const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { installPortable } = require('../portable-update.cjs');

test('a rejected or incomplete update leaves the original launcher intact', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'egent-update-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const launcher = path.join(directory, 'My Egent.exe');
  await fs.writeFile(launcher, 'original');
  const bytes = Buffer.from('test release');
  const asset = {
    name: 'Egent-1.0.0-x64.exe',
    browser_download_url:
      'https://github.com/Evanpatchouli/Egent/releases/download/v1.0.0/Egent-1.0.0-x64.exe',
    size: bytes.length,
    digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex'),
  };
  for (const [label, overrides, releaseOverrides, requested, downloads] of [
    ['changed since check', {}, {}, '1.0.1', 0],
    ['prerelease', {}, { prerelease: true }, '1.0.0', 0],
    [
      'different download URL',
      { browser_download_url: 'https://example.org/file.exe' },
      {},
      '1.0.0',
      0,
    ],
    ['missing checksum', { digest: null }, {}, '1.0.0', 0],
    ['truncated download', { size: bytes.length + 1 }, {}, '1.0.0', 1],
    ['oversized download', { size: bytes.length - 1 }, {}, '1.0.0', 1],
    ['checksum mismatch', { digest: 'sha256:' + '0'.repeat(64) }, {}, '1.0.0', 1],
  ]) {
    await t.test(label, async () => {
      const calls = [];
      await assert.rejects(
        installPortable({
          root: directory,
          data: directory,
          launcher,
          current: '0.9.0',
          requested,
          signal: new AbortController().signal,
          progress() {},
          async fetch(url) {
            calls.push(url);
            return calls.length === 1
              ? Response.json({
                  tag_name: 'v1.0.0',
                  assets: [{ ...asset, ...overrides }],
                  ...releaseOverrides,
                })
              : new Response(bytes);
          },
        }),
        /发行版本已变化|缺少可校验|更新包大小|更新包校验失败/,
      );
      assert.equal(calls.length, downloads + 1);
      assert.deepEqual(await fs.readdir(directory), ['My Egent.exe']);
      assert.equal(await fs.readFile(launcher, 'utf8'), 'original');
    });
  }
});
