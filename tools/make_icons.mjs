// Write the Home Screen icons into dist/ using the exact drawing code the production middleware serves them from.
// Usage: node tools/make_icons.mjs <outDir>
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const here = dirname(fileURLToPath(import.meta.url)), out = process.argv[2] || join(here, '..', 'dist');
const src = readFileSync(join(here, '..', 'app', 'middleware.js'), 'utf8');
const tmp = join('/tmp', 'coach-mw-icons.mjs'); writeFileSync(tmp, src);
const { ICON_ROUTES, iconPng } = await import(tmp + '?' + Date.now());
mkdirSync(out, { recursive: true });
for (const [path, [kind, n]] of Object.entries(ICON_ROUTES)) {
  let b = await iconPng(n, kind === 'ico' ? 'fav' : kind);
  if (kind === 'ico') { const h = Buffer.alloc(22); h.writeUInt16LE(1, 2); h.writeUInt16LE(1, 4); h[6] = n; h[7] = n; h.writeUInt16LE(1, 10); h.writeUInt16LE(32, 12); h.writeUInt32LE(b.length, 14); h.writeUInt32LE(22, 18); b = Buffer.concat([h, Buffer.from(b)]); }
  writeFileSync(join(out, path.slice(1)), b); console.log(path, b.length);
}
