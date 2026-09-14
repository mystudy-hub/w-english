import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const readJson = async (file) => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
export function within(root, path) {
  const resolved = resolve(root, path);
  const rel = relative(resolve(root), resolved);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Path must stay within its content directory');
  return resolved;
}
export async function writeAsset(publicRoot, id, bytes, prefix, extension, mime) {
  const digest = sha256(bytes);
  const url = `${prefix}.${digest.slice(0, 16)}.${extension}`;
  const file = within(publicRoot, url);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, bytes);
  return [id, { url, bytes: bytes.length, sha256: digest, mime }];
}
