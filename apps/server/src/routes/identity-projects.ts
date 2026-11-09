import Router from '@koa/router';
import { prisma } from '@egent/database';
import { USER_IDENTIFIER_HEADER } from '@egent/shared';
import { ApiError } from '../errors.js';

import { resolveUser } from '../services/users.js';
import { readCodexProjects } from '../services/codex-projects.js';

/** Small P2 router. Reader injection is server-owned and never accepted from requests. */
export function identityProjectsRouter(readProjects = readCodexProjects) {
  const router = new Router();
  router.get('/api/me', async (ctx) => {
    ctx.body = await resolveUser(ctx.get(USER_IDENTIFIER_HEADER));
  });
  router.get('/api/projects', async (ctx) => {
    const user = await resolveUser(ctx.get(USER_IDENTIFIER_HEADER));
    const projects = await readProjects();
    const settings = await prisma.projectSetting.findMany({
      where: { projectPath: { in: projects.map((project) => project.path) } },
    });
    const visibility = new Map(
      settings.map((setting) => [setting.projectPath, setting.colleagueVisible]),
    );
    ctx.body =
      user.role === 'OWNER'
        ? projects.map((project) => ({
            ...project,
            colleagueVisible: visibility.get(project.path) ?? false,
          }))
        : projects.filter((project) => visibility.get(project.path) === true);
  });
  router.put('/api/projects/visibility', async (ctx) => {
    const user = await resolveUser(ctx.get(USER_IDENTIFIER_HEADER));
    if (user.role !== 'OWNER')
      throw new ApiError(403, 'FORBIDDEN', '只有 Owner 可以修改项目可见性');
    const body: unknown = ctx.request.body;
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      !('projectPath' in body) ||
      typeof body.projectPath !== 'string' ||
      !('colleagueVisible' in body) ||
      typeof body.colleagueVisible !== 'boolean' ||
      Object.keys(body).some((key) => !['projectPath', 'colleagueVisible'].includes(key))
    )
      throw new ApiError(400, 'INVALID_BODY', '需要 projectPath 和布尔 colleagueVisible');
    const project = (await readProjects()).find((item) => item.path === body.projectPath);
    if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', '项目已不在 Codex 配置中');
    await prisma.projectSetting.upsert({
      where: { projectPath: project.path },
      create: { projectPath: project.path, colleagueVisible: body.colleagueVisible },
      update: { colleagueVisible: body.colleagueVisible },
    });
    ctx.body = { ...project, colleagueVisible: body.colleagueVisible };
  });
  return router;
}
