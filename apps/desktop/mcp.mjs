import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'egent', version: '0.5.5' });
const uuid = z.uuid();
const conversation = { conversationId: uuid };
const historyPath = (id) => '/api/conversations/' + id + '/messages';
const result = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

async function request(route, signal, body) {
  const dir = process.env.EGENT_DATA_DIR || path.join(process.env.APPDATA, 'Egent');
  let runtime;
  try {
    runtime = JSON.parse(await readFile(path.join(dir, 'runtime.json'), 'utf8'));
  } catch {
    throw new Error('请先启动本机 Egent 并设置昵称。');
  }
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(runtime.url) || typeof runtime.token !== 'string')
    throw new Error('本机 Egent 运行配置无效，请重新启动 Egent。');
  const response = await fetch(runtime.url + route, {
    method: body ? 'POST' : 'GET',
    redirect: 'error',
    headers: { 'X-Egent-Local-Token': runtime.token, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || 'Egent HTTP ' + response.status);
  return data;
}

server.registerTool(
  'list_conversations',
  {
    description:
      'List conversations visible to the current Egent user. Choose the requested project and conversation.',
    inputSchema: {},
  },
  async (_, { signal }) => result(await request('/api/conversations', signal)),
);

server.registerTool(
  'read_messages',
  {
    description:
      'Read visible conversation history in chronological order. Use before for older messages or after for newer messages.',
    inputSchema: {
      ...conversation,
      before: uuid.optional(),
      after: uuid.optional(),
      limit: z.number().int().min(1).max(100).default(30),
    },
  },
  async ({ conversationId, before, after, limit }, { signal }) => {
    if (before && after) throw new Error('请选择一个分页方向');
    const query = new URLSearchParams({ limit: String(limit) });
    if (before) query.set('before', before);
    if (after) query.set('after', after);
    return result(await request(historyPath(conversationId) + '?' + query, signal));
  },
);

server.registerTool(
  'send_message',
  {
    description:
      'Post as the local user. Set askEgent to request a read-only answer. Reuse the same clientMessageId for retries. Use returned agentTaskId and message id (after) with wait_for_reply.',
    inputSchema: {
      ...conversation,
      content: z.string().trim().min(1),
      askEgent: z.boolean().default(false),
      clientMessageId: uuid.optional(),
    },
  },
  async ({ conversationId, content, askEgent, clientMessageId }, { signal }) => {
    if (askEgent && !/(?:^|\s)@Egent(?=\s|$)/iu.test(content)) content = '@Egent ' + content;
    return result(
      await request(historyPath(conversationId), signal, {
        content,
        clientMessageId: clientMessageId ?? randomUUID(),
      }),
    );
  },
);

server.registerTool(
  'wait_for_reply',
  {
    description:
      'Wait for the reply to one explicit question. Use its conversationId, agentTaskId and message id as after. On pending, repeat with the returned cursor. Do not resend.',
    inputSchema: {
      ...conversation,
      agentTaskId: uuid,
      after: uuid,
      timeoutSeconds: z.number().int().min(1).max(30).default(15),
    },
  },
  async ({ conversationId, agentTaskId, after, timeoutSeconds }, { signal }) => {
    const deadline = Date.now() + timeoutSeconds * 1000;
    do {
      const page = await request(historyPath(conversationId) + '?limit=100&after=' + after, signal);
      const reply = page.items.find(
        (m) => m.senderType === 'AGENT' && m.agentTaskId === agentTaskId,
      );
      if (reply) return result({ status: 'replied', message: reply });
      after = page.items.at(-1)?.id ?? after;
      if (!page.hasMore)
        await delay(Math.min(750, Math.max(0, deadline - Date.now())), undefined, { signal });
    } while (Date.now() < deadline);
    return result({ status: 'pending', conversationId, agentTaskId, after });
  },
);

server.connect(new StdioServerTransport()).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
