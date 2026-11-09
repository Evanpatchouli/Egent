ALTER TABLE ConversationParticipant ADD COLUMN historyAfter DATETIME;
CREATE TRIGGER Conversation_project_immutable
BEFORE UPDATE OF projectPath ON Conversation
WHEN NEW.projectPath <> OLD.projectPath
BEGIN
  SELECT RAISE(ABORT, 'Conversation project is immutable');
END;
