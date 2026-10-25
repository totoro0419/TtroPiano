import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const manifest = JSON.parse(await readFile('public/piano/manifest.json', 'utf8'));
assert(manifest.samples.length > 0);
let total = 0;
for (const s of manifest.samples) {
  assert(/^(soft|hard)-\d+\.mp3$/.test(s.file));
  const bytes = await readFile('public/piano/' + s.file);
  assert(bytes.length > 1000, 'empty audio: ' + s.file);
  assert.equal(bytes.length, s.bytes, 'audio size: ' + s.file);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), s.sha256, 'audio integrity: ' + s.file);
  total += bytes.length;
}
assert.equal(total, manifest.bytes);
const license = await readFile('public/piano/LICENSE.txt', 'utf8');
assert(license.includes('Permission is hereby granted') && license.includes('S. Christian Collins'));
console.log(`Verified ${manifest.samples.length} samples (${total} bytes), hashes and license.`);
