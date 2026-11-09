import path from 'node:path';
import desktop from '../apps/desktop/package.json' with { type: 'json' };

export const version = desktop.version;
const output = path.join('release', version);
export const portableExe = path.join(output, `Egent-${version}-x64.exe`);
export const unpackedExe = path.join(output, 'win-unpacked', 'Egent.exe');
