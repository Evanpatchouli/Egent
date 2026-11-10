const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

const latest = 'https://api.github.com/repos/Evanpatchouli/Egent/releases/latest';
const retryLimit = 3;
const waitForRetry = (milliseconds, signal) => delay(milliseconds, undefined, { signal });

class RetryableError extends Error {
  constructor(cause) {
    super('更新连接暂不可用', { cause });
  }
}

function transientStatus(status) {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function discard(body) {
  if (body) void body.cancel().catch(() => {});
}

async function retry(operation, { signal, wait, onRetry, message }) {
  for (let attempted = 0; ; attempted++) {
    signal.throwIfAborted();
    try {
      return await operation();
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof RetryableError)) throw error;
      if (attempted === retryLimit) throw new Error(message, { cause: error });
      const attempt = attempted + 1;
      onRetry(attempt);
      signal.throwIfAborted();
      await wait(1000 * 2 ** attempted, signal);
    }
  }
}

async function fetchRelease({ fetch, signal, progress, wait = waitForRetry, timeoutMs = 15000 }) {
  return retry(
    async () => {
      let response;
      try {
        response = await fetch(latest, {
          credentials: 'omit',
          cache: 'no-store',
          signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
        });
      } catch (error) {
        signal.throwIfAborted();
        throw new RetryableError(error);
      }
      if (!response.ok) {
        discard(response.body);
        const error = new Error('无法读取发行信息（HTTP ' + response.status + '）。');
        if (transientStatus(response.status)) throw new RetryableError(error);
        throw error;
      }
      try {
        return await response.json();
      } catch (error) {
        signal.throwIfAborted();
        throw new RetryableError(error);
      }
    },
    {
      signal,
      wait,
      onRetry: (attempt) => progress({ percent: 0, retry: { attempt, limit: retryLimit } }),
      message: '多次无法获取发行信息，请检查网络后重试。',
    },
  );
}

async function downloadAsset({
  fetch,
  asset,
  file,
  progress,
  signal,
  wait = waitForRetry,
  stallMs = 60000,
}) {
  signal.throwIfAborted();
  const handle = await fs.open(file, 'wx');
  let received = 0;
  let hash = createHash('sha256');
  let lastPercent = -1;
  const percent = () => Math.min(99, Math.floor((received / asset.size) * 100));
  function report() {
    const current = percent();
    if (current !== lastPercent) {
      lastPercent = current;
      progress({ percent: current });
    }
  }
  async function restart() {
    await handle.truncate(0);
    received = 0;
    hash = createHash('sha256');
    lastPercent = -1;
    report();
  }
  try {
    report();
    await retry(
      async () => {
        const offset = received;
        const stalled = new AbortController();
        const timer = setTimeout(() => stalled.abort(), stallMs);
        try {
          let response;
          try {
            response = await fetch(asset.url, {
              credentials: 'omit',
              ...(offset ? { headers: { Range: `bytes=${offset}-` } } : {}),
              signal: AbortSignal.any([signal, stalled.signal]),
            });
          } catch (error) {
            signal.throwIfAborted();
            throw new RetryableError(error);
          }
          if (response.status === 416 && offset) {
            discard(response.body);
            await restart();
            throw new RetryableError(new Error('服务器不接受续传范围'));
          }
          if (!response.ok) {
            discard(response.body);
            const error = new Error('下载失败（HTTP ' + response.status + '）。');
            if (transientStatus(response.status)) throw new RetryableError(error);
            throw error;
          }
          if (!response.body) throw new RetryableError(new Error('下载响应没有内容'));
          let rangeEnd;
          if (response.status === 206) {
            const range = /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(
              response.headers.get('content-range') ?? '',
            );
            const start = Number(range?.[1]);
            const end = Number(range?.[2]);
            const total = Number(range?.[3]);
            if (
              !range ||
              start !== offset ||
              end < start ||
              end >= asset.size ||
              total !== asset.size
            ) {
              discard(response.body);
              await restart();
              throw new RetryableError(new Error('服务器返回的续传范围无效'));
            }
            rangeEnd = end;
          } else if (response.status !== 200) {
            discard(response.body);
            throw new Error('下载失败（HTTP ' + response.status + '）。');
          } else if (offset) await restart();

          const reader = response.body.getReader();
          let ended = false;
          try {
            while (true) {
              let next;
              try {
                next = await reader.read();
              } catch (error) {
                signal.throwIfAborted();
                if (received === asset.size) break;
                throw new RetryableError(error);
              }
              signal.throwIfAborted();
              if (next.done) {
                ended = true;
                break;
              }
              const chunk = Buffer.from(next.value);
              if (!chunk.length) continue;
              if (
                received + chunk.length > asset.size ||
                (rangeEnd !== undefined && received + chunk.length > rangeEnd + 1)
              )
                throw new Error('更新包大小与发行记录不符。');
              let written = 0;
              while (written < chunk.length) {
                const part = await handle.write(
                  chunk,
                  written,
                  chunk.length - written,
                  received + written,
                );
                if (!part.bytesWritten) throw new Error('无法写入更新包。');
                written += part.bytesWritten;
              }
              hash.update(chunk);
              received += chunk.length;
              timer.refresh();
              report();
            }
          } finally {
            if (!ended) await reader.cancel().catch(() => {});
            reader.releaseLock();
          }
          if (received < asset.size) throw new RetryableError(new Error('更新包下载不完整'));
        } finally {
          clearTimeout(timer);
        }
      },
      {
        signal,
        wait,
        onRetry: (attempt) => {
          lastPercent = -1;
          progress({ percent: percent(), retry: { attempt, limit: retryLimit } });
        },
        message: '更新下载多次中断，请检查网络后重试。',
      },
    );
    signal.throwIfAborted();
    if (hash.digest('hex') !== asset.hash) throw new Error('更新包校验失败，请重试。');
  } finally {
    await handle.close();
  }
  signal.throwIfAborted();
  progress({ percent: 100 });
}

module.exports = { downloadAsset, fetchRelease };
