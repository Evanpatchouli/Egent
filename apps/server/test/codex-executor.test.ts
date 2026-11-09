import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { finalJson, CodexCliExecutor } from '../src/agent/codex-executor.js';
import { runProcess, type SpawnAdapter } from '../src/agent/cli-process.js';
import { createAgentExecutor } from '../src/agent/executor.js';
import { existsSync, readFileSync } from 'node:fs';
import { parseResult } from '../src/agent/contracts.js';
import { codexFailure, redactCodexError } from '../src/agent/codex-errors.js';

function mock(
  mode: 'success' | 'error' | 'nonzero' | 'hang' | 'overflow',
  output?: { stdout: string; stderr: string },
) {
  let killed = false;
  let received = '';
  let argv: string[] = [];
  const spawn: SpawnAdapter = (_command, args, options) => {
    argv = args;
    assert.equal(options.shell, false);
    assert.equal(options.windowsHide, true);
    assert.equal(options.env.DATABASE_URL, undefined);
    const proc = new EventEmitter() as ChildProcessWithoutNullStreams;
    Object.assign(proc, {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      pid: undefined,
      kill: () => {
        killed = true;
        queueMicrotask(() => proc.emit('close', null));
        return true;
      },
    });
    proc.stdin.on('data', (chunk: Buffer) => {
      received += chunk.toString();
    });
    queueMicrotask(() => {
      if (mode === 'error') {
        proc.emit('error', new Error('ENOENT'));
        proc.emit('close', -2);
      }
      if (mode === 'nonzero') {
        proc.stdout.write(output?.stdout ?? '');
        proc.stderr.write(output?.stderr ?? 'private error details');
        proc.emit('close', output ? 1 : 2);
      }
      if (mode === 'success') {
        if (output) {
          proc.stdout.write(output.stdout);
          proc.stderr.write(output.stderr);
          proc.emit('close', 0);
          return;
        }
        proc.stdout.write(
          JSON.stringify({
            type: 'item.completed',
            item: {
              type: 'agent_message',
              text: JSON.stringify({ shouldReply: false, answer: '', evidence: [] }),
            },
          }) +
            '\n' +
            JSON.stringify({ type: 'turn.completed' }) +
            '\n',
        );
        proc.emit('close', 0);
      }
      if (mode === 'overflow') proc.stdout.write('x'.repeat(2 * 1024 * 1024 + 1));
    });
    return proc;
  };
  return {
    spawn,
    get killed() {
      return killed;
    },
    get prompt() {
      return received;
    },
    get args() {
      return argv;
    },
  };
}
const input = (signal = new AbortController().signal) => ({
  workspacePath: process.cwd(),
  prompt: '用户内容 $(不要执行) ; & 中文',
  signal,
});
await test('spawn sends prompt only via stdin and parses final JSONL safely', async () => {
  const fake = mock('success');
  const result = await runProcess('codex', ['exec', '-'], input(), 1000, fake.spawn);
  assert.equal(fake.prompt, input().prompt);
  assert.ok(!fake.args.join(' ').includes('用户'));
  assert.equal(parseResult('participate', finalJson(result.stdout)).shouldReply, false);
  for (const output of ['garbage', '{"type":"turn.failed"}', '{"type":"turn.completed"}'])
    assert.throws(() => finalJson(output));
});
await test('launch failure, nonzero exit, timeout, cancellation and output limit', async () => {
  for (const mode of ['error', 'nonzero', 'hang', 'overflow'] as const) {
    const fake = mock(mode);
    await assert.rejects(runProcess('codex', [], input(), 20, fake.spawn));
    if (mode === 'hang' || mode === 'overflow') assert.equal(fake.killed, true);
  }
  const fake = mock('hang'),
    abort = new AbortController();
  const running = runProcess('codex', [], input(abort.signal), 1000, fake.spawn);
  abort.abort();
  await assert.rejects(running);
  assert.ok(fake.killed);
});
await test('production adapter selects sandbox and schema; no dangerous bypass', async () => {
  const fake = mock('success');
  const cli = new CodexCliExecutor('codex', 1000, fake.spawn);
  await cli.participate(input());
  assert.ok(fake.args.includes('read-only'));
  assert.ok(fake.args.includes('--output-schema'));
  assert.ok(fake.args.includes('--ephemeral'));
  assert.ok(!fake.args.some((arg) => arg.includes('dangerously')));
  assert.ok(!fake.args.includes('--model') && !fake.args.includes('-m'));
  assert.ok(!fake.args.some((arg) => /^model\s*=/.test(arg)));
  const failed = mock('nonzero');
  await assert.rejects(new CodexCliExecutor('codex', 1000, failed.spawn).implement(input()));
  assert.ok(failed.args.includes('workspace-write'));
});

await test('nonzero exit exposes the nested stdout failure instead of an empty stderr', async () => {
  const detail =
    "The 'gpt-6-astra' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.";
  const stdout = JSON.stringify({
    type: 'turn.failed',
    error: { message: JSON.stringify({ type: 'error', status: 400, error: { message: detail } }) },
  });
  const fake = mock('nonzero', { stdout, stderr: '' });
  await assert.rejects(runProcess('codex', [], input(), 1000, fake.spawn), (error: Error) => {
    assert.match(error.message, /CLI.*升级|升级.*CLI/);
    assert.match(error.message, /gpt-6-astra/);
    return true;
  });
  assert.throws(() => finalJson(stdout), /gpt-6-astra/);
});

await test('provider selection defaults to Codex and rejects invalid configuration', () => {
  assert.ok(createAgentExecutor({}) instanceof CodexCliExecutor);
  assert.throws(() => createAgentExecutor({ EGENT_AGENT_PROVIDER: 'missing' }), /PROVIDER/);
  assert.throws(() => createAgentExecutor({ CODEX_TIMEOUT_MS: '0' }), /超时/);
  assert.throws(
    () => createAgentExecutor({ EGENT_AGENT_PROVIDER: 'dsh', DSH_COMMAND: ' ' }),
    /DSH_COMMAND/,
  );
});

await test('DeepSeek uses its Responses endpoint and keeps the key out of argv and stdin', async () => {
  const original = process.env.DEEPSEEK_API_KEY;
  try {
    delete process.env.DEEPSEEK_API_KEY;
    const fake = mock('success');
    const executor = createAgentExecutor(
      { EGENT_AGENT_PROVIDER: 'deepseek', DEEPSEEK_MODEL: 'deepseek-v4-pro' },
      fake.spawn,
    );
    await assert.rejects(executor.participate(input()), /DEEPSEEK_API_KEY/);
    assert.equal(fake.args.length, 0);
    process.env.DEEPSEEK_API_KEY = 'sk-dummy-integration-key';
    await executor.participate(input());
    assert.ok(fake.args.includes('deepseek-v4-pro'));
    assert.match(fake.args.join(' '), /https:\/\/api\.deepseek\.com/);
    assert.match(fake.args.join(' '), /env_key="DEEPSEEK_API_KEY"/);
    assert.ok(fake.args.includes('read-only'));
    assert.ok(!(fake.args.join(' ') + fake.prompt).includes(process.env.DEEPSEEK_API_KEY));
  } finally {
    if (original === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = original;
  }
});

await test('DSH uses an isolated headless task, stage-specific permissions and validated output', async () => {
  for (const phase of ['analyze', 'participate', 'implement'] as const) {
    const mode = phase === 'implement' ? 'workspace-write' : 'read-only';
    const expected =
      phase === 'analyze'
        ? {
            type: 'QUESTION',
            summary: '分析',
            confidence: 1,
            plan: [],
            affectedAreas: [],
            risks: [],
            needsOwnerConfirmation: false,
            answer: '答案',
            evidence: [],
            certain: false,
          }
        : phase === 'implement'
          ? { success: true, summary: '修改', changedFiles: ['README.md'], verification: ['通过'] }
          : { shouldReply: false, answer: '', evidence: [] };
    const fake = mock('success', { stdout: JSON.stringify(expected), stderr: 'private reasoning' });
    let home = '';
    const executor = createAgentExecutor(
      { EGENT_AGENT_PROVIDER: 'dsh', DSH_COMMAND: 'custom-dsh' },
      (command, args, opts) => {
        assert.equal(command, 'custom-dsh');
        assert.equal(opts.env.DSH_PERMISSION_MODE, mode);
        home = opts.env.DSH_HOME!;
        const patch = readFileSync(args[args.indexOf('--patch') + 1], 'utf8');
        assert.deepEqual(
          JSON.parse(patch).find((row: { id: string }) => row.id === 'agent-default-model')?.config,
          { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' },
        );
        assert.ok(!patch.includes(input().prompt));
        assert.equal(args[args.indexOf('--permission-mode') + 1], mode);
        assert.equal(opts.cwd, input().workspacePath);
        assert.equal(args[args.indexOf('--approval-policy') + 1], 'never');
        assert.equal(args.at(-1), '-');
        assert.ok(!args.join(' ').includes(input().prompt));
        return fake.spawn(command, args, opts);
      },
    );
    assert.deepEqual(await executor[phase](input()), expected);
    assert.ok(fake.prompt.includes(input().prompt));
    assert.ok(home && !existsSync(home));
  }
  for (const stdout of ['{"success":true}', 'private invalid JSON']) {
    const fake = mock('success', { stdout, stderr: '' });
    const executor = createAgentExecutor({ EGENT_AGENT_PROVIDER: 'dsh' }, fake.spawn);
    await assert.rejects(executor.participate(input()), /结构化输出无效|最终 JSON/);
    assert.ok(!existsSync(fake.args[fake.args.indexOf('--patch') + 1]));
  }
  const failed = mock('nonzero', { stdout: 'private transcript', stderr: 'private reasoning' });
  const executor = createAgentExecutor({ EGENT_AGENT_PROVIDER: 'dsh' }, failed.spawn);
  await assert.rejects(
    executor.participate(input()),
    (error: Error) => error.message.includes('DSH') && !error.message.includes('private'),
  );
});

await test('error messages redact credentials before reaching UI or logs and remain bounded', async () => {
  const secret = 'sk-test-secret-value';
  const stdout = JSON.stringify({
    type: 'error',
    message:
      'Request failed: Authorization: Bearer abc123 API_KEY=' +
      secret +
      ' password=hunter2 https://name:pass@example.invalid/?access_token=secretvalue ' +
      'x'.repeat(5000),
  });
  const fake = mock('nonzero', { stdout, stderr: 'ignored' });
  await assert.rejects(runProcess('codex', [], input(), 1000, fake.spawn), (error: Error) => {
    assert.ok(
      ![secret, 'abc123', 'hunter2', 'name:pass', 'secretvalue'].some((s) =>
        error.message.includes(s),
      ),
    );
    assert.match(error.message, /已隐藏/);
    assert.ok(error.message.length <= 400);
    return true;
  });
});

await test('stderr-only and empty failures have useful fallbacks without echoing normal stdout', async () => {
  const fake = mock('nonzero', {
    stdout: JSON.stringify({
      type: 'item.completed',
      item: { type: 'agent_message', text: 'PRIVATE_PROMPT' },
    }),
    stderr: 'error: configuration is invalid',
  });
  await assert.rejects(
    runProcess('codex', [], input(), 1000, fake.spawn),
    /configuration is invalid/,
  );
  await assert.rejects(
    runProcess(
      'codex',
      [],
      input(),
      1000,
      mock('nonzero', { stdout: 'PRIVATE_PROMPT', stderr: '' }).spawn,
    ),
    /未提供具体原因/,
  );
});

await test('terminal errors outrank warnings; item errors and quoted credentials are handled', () => {
  const warning = JSON.stringify({
    type: 'item.completed',
    item: { type: 'error', message: 'fallback metadata warning' },
  });
  const failed = JSON.stringify({ type: 'turn.failed', error: { message: 'rate_limit_exceeded' } });
  assert.match(codexFailure(warning + '\n' + failed, '', 1), /速率受限/);
  assert.ok(!codexFailure(warning + '\n' + failed, '', 1).includes('metadata warning'));
  assert.match(codexFailure(warning, '', 1), /fallback metadata warning/);
  const secret = redactCodexError(
    '"access_token": "private value", "refresh_token":"refresh-value", password=hidden-value',
  );
  assert.ok(!/private value|refresh-value|hidden-value/.test(secret));
  assert.match(
    codexFailure('', '{"error":{"message":"invalid_api_key"},"other":"DO_NOT_DISPLAY"}', 1),
    /认证失败/,
  );
  assert.ok(
    !codexFailure(
      '',
      '{"error":{"message":"invalid_api_key"},"other":"DO_NOT_DISPLAY"}',
      1,
    ).includes('DO_NOT_DISPLAY'),
  );
});
