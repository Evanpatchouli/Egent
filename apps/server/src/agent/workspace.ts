import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { readCodexProjects } from '../services/codex-projects.js';
/** Workspace always derives from a persisted conversation and current Codex registration. */
export async function validateWorkspace(
  workspacePath: string,
  reader = readCodexProjects,
): Promise<string> {
  const normalized = path.resolve(workspacePath);
  const identity = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
  if (
    !(await reader()).some(
      (project) => identity(path.resolve(project.path)) === identity(normalized),
    )
  )
    throw new Error('工作区已不在 Codex projects 配置中');
  const info = await stat(normalized).catch(() => {
    throw new Error('工作区不存在或无法访问');
  });
  if (!info.isDirectory()) throw new Error('工作区不是目录');
  const actual = await realpath(normalized);
  // Refuse directory junctions that redirect outside the registered path.
  if (identity(actual) !== identity(normalized))
    throw new Error('工作区路径存在重定向，请登记真实路径');
  return actual;
}
