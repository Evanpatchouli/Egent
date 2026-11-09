import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { parse } from 'smol-toml';
import { ApiError } from '../errors.js';

/** Read only projects.* from Codex. Optional path is dependency injection for isolated tests, not an API parameter. */
export async function readCodexProjects(
  configPath = path.join(homedir(), '.codex', 'config.toml'),
) {
  if (process.env.EGENT_TEST_MODE === '1' && process.env.EGENT_TEST_PROJECTS)
    return JSON.parse(process.env.EGENT_TEST_PROJECTS) as Array<{ path: string; name: string }>;
  let bytes: Buffer;
  try {
    bytes = await readFile(configPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'UNKNOWN';
    console.error('[codex-config] read failed', { code, configPath });
    throw new ApiError(
      503,
      'CODEX_CONFIG_UNAVAILABLE',
      '无法读取 Codex config.toml，请检查文件是否存在及读取权限',
    );
  }
  try {
    const doc = parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes), {
      integersAsBigInt: 'asNeeded',
    });
    if (doc.projects === undefined) return [];
    if (
      !doc.projects ||
      typeof doc.projects !== 'object' ||
      Array.isArray(doc.projects) ||
      doc.projects instanceof Date
    )
      throw new Error('projects must be a table');
    return Object.entries(doc.projects).map(([projectPath, value]) => {
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        value instanceof Date ||
        !(path.win32.isAbsolute(projectPath) || path.posix.isAbsolute(projectPath))
      )
        throw new Error('invalid project entry');
      return {
        path: projectPath,
        name:
          (projectPath.includes('\\') ? path.win32 : path.posix).basename(projectPath) ||
          projectPath,
      };
    });
  } catch (error) {
    // Parser messages can include configuration secrets; log location/category only.
    console.error('[codex-config] invalid TOML/projects', {
      configPath,
      category: error instanceof Error ? error.name : 'UnknownError',
    });
    throw new ApiError(503, 'CODEX_CONFIG_INVALID', 'Codex config.toml 格式或 projects 配置无效');
  }
}
