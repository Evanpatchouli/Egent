export interface NotificationInfo {
  id: string;
  kind: 'colleague' | 'application';
  direction: 'sent' | 'received' | 'application';
  senderName: string | null;
  title: string;
  content: string;
  createdAt: string;
  read: boolean;
  pendingCount: number;
  recipientCount: number;
}

export type UpdateCheckResult =
  | { status: 'empty' | 'current' }
  | { status: 'available'; version: string }
  | { status: 'error'; message: string };
