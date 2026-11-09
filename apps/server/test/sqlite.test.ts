import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import type { AgentExecutor, AnalysisResult } from '../src/agent/contracts.js';
import type { UserInfo } from '@egent/shared';
const root = fileURLToPath(new URL('../../../', import.meta.url));
process.env.EGENT_DATA_DIR = await mkdtemp(root + '.tmp/sqlite-test-');
const { initializeDatabase, prisma } = await import('@egent/database');
await initializeDatabase();
await initializeDatabase();
const { createConversation, joinConversation } = await import('../src/services/conversations.js');
const { sendMessage, messageHistory } = await import('../src/services/messages.js');
const { AgentService } = await import('../src/agent/service.js');
const { seal, unseal, verified, signed } = await import('../src/device/identity.js');
const { generateKeyPairSync } = await import('node:crypto');
const { id: ownerId, ...unused } = { id: randomUUID() };
void unused;
const owner: UserInfo = await prisma.user.create({
  data: {
    id: ownerId,
    identifier: createHash('sha256').update('owner').digest('hex'),
    name: '同名',
    role: 'OWNER',
  },
});
const colleague: UserInfo = await prisma.user.create({
  data: {
    identifier: createHash('sha256').update('colleague').digest('hex'),
    name: '同名',
    role: 'COLLEAGUE',
  },
});
const project = process.env.EGENT_DATA_DIR;
const reader = async () => [{ path: project, name: 'fixture' }];
await prisma.projectSetting.create({ data: { projectPath: project, colleagueVisible: true } });
let agent: InstanceType<typeof AgentService> | undefined;
try {
  await test('SQLite uniqueness, local role and transactional chat idempotency', async () => {
    await assert.rejects(
      prisma.user.create({ data: { name: 'second', identifier: 'f'.repeat(64), role: 'OWNER' } }),
    );
    const c = await createConversation(colleague, project, reader);
    await joinConversation(owner, c.id);
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        sendMessage(colleague, c.id, { content: '相同消息', clientMessageId: key }),
      ),
    );
    assert.equal(new Set(results.map((m) => m.id)).size, 1);
    assert.equal((await messageHistory(owner, c.id, {})).items.length, 2);
  });
  await test('Agent simple confirmation, complex Owner gate and persistent waiting on SQLite', async () => {
    let nextType: AnalysisResult['type'] = 'DEVELOPMENT_SIMPLE',
      implemented = 0;
    const executor: AgentExecutor = {
      analyze: async () => ({
        type: nextType,
        summary: '测试方案',
        confidence: 1,
        plan: ['测试修改'],
        affectedAreas: ['fixture'],
        risks: [],
        needsOwnerConfirmation: nextType === 'DEVELOPMENT_COMPLEX',
        answer: '',
        evidence: [],
        certain: false,
      }),
      participate: async () => ({ shouldReply: false, answer: '', evidence: [] }),
      implement: async () => {
        implemented++;
        return { success: true, summary: 'fake完成', changedFiles: [], verification: ['测试'] };
      },
    };
    agent = new AgentService(
      () => executor,
      async (p) => p,
    );
    await agent.start();
    const c = await createConversation(colleague, project, reader);
    await joinConversation(owner, c.id);
    await agent.create(colleague, c.id, { content: '开发任务', clientMessageId: randomUUID() });
    await agent.idle();
    assert.equal(
      (await prisma.agentTask.findFirstOrThrow({ where: { conversationId: c.id } })).status,
      'WAITING_USER_CONFIRMATION',
    );
    await agent.stop();
    agent = new AgentService(
      () => executor,
      async (p) => p,
    );
    await agent.start();
    await agent.idle();
    assert.equal(
      (await prisma.agentTask.findFirstOrThrow({ where: { conversationId: c.id } })).status,
      'WAITING_USER_CONFIRMATION',
    );
    await sendMessage(colleague, c.id, { content: '确认', clientMessageId: randomUUID() });
    await agent.idle();
    assert.equal(implemented, 0);
    const pending = await prisma.agentTask.findFirstOrThrow({ where: { conversationId: c.id } });
    await agent.action(colleague, pending.id, 'confirm', {
      planVersion: pending.planVersion,
      revision: pending.revision,
      clientMessageId: randomUUID(),
    });
    await agent.idle();
    assert.equal(implemented, 1);
    nextType = 'DEVELOPMENT_COMPLEX';
    const complex = await createConversation(colleague, project, reader);
    await joinConversation(owner, complex.id);
    await agent.create(colleague, complex.id, {
      content: '复杂任务',
      clientMessageId: randomUUID(),
    });
    await agent.idle();
    await sendMessage(colleague, complex.id, { content: '同意', clientMessageId: randomUUID() });
    await agent.idle();
    assert.equal(implemented, 1);
    const complexTask = await prisma.agentTask.findFirstOrThrow({
      where: { conversationId: complex.id },
    });
    await assert.rejects(
      agent.action(colleague, complexTask.id, 'confirm', {
        planVersion: complexTask.planVersion,
        revision: complexTask.revision,
        clientMessageId: randomUUID(),
      }),
    );
    await agent.action(owner, complexTask.id, 'confirm', {
      planVersion: complexTask.planVersion,
      revision: complexTask.revision,
      clientMessageId: randomUUID(),
    });
    await agent.idle();
    assert.equal(implemented, 2);
  });
  await test('late membership hides task output, titles and unread; project binding is enforced by SQLite', async () => {
    await agent?.stop();
    (await import('../src/agent/task-store.js')).setAgentAccepting(false);
    const { inviteMembers, conversationInfo, visibleTaskWhere, markRead, listConversations } =
      await import('../src/services/conversations.js');
    const c = await createConversation(owner, project, reader);
    const late = await prisma.user.create({
      data: { name: 'late', identifier: 'd'.repeat(64), role: 'COLLEAGUE' },
    });
    await assert.rejects(joinConversation(late, c.id));
    assert.equal((await listConversations(late)).length, 0);
    const trigger = await sendMessage(owner, c.id, {
      content: 'private old title',
      clientMessageId: randomUUID(),
    });
    const task = await prisma.agentTask.create({
      data: {
        conversationId: c.id,
        triggerMessageId: trigger.id,
        workspacePath: project,
        status: 'FAILED',
        errorMessage: 'private error',
      },
    });
    await inviteMembers(owner, c.id, [late.id]);
    await prisma.message.create({
      data: {
        conversationId: c.id,
        senderType: 'AGENT',
        agentTaskId: task.id,
        content: 'private old task result',
        createdAt: new Date(new Date(trigger.createdAt).getTime() + 1),
      },
    });
    assert.equal((await messageHistory(late, c.id, {})).items.length, 0);
    assert.equal((await conversationInfo(late, c.id)).title, '新加入的会话');
    assert.equal((await conversationInfo(late, c.id)).unreadCount, 0);
    assert.equal(
      (await prisma.agentTask.findMany({ where: await visibleTaskWhere(late, c.id) })).length,
      0,
    );
    await assert.rejects(markRead(late, c.id, trigger.id));
    const next = await sendMessage(owner, c.id, {
      content: 'public new request',
      clientMessageId: randomUUID(),
    });
    assert.equal((await messageHistory(late, c.id, {})).items[0]?.id, next.id);
    assert.equal((await conversationInfo(late, c.id)).unreadCount, 1);
    const newTask = await prisma.agentTask.create({
      data: {
        conversationId: c.id,
        triggerMessageId: next.id,
        workspacePath: project,
        status: 'COMPLETED',
      },
    });
    assert.deepEqual(
      (await prisma.agentTask.findMany({ where: await visibleTaskWhere(late, c.id) })).map(
        (t) => t.id,
      ),
      [newTask.id],
    );
    await assert.rejects(
      prisma.conversation.update({
        where: { id: c.id },
        data: { projectPath: project + '-other' },
      }),
    );
    await prisma.conversationParticipant.delete({
      where: { conversationId_userId: { conversationId: c.id, userId: owner.id } },
    });
    await assert.rejects(joinConversation(owner, c.id));
    assert.ok(!(await listConversations(owner)).some((row) => row.id === c.id));
  });
  await test('encrypted packets detect tampering and device signatures bind handshake', () => {
    const key = Buffer.alloc(32, 4),
      packet = seal(key, { secret: '内容' });
    assert.deepEqual(unseal(key, packet), { secret: '内容' });
    assert.throws(() => unseal(Buffer.alloc(32, 5), packet));
    const pair = generateKeyPairSync('ed25519');
    const identity = {
      deviceId: 'a'.repeat(64),
      privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    };
    const result = signed(identity, { deviceId: identity.deviceId, nonce: '123' });
    assert.ok(verified(identity.publicKey, result.payload, result.signature));
    assert.ok(!verified(identity.publicKey, { nonce: 'changed' }, result.signature));
  });
} finally {
  await agent?.stop();
  await prisma.$disconnect();
}
