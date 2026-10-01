// Готовит видео для сайта:
//   исходник (папка «для сайта») → media/full    — сжатая версия 1080p для просмотра
//                                → media/preview — 5-секундная петля без звука для сетки
//                                → media/poster  — кадр-обложка
// и собирает js/videos.js из content/videos.json + реальных размеров видео.
//
// Запуск:  node scripts/build.mjs          (уже готовые файлы пропускаются)
//          node scripts/build.mjs --force  (пересобрать всё)

import { spawnSync } from 'node:child_process';
import { existsSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'для сайта');
const OUT = {
  full: join(ROOT, 'media/full'),
  preview: join(ROOT, 'media/preview'),
  poster: join(ROOT, 'media/poster'),
};
const FORCE = process.argv.includes('--force');
const PREVIEW_SECONDS = 5;

for (const dir of Object.values(OUT)) mkdirSync(dir, { recursive: true });

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};
const slugify = (name) =>
  name.replace(/\.[^.]+$/, '').toLowerCase()
    .replace(/[а-яё]/g, (c) => TRANSLIT[c])
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} failed:\n${r.stderr}`);
  return r.stdout;
}

function probe(file) {
  const info = JSON.parse(run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:stream_side_data=rotation:stream_tags=rotate:format=duration',
    '-of', 'json', file,
  ]));
  const s = info.streams[0];
  const rotation = Number(s.side_data_list?.find((d) => 'rotation' in d)?.rotation ?? s.tags?.rotate ?? 0);
  const rotated = Math.abs(rotation) % 180 === 90; // видео с телефона часто «лежат» с флагом поворота
  return {
    width: rotated ? s.height : s.width,
    height: rotated ? s.width : s.height,
    duration: Number(info.format.duration),
  };
}

// Масштаб по короткой стороне (для 16:9 и 9:16); маленькие видео не растягиваем
const scaleShort = (px) => `scale='if(gt(iw,ih),-2,min(${px},iw))':'if(gt(iw,ih),min(${px},ih),-2)'`;

const isFresh = (out, src) => !FORCE && existsSync(out) && statSync(out).mtimeMs > statSync(src).mtimeMs;

const content = JSON.parse(readFileSync(join(ROOT, 'content/videos.json'), 'utf8'));
const items = [];

for (const entry of content.items) {
  const src = join(SRC, entry.file);
  if (!existsSync(src)) {
    console.warn(`! нет файла: ${entry.file} — пропускаю`);
    continue;
  }
  const slug = slugify(entry.file);
  const meta = probe(src);
  const start = entry.previewStart ?? Math.min(2, meta.duration * 0.1);
  const paths = {
    full: join(OUT.full, `${slug}.mp4`),
    preview: join(OUT.preview, `${slug}.mp4`),
    poster: join(OUT.poster, `${slug}.jpg`),
  };

  console.log(`→ ${entry.file}  (${meta.width}×${meta.height}, ${meta.duration.toFixed(0)} с)`);

  if (!isFresh(paths.poster, src)) {
    run('ffmpeg', ['-v', 'error', '-y', '-ss', String(start), '-i', src,
      '-vf', scaleShort(720), '-frames:v', '1', '-q:v', '4', paths.poster]);
  }

  if (!isFresh(paths.preview, src)) {
    run('ffmpeg', ['-v', 'error', '-y', '-ss', String(start), '-t', String(PREVIEW_SECONDS), '-i', src,
      '-vf', `${scaleShort(360)},fps=30`, '-an',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '28', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', paths.preview]);
  }

  if (!isFresh(paths.full, src)) {
    console.log('   сжимаю полную версию…');
    // длинные ролики (> 3 мин) — в 720p, чтобы файл влез в лимит GitHub (100 МБ)
    const long = meta.duration > 180;
    run('ffmpeg', ['-v', 'error', '-y', '-i', src,
      '-vf', scaleShort(long ? 720 : 1080),
      '-c:v', 'libx264', '-preset', 'fast', '-crf', long ? '26' : '24',
      '-maxrate', long ? '2M' : '5M', '-bufsize', long ? '4M' : '10M',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart', paths.full]);
  }

  const mb = (p) => (statSync(p).size / 1048576).toFixed(1);
  console.log(`   готово: full ${mb(paths.full)} МБ, preview ${mb(paths.preview)} МБ`);

  items.push({
    id: slug,
    category: entry.category,
    tags: entry.tags ?? [],
    market: entry.market ?? null,
    title: entry.title,
    width: meta.width,
    height: meta.height,
    duration: Math.round(meta.duration),
    full: `media/full/${slug}.mp4`,
    preview: `media/preview/${slug}.mp4`,
    poster: `media/poster/${slug}.jpg`,
  });
}

// .js, а не .json — чтобы сайт открывался двойным кликом, без локального сервера
writeFileSync(join(ROOT, 'js/videos.js'),
  `// Сгенерировано scripts/build.mjs — не редактируйте вручную, правьте content/videos.json\n` +
  `window.PORTFOLIO = ${JSON.stringify(items, null, 2)};\n`);

console.log(`\nГотово: ${items.length} видео → js/videos.js`);
