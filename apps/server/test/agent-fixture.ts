import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma, initializeDatabase } from '@egent/database';
import { createApp } from '../src/app.js';
import { AgentService } from '../src/agent/service.js';
import { DeviceService } from '../src/device/service.js';
import { loadIdentity } from '../src/device/identity.js';
import { attachSocketServer } from '../src/socket/index.js';

// Test-only server: production entry points never import this deterministic model adapter.
if (process.env.EGENT_TEST_MODE !== '1' || !process.env.EGENT_DATA_DIR?.includes('.tmp'))
  throw new Error('Fixture requires an isolated test data directory');
await initializeDatabase();
const agent = new AgentService(
  () => ({
    analyze: async ({ prompt }) => {
      await new Promise((r) => setTimeout(r, 150));
      const question = prompt.includes('本次仅只读问答');
      return {
        type: question ? 'QUESTION' : 'DEVELOPMENT_SIMPLE',
        summary: '为列表添加清晰的空状态提示',
        confidence: 1,
        plan: ['检查列表状态', '补充空状态文案', '运行相关验证'],
        affectedAreas: ['列表组件'],
        risks: ['保持现有交互不变'],
        needsOwnerConfirmation: false,
        answer: '这是显式 @Egent 的只读回答。',
        certain: true,
        evidence: ['fixture README: 测试依据'],
      };
    },
    participate: async ({ prompt }) => ({
      shouldReply: prompt.includes('智能问题'),
      answer: '这是智能参与的只读回答。',
      evidence: ['fixture README: 测试依据'],
    }),
    implement: async () => {
      await new Promise((r) => setTimeout(r, 600));
      return {
        success: true,
        summary: '测试任务已完成（模拟执行，未修改项目文件）',
        changedFiles: [],
        verification: ['测试执行器验证通过'],
      };
    },
  }),
  async (p) => p,
);
const device = new DeviceService(await loadIdentity(), process.env.EGENT_LOCAL_TOKEN!, agent);
const port = Number(process.env.SERVER_PORT);
const origins = ['http://127.0.0.1:' + port];
const app = createApp(origins, { device, agent });
const web = fileURLToPath(new URL('../../web/dist', import.meta.url));
app.use(async (ctx) => {
  if (ctx.path.startsWith('/api/') || ctx.path.startsWith('/peer/')) return;
  const file = path.resolve(web, '.' + (ctx.path === '/' ? '/index.html' : ctx.path));
  if (!file.startsWith(web + path.sep)) return;
  try {
    ctx.type = path.extname(file);
    ctx.body = await readFile(file);
  } catch {
    ctx.status = 404;
  }
});
const http = createServer(app.callback());
const io = attachSocketServer(http, origins, device);
await agent.start();
device.startSync();
http.listen(port, '127.0.0.1', () => console.log('AGENT_FIXTURE_READY ' + port));
const stop = async () => {
  device.stop();
  await agent.stop();
  io.close();
  await prisma.$disconnect();
  process.exit();
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
