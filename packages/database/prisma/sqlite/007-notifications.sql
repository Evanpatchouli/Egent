CREATE TABLE Notification (
  id TEXT NOT NULL PRIMARY KEY,
  kind TEXT NOT NULL,
  senderId TEXT,
  senderName TEXT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read BOOLEAN NOT NULL DEFAULT false,
  updateVersion TEXT UNIQUE
);
CREATE INDEX Notification_createdAt_id_idx ON Notification(createdAt, id);
CREATE TABLE NotificationDelivery (
  notificationId TEXT NOT NULL,
  peerId TEXT NOT NULL,
  deliveredAt DATETIME,
  PRIMARY KEY (notificationId, peerId),
  FOREIGN KEY (notificationId) REFERENCES Notification(id) ON DELETE CASCADE
);
CREATE INDEX NotificationDelivery_peerId_deliveredAt_idx ON NotificationDelivery(peerId, deliveredAt);
