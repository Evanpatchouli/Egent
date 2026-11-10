const path = require('node:path');
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const semver = require('semver');
const { downloadAsset, fetchRelease } = require('./update-download.cjs');

const repository = 'https://github.com/Evanpatchouli/Egent';

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
  const metadata = await fetchRelease({ fetch, signal, progress });
  const asset = selectAsset(metadata, current, requested);
  const directory = await fs.mkdtemp(path.join(path.dirname(launcher), '.egent-update-'));
  const staged = path.join(directory, 'update.exe');
  try {
    await downloadAsset({ fetch, asset, file: staged, progress, signal });
    const helper = path.join(data, 'EgentUpdate.exe');
    await fs.copyFile(path.join(root, 'EgentUpdate.exe'), helper);
    signal.throwIfAborted();
    await handoff(helper, launcher, staged, asset.hash, signal);
  } catch (error) {
    await fs.rm(staged, { force: true });
    await fs.rmdir(directory);
    throw error;
  }
}

module.exports = { installPortable };
