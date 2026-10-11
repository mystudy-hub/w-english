import { resolve } from 'node:path';
import { textbookCatalogSchema, textbookUnitSchema, validateTextbook } from '../../src/data/content-schema.ts';
import { readJson, within } from './files.mjs';

// 课本词库走自己的源文件与门槛：按单元分组，不受 Stage 0~2 的词数与场景规则约束。
export async function loadTextbookCatalog(release = false, themeWordIds = []) {
  const source = textbookCatalogSchema.parse(await readJson('data/textbook/catalog.json'));
  const units = [];
  const words = [];
  for (const entry of source.units) {
    const config = textbookUnitSchema.parse(await readJson(within(resolve('.'), entry.config)));
    if (config.unitId !== entry.unitId) throw new Error(`${entry.unitId}: 单元配置 ID 与目录不符`);
    if (config.bookId !== source.bookId) throw new Error(`${entry.unitId}: 单元不属于 ${source.bookId}`);
    const unitWords = await readJson(within(resolve('.'), entry.words));
    const seen = new Set(words.map((word) => word.wordId));
    for (const word of Array.isArray(unitWords) ? unitWords : []) {
      if (seen.has(word?.wordId)) throw new Error(`${entry.unitId}: 词条 ${word.wordId} 出现在多个文件`);
    }
    units.push(config);
    words.push(...(Array.isArray(unitWords) ? unitWords : []));
  }
  const parsed = validateTextbook(words, units, { release, themeWordIds });
  return { bookId: source.bookId, units: parsed.units, words: parsed.words, source };
}
