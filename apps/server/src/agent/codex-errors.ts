import { stripVTControlCharacters } from 'node:util';

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Follow error/message envelopes only, never dump tool results, prompts or the full event. */
function errorMessage(value: unknown, depth = 0): string | undefined {
  if (depth > 6) return;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return;
    if (text.startsWith('{')) {
      try {
        return errorMessage(JSON.parse(text), depth + 1);
      } catch {
        return;
      }
    }
    return text;
  }
  if (record(value))
    return errorMessage(value.error, depth + 1) ?? errorMessage(value.message, depth + 1);
}

/** Redact common authentication formats before any logging or user-facing truncation. */
export function redactCodexError(value: string): string {
  return stripVTControlCharacters(value)
    .replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [已隐藏]')
    .replace(/\bsk-[A-Za-z0-9_-]+/g, '[已隐藏]')
    .replace(
      /(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|password|secret|authorization)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&]+)/gi,
      '$1[已隐藏]',
    )
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[已隐藏]@')
    .replace(/[\p{Cc}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Surface the final JSONL failure, then an item error or stderr fallback, within UI limits. */
export function codexFailure(
  stdout: string,
  stderr: string,
  exitCode?: number | null,
  provider: 'Codex' | 'DeepSeek' = 'Codex',
  secret?: string,
): string {
  let terminal: string | undefined, eventError: string | undefined, itemError: string | undefined;
  for (const line of stdout.split(/\r?\n/)) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!record(event)) continue;
    if (event.type === 'turn.failed') terminal = errorMessage(event) ?? terminal;
    else if (event.type === 'error') eventError = errorMessage(event) ?? eventError;
    else if (event.type === 'item.completed' && record(event.item) && event.item.type === 'error')
      itemError = errorMessage(event.item) ?? itemError;
  }
  const stderrLines = stderr
    .split(/\r?\n/)
    .filter((line) => line.trim() && !/\bWARN(?:ING)?\b/i.test(line));
  const fallback =
    stderrLines.filter((line) => /\b(error|failed|fatal)\b|错误|失败/i.test(line)).at(-1) ??
    stderrLines.at(-1);
  const raw =
    terminal ??
    eventError ??
    itemError ??
    errorMessage(fallback) ??
    provider + ' 未提供具体原因，请查看项目设备的服务日志。';
  const reason = redactCodexError(secret ? raw.replaceAll(secret, '[已隐藏]') : raw);
  let hint = '';
  if (/requires a newer version of codex/i.test(reason))
    hint = '本机 Codex CLI 版本过旧，无法使用当前默认模型，请升级 CLI 后重试。';
  else if (/invalid_api_key|unauthorized|authentication|not logged in/i.test(reason))
    hint =
      provider === 'DeepSeek'
        ? 'DeepSeek 认证失败，请检查 DEEPSEEK_API_KEY。'
        : 'Codex 认证失败，请检查项目设备上的登录状态。';
  else if (/rate.limit|quota|usage.limit/i.test(reason))
    hint = provider + ' 请求额度或速率受限，请稍后重试或检查账号额度。';
  else if (/model.not.found|model.*not supported|model.*does not exist/i.test(reason))
    hint = '当前模型不可用，请检查 ' + provider + ' 配置和账号权限。';
  const prefix =
    provider + ' 调用失败' + (exitCode === undefined ? '' : '（退出码 ' + exitCode + '）') + '：';
  const text = prefix + hint + (hint ? '\n原因：' : '') + reason;
  return text.length > 380 ? text.slice(0, 379) + '…' : text;
}
