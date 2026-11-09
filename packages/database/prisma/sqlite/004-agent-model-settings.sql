CREATE TABLE AgentModelSetting (
  scope TEXT NOT NULL PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT,
  effort TEXT
);
