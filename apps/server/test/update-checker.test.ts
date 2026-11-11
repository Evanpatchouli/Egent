import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
process.env.EGENT_DATA_DIR = await mkdtemp(root + '.tmp/update-checker-');
const { initializeDatabase, prisma } = await import('@egent/database');
await initializeDatabase();
const { UpdateChecker } = await import('../src/device/updates.js');

try {
  await test('the notification migration preserves data from an existing device database', async () => {
    await prisma.peer.create({
      data: {
        deviceId: 'a'.repeat(64),
        publicKey: 'existing-key',
        nickname: 'existing',
        address: 'http://127.0.0.1:43127',
      },
    });
    await prisma.$executeRawUnsafe('DROP TABLE NotificationDelivery');
    await prisma.$executeRawUnsafe('DROP TABLE Notification');
    await prisma.$executeRawUnsafe('DELETE FROM _EgentSchema WHERE version = 7');
    await initializeDatabase();
    assert.equal(
      (await prisma.peer.findUniqueOrThrow({ where: { deviceId: 'a'.repeat(64) } })).nickname,
      'existing',
    );
    assert.equal(await prisma.notification.count(), 0);
  });

  await test('startup and five-minute checks deduplicate a release without resetting read state', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    let calls = 0;
    const fetchRelease: typeof fetch = async () => {
      calls++;
      return Response.json({ tag_name: 'v1.2.3', draft: false, prerelease: false });
    };
    const checker = new UpdateChecker(fetchRelease, '1.2.0');
    checker.start();
    assert.deepEqual(await checker.check(), { status: 'available', version: '1.2.3' });
    assert.equal(calls, 1);
    const notification = await prisma.notification.findUniqueOrThrow({
      where: { updateVersion: '1.2.3' },
    });
    await prisma.notification.update({ where: { id: notification.id }, data: { read: true } });
    t.mock.timers.tick(299999);
    assert.equal(calls, 1);
    t.mock.timers.tick(1);
    assert.deepEqual(await checker.check(), { status: 'available', version: '1.2.3' });
    assert.equal(calls, 2);
    assert.equal(await prisma.notification.count(), 1);
    assert.equal(
      (await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } })).read,
      true,
    );
    await checker.stop();
  });

  await test('errors, missing releases, prereleases, and older versions do not create notices', async () => {
    for (const response of [
      new Response(null, { status: 404 }),
      Response.json({ tag_name: 'v2.0.0-rc.1', prerelease: true }),
      Response.json({ tag_name: 'v2.0.0', draft: true }),
      Response.json({ tag_name: 'v1.0.0' }),
      Response.json({ tag_name: 'wrong' }),
      new Response(null, { status: 500 }),
    ]) {
      const checker = new UpdateChecker(async () => response, '1.2.0');
      assert.notEqual((await checker.check()).status, 'available');
      await checker.stop();
    }
    assert.equal(await prisma.notification.count(), 1);
  });
} finally {
  await prisma.$disconnect();
}
