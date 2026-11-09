import { prisma } from '@egent/database';
import type { UserInfo } from '@egent/shared';
import { ApiError } from '../errors.js';
/** Device identity is injected by the authenticated local control plane, never by a peer header. */
export async function resolveUser(identifier: string): Promise<UserInfo> {
  if (!/^[a-f0-9]{64}$/.test(identifier))
    throw new ApiError(401, 'INVALID_IDENTITY', '设备身份无效');
  const user = await prisma.user.findUnique({
    where: { identifier },
    select: { id: true, identifier: true, name: true, role: true },
  });
  if (!user) throw new ApiError(401, 'INVALID_IDENTITY', '设备身份不存在');
  return user;
}
