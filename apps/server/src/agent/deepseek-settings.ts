import { readFile, rename, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataDirectory } from '@egent/database';
import { ApiError } from '../errors.js';

const file = path.join(dataDirectory, 'deepseek-settings.json');
const defaultUrl = 'https://api.deepseek.com';
type Stored = { baseUrl: string; apiKey?: string };
let writes = Promise.resolve();

export async function readDeepSeekSettings(): Promise<Stored> {
  try {
    const data = JSON.parse(await readFile(file, 'utf8')) as Stored;
    return { baseUrl: data.baseUrl, apiKey: data.apiKey };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { baseUrl: defaultUrl };
    throw error;
  }
}

export async function deepSeekStatus() {
  const settings = await readDeepSeekSettings();
  return {
    baseUrl: settings.baseUrl,
    hasSavedKey: !!settings.apiKey,
    hasEnvironmentKey: !!process.env.DEEPSEEK_API_KEY?.trim(),
  };
}

export async function writeDeepSeekSettings(body: unknown) {
  if (!body || typeof body !== 'object' || !('baseUrl' in body) || !('apiKey' in body))
    throw new ApiError(400, 'INVALID_DEEPSEEK_SETTINGS', '请填写 API 地址');
  const { baseUrl, apiKey } = body;
  if (
    typeof baseUrl !== 'string' ||
    baseUrl.length > 2048 ||
    !(
      apiKey === null ||
      (typeof apiKey === 'string' && apiKey.length <= 4096 && !/[\p{Cc}\p{Cs}]/u.test(apiKey))
    )
  )
    throw new ApiError(400, 'INVALID_DEEPSEEK_SETTINGS', 'API 地址或 Key 无效');
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    throw new ApiError(400, 'INVALID_DEEPSEEK_URL', '请输入有效的 HTTPS API 地址');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new ApiError(
      400,
      'INVALID_DEEPSEEK_URL',
      'API 地址必须是 HTTPS，不能包含账号、密码、查询参数或片段',
    );
  const operation = writes.then(async () => {
    const previous = await readDeepSeekSettings();
    // null preserves the current key; an empty string explicitly removes it.
    const key = apiKey === null ? previous.apiKey : apiKey.trim() || undefined;
    const temp = file + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(
        temp,
        JSON.stringify({ baseUrl: url.toString().replace(/\/$/, ''), apiKey: key }),
        { encoding: 'utf8', mode: 0o600 },
      );
      await rename(temp, file);
    } finally {
      await rm(temp, { force: true });
    }
    return deepSeekStatus();
  });
  writes = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}
