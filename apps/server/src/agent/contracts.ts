import type { AgentType } from '@egent/shared';
/** Validated code-grounded analysis, never an unbounded stdout transcript. */
export interface AnalysisResult {
  type: AgentType;
  summary: string;
  confidence: number;
  plan: string[];
  affectedAreas: string[];
  risks: string[];
  needsOwnerConfirmation: boolean;
  answer: string;
  evidence: string[];
  certain: boolean;
}
/** Read-only participation decision; silence is a valid successful result. */
export interface ParticipationResult {
  shouldReply: boolean;
  answer: string;
  evidence: string[];
}
/** Verified implementation summary. A zero process exit alone does not mean task success. */
export interface ImplementationResult {
  success: boolean;
  summary: string;
  changedFiles: string[];
  verification: string[];
}
/** Server-owned context, bounded before reaching the selected executor. */
export interface ExecutionInput {
  workspacePath: string;
  prompt: string;
  signal: AbortSignal;
}
/** The project device selects the executor for all three phases. */
export interface AgentExecutor {
  analyze(input: ExecutionInput): Promise<AnalysisResult>;
  participate(input: ExecutionInput): Promise<ParticipationResult>;
  implement(input: ExecutionInput): Promise<ImplementationResult>;
}
export type ConversationExecutor = (id: string) => AgentExecutor | Promise<AgentExecutor>;
const text = { type: 'string', maxLength: 4000 };
const list = { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 1000 } };
/** JSON schemas constrain the CLI final result and are independently enforced below. */
export const schemas = {
  analyze: {
    type: 'object',
    additionalProperties: false,
    required: [
      'type',
      'summary',
      'confidence',
      'plan',
      'affectedAreas',
      'risks',
      'needsOwnerConfirmation',
      'answer',
      'evidence',
      'certain',
    ],
    properties: {
      type: { type: 'string', enum: ['DEVELOPMENT_SIMPLE', 'DEVELOPMENT_COMPLEX', 'QUESTION'] },
      summary: text,
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      plan: list,
      affectedAreas: list,
      risks: list,
      needsOwnerConfirmation: { type: 'boolean' },
      answer: text,
      evidence: list,
      certain: { type: 'boolean' },
    },
  },
  participate: {
    type: 'object',
    additionalProperties: false,
    required: ['shouldReply', 'answer', 'evidence'],
    properties: { shouldReply: { type: 'boolean' }, answer: text, evidence: list },
  },
  implement: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'summary', 'changedFiles', 'verification'],
    properties: {
      success: { type: 'boolean' },
      summary: text,
      changedFiles: list,
      verification: list,
    },
  },
} as const;
type Shape = {
  type: string;
  properties?: Record<string, Shape>;
  required?: readonly string[];
  enum?: readonly string[];
  items?: Shape;
  maxItems?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
};
function validate(value: unknown, shape: Shape): boolean {
  if (shape.type === 'object')
    return (
      !!value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (shape.required ?? []).every((key) => key in value) &&
      Object.entries(value).every(
        ([key, item]) => !!shape.properties?.[key] && validate(item, shape.properties[key]),
      )
    );
  if (shape.type === 'string')
    return (
      typeof value === 'string' &&
      value.length <= (shape.maxLength ?? 4000) &&
      (!shape.enum || shape.enum.includes(value))
    );
  if (shape.type === 'boolean') return typeof value === 'boolean';
  if (shape.type === 'integer' && !Number.isInteger(value)) return false;
  if (shape.type === 'number' || shape.type === 'integer')
    return (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= (shape.minimum ?? -Infinity) &&
      value <= (shape.maximum ?? Infinity)
    );
  return (
    shape.type === 'array' &&
    Array.isArray(value) &&
    value.length <= (shape.maxItems ?? 30) &&
    value.every((item) => validate(item, shape.items!))
  );
}
/** Reject malformed, oversized, unknown or semantically incomplete output from every adapter. */
export function parseResult<K extends keyof typeof schemas>(
  kind: K,
  value: unknown,
): K extends 'analyze'
  ? AnalysisResult
  : K extends 'participate'
    ? ParticipationResult
    : ImplementationResult {
  if (!validate(value, schemas[kind]) || JSON.stringify(value).length > 64000)
    throw new Error('Agent 结构化输出无效');
  if (kind === 'analyze') {
    const result = value as AnalysisResult;
    if (!result.summary.trim() || (result.type !== 'QUESTION' && !result.plan.length))
      throw new Error('Agent 分析缺少摘要或方案');
  }
  return value as K extends 'analyze'
    ? AnalysisResult
    : K extends 'participate'
      ? ParticipationResult
      : ImplementationResult;
}
