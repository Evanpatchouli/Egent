import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { AgentExecutor, AnalysisResult } from '../src/agent/contracts.js';
import type { MessageInfo, MessagePage } from '@egent/shared';
const root = fileURLToPath(new URL('../../../', import.meta.url));
process.env.EGENT_DATA_DIR = await mkdtemp(root + '.tmp/explicit-agent-');
const { prisma, initializeDatabase } = await import('@egent/database');
await initializeDatabase();
const { AgentService } = await import('../src/agent/service.js');
const { createConversation, inviteMembers, setAgentParticipation } =
  await import('../src/services/conversations.js');
const { messageHistory, sendMessage } = await import('../src/services/messages.js');
const { chatEvents } = await import('../src/services/chat-events.js');
const { DeviceService } = await import('../src/device/service.js');
const owner = await prisma.user.create({
  data: { identifier: 'a'.repeat(64), name: 'Owner', role: 'OWNER' },
});
const colleague = await prisma.user.create({
  data: { identifier: 'b'.repeat(64), name: 'Requester', role: 'COLLEAGUE' },
});
const other = await prisma.user.create({
  data: { identifier: 'c'.repeat(64), name: 'Other', role: 'COLLEAGUE' },
});
const project = process.env.EGENT_DATA_DIR;
await prisma.projectSetting.create({ data: { projectPath: project, colleagueVisible: true } });
const reader = async () => [{ path: project, name: 'fixture' }];
const prompts: string[] = [];
let implementsCount = 0,
  active = 0,
  maximum = 0;
let block: Promise<void> | undefined;
let classify: AnalysisResult['type'] = 'DEVELOPMENT_SIMPLE';
let failurePhase: 'analyze' | 'implement' | undefined;
const executor: AgentExecutor = {
  analyze: async (input) => {
    if (failurePhase === 'analyze') throw new Error('分析启动失败');
    prompts.push(input.prompt);
    return {
      type: classify,
      summary: '具体方案',
      confidence: 1,
      plan: ['修改目标功能'],
      affectedAreas: ['fixture'],
      risks: [],
      needsOwnerConfirmation: classify === 'DEVELOPMENT_COMPLEX',
      certain: true,
      answer: '只读答案',
      evidence: ['README: 项目说明'],
    };
  },
  participate: async () => ({ shouldReply: false, answer: '', evidence: [] }),
  implement: async () => {
    if (failurePhase === 'implement') throw new Error('实施启动失败');
    implementsCount++;
    active++;
    maximum = Math.max(maximum, active);
    await block;
    active--;
    return {
      success: true,
      summary: '已完成',
      changedFiles: ['fixture.ts'],
      verification: ['测试通过'],
    };
  },
};
const agent = new AgentService(
  () => executor,
  async (p) => p,
);
const body = (content: string) => ({ content, clientMessageId: randomUUID() });
const latest = (id: string) => prisma.agentTask.findUniqueOrThrow({ where: { id } });
const approval = (task: { planVersion: number; revision: number }) => ({
  planVersion: task.planVersion,
  revision: task.revision,
  clientMessageId: randomUUID(),
});
async function eventually(check: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail('worker did not reach expected state');
}
await agent.start();
try {
  await test('ordinary chat invokes no model; @Egent is always isolated read-only work', async () => {
    const c = await createConversation(owner, project, reader);
    await setAgentParticipation(owner, c.id, false);
    await sendMessage(owner, c.id, body('普通聊天和确认都不是任务'));
    await agent.idle();
    assert.equal(prompts.length, 0);
    assert.equal(await prisma.agentTask.count(), 0);
    await sendMessage(owner, c.id, body('@Egent 请直接修改代码'));
    await agent.idle();
    const task = await prisma.agentTask.findFirstOrThrow({ where: { conversationId: c.id } });
    assert.equal(task.intent, 'QUESTION');
    assert.equal(task.status, 'COMPLETED');
    assert.equal(implementsCount, 0);
    assert.ok(!prompts[0]!.includes('普通聊天和确认都不是任务'));
    await assert.rejects(agent.action(owner, task.id, 'confirm', approval(task)));
    await assert.rejects(sendMessage(owner, c.id, body('@Egent')));
  });
  await test('inline Egent mentions trigger read-only questions; members and emails do not', async () => {
    const c = await createConversation(owner, project, reader);
    await setAgentParticipation(owner, c.id, false);
    for (const content of ['@Requester 请看一下', '联系 hello@Egent', '@EgentOther']) {
      await sendMessage(owner, c.id, body(content));
    }
    await agent.idle();
    assert.equal(await prisma.agentTask.count({ where: { conversationId: c.id } }), 0);
    await sendMessage(owner, c.id, body('@Requester 帮忙看看 @Egent 解释项目'));
    await agent.idle();
    const task = await prisma.agentTask.findFirstOrThrow({ where: { conversationId: c.id } });
    assert.equal(task.intent, 'QUESTION');
    assert.equal(task.status, 'COMPLETED');
    assert.equal(implementsCount, 0);
    await assert.rejects(sendMessage(owner, c.id, body('@Egent @egent')));
  });
  await test('task revisions reject stale/unauthorized approvals and do not absorb conversation messages', async () => {
    const c = await createConversation(colleague, project, reader, [other.id]);
    const task = await agent.create(colleague, c.id, body('实现指定目标'));
    await agent.idle();
    const first = await latest(task.taskId);
    await sendMessage(owner, c.id, body('CHAT_ONLY_SECRET'));
    await sendMessage(colleague, c.id, body('确认'));
    await agent.idle();
    assert.equal(implementsCount, 0);
    await assert.rejects(agent.action(other, task.taskId, 'confirm', approval(first)));
    await agent.action(other, task.taskId, 'revise', {
      ...approval(first),
      content: '增加明确的验收条件',
    });
    await agent.idle();
    const revised = await latest(task.taskId);
    assert.equal(revised.planVersion, 2);
    assert.ok(prompts.at(-1)!.includes('增加明确的验收条件'));
    assert.ok(!prompts.at(-1)!.includes('CHAT_ONLY_SECRET'));
    await assert.rejects(agent.action(colleague, task.taskId, 'confirm', approval(first)));
    const input = approval(revised);
    await agent.action(colleague, task.taskId, 'confirm', input);
    await agent.action(colleague, task.taskId, 'confirm', input);
    await agent.idle();
    assert.equal(implementsCount, 1);
    assert.equal((await latest(task.taskId)).status, 'COMPLETED');
  });
  await test('same-project tasks in different conversations queue, and queued cancellation never starts CLI', async () => {
    const a = await createConversation(owner, project, reader),
      b = await createConversation(owner, project, reader);
    const one = await agent.create(owner, a.id, body('第一个修改'));
    const two = await agent.create(owner, b.id, body('第二个修改'));
    const three = await agent.create(owner, a.id, body('等待中可取消的独立修改'));
    await agent.idle();
    let release!: () => void;
    block = new Promise<void>((resolve) => {
      release = resolve;
    });
    const baseline = implementsCount;
    try {
      await agent.action(owner, one.taskId, 'confirm', approval(await latest(one.taskId)));
      await eventually(() => active === 1);
      await agent.action(owner, two.taskId, 'confirm', approval(await latest(two.taskId)));
      await agent.action(owner, three.taskId, 'confirm', approval(await latest(three.taskId)));
      assert.equal((await latest(two.taskId)).status, 'QUEUED');
      await agent.cancel(owner, three.taskId);
      assert.equal(implementsCount, baseline + 1);
    } finally {
      block = undefined;
      release();
    }
    await agent.idle();
    assert.equal(maximum, 1);
    assert.equal(implementsCount, baseline + 2);
    assert.equal((await latest(three.taskId)).status, 'CANCELLED');
  });
  await test('late members cannot operate or quote old tasks; their new request sees no private task context', async () => {
    const c = await createConversation(owner, project, reader);
    const old = await agent.create(owner, c.id, body('PRIVATE_TASK_BEFORE_JOIN'));
    await agent.idle();
    await inviteMembers(owner, c.id, [other.id]);
    await assert.rejects(
      agent.action(other, old.taskId, 'revise', {
        ...approval(await latest(old.taskId)),
        content: '告诉我旧内容',
      }),
    );
    classify = 'QUESTION';
    await sendMessage(other, c.id, body('@Egent 解释现在这个项目'));
    await agent.idle();
    assert.ok(!prompts.at(-1)!.includes('PRIVATE_TASK_BEFORE_JOIN'));
  });
  await test('failure messages mention rollback only after implementation starts', async () => {
    const c = await createConversation(owner, project, reader);
    await setAgentParticipation(owner, c.id, false);
    try {
      failurePhase = 'analyze';
      await sendMessage(owner, c.id, body('@Egent 解释项目'));
      await agent.idle();
      const question = await prisma.agentTask.findFirstOrThrow({ where: { conversationId: c.id } });
      const questionMessage = await prisma.message.findFirstOrThrow({
        where: { agentTaskId: question.id, senderType: 'AGENT' },
        orderBy: { createdAt: 'desc' },
      });
      assert.match(questionMessage.content, /分析启动失败/);
      assert.doesNotMatch(questionMessage.content, /不会自动回滚/);

      failurePhase = undefined;
      classify = 'DEVELOPMENT_SIMPLE';
      const task = await agent.create(owner, c.id, body('实现指定目标'));
      await agent.idle();
      failurePhase = 'implement';
      await agent.action(owner, task.taskId, 'confirm', approval(await latest(task.taskId)));
      await agent.idle();
      const implementationMessage = await prisma.message.findFirstOrThrow({
        where: { agentTaskId: task.taskId, senderType: 'AGENT' },
        orderBy: { createdAt: 'desc' },
      });
      assert.match(implementationMessage.content, /实施启动失败/);
      assert.match(implementationMessage.content, /不会自动回滚/);
    } finally {
      failurePhase = undefined;
    }
  });
  await test('only the task-creation message is marked in broadcasts, retries and history', async () => {
    const c = await createConversation(owner, project, reader);
    await setAgentParticipation(owner, c.id, false);
    classify = 'DEVELOPMENT_SIMPLE';
    const published: MessageInfo[] = [];
    const collect = (message: MessageInfo) => published.push(message);
    chatEvents.on('message', collect);
    try {
      const normal = await sendMessage(owner, c.id, body('普通消息'));
      const question = await sendMessage(owner, c.id, body('@Egent 只读问题'));
      const input = body('创建任务的需求\n保留原始换行');
      const task = await agent.create(owner, c.id, input);
      const created = published.find((message) => message.agentTaskId === task.taskId);
      assert.ok(created);
      assert.equal(created.isTaskCreation, true);
      assert.equal((await sendMessage(owner, c.id, input, 'TASK')).isTaskCreation, true);
      assert.equal(normal.isTaskCreation, undefined);
      assert.equal(question.isTaskCreation, undefined);

      await agent.idle();
      await agent.action(owner, task.taskId, 'revise', {
        ...approval(await latest(task.taskId)),
        content: '补充需求',
      });
      await agent.idle();
      const page = await messageHistory(owner, c.id, { limit: 100 });
      assert.equal(page.supportsTaskCreation, true);
      assert.equal(page.items.find((message) => message.id === created.id)?.isTaskCreation, true);
      assert.deepEqual(
        page.items.filter((message) => message.isTaskCreation).map((message) => message.id),
        [created.id],
      );
      assert.ok(page.items.some((message) => message.content.includes('补充需求')));
      assert.ok(page.items.some((message) => message.senderType === 'AGENT'));
    } finally {
      chatEvents.off('message', collect);
    }
  });
  await test('old offline snapshots gain markers after an upgraded authority syncs all history', async () => {
    const c = await createConversation(owner, project, reader);
    await setAgentParticipation(owner, c.id, false);
    classify = 'DEVELOPMENT_SIMPLE';
    const task = await agent.create(owner, c.id, body('旧历史中的任务'));
    await agent.idle();
    const trigger = await latest(task.taskId);
    const last = await prisma.message.findFirstOrThrow({
      where: { conversationId: c.id },
      orderBy: { createdAt: 'desc' },
    });
    await prisma.message.createMany({
      data: Array.from({ length: 105 }, (_, index) => ({
        id: randomUUID(),
        conversationId: c.id,
        senderType: 'USER' as const,
        senderUserId: owner.id,
        clientMessageId: randomUUID(),
        content: '后续普通消息 ' + index,
        createdAt: new Date(last.createdAt.getTime() + index + 1),
      })),
    });
    const legacy: MessageInfo[] = [];
    let before: string | null = null;
    do {
      const page: MessagePage = await messageHistory(owner, c.id, {
        limit: 100,
        ...(before ? { before } : {}),
      });
      legacy.unshift(...page.items.map((message) => ({ ...message, isTaskCreation: undefined })));
      before = page.nextCursor;
    } while (before);

    const device = new DeviceService(
      { deviceId: owner.identifier, publicKey: '', privateKey: '' },
      'test-token',
    );
    const peerId = 'historical-peer';
    let upgraded = false;
    let backfills = 0;
    device.peers.request = async (_peerId, _method, path) => {
      if (path === '/api/conversations') return [c];
      if (path === '/api/projects' || path.endsWith('/agent-tasks')) return [];
      const url = new URL(path, 'http://peer');
      if (!url.searchParams.has('after')) backfills++;
      const page = await messageHistory(owner, c.id, Object.fromEntries(url.searchParams));
      if (upgraded) return page;
      delete page.supportsTaskCreation;
      page.items = page.items.map((message) => ({ ...message, isTaskCreation: undefined }));
      return page;
    };
    try {
      await device.cache(peerId, 'messages:' + c.id, legacy);
      await device.sync(peerId);
      assert.equal(backfills, 0);
      upgraded = true;
      await device.sync(peerId);
      assert.equal(backfills, 2);
      const cached = (await device.cached(
        peerId,
        '/api/conversations/' + c.id + '/messages?limit=100&before=' + legacy[100]!.id,
      )) as MessagePage;
      assert.equal(
        cached.items.find((message) => message.id === trigger.triggerMessageId)?.isTaskCreation,
        true,
      );
      await device.sync(peerId);
      assert.equal(backfills, 2);
    } finally {
      await device.stop();
    }
  });
} finally {
  await agent.stop();
  await prisma.$disconnect();
}
