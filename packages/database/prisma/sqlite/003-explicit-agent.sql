ALTER TABLE AgentTask ADD COLUMN intent TEXT NOT NULL DEFAULT 'TASK';
DROP INDEX IF EXISTS AgentTask_one_active;
CREATE UNIQUE INDEX AgentTask_project_implementation ON AgentTask(workspacePath COLLATE NOCASE) WHERE status = 'IMPLEMENTING';
ALTER TABLE Conversation ADD COLUMN autoAgentEnabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE Conversation ADD COLUMN autoAgentPendingAt DATETIME;
ALTER TABLE Conversation ADD COLUMN autoAgentCursor DATETIME;
ALTER TABLE Conversation ADD COLUMN autoAgentLastReplyAt DATETIME;
ALTER TABLE Conversation ADD COLUMN autoAgentRevision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE Conversation ADD COLUMN autoAgentError TEXT;
