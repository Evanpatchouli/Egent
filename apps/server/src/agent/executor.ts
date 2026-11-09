import { CodexCliExecutor } from './codex-executor.js';
import type { SpawnAdapter } from './cli-process.js';
import { DshCliExecutor } from './dsh-executor.js';
import type { AgentExecutor } from './contracts.js';
import { environmentProfile } from './model-settings.js';

export function createAgentExecutor(
  env: NodeJS.ProcessEnv = process.env,
  adapter?: SpawnAdapter,
  profile = environmentProfile(env),
): AgentExecutor {
  const timeout = Number(env.EGENT_AGENT_TIMEOUT_MS ?? env.CODEX_TIMEOUT_MS ?? 600000);
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 3600000)
    throw new Error('Agent 超时必须是 1000 至 3600000 之间的整数毫秒数');
  switch (profile.provider) {
    case 'dsh': {
      const command = (env.DSH_COMMAND ?? 'dsh').trim();
      if (!command) throw new Error('DSH_COMMAND 不能为空');
      return new DshCliExecutor(command, timeout, adapter, profile);
    }
    case 'codex':
    case 'deepseek': {
      const command = (env.CODEX_COMMAND ?? 'codex').trim();
      if (!command) throw new Error('CODEX_COMMAND 不能为空');
      return new CodexCliExecutor(command, timeout, adapter, profile);
    }
  }
}
