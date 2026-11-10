import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { dataDirectory } from '@egent/database';
import { defaultAgentModel } from '@egent/shared';
import { schemas, parseResult, type AgentExecutor, type ExecutionInput } from './contracts.js';
import { codexFailure } from './codex-errors.js';
import { runProcess, type SpawnAdapter } from './cli-process.js';
import { readDeepSeekSettings } from './deepseek-settings.js';

/** Extract the final completed assistant message from documented JSONL, not arbitrary tool output. */
export function finalJson(
  stdout: string,
  provider: 'Codex' | 'DeepSeek' = 'Codex',
  secret?: string,
): unknown {
  const decode = (text: string): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('Codex JSON 无法解析');
    }
  };
  let final: string | undefined;
  let completed = false;
  for (const line of stdout.split(/\r?\n/).filter((line) => line.trim())) {
    const item: unknown = decode(line);
    if (!item || typeof item !== 'object' || !('type' in item)) throw new Error('Codex JSONL 无效');
    if (item.type === 'turn.failed' || item.type === 'error')
      throw new Error(codexFailure(stdout, '', undefined, provider, secret));
    if (item.type === 'turn.completed') completed = true;
    if (
      item.type === 'item.completed' &&
      'item' in item &&
      item.item &&
      typeof item.item === 'object' &&
      'type' in item.item &&
      item.item.type === 'agent_message' &&
      'text' in item.item &&
      typeof item.item.text === 'string'
    )
      final = item.item.text;
  }
  if (!completed || !final || Buffer.byteLength(final) > 64000)
    throw new Error('Codex 缺少有效最终 JSON');
  return decode(final);
}
/** Production CLI adapter. Analysis/participation use read-only; implementation uses workspace-write. */
export class CodexCliExecutor implements AgentExecutor {
  constructor(
    private command: string,
    private timeoutMs: number,
    private adapter?: SpawnAdapter,
    private profile = defaultAgentModel('codex'),
  ) {}
  private async execute<K extends keyof typeof schemas>(kind: K, input: ExecutionInput) {
    const deepseek = this.profile.provider === 'deepseek';
    const settings = deepseek ? await readDeepSeekSettings() : undefined;
    const apiKey = settings?.apiKey || process.env.DEEPSEEK_API_KEY?.trim();
    if (deepseek && !apiKey)
      throw new Error('请在项目设备的模型设置中填写 DeepSeek API Key，或设置 DEEPSEEK_API_KEY。');
    const root = dataDirectory;
    const temp = await mkdtemp(path.join(root, '.codex-task-'));
    try {
      const schema = path.join(temp, 'output-schema.json');
      await writeFile(schema, JSON.stringify(schemas[kind]), 'utf8');
      const flags = [
        'apps',
        'plugins',
        'hooks',
        'multi_agent',
        'browser_use',
        'computer_use',
        'image_generation',
      ].flatMap((feature) => ['--disable', feature]);
      const args = [
        ...(deepseek
          ? [
              '-c',
              'model_provider="egent_deepseek"',
              '-c',
              `model_providers.egent_deepseek={name="DeepSeek",base_url=${JSON.stringify(settings!.baseUrl)},wire_api="responses",env_key="DEEPSEEK_API_KEY",requires_openai_auth=false,supports_websockets=false}`,
              '-c',
              'web_search="disabled"',
            ]
          : []),
        ...(this.profile.model ? ['--model', this.profile.model] : []),
        ...(this.profile.effort
          ? ['-c', 'model_reasoning_effort=' + JSON.stringify(this.profile.effort)]
          : []),
        '-a',
        'never',
        '-c',
        'mcp_servers={}',
        ...flags,
        'exec',
        '--sandbox',
        kind === 'implement' ? 'workspace-write' : 'read-only',
        '--ephemeral',
        '--skip-git-repo-check',
        '--color',
        'never',
        '--json',
        '--output-schema',
        schema,
        '-',
      ];
      const provider = deepseek ? 'DeepSeek' : 'Codex';
      const output = await runProcess(
        this.command,
        args,
        input,
        this.timeoutMs,
        this.adapter,
        provider,
        deepseek ? { DEEPSEEK_API_KEY: apiKey } : {},
      );
      return parseResult(kind, finalJson(output.stdout, provider, deepseek ? apiKey : undefined));
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }
  analyze(input: ExecutionInput) {
    return this.execute('analyze', input);
  }
  participate(input: ExecutionInput) {
    return this.execute('participate', input);
  }
  implement(input: ExecutionInput) {
    return this.execute('implement', input);
  }
}
