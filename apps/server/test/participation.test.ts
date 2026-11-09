import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { AgentExecutor } from '../src/agent/contracts.js';
const root = fileURLToPath(new URL('../../../', import.meta.url));
process.env.EGENT_DATA_DIR = await mkdtemp(root + '.tmp/participation-');
const { prisma, initializeDatabase } = await import('@egent/database');
await initializeDatabase();
const { createConversation, inviteMembers, setAgentParticipation } =
  await import('../src/services/conversations.js');
const { sendMessage } = await import('../src/services/messages.js');
const { participateOnce } = await import('../src/agent/participation.js');
const owner = await prisma.user.create({
  data: { name: 'Owner', identifier: 'a'.repeat(64), role: 'OWNER' },
});
const late = await prisma.user.create({
  data: { name: 'Late', identifier: 'b'.repeat(64), role: 'COLLEAGUE' },
});
const project = process.env.EGENT_DATA_DIR;
const reader = async () => [{ path: project, name: 'fixture' }];
let calls = 0,
  prompt = '',
  reply = false;
let gate: Promise<void> | undefined;
const executor: AgentExecutor = {
  analyze: async () => {
    throw new Error('not an explicit analysis');
  },
  implement: async () => {
    throw new Error('autonomy must never write');
  },
  participate: async (input) => {
    calls++;
    prompt = input.prompt;
    await gate;
    return {
      shouldReply: reply,
      answer: reply ? '可验证的回答' : '',
      evidence: reply ? ['README: 依据'] : [],
    };
  },
};
const send = (id: string, content: string) =>
  sendMessage(owner, id, { content, clientMessageId: randomUUID() });
const due = (id: string) =>
  prisma.conversation.update({ where: { id }, data: { autoAgentPendingAt: new Date(0) } });
const run = () =>
  participateOnce(
    () => executor,
    new AbortController().signal,
    async (p) => p,
  );
const answers = (id: string) =>
  prisma.message.count({ where: { conversationId: id, senderType: 'AGENT' } });
try {
  await test('enabled by default, debounced batches may stay silent without a task or message', async () => {
    const c = await createConversation(owner, project, reader);
    assert.equal(c.autoAgentEnabled, true);
    await send(c.id, '你好');
    await send(c.id, '收到');
    assert.equal(await run(), false);
    assert.equal(calls, 0);
    await due(c.id);
    assert.equal(await run(), true);
    assert.equal(calls, 1);
    assert.equal(await answers(c.id), 0);
    assert.equal(await prisma.agentTask.count(), 0);
    assert.equal(await run(), false);
  });
  await test('switch-off suppresses ordinary-message checks; replies have cooldown and do not trigger themselves', async () => {
    const c = await createConversation(owner, project, reader);
    await setAgentParticipation(owner, c.id, false);
    await send(c.id, '关闭后的问题');
    assert.equal(await run(), false);
    assert.equal(calls, 1);
    await setAgentParticipation(owner, c.id, true);
    reply = true;
    await send(c.id, '新问题');
    await due(c.id);
    await run();
    assert.equal(await answers(c.id), 1);
    assert.equal(await run(), false);
    await send(c.id, '继续讨论');
    const state = await prisma.conversation.findUniqueOrThrow({ where: { id: c.id } });
    assert.ok(state.autoAgentPendingAt!.getTime() >= state.autoAgentLastReplyAt!.getTime() + 30000);
    await setAgentParticipation(owner, c.id, false);
  });
  await test('new messages and off-on toggles invalidate an in-flight autonomous answer', async () => {
    const c = await createConversation(owner, project, reader);
    await send(c.id, '旧问题');
    await due(c.id);
    let release!: () => void;
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const before = calls,
      pending = run();
    while (calls === before) await new Promise((r) => setTimeout(r, 5));
    await send(c.id, '问题已经由同事回答');
    release();
    await pending;
    gate = undefined;
    assert.equal(await answers(c.id), 0);
    await due(c.id);
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const count = calls,
      toggled = run();
    while (calls === count) await new Promise((r) => setTimeout(r, 5));
    await setAgentParticipation(owner, c.id, false);
    await setAgentParticipation(owner, c.id, true);
    release();
    await toggled;
    gate = undefined;
    assert.equal(await answers(c.id), 0);
  });
  await test('membership changes discard drafts; later checks use only jointly visible history', async () => {
    const c = await createConversation(owner, project, reader);
    await send(c.id, 'PRIVATE_BEFORE_JOIN');
    await due(c.id);
    let release!: () => void;
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const count = calls,
      pending = run();
    while (calls === count) await new Promise((r) => setTimeout(r, 5));
    await inviteMembers(owner, c.id, [late.id]);
    await assert.rejects(setAgentParticipation(late, c.id, false));
    release();
    await pending;
    gate = undefined;
    assert.equal(await answers(c.id), 0);
    await send(c.id, 'PUBLIC_AFTER_JOIN');
    await due(c.id);
    await run();
    assert.ok(prompt.includes('PUBLIC_AFTER_JOIN'));
    assert.ok(!prompt.includes('PRIVATE_BEFORE_JOIN'));
    assert.equal(await answers(c.id), 1);
  });
} finally {
  await prisma.$disconnect();
}
