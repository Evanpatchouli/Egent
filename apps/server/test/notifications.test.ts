import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const data = await mkdtemp(root + '.tmp/notifications-');
const processes: ChildProcess[] = [];
async function start(name: string, port: number) {
  const child = spawn(process.execPath, [root + 'apps/server/dist/server.js'], {
    env: {
      ...process.env,
      EGENT_DATA_DIR: data + '/' + name,
      EGENT_TEST_MODE: '1',
      EGENT_TEST_DEVICE_ID: name,
      EGENT_LOCAL_TOKEN: name + '-token',
      SERVER_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  processes.push(child);
  await new Promise<void>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('startup timeout ' + output)), 15000);
    child.stdout!.on('data', (chunk: Buffer) => {
      output += chunk;
      if (output.includes('EGENT_READY')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr!.on('data', (chunk: Buffer) => {
      output += chunk;
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error('startup exited ' + code + ' ' + output));
    });
  });
  return { name, port, child, url: 'http://127.0.0.1:' + port };
}
type Device = Awaited<ReturnType<typeof start>>;
async function api(device: Device, path: string, body?: unknown, peerId?: string) {
  const response = await fetch(device.url + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Egent-Local-Token': device.name + '-token',
      ...(peerId ? { 'X-Egent-Peer': peerId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, body: await response.json() };
}
async function ok(device: Device, path: string, body?: unknown, peerId?: string) {
  const result = await api(device, path, body, peerId);
  assert.equal(result.status, 200, JSON.stringify(result));
  return result.body;
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill();
  await exited;
}
async function eventually(check: () => Promise<boolean>, label: string) {
  const until = Date.now() + 25000;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.fail(label);
}

let a = await start('notice-a', 44641);
let b = await start('notice-b', 44642);
const c = await start('notice-c', 44643);
try {
  for (const device of [a, b, c]) await ok(device, '/api/device/nickname', { name: device.name });
  const bid = (await ok(b, '/api/device')).deviceId as string;
  const cid = (await ok(c, '/api/device')).deviceId as string;
  await ok(a, '/api/peers/connect', { address: b.url });
  await ok(a, '/api/peers/connect', { address: c.url });

  await test('selected peers receive authenticated markdown notices exactly once and read state is local', async () => {
    assert.equal((await fetch(a.url + '/api/notifications')).status, 401);
    assert.equal(
      (await api(a, '/api/notifications', undefined, bid)).body.error.code,
      'PEER_FORBIDDEN',
    );
    const input = {
      id: randomUUID(),
      title: '只发给 B',
      content: '# 计划\n\n**重要**',
      recipientIds: [bid],
    };
    await ok(a, '/api/notifications', input);
    await ok(a, '/api/notifications', input);
    assert.equal((await api(a, '/api/notifications', { ...input, title: '不同内容' })).status, 409);
    assert.equal(
      (await api(a, '/api/notifications', { ...input, id: randomUUID(), recipientIds: [] })).status,
      400,
    );
    assert.equal(
      (
        await api(a, '/api/notifications', {
          ...input,
          id: randomUUID(),
          recipientIds: ['f'.repeat(64)],
        })
      ).status,
      400,
    );
    await eventually(
      async () =>
        (await ok(b, '/api/notifications')).some((row: { id: string }) => row.id === input.id),
      'B receives selected notification',
    );
    const received = (await ok(b, '/api/notifications'))[0];
    assert.equal(received.senderName, 'notice-a');
    assert.equal(received.content, input.content);
    assert.equal(received.read, false);
    assert.equal((await ok(c, '/api/notifications')).length, 0);
    await ok(
      a,
      '/api/notifications/deliver',
      { id: input.id, title: input.title, content: input.content, createdAt: received.createdAt },
      bid,
    );
    assert.equal((await ok(b, '/api/notifications')).length, 1);
    await ok(b, '/api/notifications/' + input.id + '/read', {});
    assert.equal((await ok(b, '/api/notifications'))[0].read, true);
    assert.equal((await ok(a, '/api/notifications'))[0].read, true);
  });

  await test('broadcast delivers to all selected devices and orders newest first', async () => {
    const input = {
      id: randomUUID(),
      title: '发给所有人',
      content: '- 全员通知',
      recipientIds: [bid, cid],
    };
    await ok(a, '/api/notifications', input);
    await eventually(
      async () =>
        (await ok(b, '/api/notifications')).some((row: { id: string }) => row.id === input.id) &&
        (await ok(c, '/api/notifications')).some((row: { id: string }) => row.id === input.id),
      'both recipients receive broadcast',
    );
    assert.equal((await ok(b, '/api/notifications'))[0].id, input.id);
    await eventually(
      async () =>
        (await ok(a, '/api/notifications')).find((row: { id: string }) => row.id === input.id)
          ?.pendingCount === 0,
      'delivery acknowledgements are recorded',
    );
  });

  await test('offline delivery survives sender and recipient restarts', async () => {
    await stop(b.child);
    const input = {
      id: randomUUID(),
      title: '离线待收',
      content: '重新连接后送达',
      recipientIds: [bid],
    };
    await ok(a, '/api/notifications', input);
    assert.equal(
      (await ok(a, '/api/notifications')).find((row: { id: string }) => row.id === input.id)
        .pendingCount,
      1,
    );
    await stop(a.child);
    b = await start('notice-b', 44642);
    a = await start('notice-a', 44641);
    await eventually(
      async () =>
        (await ok(b, '/api/notifications')).some((row: { id: string }) => row.id === input.id),
      'offline notification reaches B after restart',
    );
    await eventually(
      async () =>
        (await ok(a, '/api/notifications')).find((row: { id: string }) => row.id === input.id)
          ?.pendingCount === 0,
      'pending record is acknowledged',
    );
    assert.equal(
      (await ok(b, '/api/notifications')).filter((row: { id: string }) => row.id === input.id)
        .length,
      1,
    );
  });
} finally {
  await Promise.all(processes.map(stop));
}
