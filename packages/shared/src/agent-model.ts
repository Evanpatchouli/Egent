export const agentEfforts = {
  codex: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  deepseek: ['none', 'low', 'high', 'max'],
  dsh: ['off', 'low', 'high', 'max'],
} as const;
export type AgentProvider = keyof typeof agentEfforts;
export interface AgentModelProfile {
  provider: AgentProvider;
  /** Null delegates this option to the Codex CLI. */
  model: string | null;
  effort: string | null;
}
export interface AgentModelSettings {
  profile: AgentModelProfile;
  source: 'environment' | 'global' | 'conversation';
  /** Owner-only choices for the model editor, including inherited provider settings. */
  savedProfiles?: Partial<Record<AgentProvider, AgentModelProfile>>;
}
export function defaultAgentModel(provider: AgentProvider): AgentModelProfile {
  return provider === 'codex'
    ? { provider, model: null, effort: null }
    : { provider, model: 'deepseek-flash', effort: 'high' };
}
