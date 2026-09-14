import { parseAudioOptions, selectAudioClips } from './lib/audio-selection.mjs';
import { produceSprites } from './lib/audio-production.mjs';
import { readJson } from './lib/files.mjs';
import { loadActiveCatalog } from './lib/catalog-source.mjs';

try {
  const options = parseAudioOptions(process.argv.slice(2));
  if (options.help) {
    console.log('用法：npm run audio:pack -- [--theme animal_home] [--sprite guide,phonics]\n不传参数时打包全量；两个筛选参数不能同时使用。分批打包保留其他已生成精灵。');
  } else {
  const selection = selectAudioClips(await loadActiveCatalog(), options);
  let gains = {};
  try { gains = await readJson('data/audio-gains.json'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const result = await produceSprites(selection.clips, { sourceDirectory: 'audio-source', outputDirectory: 'artifacts/audio', gains, retainExisting: selection.partial });
  console.log(`✓ 本批打包 ${selection.spriteIds.length} 个精灵、${selection.clips.length} 个片段；索引共 ${Object.keys(result.sprites).length} 个精灵、${result.clips.length} 个切片，仍需最终听审。`);
  }
} catch (error) {
  console.error(`音频打包未完成：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
