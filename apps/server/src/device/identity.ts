import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { dataDirectory, prisma } from '@egent/database';
import type { UserInfo } from '@egent/shared';
export interface DeviceIdentity {
  deviceId: string;
  publicKey: string;
  privateKey: string;
}
/** Stable UUID representation lets the same device sender match across database replicas. */
export function deviceUserId(deviceId: string) {
  const h = deviceId.slice(0, 32);
  return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)].join('-');
}
/** MachineGuid is hashed into an app-scoped ID; never send the raw OS identifier. */
async function machineCode(): Promise<string> {
  if (process.env.EGENT_TEST_MODE === '1' && process.env.EGENT_TEST_DEVICE_ID)
    return process.env.EGENT_TEST_DEVICE_ID;
  if (process.platform !== 'win32') throw new Error('当前桌面版仅支持 Windows');
  return new Promise((resolve, reject) => {
    const child = spawn(
      'reg.exe',
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
      { shell: false, windowsHide: true },
    );
    let text = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('读取设备标识超时'));
    }, 5000);
    child.stdout.on('data', (data: Buffer) => {
      text += data.toString();
    });
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timer);
      const match = text.match(/MachineGuid\s+REG_SZ\s+(\S+)/i);
      if (code !== 0 || !match) reject(new Error('无法读取设备标识'));
      else resolve(match[1]!);
    });
  });
}
/** Device key is stable in the application data directory across nickname/IP changes. */
export async function loadIdentity(): Promise<DeviceIdentity> {
  const deviceId = createHash('sha256')
    .update('egent-device-v1:' + (await machineCode()))
    .digest('hex');
  const file = path.join(dataDirectory, 'device.json');
  try {
    const stored = JSON.parse(await readFile(file, 'utf8')) as DeviceIdentity;
    if (stored.deviceId !== deviceId) throw new Error('数据目录属于另一设备，请使用独立数据目录');
    return stored;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const keys = generateKeyPairSync('ed25519');
  const identity = {
    deviceId,
    publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
  await writeFile(file, JSON.stringify(identity), 'utf8');
  return identity;
}
/** User nicknames never determine identity. */
export async function localUser(identity: DeviceIdentity): Promise<UserInfo | null> {
  return prisma.user.findUnique({ where: { identifier: identity.deviceId } });
}
export function signed(identity: DeviceIdentity, payload: unknown) {
  const text = JSON.stringify(payload);
  return {
    payload,
    signature: sign(null, Buffer.from(text), identity.privateKey).toString('base64'),
  };
}
export function verified(publicKey: string, payload: unknown, signature: string) {
  try {
    return verify(
      null,
      Buffer.from(JSON.stringify(payload)),
      publicKey,
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
}
export interface CipherPacket {
  iv: string;
  data: string;
  tag: string;
}
export function seal(key: Buffer, payload: unknown): CipherPacket {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    data: data.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}
export function unseal(key: Buffer, packet: CipherPacket): unknown {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(packet.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(packet.tag, 'base64'));
  return JSON.parse(
    Buffer.concat([decipher.update(Buffer.from(packet.data, 'base64')), decipher.final()]).toString(
      'utf8',
    ),
  );
}
