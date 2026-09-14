import { mkdir, writeFile } from 'node:fs/promises';
import { parseAudioOptions, selectAudioClips } from './lib/audio-selection.mjs';
import { loadActiveCatalog } from './lib/catalog-source.mjs';

try {
  const options = parseAudioOptions(process.argv.slice(2));
  if (options.help) console.log('用法：npm run audio:inventory -- [--theme animal_home] [--sprite guide,phonics]\n两个筛选参数不能同时使用；分批清单单独保存，不覆盖全量清单。');
  else {
    const catalog = await loadActiveCatalog(); const { clips, spriteIds, partial, name } = selectAudioClips(catalog, options);
    const path = `artifacts/audio-inventory${partial ? `.${name}` : ''}.json`;
    await mkdir('artifacts', { recursive: true });
    await writeFile(path, JSON.stringify({ schemaVersion: 1, sourceDirectory: 'audio-source', spriteIds, clips }, null, 2) + '\n');
    console.log(`Stage ${catalog.source.stage}: ${clips.length} 个片段；${clips.filter((clip) => ['word','slow','sentence'].includes(clip.kind)).length} 个学习语音、${clips.filter((clip) => clip.kind === 'phoneme').length} 个音素、${clips.filter((clip) => clip.kind === 'guide').length} 个向导语音；${clips.filter((clip) => clip.input).length} 个输入文件。清单：${path}`);
  }
} catch (error) { console.error(`素材清单未生成：${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
