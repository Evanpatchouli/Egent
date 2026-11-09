import assert from 'node:assert/strict';
import { test } from 'node:test';
import { io } from 'socket.io-client';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const data = await mkdtemp(root + '.tmp/group-devices-');
const processes: ChildProcess[] = [];
async function start(name: string, port: number) {
  const child = spawn(process.execPath, [root + 'apps/server/dist/server.js'], {
    env: {
      ...process.env,
      EGENT_DATA_DIR: data + '/' + name,
      EGENT_TEST_MODE: '1',
      EGENT_TEST_DEVICE_ID: name,
      EGENT_LOCAL_TOKEN: name + '-local-token',
      EGENT_TEST_PROJECTS: JSON.stringify([{ path: root, name: 'Egent fixture' }]),
      SERVER_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  processes.push(child);
  await new Promise<void>((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('startup timeout ' + output)), 15000);
    child.stdout!.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('EGENT_READY')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr!.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error('startup exited ' + code + ' ' + output));
    });
  });
  return { name, port, url: 'http://127.0.0.1:' + port, child };
}
type Device = Awaited<ReturnType<typeof start>>;
async function api(device: Device, path: string, body?: unknown, peerId?: string, method?: string) {
  const response = await fetch(device.url + path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      'Content-Type': 'application/json',
      'X-Egent-Local-Token': device.name + '-local-token',
      ...(peerId ? { 'X-Egent-Peer': peerId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, body: await response.json() };
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill();
  await exited;
}

async function ok(device: Device, path: string, body?: unknown, peer?: string, method?: string) {
  const result = await api(device, path, body, peer, method);
  assert.ok(result.status >= 200 && result.status < 300, JSON.stringify(result));
  return result.body;
}
async function eventually(check: () => Promise<boolean>, label: string) {
  const until = Date.now() + 18000;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.fail(label);
}
const all: Device[] = [];
try {
  for (const [i, name] of ['creator', 'project-owner', 'initial-member', 'late-member'].entries()) {
    const device = await start(name, 44501 + i);
    all.push(device);
    await ok(device, '/api/device/nickname', { name });
    await ok(
      device,
      '/api/projects/visibility',
      { projectPath: root, colleagueVisible: true },
      undefined,
      'PUT',
    );
  }
  const [a, b, c, d] = all as [Device, Device, Device, Device];
  const ids = await Promise.all(
    all.map(async (device) => (await ok(device, '/api/device')).deviceId as string),
  );
  const [aid, bid, cid, did] = ids as [string, string, string, string];
  for (const peer of [b, c, d]) await ok(a, '/api/peers/connect', { address: peer.url });
  let id = '',
    oldMessage = '',
    newest = '';
  await test('creator selects one of all members projects; three members discover one immutable authority', async () => {
    const projects = await ok(a, '/api/workspace/projects', { memberIds: [bid, cid] });
    assert.deepEqual(
      new Set(projects.map((p: { deviceId: string }) => p.deviceId)),
      new Set([aid, bid, cid]),
    );
    id = randomUUID();
    const input = { id, hostId: bid, projectPath: root, memberIds: [bid, cid] };
    const created = await ok(a, '/api/conversations', input);
    assert.equal(created.hostId, bid);
    assert.equal(created.canConfigureAgent, false);
    const deniedToggle = await api(
      a,
      '/api/conversations/' + id + '/agent-participation',
      { enabled: false },
      undefined,
      'PUT',
    );
    assert.equal(deniedToggle.body.error.code, 'FORBIDDEN');
    const ownerToggle = await ok(
      b,
      '/api/conversations/' + id + '/agent-participation',
      { enabled: false },
      undefined,
      'PUT',
    );
    assert.equal(ownerToggle.canConfigureAgent, true);
    assert.equal(ownerToggle.autoAgentEnabled, false);
    assert.equal(created.createdByUserId, (await ok(a, '/api/me')).id);
    assert.equal(created.members.length, 3);
    assert.equal((await ok(a, '/api/conversations', input)).id, id);
    assert.equal(
      (await api(a, '/api/conversations', { ...input, projectPath: root + 'other' })).status,
      400,
    );
    await eventually(
      async () => (await ok(c, '/api/conversations')).some((x: { id: string }) => x.id === id),
      'invitee discovers host automatically',
    );
    for (const device of [a, b, c])
      assert.equal(
        (await ok(device, '/api/conversations')).filter((x: { id: string }) => x.id === id).length,
        1,
      );
    const sent = await ok(a, '/api/conversations/' + id + '/messages', {
      content: 'SECRET BEFORE JOIN',
      clientMessageId: randomUUID(),
    });
    oldMessage = sent.id;
    await ok(c, '/api/conversations/' + id + '/messages', {
      content: 'initial member can reply',
      clientMessageId: randomUUID(),
    });
    await ok(d, '/api/peers/connect', { address: b.url });
    assert.equal(
      (await api(d, '/api/conversations/' + id + '/messages', undefined, bid)).status,
      400,
    );
    assert.equal((await api(d, '/api/conversations/' + id + '/join', {}, bid)).status, 400);
    assert.equal((await ok(d, '/api/conversations')).length, 0);
  });
  await test('project device resolves model settings, rejects remote edits and restores inheritance', async () => {
    const global = '/api/device/agent-model';
    const conversation = '/api/conversations/' + id;
    const override = conversation + '/agent-model';
    const profile = { provider: 'dsh', model: 'deepseek-v4-pro', effort: 'max' };
    const other = { provider: 'codex', model: null, effort: 'low' };
    assert.equal((await ok(b, global)).source, 'environment');
    await ok(b, global, { profile }, undefined, 'PUT');
    assert.deepEqual((await ok(a, conversation)).agentModelSettings, { profile, source: 'global' });
    assert.equal(
      (await api(a, override, { profile: other }, undefined, 'PUT')).body.error.code,
      'FORBIDDEN',
    );
    assert.equal(
      (await api(a, global, { profile: other }, bid, 'PUT')).body.error.code,
      'PEER_FORBIDDEN',
    );
    assert.equal(
      (await api(b, override, { profile: { ...profile, effort: 'invalid' } }, undefined, 'PUT'))
        .status,
      400,
    );
    await ok(b, override, { profile: other }, undefined, 'PUT');
    await ok(b, global, { profile: null }, undefined, 'PUT');
    assert.deepEqual((await ok(a, conversation)).agentModelSettings, {
      profile: other,
      source: 'conversation',
    });
    await ok(b, override, { profile: null }, undefined, 'PUT');
    const defaults = await ok(b, global);
    assert.deepEqual((await ok(a, conversation)).agentModelSettings, {
      profile: defaults.profile,
      source: defaults.source,
    });
  });
  await test('global and conversation remember separate provider settings after switching', async () => {
    const global = '/api/device/agent-model';
    const conversation = '/api/conversations/' + id;
    const local = conversation + '/agent-model';
    const codex = { provider: 'codex', model: 'gpt-6.1-terra', effort: 'xhigh' };
    const dsh = { provider: 'dsh', model: 'deepseek-v4-pro', effort: 'max' };
    const deepseek = { provider: 'deepseek', model: 'deepseek-flash', effort: 'low' };
    for (const profile of [codex, deepseek, dsh])
      await ok(b, global, { profile }, undefined, 'PUT');
    const globalSettings = await ok(b, global);
    assert.deepEqual(globalSettings.profile, dsh);
    assert.deepEqual(globalSettings.savedProfiles, { codex, dsh, deepseek });
    const custom = { ...codex, effort: 'medium' };
    await ok(b, local, { profile: custom }, undefined, 'PUT');
    await ok(b, local, { profile: dsh }, undefined, 'PUT');
    const choices = (await ok(b, conversation)).agentModelSettings.savedProfiles;
    assert.deepEqual(choices, { codex: custom, dsh, deepseek });
    assert.deepEqual((await ok(b, global)).savedProfiles.codex, codex);
    assert.equal((await ok(a, conversation)).agentModelSettings.savedProfiles, undefined);
    await ok(b, local, { profile: choices.codex }, undefined, 'PUT');
    assert.deepEqual((await ok(a, conversation)).agentModelSettings.profile, custom);
    assert.deepEqual(await ok(b, local, { profile: null }, undefined, 'PUT'), globalSettings);
    await ok(b, global, { profile: null }, undefined, 'PUT');
  });
  await test('late invitation limits history, old cursors, title and unread; repeats preserve the boundary', async () => {
    await ok(a, '/api/conversations/' + id + '/invite', { memberIds: [did] });
    await eventually(
      async () => (await ok(d, '/api/conversations')).some((x: { id: string }) => x.id === id),
      'late member discovers conversation',
    );
    const detail = await ok(d, '/api/conversations/' + id);
    assert.equal(detail.title, '新加入的会话');
    assert.equal(detail.unreadCount, 0);
    assert.equal(detail.members.length, 4);
    assert.equal((await ok(d, '/api/conversations/' + id + '/messages')).items.length, 0);
    for (const cursor of ['before', 'after'])
      assert.equal(
        (await api(d, '/api/conversations/' + id + '/messages?' + cursor + '=' + oldMessage))
          .status,
        400,
      );
    assert.equal(
      (await api(d, '/api/conversations/' + id + '/read', { messageId: oldMessage })).status,
      400,
    );
    for (let n = 0; n < 7; n++)
      newest = (
        await ok(b, '/api/conversations/' + id + '/messages', {
          content: 'visible after join ' + n,
          clientMessageId: randomUUID(),
        })
      ).id;
    const visible = await ok(d, '/api/conversations/' + id + '/messages?limit=2');
    assert.equal(visible.items.length, 2);
    assert.equal(visible.hasMore, true);
    const earlier = await ok(
      d,
      '/api/conversations/' + id + '/messages?limit=100&before=' + visible.nextCursor,
    );
    assert.equal(earlier.items.length, 5);
    assert.ok(
      [...earlier.items, ...visible.items].every((m: { content: string }) =>
        m.content.startsWith('visible after join'),
      ),
    );
    assert.equal((await ok(d, '/api/conversations/' + id)).unreadCount, 7);
    await ok(a, '/api/conversations/' + id + '/invite', { memberIds: [did] });
    assert.equal((await ok(d, '/api/conversations/' + id)).historyAfter, detail.historyAfter);
    await ok(d, '/api/conversations/' + id + '/read', { messageId: newest });
    assert.equal((await ok(d, '/api/conversations/' + id)).unreadCount, 0);
    assert.equal(
      (await api(a, '/api/conversations/' + id, { projectPath: 'changed' }, undefined, 'PUT'))
        .status,
      400,
    );
    const other = await ok(a, '/api/conversations', {
      id: randomUUID(),
      hostId: aid,
      projectPath: root,
      memberIds: [cid],
    });
    assert.equal(other.hostId, aid);
    assert.equal((await ok(a, '/api/conversations')).length, 2);
    await eventually(
      async () => (await ok(c, '/api/conversations')).length === 2,
      'different authorities aggregate without duplicate projects',
    );
  });
  await test('unified socket routes a late member to the remote host without replaying old history', async () => {
    const socket = io(d.url, {
      auth: { localToken: d.name + '-local-token' },
      transports: ['websocket'],
    });
    const seen: { id: string; content: string }[] = [];
    socket.on('message:new', (message) => seen.push(message));
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
      const joined = await new Promise<{ ok: boolean }>((resolve) =>
        socket.emit('conversation:join', { conversationId: id }, resolve),
      );
      assert.equal(joined.ok, true);
      const response = await new Promise<{ ok: boolean; data: { id: string } }>((resolve) =>
        socket.emit(
          'message:send',
          { conversationId: id, clientMessageId: randomUUID(), content: 'socket after join' },
          resolve,
        ),
      );
      assert.equal(response.ok, true);
      await eventually(
        async () => seen.some((m) => m.id === response.data.id),
        'late member receives live socket message',
      );
      assert.ok(
        !seen.some((m) => m.content.includes('SECRET') || m.content.includes('initial member')),
      );
      assert.ok(
        (await ok(b, '/api/conversations/' + id + '/messages')).items.some(
          (m: { id: string }) => m.id === response.data.id,
        ),
      );
      await ok(d, '/api/conversations/' + id + '/read', { messageId: response.data.id });
    } finally {
      socket.disconnect();
    }
  });
  await test('offline cache retains only allowed records; same device at a new IP restores group access', async () => {
    await eventually(
      async () =>
        (await ok(d, '/api/conversations')).some(
          (x: { id: string; unreadCount: number }) => x.id === id && x.unreadCount === 0,
        ),
      'read status synchronized',
    );
    await new Promise((r) => setTimeout(r, 1800));
    await stop(b.child);
    await eventually(
      async () =>
        (await ok(d, '/api/peers')).some(
          (p: { deviceId: string; online: boolean }) => p.deviceId === bid && !p.online,
        ),
      'host goes offline',
    );
    const cache = await ok(d, '/api/conversations/' + id + '/messages');
    assert.equal(cache.items.length, 8);
    assert.ok(!JSON.stringify(cache).includes('SECRET'));
    assert.equal(
      (
        await api(d, '/api/conversations/' + id + '/messages', {
          clientMessageId: randomUUID(),
          content: 'cannot send offline',
        })
      ).status,
      503,
    );
    assert.equal((await api(d, '/api/peers/probe', { address: c.url, deviceId: bid })).status, 503);
    const moved = await start('project-owner', 44505);
    all.push(moved);
    assert.equal(
      (await ok(d, '/api/peers/connect', { address: moved.url, deviceId: bid })).deviceId,
      bid,
    );
    await ok(d, '/api/conversations/' + id + '/messages', {
      clientMessageId: randomUUID(),
      content: 'after reconnection',
    });
    assert.equal((await ok(d, '/api/conversations/' + id + '/messages')).items.length, 9);
  });
  console.log('Group fixture:', data);
} finally {
  await Promise.all(processes.map(stop));
}
