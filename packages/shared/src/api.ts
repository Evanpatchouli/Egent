/** Roles are always read from the database by the server. */
export type UserRole = 'OWNER' | 'COLLEAGUE';
/** Public identity response. */
export interface UserInfo {
  id: string;
  identifier: string;
  name: string;
  role: UserRole;
}
/** Initialization decision made by the server. */
export interface BootstrapResponse {
  initialized: boolean;
  role: UserRole;
  ownerExists: boolean;
}
/** Public colleague selection never includes an Owner. */
export interface SelectableUser {
  identifier: string;
  name: string;
}
/** Only Owner responses include visibility settings. */
export interface ProjectInfo {
  path: string;
  name: string;
  colleagueVisible?: boolean;
}
/** Consistent API error payload. */
export interface ApiErrorResponse {
  error: { code: string; message: string };
}
