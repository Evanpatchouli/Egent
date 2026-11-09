// Explicit opt-in only. Calls a real model for ANALYZE, never IMPLEMENT.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CodexCliExecutor } from '../src/agent/codex-executor.js';
import { analysisPrompt } from '../src/agent/prompts.js';
import { validateWorkspace } from '../src/agent/workspace.js';
if (process.env.EGENT_REAL_CODEX_TEST !== '1') {
  console.log('Skipped: set EGENT_REAL_CODEX_TEST=1 to run a real read-only Codex analysis.');
} else {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const directory = await mkdtemp(root + '.tmp/p4-real-analyze-');
  const content = '# Read-only fixture\nThe service returns the integer 42 from GET /answer.\n';
  await writeFile(directory + '/README.md', content, 'utf8');
  try {
    const workspace = await validateWorkspace(directory, async () => [
      { path: directory, name: 'fixture' },
    ]);
    const executor = new CodexCliExecutor(
      process.env.CODEX_COMMAND ?? 'codex',
      Number(process.env.CODEX_TIMEOUT_MS ?? '120000'),
    );
    const result = await executor.analyze({
      workspacePath: workspace,
      signal: new AbortController().signal,
      prompt: analysisPrompt(
        JSON.stringify({ question: 'README 记录 GET /answer 返回什么？只读回答，不能修改文件。' }),
      ),
    });
    assert.equal(result.type, 'QUESTION');
    assert.ok(result.answer.includes('42'));
    assert.ok(result.evidence.length);
    assert.equal(await readFile(directory + '/README.md', 'utf8'), content);
    assert.deepEqual(await readdir(directory), ['README.md']);
    console.log('Real Codex read-only integration passed:', JSON.stringify(result));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
