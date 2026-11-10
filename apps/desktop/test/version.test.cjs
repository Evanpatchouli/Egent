const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { version } = require('../package.json');

test('MCP reports the desktop package version', async () => {
  const client = new Client({ name: 'egent-version-test', version: '1' });
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [path.join(__dirname, '../mcp.mjs')],
      }),
    );
    assert.equal(client.getServerVersion().version, version);
  } finally {
    await client.close();
  }
});
