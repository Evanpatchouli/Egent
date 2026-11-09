import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { portableExe, unpackedExe } from './release-paths.mjs';
const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('electron-builder'));
const libraryRequire = createRequire(builderRequire.resolve('app-builder-lib'));
const { Data, NtExecutable, NtExecutableResource, Resource } = libraryRequire('resedit');
const hash = (bytes) => createHash('sha256').update(Buffer.from(bytes)).digest('hex');
const icon = Data.IconFile.from(await readFile('apps/desktop/assets/icon.ico'));
const expected = icon.icons.map(({ data }) => {
  assert.ok(data.isRaw(), 'Expected alpha PNG icon frames');
  return { size: data.width, hash: hash(data.bin) };
});
assert.deepEqual(
  expected.map((item) => item.size),
  [16, 24, 32, 48, 64, 128, 256],
);
const files = process.argv.slice(2);
if (files.length === 0) files.push(unpackedExe, portableExe);
for (const file of files) {
  const resources = NtExecutableResource.from(NtExecutable.from(await readFile(file)));
  const groups = Resource.IconGroupEntry.fromEntries(resources.entries);
  const matches = groups.filter((group) => {
    const actual = group.getIconItemsFromEntries(resources.entries);
    // Windows stores 256px as zero in the one-byte icon group dimension field.
    return (
      actual.length === expected.length &&
      expected.every((frame) =>
        actual.some(
          (item) =>
            item.isRaw() && (item.width || 256) === frame.size && hash(item.bin) === frame.hash,
        ),
      )
    );
  });
  assert.ok(matches.length > 0, 'Generated icon not embedded correctly in ' + file);
  console.log(
    JSON.stringify({
      file,
      exactMatchingIconGroups: matches.map((group) => group.id),
      sizes: expected.map((frame) => frame.size),
    }),
  );
}
