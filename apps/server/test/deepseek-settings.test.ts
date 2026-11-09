import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

const directory = await mkdtemp(path.join(os.tmpdir(), 'egent-deepseek-test-'));
process.env.EGENT_DATA_DIR = directory;
const { writeDeepSeekSettings, readDeepSeekSettings } =
  await import('../src/agent/deepseek-settings.js');
const { CodexCliExecutor } = await import('../src/agent/codex-executor.js');
const { DshCliExecutor } = await import('../src/agent/dsh-executor.js');
const input = {
  workspacePath: directory,
  prompt: 'test prompt',
  signal: new AbortController().signal,
};

await test('saved endpoint and secret are used on the next call, with environment fallback', async () => {
  const previous = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'environment-secret';
  try {
    await writeDeepSeekSettings({ baseUrl: 'https://provider.example/v1', apiKey: 'saved-secret' });
    let args: string[] = [];
    let key: string | undefined;
    const mock = (_command: string, argv: string[], options: { env: NodeJS.ProcessEnv }) => {
      args = argv;
      key = options.env.DEEPSEEK_API_KEY;
      const proc = new EventEmitter() as ChildProcessWithoutNullStreams;
      Object.assign(proc, {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      });
      queueMicrotask(() => {
        const output = JSON.stringify({ shouldReply: false, answer: '', evidence: [] });
        proc.stdout.write(
          _command === 'dsh'
            ? output
            : JSON.stringify({
                type: 'item.completed',
                item: { type: 'agent_message', text: output },
              }) +
                '\n' +
                JSON.stringify({ type: 'turn.completed' }),
        );
        proc.emit('close', 0);
      });
      return proc;
    };
    const codex = new CodexCliExecutor('codex', 1000, mock, {
      provider: 'deepseek',
      model: 'deepseek-flash',
      effort: 'high',
    });
    await codex.participate(input);
    assert.match(args.join(' '), /https:\/\/provider\.example\/v1/);
    assert.equal(key, 'saved-secret');
    assert.ok(!args.join(' ').includes('saved-secret'));
    await new DshCliExecutor('dsh', 1000, mock).participate(input);
    assert.equal(key, 'saved-secret');
    await writeDeepSeekSettings({ baseUrl: 'https://api.deepseek.com', apiKey: null });
    assert.equal((await readDeepSeekSettings()).apiKey, 'saved-secret');
    await writeDeepSeekSettings({ baseUrl: 'https://api.deepseek.com', apiKey: '' });
    await codex.participate(input);
    assert.equal(key, 'environment-secret');
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
