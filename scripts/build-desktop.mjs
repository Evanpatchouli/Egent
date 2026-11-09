import { build } from 'esbuild';
import { mkdir, cp, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
const desktopPackage = JSON.parse(await readFile('apps/desktop/package.json', 'utf8'));
const staging = path.join(root, 'apps/desktop/build/app');
await mkdir(staging, { recursive: true });
await build({
  entryPoints: ['apps/server/src/server.ts'],
  outfile: path.join(staging, 'server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: ['@libsql/client', '@libsql/client/*'],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
await cp('apps/desktop/main.cjs', path.join(staging, 'main.cjs'));
await build({
  entryPoints: ['apps/desktop/mcp.mjs'],
  outfile: path.join(staging, 'mcp.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
});
await cp('apps/desktop/splash.html', path.join(staging, 'splash.html'));
await cp('apps/desktop/assets/icon.ico', path.join(staging, 'icon.ico'));
await cp('apps/desktop/assets/icon.png', path.join(staging, 'icon.png'));
await cp('apps/desktop/assets/tray-mention.png', path.join(staging, 'tray-mention.png'));
const stagedWeb = path.join(staging, 'web');
await rm(stagedWeb, { recursive: true, force: true });
await cp('apps/web/dist', stagedWeb, { recursive: true });
await cp('packages/database/prisma/sqlite/001-initial.sql', path.join(staging, 'schema.sql'));
await cp(
  'packages/database/prisma/sqlite/002-membership.sql',
  path.join(staging, '002-membership.sql'),
);
await cp(
  'packages/database/prisma/sqlite/003-explicit-agent.sql',
  path.join(staging, '003-explicit-agent.sql'),
);
await cp(
  'packages/database/prisma/sqlite/004-agent-model-settings.sql',
  path.join(staging, '004-agent-model-settings.sql'),
);
await cp(
  'packages/database/prisma/sqlite/005-hidden-conversations.sql',
  path.join(staging, '005-hidden-conversations.sql'),
);
await cp(
  'packages/database/prisma/sqlite/006-mention-alerts.sql',
  path.join(staging, '006-mention-alerts.sql'),
);
await writeFile(
  path.join(staging, 'package.json'),
  JSON.stringify({
    name: 'egent',
    version: desktopPackage.version,
    description: 'Egent desktop peer workspace',
    author: 'Egent',
    main: 'main.cjs',
    dependencies: { '@libsql/client': '0.17.0' },
  }),
  'utf8',
);
const npm = process.platform === 'win32' ? 'npm.exe' : 'npm';
await new Promise((resolve, reject) => {
  const child = spawn(
    npm,
    [
      'install',
      '--omit=dev',
      '--ignore-scripts',
      '--prefix',
      staging,
      '--cache',
      path.join(root, '.cache/npm'),
    ],
    { stdio: 'inherit', shell: false, windowsHide: true },
  );
  child.on('error', reject);
  child.on('exit', (code) =>
    code === 0 ? resolve() : reject(new Error('Staging dependency install failed')),
  );
});
console.log('Desktop staging ready:', staging);
