import { randomUUID } from 'node:crypto';
import { prisma, serialWrite } from '@egent/database';
import type { NotificationInfo, UserInfo } from '@egent/shared';
import { ApiError } from '../errors.js';
import { chatEvents } from '../services/chat-events.js';
import type { PeerService } from './peers.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function messageFields(body: unknown) {
  const input = body as { id?: unknown; title?: unknown; content?: unknown } | null;
  if (!input || typeof input.id !== 'string' || !uuid.test(input.id))
    throw new ApiError(400, 'INVALID_NOTIFICATION', '通知 ID 无效');
  if (
    typeof input.title !== 'string' ||
    !input.title.trim() ||
    [...input.title.trim()].length > 120 ||
    /[\r\n\p{Cc}\p{Cs}]/u.test(input.title)
  )
    throw new ApiError(400, 'INVALID_NOTIFICATION', '通知标题需为 1–120 个字符，且不能换行');
  if (typeof input.content !== 'string' || !input.content.trim() || input.content.length > 32000)
    throw new ApiError(400, 'INVALID_NOTIFICATION', '通知内容需为 1–32000 个字符');
  return { id: input.id, title: input.title.trim(), content: input.content };
}

export class NotificationService {
  constructor(
    private deviceId: string,
    private peers: PeerService,
  ) {}

  async list(): Promise<NotificationInfo[]> {
    const rows = await prisma.notification.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { deliveries: true },
    });
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind as NotificationInfo['kind'],
      direction:
        row.kind === 'application'
          ? 'application'
          : row.senderId === this.deviceId
            ? 'sent'
            : 'received',
      senderName: row.senderName,
      title: row.title,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
      read: row.read,
      pendingCount: row.deliveries.filter((delivery) => !delivery.deliveredAt).length,
      recipientCount: row.deliveries.length,
    }));
  }

  async create(user: UserInfo, body: unknown) {
    const fields = messageFields(body);
    const recipients = (body as { recipientIds?: unknown }).recipientIds;
    if (
      !Array.isArray(recipients) ||
      recipients.length < 1 ||
      recipients.length > 10000 ||
      recipients.some((id) => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) ||
      new Set(recipients).size !== recipients.length
    )
      throw new ApiError(400, 'INVALID_RECIPIENTS', '请选择 1–10000 位不同的同事');

    const created = await serialWrite(() =>
      prisma.$transaction(async (tx) => {
        const previous = await tx.notification.findUnique({
          where: { id: fields.id },
          include: { deliveries: true },
        });
        if (previous) {
          const existing = previous.deliveries.map((row) => row.peerId).sort();
          if (
            previous.senderId !== this.deviceId ||
            previous.kind !== 'colleague' ||
            previous.title !== fields.title ||
            previous.content !== fields.content ||
            JSON.stringify(existing) !== JSON.stringify([...recipients].sort())
          )
            throw new ApiError(409, 'NOTIFICATION_CONFLICT', '通知 ID 已被使用');
          return false;
        }
        const known = await tx.peer.count({ where: { deviceId: { in: recipients } } });
        if (known !== recipients.length)
          throw new ApiError(400, 'INVALID_RECIPIENTS', '所选同事不存在，请刷新后重试');
        await tx.notification.create({
          data: {
            ...fields,
            kind: 'colleague',
            senderId: this.deviceId,
            senderName: user.name,
            read: true,
            deliveries: { create: recipients.map((peerId: string) => ({ peerId })) },
          },
        });
        return true;
      }),
    );
    if (created) chatEvents.emit('notificationsChanged');
    return { id: fields.id };
  }

  /** Only an authenticated peer may deliver its own message; duplicate retries are harmless. */
  async receive(user: UserInfo, body: unknown) {
    if (user.role !== 'COLLEAGUE') throw new ApiError(403, 'PEER_FORBIDDEN', '需要同事身份');
    const fields = messageFields(body);
    const rawDate = (body as { createdAt?: unknown }).createdAt;
    if (typeof rawDate !== 'string' || !Number.isFinite(Date.parse(rawDate)))
      throw new ApiError(400, 'INVALID_NOTIFICATION', '通知时间无效');
    const createdAt = new Date(rawDate);
    const created = await serialWrite(async () => {
      const previous = await prisma.notification.findUnique({ where: { id: fields.id } });
      if (previous) {
        if (
          previous.senderId !== user.identifier ||
          previous.kind !== 'colleague' ||
          previous.title !== fields.title ||
          previous.content !== fields.content ||
          previous.createdAt.getTime() !== createdAt.getTime()
        )
          throw new ApiError(409, 'NOTIFICATION_CONFLICT', '通知 ID 已被使用');
        return false;
      }
      await prisma.notification.create({
        data: {
          ...fields,
          kind: 'colleague',
          senderId: user.identifier,
          senderName: user.name,
          createdAt,
        },
      });
      return true;
    });
    if (created) {
      chatEvents.emit('notificationsChanged');
      chatEvents.emit('notificationReceived', { title: fields.title, senderName: user.name });
    }
    return { ok: true };
  }

  async markRead(id: string) {
    if (!uuid.test(id)) throw new ApiError(400, 'INVALID_NOTIFICATION', '通知 ID 无效');
    const result = await prisma.notification.updateMany({
      where: { id, read: false },
      data: { read: true },
    });
    if (!result.count && !(await prisma.notification.findUnique({ where: { id } })))
      throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', '通知不存在');
    if (result.count) chatEvents.emit('notificationsChanged');
    return { ok: true };
  }

  async deliver(peerId: string) {
    const pending = await prisma.notificationDelivery.findMany({
      where: { peerId, deliveredAt: null },
      include: { notification: true },
      orderBy: { notification: { createdAt: 'asc' } },
      take: 100,
    });
    for (const delivery of pending) {
      const { id, title, content, createdAt } = delivery.notification;
      await this.peers.request(peerId, 'POST', '/api/notifications/deliver', {
        id,
        title,
        content,
        createdAt: createdAt.toISOString(),
      });
      await prisma.notificationDelivery.update({
        where: { notificationId_peerId: { notificationId: id, peerId } },
        data: { deliveredAt: new Date() },
      });
      chatEvents.emit('notificationsChanged');
    }
  }
}

export async function recordUpdate(version: string) {
  const created = await serialWrite(async () => {
    if (await prisma.notification.findUnique({ where: { updateVersion: version } })) return false;
    await prisma.notification.create({
      data: {
        id: randomUUID(),
        kind: 'application',
        title: `发现新版本 v${version}`,
        content: `Egent **v${version}** 已发布。\n\n点击标题栏“更多” → “检查更新”，即可查看更新或下载新版。`,
        updateVersion: version,
      },
    });
    return true;
  });
  if (created) {
    chatEvents.emit('notificationsChanged');
    chatEvents.emit('notificationReceived', { title: `发现新版本 v${version}`, senderName: null });
  }
}
