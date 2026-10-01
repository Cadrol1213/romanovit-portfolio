// Готовит видео для сайта:
//   исходник (папка «для сайта») → media/full    — сжатая версия 1080p для просмотра
//                                → media/preview — 5-секундная петля без звука для сетки
//                                → media/poster  — кадр-обложка
// и собирает js/videos.js из content/videos.json + реальных размеров видео.
// Заодно обновляет SEO: русские тексты и список работ прямо в index.html,
// микроразметку schema.org, sitemap.xml и robots.txt.
//
// Запуск:  node scripts/build.mjs          (уже готовые файлы пропускаются)
//          node scripts/build.mjs --force  (пересобрать всё)

import { spawnSync } from 'node:child_process';
import { existsSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'для сайта');
const OUT = {
  full: join(ROOT, 'media/full'),
  preview: join(ROOT, 'media/preview'),
  poster: join(ROOT, 'media/poster'),
};
// Адрес сайта — поменять здесь, когда подключите свой домен
const SITE_URL = 'https://cadrol1213.github.io/romanovit-portfolio/';
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
const uploaded = {}; // id → дата файла, для микроразметки VideoObject

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

  uploaded[slug] = statSync(src).mtime.toISOString();
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

// ======================= SEO =======================

// тексты сайта: тот же js/i18n.js, что использует браузер
const sandbox = { window: {} };
vm.runInNewContext(readFileSync(join(ROOT, 'js/i18n.js'), 'utf8'), sandbox);
const RU = sandbox.window.I18N.ru;
const esc = (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const isoDuration = (sec) => `PT${Math.floor(sec / 60)}M${sec % 60}S`;
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

let html = readFileSync(join(ROOT, 'index.html'), 'utf8');

// 1. Русские тексты прямо в HTML — поисковик видит их без JavaScript
html = html.replace(/(<([a-z0-9]+)\b[^>]*\bdata-i18n="([^"]+)"[^>]*>)([^<]*)(<\/\2>)/g,
  (m, open, tag, key, _old, close) => (typeof RU[key] === 'string' ? open + esc(RU[key]) + close : m));

// 2. Список работ внутри сетки (JS потом заменит его на сетку с превью)
const worksList = '<ul class="works-static">' + items.map((it) =>
  `<li><a href="${it.full}">${esc(it.title.ru)}</a> — ${esc(RU['filter.' + it.category] || it.category)}, ${mmss(it.duration)}</li>`).join('') + '</ul>';
html = html.replace(/<!-- build:works -->[\s\S]*?<!-- \/build:works -->/, `<!-- build:works -->${worksList}<!-- /build:works -->`);

// 3. Микроразметка schema.org: исполнитель, услуги с ценами, вопросы-ответы, видео
const PRICE_RUB = [500, 1000, 500, 500, 1500, 500]; // в том же порядке, что prices.1…6 в i18n.js
const faq = [];
for (let n = 1; RU[`faq.${n}.q`]; n++) faq.push({ q: RU[`faq.${n}.q`], a: RU[`faq.${n}.a`] });
const graph = [
  {
    '@type': 'ProfessionalService',
    '@id': SITE_URL + '#service',
    name: 'RomanovIT',
    url: SITE_URL,
    image: SITE_URL + 'assets/og.jpg',
    description: RU['meta.description'],
    areaServed: ['RU', 'US'],
    sameAs: ['https://kwork.ru/user/romanovit'],
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: RU['prices.title'],
      itemListElement: PRICE_RUB.map((price, k) => ({
        '@type': 'Offer',
        itemOffered: { '@type': 'Service', name: RU[`prices.${k + 1}.title`], description: RU[`prices.${k + 1}.desc`] },
        priceSpecification: { '@type': 'PriceSpecification', minPrice: price, priceCurrency: 'RUB' },
      })),
    },
  },
  {
    '@type': 'FAQPage',
    mainEntity: faq.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  },
  {
    '@type': 'ItemList',
    name: RU['works.title'],
    itemListElement: items.map((it, k) => ({
      '@type': 'ListItem',
      position: k + 1,
      item: {
        '@type': 'VideoObject',
        name: it.title.ru,
        description: `${it.title.ru} — ${RU['filter.' + it.category] || it.category}. Монтаж: RomanovIT.`,
        thumbnailUrl: SITE_URL + it.poster,
        contentUrl: SITE_URL + it.full,
        uploadDate: uploaded[it.id],
        duration: isoDuration(it.duration),
      },
    })),
  },
];
const jsonld = `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\u003c')}</script>`;
html = html.replace(/<!-- build:jsonld -->[\s\S]*?<!-- \/build:jsonld -->/, `<!-- build:jsonld -->${jsonld}<!-- /build:jsonld -->`);

writeFileSync(join(ROOT, 'index.html'), html);

// 4. sitemap.xml и robots.txt
const today = new Date().toISOString().slice(0, 10);
writeFileSync(join(ROOT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  <url>
    <loc>${SITE_URL}</loc>
    <lastmod>${today}</lastmod>
${items.map((it) => `    <video:video>
      <video:thumbnail_loc>${SITE_URL}${it.poster}</video:thumbnail_loc>
      <video:title>${esc(it.title.ru)}</video:title>
      <video:description>${esc(it.title.ru)} — ${esc(RU['filter.' + it.category] || it.category)}</video:description>
      <video:content_loc>${SITE_URL}${it.full}</video:content_loc>
      <video:duration>${it.duration}</video:duration>
    </video:video>`).join('\n')}
  </url>
</urlset>
`);
writeFileSync(join(ROOT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}sitemap.xml\n`);

console.log('SEO: тексты и список работ в index.html, schema.org, sitemap.xml, robots.txt');
