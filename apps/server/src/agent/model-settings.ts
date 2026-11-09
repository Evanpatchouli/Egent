import { prisma, serialWrite } from '@egent/database';
import {
  agentEfforts,
  defaultAgentModel,
  type AgentModelProfile,
  type AgentModelSettings,
  type AgentProvider,
} from '@egent/shared';
import { ApiError } from '../errors.js';

export function environmentProfile(env: NodeJS.ProcessEnv = process.env): AgentModelProfile {
  const provider = env.EGENT_AGENT_PROVIDER?.trim().toLowerCase() ?? 'codex';
  if (provider !== 'codex' && provider !== 'deepseek' && provider !== 'dsh')
    throw new Error('EGENT_AGENT_PROVIDER 必须为 codex、deepseek 或 dsh');
  const profile = defaultAgentModel(provider);
  if (provider === 'deepseek' && env.DEEPSEEK_MODEL !== undefined) {
    profile.model = env.DEEPSEEK_MODEL.trim();
    if (!profile.model) throw new Error('DEEPSEEK_MODEL 不能为空');
  }
  return profile;
}

function parseProfile(input: unknown): AgentModelProfile {
  if (
    !input ||
    typeof input !== 'object' ||
    !('provider' in input) ||
    !('model' in input) ||
    !('effort' in input) ||
    Object.keys(input).some((key) => !['provider', 'model', 'effort'].includes(key))
  )
    throw new ApiError(400, 'INVALID_AGENT_PROFILE', '需要执行器、模型和思考强度');
  const { provider, model, effort } = input;
  if (provider !== 'codex' && provider !== 'deepseek' && provider !== 'dsh')
    throw new ApiError(400, 'INVALID_AGENT_PROVIDER', '执行器无效');
  if (
    !(model === null && provider === 'codex') &&
    !(typeof model === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(model))
  )
    throw new ApiError(400, 'INVALID_AGENT_MODEL', '请填写有效的模型 ID（最多 128 个字符）');
  if (
    !(effort === null && provider === 'codex') &&
    !(typeof effort === 'string' && (agentEfforts[provider] as readonly string[]).includes(effort))
  )
    throw new ApiError(400, 'INVALID_AGENT_EFFORT', '此执行器不支持该思考强度');
  return { provider, model, effort };
}

// Active settings keep their original scope keys. Inactive choices use a reserved suffix.
function providerScopes(scope: string) {
  return Object.keys(agentEfforts).map((provider) => scope + '/' + provider);
}

export async function readModelSettings(
  id?: string,
  includeSaved = false,
): Promise<AgentModelSettings> {
  const scopes = id ? ['global', id] : ['global'];
  const keys = includeSaved ? scopes.flatMap((scope) => [scope, ...providerScopes(scope)]) : scopes;
  const rows = await prisma.agentModelSetting.findMany({
    where: { scope: { in: keys } },
  });
  const byScope = new Map(rows.map(({ scope, ...profile }) => [scope, parseProfile(profile)]));
  const scoped = id ? byScope.get(id) : undefined;
  const global = byScope.get('global');
  const profile = scoped ?? global ?? environmentProfile();
  const result: AgentModelSettings = {
    profile,
    source: scoped ? 'conversation' : global ? 'global' : 'environment',
  };
  if (includeSaved) {
    const saved: Partial<Record<AgentProvider, AgentModelProfile>> = {};
    for (const scope of scopes) {
      for (const key of [...providerScopes(scope), scope]) {
        const choice = byScope.get(key);
        if (choice) saved[choice.provider] = choice;
      }
    }
    result.savedProfiles = saved;
  }
  return result;
}

/** Removing a setting restores live inheritance for subsequent calls. */
export async function writeModelSettings(scope: string, body: unknown) {
  if (!body || typeof body !== 'object' || !('profile' in body) || Object.keys(body).length !== 1)
    throw new ApiError(400, 'INVALID_AGENT_SETTINGS', '需要 profile 设置');
  const profile = body.profile === null ? null : parseProfile(body.profile);
  return serialWrite(async () => {
    await prisma.$transaction(async (tx) => {
      if (!profile) {
        await tx.agentModelSetting.deleteMany({
          where: { scope: { in: [scope, ...providerScopes(scope)] } },
        });
        return;
      }
      const current = await tx.agentModelSetting.findUnique({ where: { scope } });
      if (current && current.provider !== profile.provider) {
        const { provider, model, effort } = current;
        const previous = { provider, model, effort };
        const key = scope + '/' + provider;
        await tx.agentModelSetting.upsert({
          where: { scope: key },
          create: { scope: key, ...previous },
          update: previous,
        });
      }
      await tx.agentModelSetting.upsert({
        where: { scope },
        create: { scope, ...profile },
        update: profile,
      });
    });
    return readModelSettings(scope === 'global' ? undefined : scope, true);
  });
}
