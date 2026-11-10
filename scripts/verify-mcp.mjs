// Windows production smoke test: isolated desktop instance, deterministic Codex fixture.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { unpackedExe, version } from './release-paths.mjs';

const desktopPath = path.resolve(process.argv[2] ?? unpackedExe);
const executableVersion = execFileSync(
  path.join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
  [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '(Get-Item -LiteralPath $env:EGENT_VERIFY_EXE).VersionInfo.FileVersion',
  ],
  { encoding: 'utf8', env: { ...process.env, EGENT_VERIFY_EXE: desktopPath } },
).trim();
assert.equal(executableVersion, version, 'packaged executable version');

const data = await mkdtemp(path.join(tmpdir(), 'Egent MCP '));
const project = path.join(data, 'project');
await mkdir(project);
await mkdir(path.join(data, '.codex'));
await writeFile(
  path.join(data, '.codex/config.toml'),
  '[projects.' + JSON.stringify(project) + ']\n',
);
const fake = path.join(data, 'fixture.exe');
const fixture = path.join(data, 'fixture.cs');
const answer = {
  type: 'QUESTION',
  summary: 'Read-only fixture answer',
  confidence: 1,
  certain: true,
  evidence: ['fixture'],
  answer: 'FIRST',
  plan: [],
  affectedAreas: [],
  risks: [],
  needsOwnerConfirmation: false,
};
const event = JSON.stringify({
  type: 'item.completed',
  item: { type: 'agent_message', text: JSON.stringify(answer) },
});
await writeFile(
  fixture,
  'using System; class Fixture { static void Main() { var p = Console.In.ReadToEnd(); Console.WriteLine(' +
    JSON.stringify(event) +
    '.Replace("FIRST",p.Contains("second-round") ? "SECOND" : "FIRST")); Console.WriteLine("{\\"type\\":\\"turn.completed\\"}"); } }',
);
execFileSync(path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), [
  '/nologo',
  '/out:' + fake,
  fixture,
]);
const listener = createServer();
await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
const port = String(listener.address().port);
await new Promise((resolve) => listener.close(resolve));
const desktop = spawn(desktopPath, [], {
  windowsHide: true,
  stdio: 'ignore',
  env: {
    ...process.env,
    EGENT_DATA_DIR: data,
    USERPROFILE: data,
    TEMP: data,
    TMP: data,
    SERVER_PORT: port,
    CODEX_COMMAND: fake,
    EGENT_AGENT_PROVIDER: 'codex',
  },
});
const client = new Client({ name: 'egent-production-smoke', version: '1' });
function stopFixture() {
  if (desktop.exitCode !== null) return;
  try {
    execFileSync('taskkill.exe', ['/PID', String(desktop.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch (error) {
    if (error.status !== 128) throw error;
  }
}
try {
  let runtime;
  for (let i = 0; i < 720 && !runtime; i++) {
    assert.equal(desktop.exitCode, null, 'desktop exited before backend readiness');
    try {
      runtime = JSON.parse(await readFile(path.join(data, 'runtime.json'), 'utf8'));
    } catch {
      await delay(250);
    }
  }
  assert.ok(runtime, 'desktop backend started');
  const launcher = await readFile(path.join(data, 'egent-mcp.cmd'), 'utf8');
  const launcherCommand = launcher.split(/\r?\n/).find((line) => /^"[^"]+"\s+"[^"]+"$/.test(line));
  const launcherPaths = launcherCommand?.match(/^"([^"]+)"\s+"([^"]+)"$/);
  assert.ok(launcherPaths, 'packaged MCP launcher contains its runtime paths');
  const packagedMcpPath = launcherPaths[2].replaceAll('%%', '%');
  assert.equal(path.basename(packagedMcpPath), 'mcp.cjs');
  const packagedDesktop = JSON.parse(
    await readFile(path.join(path.dirname(packagedMcpPath), 'package.json'), 'utf8'),
  );
  assert.equal(packagedDesktop.version, version, 'packaged application version');
  async function setup(method, route, body) {
    const res = await fetch(runtime.url + '/api/' + route, {
      method,
      headers: { 'X-Egent-Local-Token': runtime.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.ok(res.ok, route + ' HTTP ' + res.status);
    return res.json();
  }
  await setup('POST', 'device/nickname', { name: '验收' });
  assert.equal((await setup('GET', 'health')).version, version, 'packaged health version');
  assert.equal((await setup('GET', 'device/notification-settings')).systemNotifications, true);
  assert.equal(
    (await setup('PUT', 'device/notification-settings', { systemNotifications: false }))
      .systemNotifications,
    false,
  );
  assert.equal((await setup('GET', 'device/notification-settings')).systemNotifications, false);
  await setup('PUT', 'device/notification-settings', { systemNotifications: true });
  const globalProfile = { provider: 'codex', model: 'gpt-6.1-terra', effort: 'xhigh' };
  await setup('PUT', 'device/agent-model', { profile: globalProfile });
  const dshProfile = { provider: 'dsh', model: 'deepseek-v4-pro', effort: 'max' };
  await setup('PUT', 'device/agent-model', { profile: dshProfile });
  const choices = (await setup('GET', 'device/agent-model')).savedProfiles;
  assert.deepEqual(choices.codex, globalProfile);
  await setup('PUT', 'device/agent-model', { profile: choices.codex });
  await setup('PUT', 'projects/visibility', { projectPath: project, colleagueVisible: true });
  const conversationId = randomUUID();
  await setup('POST', 'conversations', {
    id: conversationId,
    hostId: runtime.deviceId,
    memberIds: [],
    projectPath: project,
  });
  const modelRoute = 'conversations/' + conversationId + '/agent-model';
  const override = { provider: 'dsh', model: 'deepseek-flash', effort: 'high' };
  assert.deepEqual(await setup('PUT', modelRoute, { profile: override }), {
    profile: override,
    source: 'conversation',
    savedProfiles: { codex: globalProfile, dsh: override },
  });
  assert.deepEqual(await setup('PUT', modelRoute, { profile: null }), {
    profile: globalProfile,
    source: 'global',
    savedProfiles: { codex: globalProfile, dsh: dshProfile },
  });
  await client.connect(
    new StdioClientTransport({
      command: 'cmd.exe',
      args: ['/d', '/c', 'call', path.join(data, 'egent-mcp.cmd')],
    }),
  );
  assert.equal(client.getServerVersion().version, version, 'packaged MCP server version');
  assert.equal((await client.listTools()).tools.length, 4);
  async function call(name, args) {
    const res = await client.callTool({ name, arguments: args });
    assert.ok(!res.isError, JSON.stringify(res.content));
    return JSON.parse(res.content[0].text);
  }
  assert.equal((await call('list_conversations', {}))[0].id, conversationId);
  const first = {
    conversationId,
    askEgent: true,
    content: '第一轮',
    clientMessageId: randomUUID(),
  };
  const sent = await call('send_message', first);
  assert.equal(sent.content, '@Egent 第一轮');
  assert.deepEqual(await call('send_message', first), sent);
  const next = await call('send_message', {
    ...first,
    clientMessageId: randomUUID(),
    content: 'second-round 追问',
  });
  // Start before the FIRST answer and specifically request the SECOND one.
  const reply = await call('wait_for_reply', {
    conversationId,
    after: sent.id,
    agentTaskId: next.agentTaskId,
    timeoutSeconds: 30,
  });
  assert.match(reply.message.content, /^SECOND/);
  const history = await call('read_messages', { conversationId, after: sent.id });
  assert.ok(
    history.items.some((m) => m.agentTaskId === sent.agentTaskId && m.content.startsWith('FIRST')),
  );
  console.log(
    `Packaged version ${version} verified in the executable, application, health endpoint and MCP server.`,
  );
  console.log('Packaged MCP verified: discovery, Unicode, retry, correlated answers and history.');
} finally {
  await client.close();
  stopFixture();
  if (
    path.dirname(path.resolve(data)) === path.resolve(tmpdir()) &&
    path.basename(data).startsWith('Egent MCP ')
  )
    await rm(data, { recursive: true, force: true, maxRetries: 5 });
}
