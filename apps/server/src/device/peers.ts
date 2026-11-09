import {
  generateKeyPairSync,
  diffieHellman,
  createPublicKey,
  randomBytes,
  randomUUID,
  type KeyObject,
} from 'node:crypto';
import { isIP } from 'node:net';
import { prisma } from '@egent/database';
import type { UserInfo } from '@egent/shared';
import { ApiError } from '../errors.js';
import {
  localUser,
  deviceUserId,
  signed,
  verified,
  seal,
  unseal,
  type CipherPacket,
  type DeviceIdentity,
} from './identity.js';
type Hello = {
  protocol: 1;
  deviceId: string;
  publicKey: string;
  nickname: string;
  challenge: string;
  ephemeral: string;
};
type Introduction = {
  deviceId: string;
  publicKey: string;
  nickname: string;
  challenge: string;
  targetId: string;
  ephemeral: string;
  listenPort: number;
};
interface Session {
  key: Buffer;
  user: UserInfo;
  expires: number;
  seen: Set<string>;
}
interface Outgoing {
  key: Buffer;
  address: string;
  sessionId: string;
  deviceId: string;
}
const publicPem = (key: KeyObject) => key.export({ type: 'spki', format: 'pem' }).toString();
export function peerAddress(value: unknown): string {
  if (typeof value !== 'string') throw new ApiError(400, 'INVALID_ADDRESS', '请输入目标 IP');
  let url: URL;
  try {
    url = new URL(value.includes('://') ? value : 'http://' + value);
  } catch {
    throw new ApiError(400, 'INVALID_ADDRESS', 'IP 地址无效');
  }
  if (
    url.protocol !== 'http:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    isIP(url.hostname.replace(/^\[|\]$/g, '')) === 0
  )
    throw new ApiError(400, 'INVALID_ADDRESS', '仅接受 IP 或 IP:端口');
  if (!url.port) url.port = '43127';
  return url.origin;
}
/** Encrypted RPC between two backends. UI never gets peer keys or remote identity tokens. */
export class PeerService {
  challenges = new Map<string, { key: KeyObject; expires: number }>();
  sessions = new Map<string, Session>();
  outgoing = new Map<string, Outgoing>();
  constructor(
    public identity: DeviceIdentity,
    private dispatch: (
      user: UserInfo,
      method: string,
      path: string,
      body: unknown,
    ) => Promise<unknown>,
  ) {}
  async hello() {
    for (const [id, item] of this.challenges)
      if (item.expires < Date.now()) this.challenges.delete(id);
    if (this.challenges.size >= 128) throw new ApiError(429, 'BUSY', '连接请求过多');
    const pair = generateKeyPairSync('x25519'),
      challenge = randomBytes(32).toString('hex');
    this.challenges.set(challenge, { key: pair.privateKey, expires: Date.now() + 30000 });
    return signed(this.identity, {
      protocol: 1,
      deviceId: this.identity.deviceId,
      publicKey: this.identity.publicKey,
      nickname: (await localUser(this.identity))?.name ?? '未设置昵称',
      challenge,
      ephemeral: publicPem(pair.publicKey),
    });
  }
  async accept(body: { payload: Introduction; signature: string }, sourceIp = '127.0.0.1') {
    const p = body?.payload;
    if (
      !p ||
      !/^([a-f0-9]{64})$/.test(p.deviceId) ||
      p.deviceId === this.identity.deviceId ||
      p.targetId !== this.identity.deviceId ||
      typeof p.nickname !== 'string' ||
      !p.nickname.trim() ||
      [...p.nickname].length > 64 ||
      typeof p.publicKey !== 'string' ||
      p.publicKey.length > 2000 ||
      !verified(p.publicKey, p, body.signature)
    )
      throw new ApiError(403, 'INVALID_PEER', '设备身份签名无效');
    const challenge = this.challenges.get(p.challenge);
    this.challenges.delete(p.challenge);
    if (!challenge || challenge.expires < Date.now())
      throw new ApiError(403, 'CHALLENGE_EXPIRED', '握手已过期');
    const known = await prisma.peer.findUnique({ where: { deviceId: p.deviceId } });
    if (known && known.publicKey !== p.publicKey)
      throw new ApiError(403, 'KEY_CHANGED', '对方设备密钥已改变');
    const key = diffieHellman({
      privateKey: challenge.key,
      publicKey: createPublicKey(p.ephemeral),
    });
    if (!Number.isInteger(p.listenPort) || p.listenPort < 1 || p.listenPort > 65535)
      throw new ApiError(400, 'INVALID_PORT', '无效连接端口');
    const ip = sourceIp.replace(/^::ffff:/, '');
    const address = 'http://' + (isIP(ip) === 6 ? '[' + ip + ']' : ip) + ':' + p.listenPort;
    const user = await prisma.user.upsert({
      where: { identifier: p.deviceId },
      create: {
        id: deviceUserId(p.deviceId),
        identifier: p.deviceId,
        name: p.nickname,
        role: 'COLLEAGUE',
      },
      update: { name: p.nickname },
    });
    if (user.role !== 'COLLEAGUE') throw new ApiError(403, 'INVALID_PEER', '不能冒用本机 Owner');
    await prisma.peer.upsert({
      where: { deviceId: p.deviceId },
      create: { deviceId: p.deviceId, publicKey: p.publicKey, nickname: p.nickname, address },
      update: { nickname: p.nickname, address },
    });
    for (const [id, session] of this.sessions)
      if (session.expires < Date.now()) this.sessions.delete(id);
    if (this.sessions.size >= 256) throw new ApiError(429, 'BUSY', '连接数达到上限');
    const sessionId = randomUUID();
    this.sessions.set(sessionId, { key, user, expires: Date.now() + 3600000, seen: new Set() });
    return { sessionId, packet: seal(key, { sessionId, deviceId: this.identity.deviceId }) };
  }
  async rpc(sessionId: string, packet: CipherPacket) {
    const session = this.sessions.get(sessionId);
    if (!session || session.expires < Date.now())
      throw new ApiError(401, 'SESSION_EXPIRED', '连接已过期，请重新连接');
    let p: { id: string; method: string; path: string; body: unknown };
    try {
      p = unseal(session.key, packet) as typeof p;
    } catch {
      throw new ApiError(403, 'INVALID_PACKET', '消息校验失败');
    }
    if (!p || typeof p.id !== 'string' || session.seen.has(p.id) || session.seen.size > 20000)
      throw new ApiError(403, 'REPLAY', '重复或无效请求');
    session.seen.add(p.id);
    session.expires = Date.now() + 3600000;
    try {
      return seal(session.key, {
        id: p.id,
        ok: true,
        data: await this.dispatch(session.user, p.method, p.path, p.body),
      });
    } catch (error) {
      return seal(session.key, {
        id: p.id,
        ok: false,
        error: {
          code: error instanceof ApiError ? error.code : 'PEER_ERROR',
          message: error instanceof ApiError ? error.message : '对方服务处理失败',
        },
      });
    }
  }
  private async fetch(address: string, path: string, body?: unknown, timeout = 5000) {
    const response = await fetch(address + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('对方可能不在线或 IP 已更改');
    const text = await response.text();
    if (text.length > 4 * 1024 * 1024) throw new Error('远端响应超限');
    return JSON.parse(text);
  }
  async probe(address: unknown, expectedId?: string) {
    const origin = peerAddress(address);
    const result = (await this.fetch(origin, '/peer/hello')) as {
      payload: Hello;
      signature: string;
    };
    const p = result.payload;
    if (
      !p ||
      p.protocol !== 1 ||
      !/^([a-f0-9]{64})$/.test(p.deviceId) ||
      typeof p.publicKey !== 'string' ||
      !verified(p.publicKey, p, result.signature)
    )
      throw new Error('目标不是可验证的 Egent 设备');
    if (p.deviceId === this.identity.deviceId) throw new Error('不能连接自己');
    if (expectedId && expectedId !== p.deviceId)
      throw new Error('该 IP 已属于另一设备，不能加载原联系人历史');
    const known = await prisma.peer.findUnique({ where: { deviceId: p.deviceId } });
    if (known && known.publicKey !== p.publicKey) throw new Error('设备密钥已改变，请核对对方设备');
    return { address: origin, hello: p };
  }
  async connect(address: unknown, expectedId?: string, expectedKey?: string) {
    const { address: origin, hello } = await this.probe(address, expectedId);
    if (expectedKey && hello.publicKey !== expectedKey) throw new Error('设备密钥与邀请信息不匹配');
    const me = await localUser(this.identity);
    if (!me) throw new Error('请先设置昵称');
    const pair = generateKeyPairSync('x25519');
    const intro: Introduction = {
      deviceId: this.identity.deviceId,
      publicKey: this.identity.publicKey,
      nickname: me.name,
      challenge: hello.challenge,
      targetId: hello.deviceId,
      ephemeral: publicPem(pair.publicKey),
      listenPort: Number(process.env.SERVER_PORT ?? 43127),
    };
    const result = await this.fetch(origin, '/peer/connect', signed(this.identity, intro));
    const key = diffieHellman({
      privateKey: pair.privateKey,
      publicKey: createPublicKey(hello.ephemeral),
    });
    const proof = unseal(key, result.packet) as { sessionId: string; deviceId: string };
    if (proof.deviceId !== hello.deviceId || proof.sessionId !== result.sessionId)
      throw new Error('连接响应校验失败');
    await prisma.peer.upsert({
      where: { deviceId: hello.deviceId },
      create: {
        deviceId: hello.deviceId,
        publicKey: hello.publicKey,
        nickname: hello.nickname,
        address: origin,
      },
      update: { nickname: hello.nickname, address: origin },
    });
    await prisma.user.upsert({
      where: { identifier: hello.deviceId },
      create: {
        id: deviceUserId(hello.deviceId),
        identifier: hello.deviceId,
        name: hello.nickname,
        role: 'COLLEAGUE',
      },
      update: { name: hello.nickname },
    });
    this.outgoing.set(hello.deviceId, {
      key,
      address: origin,
      sessionId: result.sessionId,
      deviceId: hello.deviceId,
    });
    return { deviceId: hello.deviceId, nickname: hello.nickname, address: origin };
  }
  async request(peerId: string, method: string, path: string, body?: unknown): Promise<unknown> {
    const connection = this.outgoing.get(peerId);
    if (!connection) throw new ApiError(503, 'PEER_OFFLINE', '请先连接对方设备');
    const id = randomUUID();
    try {
      const result = await this.fetch(
        connection.address,
        '/peer/rpc',
        {
          sessionId: connection.sessionId,
          packet: seal(connection.key, { id, method, path, body }),
        },
        path === '/api/groups' || path.endsWith('/invite') ? 120000 : 10000,
      );
      const response = unseal(connection.key, result) as {
        id: string;
        ok: boolean;
        data: unknown;
        error: { code: string; message: string };
      };
      if (response.id !== id) throw new Error('远端响应关联无效');
      if (!response.ok) throw new ApiError(400, response.error.code, response.error.message);
      return response.data;
    } catch (error) {
      if (!(error instanceof ApiError) || error.code === 'SESSION_EXPIRED') {
        this.outgoing.delete(peerId);
        throw new ApiError(503, 'PEER_OFFLINE', '对方可能不在线或 IP 已更改');
      }
      throw error;
    }
  }
}
