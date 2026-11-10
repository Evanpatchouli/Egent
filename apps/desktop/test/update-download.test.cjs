const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { downloadAsset, fetchRelease } = require('../update-download.cjs');

const bytes = Buffer.from('A release package with enough bytes for a resumed download.');
const asset = {
  url: 'https://example.test/Egent.exe',
  size: bytes.length,
  hash: createHash('sha256').update(bytes).digest('hex'),
};
const noWait = async (_milliseconds, signal) => signal.throwIfAborted();

async function destination(t) {
  const directory = path.resolve(await fs.mkdtemp(path.join(os.tmpdir(), 'egent-retry-test-')));
  assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
  t.after(async () => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('egent-retry-test-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return path.join(directory, 'update.exe');
}

function interruptedResponse(part) {
  let sent = false;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(part);
        } else controller.error(new TypeError('connection terminated'));
      },
    }),
  );
}

function remainingResponse(offset, headers = {}) {
  return new Response(bytes.subarray(offset), {
    status: 206,
    headers: {
      'Content-Range': `bytes ${offset}-${bytes.length - 1}/${bytes.length}`,
      ...headers,
    },
  });
}

test('interrupted downloads resume at the persisted byte and verify the complete file', async (t) => {
  const file = await destination(t);
  const progress = [];
  const requests = [];
  await downloadAsset({
    asset,
    file,
    signal: new AbortController().signal,
    progress: (event) => progress.push(event),
    wait: noWait,
    async fetch(_url, options) {
      requests.push(options);
      return requests.length === 1
        ? interruptedResponse(bytes.subarray(0, 11))
        : remainingResponse(11);
    },
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].headers.Range, 'bytes=11-');
  assert.deepEqual(await fs.readFile(file), bytes);
  assert.ok(progress.some((event) => event.retry?.attempt === 1));
  assert.equal(progress.at(-1).percent, 100);
});

test('a verified complete file is accepted when the connection closes immediately afterward', async (t) => {
  const file = await destination(t);
  const progress = [];
  let requests = 0;
  await downloadAsset({
    asset,
    file,
    signal: new AbortController().signal,
    progress: (event) => progress.push(event),
    wait: noWait,
    async fetch() {
      requests++;
      return interruptedResponse(bytes);
    },
  });
  assert.equal(requests, 1);
  assert.deepEqual(await fs.readFile(file), bytes);
  assert.equal(progress.at(-1).percent, 100);
});

test('when the server ignores Range, retry starts over without combining different content', async (t) => {
  const file = await destination(t);
  const progress = [];
  let requests = 0;
  await downloadAsset({
    asset,
    file,
    signal: new AbortController().signal,
    progress: (event) => progress.push(event),
    wait: noWait,
    async fetch(_url, options) {
      requests++;
      if (requests === 1) return interruptedResponse(bytes.subarray(0, 25));
      assert.equal(options.headers.Range, 'bytes=25-');
      return new Response(bytes);
    },
  });
  assert.equal(requests, 2);
  assert.deepEqual(await fs.readFile(file), bytes);
  assert.ok(
    progress.some((event, index) => index > 0 && event.percent < progress[index - 1].percent),
  );
});

test('an invalid Content-Range is discarded and the next request restarts safely', async (t) => {
  const file = await destination(t);
  const ranges = [];
  await downloadAsset({
    asset,
    file,
    signal: new AbortController().signal,
    progress() {},
    wait: noWait,
    async fetch(_url, options) {
      ranges.push(options.headers?.Range);
      if (ranges.length === 1) return interruptedResponse(bytes.subarray(0, 9));
      if (ranges.length === 2)
        return remainingResponse(9, {
          'Content-Range': `bytes 3-${bytes.length - 1}/${bytes.length}`,
        });
      return new Response(bytes);
    },
  });
  assert.deepEqual(ranges, [undefined, 'bytes=9-', undefined]);
  assert.deepEqual(await fs.readFile(file), bytes);
});

test('a rejected Range restarts from the beginning on the next attempt', async (t) => {
  const file = await destination(t);
  const ranges = [];
  await downloadAsset({
    asset,
    file,
    signal: new AbortController().signal,
    progress() {},
    wait: noWait,
    async fetch(_url, options) {
      ranges.push(options.headers?.Range);
      if (ranges.length === 1) return interruptedResponse(bytes.subarray(0, 9));
      if (ranges.length === 2) return new Response(null, { status: 416 });
      return new Response(bytes);
    },
  });
  assert.deepEqual(ranges, [undefined, 'bytes=9-', undefined]);
  assert.deepEqual(await fs.readFile(file), bytes);
});

test('a transient HTTP failure retries and eventually downloads successfully', async (t) => {
  const file = await destination(t);
  let requests = 0;
  const progress = [];
  await downloadAsset({
    asset,
    file,
    signal: new AbortController().signal,
    progress: (event) => progress.push(event),
    wait: noWait,
    async fetch() {
      requests++;
      return requests === 1 ? new Response('unavailable', { status: 503 }) : new Response(bytes);
    },
  });
  assert.equal(requests, 2);
  assert.ok(progress.some((event) => event.retry?.attempt === 1));
  assert.deepEqual(await fs.readFile(file), bytes);
});

test('a connection failure before the first byte is retried', async (t) => {
  const file = await destination(t);
  let requests = 0;
  await downloadAsset({
    asset,
    file,
    signal: new AbortController().signal,
    progress() {},
    wait: noWait,
    async fetch(_url, options) {
      requests++;
      assert.equal(options.headers?.Range, undefined);
      if (requests === 1) throw new TypeError('connection reset');
      return new Response(bytes);
    },
  });
  assert.equal(requests, 2);
  assert.deepEqual(await fs.readFile(file), bytes);
});

test('short responses are retried only a bounded number of times', async (t) => {
  const file = await destination(t);
  const retries = [];
  let requests = 0;
  await assert.rejects(
    downloadAsset({
      asset,
      file,
      signal: new AbortController().signal,
      progress: (event) => event.retry && retries.push(event.retry.attempt),
      wait: noWait,
      async fetch() {
        requests++;
        return new Response(bytes.subarray(0, 5));
      },
    }),
    /多次.*中断|多次.*失败/,
  );
  assert.equal(requests, 4);
  assert.deepEqual(retries, [1, 2, 3]);
});

test('permanent HTTP errors, oversized files and checksum failures do not retry', async (t) => {
  for (const [name, response, expected] of [
    ['http', () => new Response('missing', { status: 404 }), /HTTP 404/],
    ['oversized', () => new Response(Buffer.concat([bytes, Buffer.from('x')])), /大小/],
    ['checksum', () => new Response(Buffer.alloc(bytes.length)), /校验失败/],
  ]) {
    await t.test(name, async (subtest) => {
      const file = await destination(subtest);
      let requests = 0;
      const progress = [];
      await assert.rejects(
        downloadAsset({
          asset,
          file,
          signal: new AbortController().signal,
          progress: (event) => progress.push(event),
          wait: noWait,
          async fetch() {
            requests++;
            return response();
          },
        }),
        expected,
      );
      assert.equal(requests, 1);
      assert.ok(progress.every((event) => event.percent < 100));
    });
  }
});

test('a local file creation failure does not trigger network retries', async (t) => {
  const file = await destination(t);
  await fs.writeFile(file, 'existing');
  let requests = 0;
  await assert.rejects(
    downloadAsset({
      asset,
      file,
      signal: new AbortController().signal,
      progress() {},
      wait: noWait,
      async fetch() {
        requests++;
        return new Response(bytes);
      },
    }),
    { code: 'EEXIST' },
  );
  assert.equal(requests, 0);
  assert.equal(await fs.readFile(file, 'utf8'), 'existing');
});

test('cancellation during backoff stops immediately and makes no further request', async (t) => {
  const file = await destination(t);
  const abort = new AbortController();
  let requests = 0;
  let waitStarted;
  const waiting = new Promise((resolve) => (waitStarted = resolve));
  const running = downloadAsset({
    asset,
    file,
    signal: abort.signal,
    progress() {},
    async wait(_milliseconds, signal) {
      waitStarted();
      await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
    async fetch() {
      requests++;
      throw new TypeError('network unavailable');
    },
  });
  await waiting;
  abort.abort();
  await assert.rejects(running, { name: 'AbortError' });
  assert.equal(requests, 1);
});

test('a stalled connection is aborted and retried with a fresh timeout', async (t) => {
  const file = await destination(t);
  let requests = 0;
  await downloadAsset({
    asset,
    file,
    signal: new AbortController().signal,
    progress() {},
    wait: noWait,
    stallMs: 25,
    async fetch(_url, options) {
      requests++;
      if (requests > 1) return new Response(bytes);
      return new Response(
        new ReadableStream({
          start(controller) {
            options.signal.addEventListener(
              'abort',
              () => controller.error(options.signal.reason),
              {
                once: true,
              },
            );
          },
        }),
      );
    },
  });
  assert.equal(requests, 2);
  assert.deepEqual(await fs.readFile(file), bytes);
});

test('transient release-metadata failures retry, but a permanent HTTP error does not', async () => {
  let requests = 0;
  const events = [];
  const release = await fetchRelease({
    signal: new AbortController().signal,
    progress: (event) => events.push(event),
    wait: noWait,
    async fetch() {
      requests++;
      if (requests === 1) throw new TypeError('connection reset');
      if (requests === 2) return new Response('temporary', { status: 503 });
      return Response.json({ tag_name: 'v1.0.0' });
    },
  });
  assert.equal(release.tag_name, 'v1.0.0');
  assert.equal(requests, 3);
  assert.deepEqual(
    events.map((event) => event.retry.attempt),
    [1, 2],
  );
  requests = 0;
  await assert.rejects(
    fetchRelease({
      signal: new AbortController().signal,
      progress() {},
      wait: noWait,
      async fetch() {
        requests++;
        return new Response('missing', { status: 404 });
      },
    }),
    /HTTP 404/,
  );
  assert.equal(requests, 1);
});

test('an incomplete metadata response is retried before selecting an asset', async () => {
  let requests = 0;
  const release = await fetchRelease({
    signal: new AbortController().signal,
    progress() {},
    wait: noWait,
    async fetch() {
      requests++;
      return requests === 1 ? new Response('{') : Response.json({ tag_name: 'v1.0.0' });
    },
  });
  assert.equal(release.tag_name, 'v1.0.0');
  assert.equal(requests, 2);
});
