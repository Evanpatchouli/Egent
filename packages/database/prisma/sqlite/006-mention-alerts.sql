CREATE TABLE MentionAlert (
  messageId TEXT NOT NULL PRIMARY KEY,
  conversationId TEXT NOT NULL,
  senderName TEXT NOT NULL,
  createdAt DATETIME NOT NULL,
  read BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX MentionAlert_conversationId_read_createdAt_idx ON MentionAlert(conversationId, read, createdAt);
CREATE TABLE DevicePreference (
  id TEXT NOT NULL PRIMARY KEY,
  systemNotifications BOOLEAN NOT NULL DEFAULT true
);
