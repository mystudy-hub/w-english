import { resolve } from 'node:path';
import { z } from 'zod';
import { validateCatalog } from '../../src/data/content-schema.ts';
import { readJson, within } from './files.mjs';

const sourcePath = z.string().regex(/^data\/[a-z0-9_/-]+\.json$/).refine((value) => !value.includes('..'));
const sourceSchema = z.strictObject({
  schemaVersion: z.literal(1), stage: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  expectedWords: z.number().int().positive(), words: sourcePath, themes: z.array(sourcePath).min(1),
});
export async function loadActiveCatalog(release = false) {
  const source = sourceSchema.parse(await readJson('data/catalog.json'));
  const expected = [10, 20, 100][source.stage];
  if (source.expectedWords !== expected) throw new Error(`Stage ${source.stage} 的词数门槛必须是 ${expected}`);
  const wordInput = await readJson(within(resolve('.'), source.words));
  const themeInputs = await Promise.all(source.themes.map((file) => readJson(within(resolve('.'), file))));
  const catalog = validateCatalog(wordInput, themeInputs, release);
  if (catalog.words.length !== expected) throw new Error(`Stage ${source.stage} 需要 ${expected} 词，实际 ${catalog.words.length} 词`);
  if (new Set(catalog.words.map((word) => word.word)).size !== expected) throw new Error('阶段词库必须包含规定数量的不同单词');
  if (source.stage === 2 && catalog.themes.length !== 3) throw new Error('Stage 2 必须包含三个场景');
  const covered = new Set(catalog.themes.flatMap((theme) => theme.wordIds));
  if (catalog.words.some((word) => !covered.has(word.wordId))) throw new Error('存在没有进入场景的词条');
  if (new Set(catalog.themes.map((theme) => theme.contentVersion)).size !== 1) throw new Error('场景内容版本不一致');
  return { ...catalog, source };
}
