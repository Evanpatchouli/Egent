import { prisma } from '@egent/database';
import type { UserInfo } from '@egent/shared';
import { ApiError } from '../errors.js';
import {
  accessConversation,
  conversationInfo,
  createConversation,
  inviteMembers,
  requireUuid,
} from '../services/conversations.js';
import { localUser, deviceUserId } from './identity.js';
import type { DeviceService } from './service.js';

type Contact = { deviceId: string; address: string; publicKey: string };
type GroupInput = { id: string; projectPath: string; members: Contact[] };

/** The authority verifies every invited device itself; caller-supplied names/roles are never trusted. */
export class GroupService {
  constructor(private device: DeviceService) {}

  private async prepare(value: unknown): Promise<string[]> {
    if (!Array.isArray(value) || value.length > 19)
      throw new ApiError(400, 'INVALID_MEMBERS', '请选择最多 19 位同事');
    const ids: string[] = [];
    for (const raw of value) {
      const p = raw as Contact;
      if (!p || !/^[a-f0-9]{64}$/.test(p.deviceId) || typeof p.publicKey !== 'string')
        throw new ApiError(400, 'INVALID_MEMBERS', '邀请信息无效');
      if (p.deviceId === this.device.identity.deviceId) continue;
      try {
        await this.device.peers.connect(p.address, p.deviceId, p.publicKey);
      } catch {
        throw new ApiError(
          503,
          'MEMBER_UNREACHABLE',
          '项目所属设备无法连接某位同事，请确认 IP 和在线状态后重试',
        );
      }
      ids.push(deviceUserId(p.deviceId));
    }
    return [...new Set(ids)];
  }

  /** Creation is idempotent across a lost reply, with immutable project and original creator. */
  async create(user: UserInfo, raw: unknown) {
    const input = raw as GroupInput;
    const id = requireUuid(input?.id);
    const existing = await prisma.conversation.findUnique({ where: { id } });
    if (existing) {
      if (existing.createdByUserId !== user.id || existing.projectPath !== input.projectPath)
        throw new ApiError(409, 'CONVERSATION_CONFLICT', '会话创建信息已改变');
      return conversationInfo(user, id);
    }
    // Even local creation must use an explicitly opened project in the new flow.
    const setting = await prisma.projectSetting.findUnique({
      where: { projectPath: input.projectPath ?? '' },
    });
    if (!setting?.colleagueVisible) throw new ApiError(403, 'PROJECT_FORBIDDEN', '该项目尚未开放');
    const ids = await this.prepare(input.members);
    return createConversation(user, input.projectPath, undefined, ids, id);
  }

  /** Only an existing member may extend the roster, without changing its project. */
  async invite(user: UserInfo, id: string, raw: unknown) {
    await accessConversation(user, id);
    const ids = await this.prepare((raw as { members?: unknown })?.members);
    return inviteMembers(user, id, ids);
  }

  /** Expand locally selected contacts to pinned connection descriptors for the project host. */
  async descriptors(raw: unknown): Promise<Contact[]> {
    if (!Array.isArray(raw) || raw.length > 19 || raw.some((id) => typeof id !== 'string'))
      throw new ApiError(400, 'INVALID_MEMBERS', '请选择同事');
    const members: Contact[] = [];
    for (const id of new Set(raw as string[])) {
      if (id === this.device.identity.deviceId) continue;
      const peer = await prisma.peer.findUnique({ where: { deviceId: id } });
      if (!peer || !this.device.peers.outgoing.has(id))
        throw new ApiError(503, 'PEER_OFFLINE', '请先连接所选同事');
      members.push({ deviceId: id, address: peer.address, publicKey: peer.publicKey });
    }
    return members;
  }

  /** Route the creator's explicit choices to one project authority. */
  async localCreate(raw: unknown) {
    const input = raw as {
      id?: string;
      hostId?: string;
      projectPath?: string;
      memberIds?: string[];
    };
    if (!input || typeof input.projectPath !== 'string' || typeof input.hostId !== 'string')
      throw new ApiError(400, 'INVALID_GROUP', '请选择项目所属人和项目');
    const members = await this.descriptors(input.memberIds);
    if (
      input.hostId !== this.device.identity.deviceId &&
      !members.some((m) => m.deviceId === input.hostId)
    )
      throw new ApiError(400, 'HOST_NOT_MEMBER', '项目所属人必须是会话成员');
    const body = { id: requireUuid(input.id), projectPath: input.projectPath, members };
    if (input.hostId === this.device.identity.deviceId) {
      const me = await localUser(this.device.identity);
      if (!me) throw new ApiError(401, 'LOCAL_IDENTITY', '请设置昵称');
      return this.create(me, body);
    }
    const result = await this.device.peers.request(input.hostId, 'POST', '/api/groups', body);
    await this.device.sync(input.hostId);
    return result;
  }
}
