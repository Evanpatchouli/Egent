import Router from '@koa/router';
import { prisma } from '@egent/database';
import type { UserInfo, MessageInfo, MessagePage, ConversationInfo } from '@egent/shared';
import { ApiError } from '../errors.js';
import { readCodexProjects } from '../services/codex-projects.js';
import {
  listConversations,
  joinConversation,
  markRead,
  visibleTaskWhere,
  setAgentParticipation,
  setConversationModel,
} from '../services/conversations.js';
import { messageHistory, sendMessage } from '../services/messages.js';
import { taskInfo } from '../agent/task-store.js';
import type { AgentService } from '../agent/service.js';
import { GroupService } from './groups.js';
import { PeerService } from './peers.js';
import { localUser, deviceUserId, type DeviceIdentity } from './identity.js';
import { chatEvents } from '../services/chat-events.js';
import { readModelSettings, writeModelSettings } from '../agent/model-settings.js';
import { deepSeekStatus, writeDeepSeekSettings } from '../agent/deepseek-settings.js';
import { dismissMentions, markMentionsRead, recordMention } from './mentions.js';

/** Device-local control and the limited peer data plane are separate trust boundaries. */
export class DeviceService {
  peers: PeerService;
  groups: GroupService;
  private retryAt = new Map<string, number>();
  private syncJobs = new Map<string, Promise<void>>();
  private syncing = false;
  private timer?: ReturnType<typeof setInterval>;
  private startedAt = new Date().toISOString();
  private readWatermarks = new Map<string, string>();
  private onMessage = (message: MessageInfo) => {
    void (async () => {
      const me = await localUser(this.identity);
      if (!me) return;
      const participant = await prisma.conversationParticipant.findUnique({
        where: { conversationId_userId: { conversationId: message.conversationId, userId: me.id } },
      });
      if (participant) await recordMention(message, me, participant.lastReadAt?.toISOString());
    })().catch((error: unknown) => console.error('[mention]', error));
  };
  constructor(
    public identity: DeviceIdentity,
    public localToken: string,
    private agent?: AgentService,
  ) {
    chatEvents.on('message', this.onMessage);
    this.groups = new GroupService(this);
    this.peers = new PeerService(identity, (user, method, path, body) =>
      this.dispatch(user, method, path, body),
    );
  }
  async dispatch(user: UserInfo, method: string, path: string, body: unknown): Promise<unknown> {
    const url = new URL(path, 'http://peer');
    const route = url.pathname;
    const model = route.match(/^\/api\/conversations\/([a-f0-9-]{36})\/agent-model$/i);
    if (model && method === 'PUT') return setConversationModel(user, model[1]!, body);
    if (method === 'POST' && route === '/api/groups') return this.groups.create(user, body);
    const invitation = route.match(/^\/api\/conversations\/([a-f0-9-]{36})\/invite$/i);
    if (invitation && method === 'POST') return this.groups.invite(user, invitation[1]!, body);
    const mode = route.match(/^\/api\/conversations\/([a-f0-9-]{36})\/agent-participation$/i);
    if (mode && method === 'PUT')
      return setAgentParticipation(user, mode[1]!, (body as { enabled?: unknown })?.enabled);
    if (method === 'GET' && route === '/api/me') return user;
    if (method === 'GET' && route === '/api/projects') {
      const rows = await readCodexProjects();
      const visible = await prisma.projectSetting.findMany({ where: { colleagueVisible: true } });
      return user.role === 'OWNER'
        ? rows
        : rows.filter((p) => visible.some((v) => v.projectPath === p.path));
    }
    if (route === '/api/conversations') {
      if (method === 'GET') return listConversations(user);
    }
    const match = route.match(
      /^\/api\/conversations\/([a-f0-9-]{36})(?:\/(join|messages|read|agent-tasks))?$/i,
    );
    if (match) {
      const id = match[1]!,
        action = match[2];
      if ((!action && method === 'GET') || (action === 'join' && method === 'POST'))
        return joinConversation(user, id);
      if (action === 'messages' && method === 'GET')
        return messageHistory(user, id, Object.fromEntries(url.searchParams));
      if (action === 'messages' && method === 'POST') return sendMessage(user, id, body);
      if (action === 'read' && method === 'POST') {
        await markRead(user, id, (body as { messageId?: unknown })?.messageId);
        return { ok: true };
      }
      if (action === 'agent-tasks' && method === 'POST') {
        if (!this.agent) throw new ApiError(503, 'AGENT_UNAVAILABLE', 'Agent 未启动');
        return this.agent.create(user, id, body);
      }
      if (action === 'agent-tasks' && method === 'GET') {
        const where = await visibleTaskWhere(user, id);
        return (
          await prisma.agentTask.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: 30,
          })
        ).map((task) => taskInfo(task, user));
      }
    }
    const taskDetail = route.match(/^\/api\/agent-tasks\/([a-f0-9-]{36})$/i);
    if (taskDetail && method === 'GET') {
      const task = await prisma.agentTask.findUnique({ where: { id: taskDetail[1] } });
      if (
        !task ||
        !(await prisma.agentTask.findFirst({
          where: { id: task.id, ...(await visibleTaskWhere(user, task.conversationId)) },
        }))
      )
        throw new ApiError(403, 'TASK_HIDDEN', '任务不在可见记录中');
      return taskInfo(task, user);
    }
    const taskAction = route.match(/^\/api\/agent-tasks\/([a-f0-9-]{36})\/(confirm|revise)$/i);
    if (taskAction && method === 'POST' && this.agent)
      return this.agent.action(user, taskAction[1]!, taskAction[2] as 'confirm' | 'revise', body);
    const cancel = route.match(/^\/api\/agent-tasks\/([a-f0-9-]{36})\/cancel$/i);
    if (cancel && method === 'POST' && this.agent) {
      await this.agent.cancel(user, cancel[1]!);
      return { ok: true };
    }
    throw new ApiError(403, 'PEER_FORBIDDEN', '远程设备不能调用本机管理接口');
  }
  /** Local snapshot tables are replicas only: never schedule Agent from remote copies. */
  async sync(peerId: string) {
    const existing = this.syncJobs.get(peerId);
    if (existing) return existing;
    const job = this.syncNow(peerId).finally(() => this.syncJobs.delete(peerId));
    this.syncJobs.set(peerId, job);
    return job;
  }
  /** Live bridge messages are recorded before the renderer can mark them read. */
  async observeMessage(message: MessageInfo) {
    const me = await localUser(this.identity);
    if (me) await recordMention(message, me, this.readWatermarks.get(message.conversationId));
  }
  private async syncNow(peerId: string) {
    const conversations = (await this.peers.request(
      peerId,
      'GET',
      '/api/conversations',
    )) as ConversationInfo[];
    await this.cache(peerId, '/api/conversations', conversations);
    const projects = await this.peers.request(peerId, 'GET', '/api/projects');
    await this.cache(peerId, '/api/projects', projects);
    for (const c of conversations) {
      const tasks = await this.peers.request(
        peerId,
        'GET',
        '/api/conversations/' + c.id + '/agent-tasks',
      );
      await this.cache(peerId, '/api/conversations/' + c.id + '/agent-tasks', tasks);
      const stored = await prisma.remoteSnapshot.findUnique({
        where: { peerId_resource: { peerId, resource: 'messages:' + c.id } },
      });
      let messages = (stored?.data ?? []) as unknown as MessageInfo[];
      const known = new Set(messages.map((message) => message.id));
      const me = await localUser(this.identity);
      let after = messages.at(-1)?.id;
      let supportsTaskCreation = false;
      for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
        const page = (await this.peers.request(
          peerId,
          'GET',
          '/api/conversations/' + c.id + '/messages?limit=100' + (after ? '&after=' + after : ''),
        )) as MessagePage;
        supportsTaskCreation ||= page.supportsTaskCreation === true;
        if (me) {
          const readAfter = [c.lastReadAt, this.readWatermarks.get(c.id)]
            .filter((value): value is string => !!value)
            .sort()
            .at(-1);
          for (const message of page.items) {
            if (!known.has(message.id) && (stored || message.createdAt >= this.startedAt))
              await recordMention(message, me, readAfter);
            known.add(message.id);
          }
        }
        messages = [...new Map([...messages, ...page.items].map((m) => [m.id, m])).values()].sort(
          (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
        );
        await this.cache(peerId, 'messages:' + c.id, messages);
        if (!page.hasMore) break;
        // First connection backfills earlier pages; later connections only append missing messages.
        if (!after) {
          let before = page.nextCursor;
          while (before) {
            const older = (await this.peers.request(
              peerId,
              'GET',
              '/api/conversations/' + c.id + '/messages?limit=100&before=' + before,
            )) as MessagePage;
            messages = [
              ...new Map([...older.items, ...messages].map((m) => [m.id, m])).values(),
            ].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
            await this.cache(peerId, 'messages:' + c.id, messages);
            before = older.nextCursor;
          }
          break;
        }
        after = page.nextCursor ?? undefined;
      }
      // Upgrade old offline replicas once the authority can classify historical messages.
      const markerResource = 'message-task-markers:' + c.id;
      if (
        supportsTaskCreation &&
        !(await prisma.remoteSnapshot.findUnique({
          where: { peerId_resource: { peerId, resource: markerResource } },
        }))
      ) {
        if (stored && messages.some((m) => m.senderType === 'USER' && m.agentTaskId)) {
          let before: string | null = null;
          do {
            const page = (await this.peers.request(
              peerId,
              'GET',
              '/api/conversations/' +
                c.id +
                '/messages?limit=100' +
                (before ? '&before=' + before : ''),
            )) as MessagePage;
            if (!page.supportsTaskCreation) throw new Error('任务消息标记不可用');
            messages = [
              ...new Map([...messages, ...page.items].map((m) => [m.id, m])).values(),
            ].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
            await this.cache(peerId, 'messages:' + c.id, messages);
            before = page.nextCursor;
          } while (before);
        }
        await this.cache(peerId, markerResource, true);
      }
    }
    chatEvents.emit('peerSync', peerId);
  }
  async cache(peerId: string, resource: string, data: unknown) {
    await prisma.remoteSnapshot.upsert({
      where: { peerId_resource: { peerId, resource } },
      create: { peerId, resource, data: JSON.parse(JSON.stringify(data)) },
      update: { data: JSON.parse(JSON.stringify(data)) },
    });
  }
  async cached(peerId: string, path: string): Promise<unknown> {
    const url = new URL(path, 'http://local');
    if (url.pathname === '/api/me') {
      const me = await localUser(this.identity);
      if (me) return { ...me, role: 'COLLEAGUE' };
    }
    const messageMatch = url.pathname.match(/^\/api\/conversations\/([a-f0-9-]{36})\/messages$/i);
    if (messageMatch) {
      const stored = await prisma.remoteSnapshot.findUnique({
        where: { peerId_resource: { peerId, resource: 'messages:' + messageMatch[1] } },
      });
      const all = (stored?.data ?? []) as unknown as MessageInfo[];
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));
      const before = url.searchParams.get('before'),
        after = url.searchParams.get('after');
      let rows = all;
      if (before) {
        const index = all.findIndex((m) => m.id === before);
        rows = index < 0 ? [] : all.slice(0, index);
      }
      if (after) {
        const index = all.findIndex((m) => m.id === after);
        rows = index < 0 ? [] : all.slice(index + 1);
      }
      const items = after ? rows.slice(0, limit) : rows.slice(-limit);
      return {
        items,
        hasMore: rows.length > limit,
        nextCursor: rows.length > limit ? (after ? items.at(-1)?.id : items[0]?.id) : null,
      };
    }
    const detail = url.pathname.match(/^\/api\/conversations\/([a-f0-9-]{36})(?:\/join)?$/i);
    const resource = detail ? '/api/conversations' : url.pathname;
    const row = await prisma.remoteSnapshot.findUnique({
      where: { peerId_resource: { peerId, resource } },
    });
    if (!row && resource === '/api/conversations') return [];
    if (!row) throw new ApiError(503, 'NO_CACHE', '对方离线，尚无本地记录');
    if (detail) return (row.data as unknown as ConversationInfo[]).find((c) => c.id === detail[1]);
    return row.data;
  }
  startSync() {
    const pulse = () => {
      if (this.syncing) return;
      this.syncing = true;
      void (async () => {
        const peers = await prisma.peer.findMany();
        // Incoming handshakes also seed contacts: reciprocal connections discover invitations.
        for (let offset = 0; offset < peers.length; offset += 4) {
          await Promise.all(
            peers.slice(offset, offset + 4).map(async (peer) => {
              try {
                if (!this.peers.outgoing.has(peer.deviceId)) {
                  if ((this.retryAt.get(peer.deviceId) ?? 0) > Date.now()) return;
                  this.retryAt.set(peer.deviceId, Date.now() + 15000);
                  await this.peers.connect(peer.address, peer.deviceId, peer.publicKey);
                }
                await this.sync(peer.deviceId);
              } catch {
                /* One offline contact must not block the other devices. */
              }
              chatEvents.emit('peerSync', peer.deviceId);
            }),
          );
        }
      })()
        .catch(() => {})
        .finally(() => {
          this.syncing = false;
        });
    };
    this.timer = setInterval(pulse, 1500);
    pulse();
  }
  /** Unified local workspace includes all persisted replicas, even while a host is offline. */
  async allConversations(): Promise<ConversationInfo[]> {
    const me = await localUser(this.identity);
    if (!me) return [];
    const own = await listConversations(me);
    const snapshots = await prisma.remoteSnapshot.findMany({
      where: { resource: '/api/conversations' },
    });
    const rows = new Map(own.map((c) => [c.id, c]));
    for (const snapshot of snapshots) {
      for (const c of snapshot.data as unknown as ConversationInfo[]) {
        if (!rows.has(c.id))
          rows.set(c.id, {
            ...c,
            hostId: snapshot.peerId,
            online: this.peers.outgoing.has(snapshot.peerId),
          });
      }
    }
    const hidden = new Set((await prisma.hiddenConversation.findMany()).map((row) => row.id));
    const alerts = await prisma.mentionAlert.findMany({
      where: { read: false },
      orderBy: { createdAt: 'desc' },
    });
    const byConversation = new Map<string, { senderName: string; count: number }>();
    for (const alert of alerts) {
      const current = byConversation.get(alert.conversationId);
      if (current) current.count++;
      else byConversation.set(alert.conversationId, { senderName: alert.senderName, count: 1 });
    }
    return [...rows.values()]
      .filter((row) => !hidden.has(row.id))
      .map((row) => ({ ...row, mentionAlert: byConversation.get(row.id) ?? null }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  }
  /** Resolve each operation by conversation authority, independent of UI contact selection. */
  async workspace(method: string, path: string, body?: unknown): Promise<unknown> {
    const route = new URL(path, 'http://local').pathname;
    if (route === '/api/conversations') {
      if (method === 'GET') return this.allConversations();
      if (method === 'POST') return this.groups.localCreate(body);
    }
    const match = route.match(/^\/api\/conversations\/([a-f0-9-]{36})/i);
    let id = match?.[1];
    const taskId = route.match(/^\/api\/agent-tasks\/([a-f0-9-]{36})/i)?.[1];
    if (taskId) {
      const task = await prisma.agentTask.findUnique({ where: { id: taskId } });
      id = task?.conversationId;
      if (!id) {
        const snapshots = await prisma.remoteSnapshot.findMany({
          where: { resource: { endsWith: '/agent-tasks' } },
        });
        for (const row of snapshots) {
          const task = (row.data as unknown as { taskId: string; conversationId: string }[]).find(
            (t) => t.taskId === taskId,
          );
          if (task) {
            id = task.conversationId;
            break;
          }
        }
      }
    }
    const conversation = (await this.allConversations()).find((c) => c.id === id);
    if (!conversation) throw new ApiError(403, 'NOT_PARTICIPANT', '你不是该会话的参与者');
    let payload = body;
    if (route.endsWith('/invite') && method === 'POST')
      payload = {
        members: await this.groups.descriptors((body as { memberIds?: unknown })?.memberIds),
      };
    let result: unknown;
    if (conversation.hostId === this.identity.deviceId) {
      const me = await localUser(this.identity);
      if (!me) throw new ApiError(401, 'LOCAL_IDENTITY', '请设置昵称');
      result = await this.dispatch(me, method, path, payload);
    } else result = await this.forward(conversation.hostId!, method, path, payload);
    if (method === 'POST' && route.endsWith('/read')) {
      const messageId = (body as { messageId?: string })?.messageId;
      const own = messageId ? await prisma.message.findUnique({ where: { id: messageId } }) : null;
      const snapshot =
        conversation.hostId === this.identity.deviceId
          ? null
          : await prisma.remoteSnapshot.findUnique({
              where: {
                peerId_resource: {
                  peerId: conversation.hostId!,
                  resource: 'messages:' + conversation.id,
                },
              },
            });
      const cached = (snapshot?.data as unknown as MessageInfo[] | undefined)?.find(
        (message) => message.id === messageId,
      );
      let through = own?.createdAt.toISOString() ?? cached?.createdAt;
      if (!through && conversation.hostId !== this.identity.deviceId) {
        try {
          const latest = (await this.peers.request(
            conversation.hostId!,
            'GET',
            '/api/conversations/' + conversation.id,
          )) as ConversationInfo;
          through = latest.lastReadAt ?? undefined;
          if (!through && messageId) {
            const page = (await this.peers.request(
              conversation.hostId!,
              'GET',
              '/api/conversations/' + conversation.id + '/messages?limit=100',
            )) as MessagePage;
            through = page.items.find((message) => message.id === messageId)?.createdAt;
          }
        } catch {
          /* A successful read stays successful if the follow-up fails. */
        }
      }
      if (through) {
        this.readWatermarks.set(conversation.id, through);
        await markMentionsRead(conversation.id, new Date(through));
      }
    }
    return result;
  }
  /** Forward only to the chosen authority; permission failures never fall back to cached success. */
  async forward(peerId: string, method: string, path: string, body?: unknown): Promise<unknown> {
    const route = new URL(path, 'http://local').pathname;
    let result: unknown;
    try {
      result = await this.peers.request(peerId, method, path, body);
      if (method === 'GET') await this.cache(peerId, route, result);
      if (method === 'POST' && route.endsWith('/agent-tasks')) await this.sync(peerId);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === 'PEER_OFFLINE' &&
        (method === 'GET' || route.endsWith('/join'))
      )
        result = await this.cached(peerId, path);
      else throw error;
    }
    return result;
  }
  stop() {
    clearInterval(this.timer);
    chatEvents.off('message', this.onMessage);
  }
  router() {
    const router = new Router();
    router.get('/peer/hello', async (ctx) => {
      ctx.body = await this.peers.hello();
    });
    router.post('/peer/connect', async (ctx) => {
      ctx.body = await this.peers.accept(
        ctx.request.body as Parameters<PeerService['accept']>[0],
        ctx.req.socket.remoteAddress,
      );
    });
    router.post('/peer/rpc', async (ctx) => {
      const body = ctx.request.body as {
        sessionId: string;
        packet: Parameters<PeerService['rpc']>[1];
      };
      ctx.body = await this.peers.rpc(body.sessionId, body.packet);
    });
    router.post('/api/workspace/projects', async (ctx) => {
      const members = await this.groups.descriptors(
        (ctx.request.body as { memberIds?: unknown })?.memberIds,
      );
      const me = await localUser(this.identity);
      if (!me) throw new ApiError(401, 'LOCAL_IDENTITY', '请设置昵称');
      const opened = await prisma.projectSetting.findMany({ where: { colleagueVisible: true } });
      const own = (await readCodexProjects()).filter((p) =>
        opened.some((v) => v.projectPath === p.path),
      );
      ctx.body = [
        { deviceId: this.identity.deviceId, nickname: me.name, projects: own },
        ...(await Promise.all(
          members.map(async (p) => ({
            deviceId: p.deviceId,
            nickname: (await prisma.peer.findUniqueOrThrow({ where: { deviceId: p.deviceId } }))
              .nickname,
            projects: await this.peers.request(p.deviceId, 'GET', '/api/projects'),
          })),
        )),
      ];
    });
    router.get('/api/device', async (ctx) => {
      ctx.body = {
        deviceId: this.identity.deviceId,
        user: await localUser(this.identity),
        port: Number(process.env.SERVER_PORT ?? 43127),
      };
    });
    router.get('/api/device/notification-settings', async (ctx) => {
      const preference = await prisma.devicePreference.findUnique({ where: { id: 'local' } });
      ctx.body = { systemNotifications: preference?.systemNotifications ?? true };
    });
    router.put('/api/device/notification-settings', async (ctx) => {
      const body = ctx.request.body as { systemNotifications?: unknown };
      if (!body || typeof body.systemNotifications !== 'boolean' || Object.keys(body).length !== 1)
        throw new ApiError(400, 'INVALID_NOTIFICATION_SETTINGS', '需要系统通知开关');
      const preference = await prisma.devicePreference.upsert({
        where: { id: 'local' },
        create: { id: 'local', systemNotifications: body.systemNotifications },
        update: { systemNotifications: body.systemNotifications },
      });
      chatEvents.emit('systemNotifications', preference.systemNotifications);
      ctx.body = { systemNotifications: preference.systemNotifications };
    });
    const requireLocalOwner = async () => {
      if ((await localUser(this.identity))?.role !== 'OWNER')
        throw new ApiError(403, 'FORBIDDEN', '需要本机项目所属人身份');
    };
    router.get('/api/device/agent-model', async (ctx) => {
      await requireLocalOwner();
      ctx.body = await readModelSettings(undefined, true);
    });
    router.put('/api/device/agent-model', async (ctx) => {
      await requireLocalOwner();
      ctx.body = await writeModelSettings('global', ctx.request.body);
      chatEvents.emit('conversation', '');
    });
    router.get('/api/device/deepseek-settings', async (ctx) => {
      await requireLocalOwner();
      ctx.set('Cache-Control', 'no-store');
      ctx.body = await deepSeekStatus();
    });
    router.put('/api/device/deepseek-settings', async (ctx) => {
      await requireLocalOwner();
      ctx.set('Cache-Control', 'no-store');
      ctx.body = await writeDeepSeekSettings(ctx.request.body);
    });
    router.post('/api/device/conversations/:id/hide', async (ctx) => {
      const id = ctx.params.id;
      if (!id) throw new ApiError(400, 'INVALID_CONVERSATION', '会话 ID 无效');
      if (!(await this.allConversations()).some((conversation) => conversation.id === id))
        throw new ApiError(404, 'CONVERSATION_NOT_FOUND', '会话不存在或已从本机历史移除');
      await prisma.hiddenConversation.upsert({ where: { id }, create: { id }, update: {} });
      await dismissMentions(id);
      chatEvents.emit('conversation', id);
      ctx.body = { ok: true };
    });
    router.post('/api/device/nickname', async (ctx) => {
      const name = (ctx.request.body as { name?: unknown })?.name;
      if (
        typeof name !== 'string' ||
        !name.trim() ||
        [...name.trim()].length > 64 ||
        /[\p{Cc}\p{Cs}]/u.test(name)
      )
        throw new ApiError(400, 'INVALID_NAME', '昵称需为 1–64 个有效字符');
      ctx.body = await prisma.user.upsert({
        where: { identifier: this.identity.deviceId },
        create: {
          id: deviceUserId(this.identity.deviceId),
          identifier: this.identity.deviceId,
          name: name.trim(),
          role: 'OWNER',
        },
        update: { name: name.trim() },
      });
    });
    router.get('/api/peers', async (ctx) => {
      ctx.body = (await prisma.peer.findMany({ orderBy: { updatedAt: 'desc' } })).map((p) => ({
        deviceId: p.deviceId,
        nickname: p.nickname,
        address: p.address,
        online: this.peers.outgoing.has(p.deviceId),
      }));
    });
    router.post('/api/peers/probe', async (ctx) => {
      const body = ctx.request.body as { address: unknown; deviceId?: string };
      let result: Awaited<ReturnType<PeerService['probe']>>;
      try {
        result = await this.peers.probe(body.address, body.deviceId);
      } catch (error) {
        throw new ApiError(
          503,
          'PEER_UNAVAILABLE',
          error instanceof Error ? error.message : '对方不可用',
        );
      }
      ctx.body = {
        deviceId: result.hello.deviceId,
        nickname: result.hello.nickname,
        address: result.address,
      };
    });
    router.post('/api/peers/connect', async (ctx) => {
      const body = ctx.request.body as { address: unknown; deviceId?: string };
      try {
        ctx.body = await this.peers.connect(body.address, body.deviceId);
      } catch (error) {
        throw new ApiError(
          503,
          'PEER_UNAVAILABLE',
          error instanceof Error ? error.message : '连接失败',
        );
      }
      void this.sync((ctx.body as { deviceId: string }).deviceId).catch(() => {});
    });
    return router;
  }
}
