import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dataDirectory } from '@egent/database';
import { defaultAgentModel } from '@egent/shared';
import { runProcess, type SpawnAdapter } from './cli-process.js';
import { parseResult, schemas, type AgentExecutor, type ExecutionInput } from './contracts.js';
import { readDeepSeekSettings } from './deepseek-settings.js';

export class DshCliExecutor implements AgentExecutor {
  constructor(
    private command: string,
    private timeoutMs: number,
    private adapter?: SpawnAdapter,
    private profile = defaultAgentModel('dsh'),
  ) {}

  private async execute<K extends keyof typeof schemas>(kind: K, input: ExecutionInput) {
    const apiKey = (await readDeepSeekSettings()).apiKey || process.env.DEEPSEEK_API_KEY?.trim();
    const home = await mkdtemp(path.join(dataDirectory, '.dsh-task-'));
    try {
      const mode = kind === 'implement' ? 'workspace-write' : 'read-only';
      const patch = path.join(home, 'egent.patch.yml');
      const task =
        input.prompt +
        '\n最终回复必须是符合以下 JSON Schema 的单个 JSON 对象：\n' +
        JSON.stringify(schemas[kind]);
      await writeFile(
        patch,
        JSON.stringify([
          {
            id: 'agent-default-model',
            config: {
              provider: 'deepseek-official',
              model: this.profile.model,
              reasoningEffort: this.profile.effort,
            },
          },
          ...[
            'session-title-llm',
            'tool-web',
            'tool-working-directory',
            'tool-plugin-manager',
            'tool-subagent',
            'tool-subagent-fork',
            'tool-subagent-control',
            'tool-workflow',
          ].map((id) => ({ id, disabled: true })),
        ]),
        { mode: 0o600 },
      );
      const { stdout } = await runProcess(
        this.command,
        [
          '--profile',
          'headless',
          '--patch',
          patch,
          '--permission-mode',
          mode,
          '--approval-policy',
          'never',
          '-',
        ],
        { ...input, prompt: task },
        this.timeoutMs,
        this.adapter,
        'DSH',
        {
          DSH_HOME: home,
          DSH_PERMISSION_MODE: mode,
          DSH_TELEMETRY_DISABLED: '1',
          ...(apiKey ? { DEEPSEEK_API_KEY: apiKey } : {}),
        },
      );
      let result: unknown;
      try {
        result = JSON.parse(stdout);
      } catch {
        throw new Error('DSH 未返回有效的最终 JSON 对象');
      }
      return parseResult(kind, result);
    } finally {
      await rm(home, { recursive: true, force: true, maxRetries: 3 });
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
