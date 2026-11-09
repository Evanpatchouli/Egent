const path = require('node:path');
const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const semver = require('semver');

const repository = 'https://github.com/Evanpatchouli/Egent';
const latest = 'https://api.github.com/repos/Evanpatchouli/Egent/releases/latest';

function selectAsset(release, current, requested) {
  const version = semver.valid(release.tag_name);
  if (
    !version ||
    version !== requested ||
    !semver.gt(version, current) ||
    semver.prerelease(version) ||
    release.draft ||
    release.prerelease
  ) {
    throw new Error('发行版本已变化，请重新检查更新。');
  }
  const name = 'Egent-' + version + '-x64.exe';
  const url =
    repository + '/releases/download/' + encodeURIComponent(release.tag_name) + '/' + name;
  const asset = release.assets?.find(
    (item) => item.name === name && item.browser_download_url === url,
  );
  if (
    !asset ||
    !Number.isSafeInteger(asset.size) ||
    asset.size <= 0 ||
    asset.size > 1024 ** 3 ||
    !/^sha256:[0-9a-f]{64}$/.test(asset.digest)
  ) {
    throw new Error('该发行版缺少可校验的 Windows x64 便携包。');
  }
  return { url, size: asset.size, hash: asset.digest.slice(7) };
}

async function download(response, asset, file, progress, timer) {
  if (!response.ok || !response.body) throw new Error('下载失败（HTTP ' + response.status + '）。');
  const hash = createHash('sha256');
  let received = 0,
    lastPercent = -1;
  await pipeline(
    response.body,
    async function* (source) {
      for await (const chunk of source) {
        timer.refresh();
        received += chunk.length;
        if (received > asset.size) throw new Error('更新包大小与发行记录不符。');
        hash.update(chunk);
        const percent = Math.floor((received / asset.size) * 100);
        if (percent !== lastPercent) progress(percent);
        lastPercent = percent;
        yield chunk;
      }
    },
    createWriteStream(file, { flags: 'wx' }),
  );
  if (received !== asset.size || hash.digest('hex') !== asset.hash)
    throw new Error('更新包校验失败，请重试。');
}

// The helper signals readiness only after opening the portable launcher process
// and verifying the staged file. Its stdin closes without a command on failure.
async function handoff(helper, launcher, staged, hash, signal) {
  const child = spawn(helper, [String(process.ppid), launcher, staged, hash], {
    cwd: path.dirname(launcher),
    windowsHide: true,
    detached: true,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('等待更新程序就绪超时。')), 30000);
      function finish(error) {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      }
      child.once('error', finish);
      child.once('exit', () => finish(new Error('无法准备更新，请检查启动器路径和目录权限。')));
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk.toString();
        if (output.includes('READY\n')) finish();
      });
      child.stdin.on('error', finish);
    });
    signal.throwIfAborted();
    await new Promise((resolve, reject) =>
      child.stdin.end('INSTALL\n', (error) => (error ? reject(error) : resolve())),
    );
  } catch (error) {
    child.kill();
    throw error;
  } finally {
    child.stdout.destroy();
    child.unref();
  }
}

async function installPortable({
  root,
  data,
  launcher,
  current,
  requested,
  fetch,
  progress,
  signal,
}) {
  const metadata = await fetch(latest, {
    credentials: 'omit',
    cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  });
  if (!metadata.ok) throw new Error('无法读取发行信息（HTTP ' + metadata.status + '）。');
  const asset = selectAsset(await metadata.json(), current, requested);
  const directory = await fs.mkdtemp(path.join(path.dirname(launcher), '.egent-update-'));
  const staged = path.join(directory, 'update.exe');
  const stalled = new AbortController();
  const timer = setTimeout(() => stalled.abort(), 60000);
  try {
    const response = await fetch(asset.url, {
      credentials: 'omit',
      signal: AbortSignal.any([signal, stalled.signal]),
    });
    await download(response, asset, staged, progress, timer);
    clearTimeout(timer);
    const helper = path.join(data, 'EgentUpdate.exe');
    await fs.copyFile(path.join(root, 'EgentUpdate.exe'), helper);
    signal.throwIfAborted();
    await handoff(helper, launcher, staged, asset.hash, signal);
  } catch (error) {
    await fs.rm(staged, { force: true });
    await fs.rmdir(directory);
    if (stalled.signal.aborted)
      throw new Error('下载连接超时，请检查网络后重试。', { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { installPortable };
