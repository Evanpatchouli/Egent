import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const data = await mkdtemp(root + '.tmp/desktop-pair-');
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
let a = await start('alpha', 44101);
let b = await start('beta', 44102);
let peerId = '',
  conversation = '',
  messageId = '';
try {
  await test('local owner is machine-derived; nickname changes do not change identity', async () => {
    assert.equal((await api(a, '/api/device/nickname', { name: '小林' })).status, 200);
    await api(b, '/api/device/nickname', { name: '小林' });
    const first = (await api(a, '/api/me')).body;
    await api(a, '/api/device/nickname', { name: '小林的新昵称' });
    assert.equal((await api(a, '/api/me')).body.identifier, first.identifier);
    assert.notEqual((await api(b, '/api/me')).body.identifier, first.identifier);
    assert.equal(
      (await fetch(a.url + '/api/me', { headers: { 'X-Egent-User-Identifier': first.identifier } }))
        .status,
      401,
    );
    assert.equal((await api(a, '/api/users', { name: '伪造' })).status, 403);
  });
  await test('system notifications default on and can be changed locally', async () => {
    const path = '/api/device/notification-settings';
    assert.equal((await fetch(a.url + path)).status, 401);
    assert.equal((await api(a, path)).body.systemNotifications, true);
    assert.equal(
      (await api(a, path, { systemNotifications: false }, undefined, 'PUT')).body
        .systemNotifications,
      false,
    );
    assert.equal((await api(b, path)).body.systemNotifications, true);
    assert.equal(
      (await api(a, path, { systemNotifications: 'false' }, undefined, 'PUT')).status,
      400,
    );
  });
  await test('DeepSeek settings remain local and never return the key', async () => {
    const path = '/api/device/deepseek-settings';
    assert.equal((await fetch(a.url + path)).status, 401);
    const updated = await api(
      a,
      path,
      { baseUrl: 'https://example.test/v1/', apiKey: 'secret-for-test' },
      undefined,
      'PUT',
    );
    assert.equal(updated.status, 200);
    assert.equal(updated.body.baseUrl, 'https://example.test/v1');
    assert.equal(updated.body.hasSavedKey, true);
    assert.ok(!JSON.stringify(updated.body).includes('secret-for-test'));
    assert.equal(
      (await api(a, path, { baseUrl: 'http://example.test', apiKey: null }, undefined, 'PUT'))
        .status,
      400,
    );
    assert.equal(
      (
        await api(
          a,
          path,
          { baseUrl: 'https://user:password@example.test', apiKey: null },
          undefined,
          'PUT',
        )
      ).status,
      400,
    );
    assert.equal(
      (await api(a, path, { baseUrl: 'https://example.test', apiKey: null }, undefined, 'PUT')).body
        .hasSavedKey,
      true,
    );
    assert.equal((await api(b, path)).body.hasSavedKey, false);
    const stored = JSON.parse(await readFile(data + '/alpha/deepseek-settings.json', 'utf8'));
    assert.equal(stored.apiKey, 'secret-for-test');
    const removed = await api(
      a,
      path,
      { baseUrl: 'https://api.deepseek.com', apiKey: '' },
      undefined,
      'PUT',
    );
    assert.equal(removed.body.hasSavedKey, false);
  });
  await test('probe/handshake verifies identity and only returns peer-visible projects', async () => {
    await api(
      b,
      '/api/projects/visibility',
      { projectPath: root, colleagueVisible: true },
      undefined,
      'PUT',
    );
    const probe = await api(a, '/api/peers/probe', { address: b.url });
    assert.equal(probe.status, 200);
    peerId = probe.body.deviceId;
    const connected = await api(a, '/api/peers/connect', { address: b.url, deviceId: peerId });
    assert.equal(connected.status, 200);
    assert.equal((await api(a, '/api/me', undefined, peerId)).body.role, 'COLLEAGUE');
    assert.equal(
      (await api(a, '/api/device/deepseek-settings', undefined, peerId)).body.error.code,
      'PEER_FORBIDDEN',
    );
    const projects = await api(a, '/api/projects', undefined, peerId);
    assert.equal(projects.body.length, 1);
    assert.equal(
      (
        await api(
          a,
          '/api/projects/visibility',
          { projectPath: root, colleagueVisible: false },
          peerId,
          'PUT',
        )
      ).body.error.code,
      'PEER_FORBIDDEN',
    );
    assert.equal(
      (await api(a, '/api/peers/probe', { address: b.url, deviceId: 'f'.repeat(64) })).status,
      503,
    );
  });
  await test('conversation lives at target, both endpoints chat and replica is persisted', async () => {
    const created = await api(a, '/api/conversations', {
      id: randomUUID(),
      projectPath: root,
      hostId: peerId,
      memberIds: [peerId],
    });
    assert.equal(created.status, 200);
    conversation = created.body.id;
    const key = randomUUID();
    const result = await api(
      a,
      '/api/conversations/' + conversation + '/messages',
      { clientMessageId: key, content: '设备之间的第一条消息' },
      peerId,
    );
    assert.equal(result.status, 200);
    messageId = result.body.id;
    await api(b, '/api/conversations/' + conversation + '/join', {});
    const reply = await api(b, '/api/conversations/' + conversation + '/messages', {
      clientMessageId: randomUUID(),
      content: '从项目设备回复',
    });
    assert.equal(reply.status, 200);
    const duplicate = await api(
      a,
      '/api/conversations/' + conversation + '/messages',
      { clientMessageId: key, content: '设备之间的第一条消息' },
      peerId,
    );
    assert.equal(duplicate.body.id, messageId);
    assert.equal((await api(a, '/api/conversations')).body.length, 1);
    const remoteHistory = await api(
      a,
      '/api/conversations/' + conversation + '/messages',
      undefined,
      peerId,
    );
    assert.equal(remoteHistory.body.items.length, 3);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  });
  await test('offline history survives, buttons can detect offline; new address retains identity', async () => {
    await stop(b.child);
    assert.notEqual(
      (await api(a, '/api/peers/probe', { address: b.url, deviceId: peerId })).status,
      200,
    );
    const offline = await api(
      a,
      '/api/conversations/' + conversation + '/messages',
      undefined,
      peerId,
    );
    assert.equal(offline.body.items.length, 3);
    b = await start('beta', 44103);
    const connected = await api(a, '/api/peers/connect', { address: b.url, deviceId: peerId });
    assert.equal(connected.status, 200);
    assert.equal(connected.body.deviceId, peerId);
    assert.ok(
      (await api(a, '/api/conversations', undefined, peerId)).body.some(
        (c: { id: string }) => c.id === conversation,
      ),
    );
    const peer = (await api(a, '/api/peers')).body.find(
      (p: { deviceId: string }) => p.deviceId === peerId,
    );
    assert.equal(peer.address, b.url);
    assert.ok((await readFile(data + '/beta/device.json', 'utf8')).includes(peerId));
    const reverse = await api(b, '/api/peers/connect', { address: a.url });
    assert.equal(reverse.status, 200);
    assert.ok(
      (await api(b, '/api/conversations')).body.some((c: { id: string }) => c.id === conversation),
    );
    const ownHistory = await api(b, '/api/conversations/' + conversation + '/messages', undefined);
    assert.equal(ownHistory.body.items.length, 3);
  });
  await test('mentions appear only for the addressed device and clear when read', async () => {
    const sendPath = '/api/conversations/' + conversation + '/messages';
    const sent = await api(b, sendPath, {
      clientMessageId: randomUUID(),
      content: '@小林的新昵称 请看一下',
    });
    assert.equal(sent.status, 200);
    let alert;
    for (let attempt = 0; attempt < 50; attempt++) {
      alert = (await api(a, '/api/conversations')).body.find(
        (c: { id: string }) => c.id === conversation,
      )?.mentionAlert;
      if (alert) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(alert?.senderName, '小林');
    assert.equal(alert?.count, 1);
    assert.equal(
      (await api(b, '/api/conversations')).body.find((c: { id: string }) => c.id === conversation)
        ?.mentionAlert,
      null,
    );
    await stop(a.child);
    a = await start('alpha', 44101);
    await api(a, '/api/peers/connect', { address: b.url, deviceId: peerId });
    assert.equal(
      (await api(a, '/api/conversations')).body.find((c: { id: string }) => c.id === conversation)
        ?.mentionAlert?.count,
      1,
    );
    const second = await api(b, sendPath, {
      clientMessageId: randomUUID(),
      content: '@小林的新昵称 再看一条',
    });
    for (let attempt = 0; attempt < 50; attempt++) {
      const current = (await api(a, '/api/conversations')).body.find(
        (c: { id: string }) => c.id === conversation,
      )?.mentionAlert;
      if (current?.count === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(
      (await api(a, '/api/conversations')).body.find((c: { id: string }) => c.id === conversation)
        ?.mentionAlert?.count,
      2,
    );
    assert.equal(
      (await api(a, '/api/conversations/' + conversation + '/read', { messageId: sent.body.id }))
        .status,
      200,
    );
    assert.equal(
      (await api(a, '/api/conversations')).body.find((c: { id: string }) => c.id === conversation)
        ?.mentionAlert?.count,
      1,
    );
    assert.equal(
      (await api(a, '/api/conversations/' + conversation + '/read', { messageId: second.body.id }))
        .status,
      200,
    );
    assert.equal(
      (await api(a, '/api/conversations')).body.find((c: { id: string }) => c.id === conversation)
        ?.mentionAlert,
      null,
    );
    const reply = await api(a, sendPath, { clientMessageId: randomUUID(), content: '@小林 收到' });
    assert.equal(reply.status, 200);
    let ownerAlert;
    for (let attempt = 0; attempt < 50; attempt++) {
      ownerAlert = (await api(b, '/api/conversations')).body.find(
        (c: { id: string }) => c.id === conversation,
      )?.mentionAlert;
      if (ownerAlert) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(ownerAlert?.senderName, '小林的新昵称');
    assert.equal(
      (await api(b, '/api/conversations/' + conversation + '/read', { messageId: reply.body.id }))
        .status,
      200,
    );
    assert.equal(
      (await api(b, '/api/conversations')).body.find((c: { id: string }) => c.id === conversation)
        ?.mentionAlert,
      null,
    );
  });
  await test('removing history is device-local and survives restart and synchronization', async () => {
    const hide = '/api/device/conversations/' + conversation + '/hide';
    assert.equal((await fetch(a.url + hide, { method: 'POST' })).status, 401);
    assert.equal((await api(a, hide, {}, peerId)).body.error.code, 'PEER_FORBIDDEN');
    assert.equal((await api(a, hide, {})).status, 200);
    assert.ok(
      !(await api(a, '/api/conversations')).body.some((c: { id: string }) => c.id === conversation),
    );
    assert.ok(
      (await api(b, '/api/conversations')).body.some((c: { id: string }) => c.id === conversation),
    );
    assert.equal(
      (await api(b, '/api/conversations/' + conversation + '/messages')).body.items.length,
      6,
    );
    await stop(a.child);
    a = await start('alpha', 44101);
    assert.equal(
      (await api(a, '/api/device/notification-settings')).body.systemNotifications,
      false,
    );
    await api(a, '/api/peers/connect', { address: b.url, deviceId: peerId });
    assert.ok(
      !(await api(a, '/api/conversations')).body.some((c: { id: string }) => c.id === conversation),
    );
    assert.equal((await api(b, hide, {})).status, 200);
    assert.equal(
      (await api(a, '/api/conversations/' + conversation + '/messages', undefined, peerId)).status,
      200,
    );
  });
  console.log('Desktop pair fixture:', data);
} finally {
  await Promise.all(processes.map(stop));
}
