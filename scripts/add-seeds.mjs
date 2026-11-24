/* 补充早期奠基文献（按 DOI 精确抓取，避免被“按被引取前 N”漏掉）。
 * 用法：node scripts/add-seeds.mjs [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCorpus } from './lib/corpus.mjs';
import { classifyRecord, TYPE_NAMES } from './lib/classify.mjs';
import { mapWork } from './lib/openalex.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const API = 'https://api.openalex.org';
const DRY = process.argv.includes('--dry-run');

// 早期辐射制冷奠基/经典文献（DOI 已核对）
const SEEDS = [
  '10.1016/0038-092X(75)90062-6', // Catalanotti et al., The radiative cooling of selective surfaces, Solar Energy, 1975
  '10.1016/0038-092X(78)90195-0', // Radiative cooling of TiO2 white paint, Solar Energy, 1978
  '10.1016/0165-1633(84)90067-4', // Materials for radiative cooling to low temperature, 1984
  '10.1364/AO.26.002131',         // Radiative cooling and frost formation, Applied Optics, 1987
  '10.1016/0038-092X(75)90062-6',
];

const norm = (s) => String(s || '').toLowerCase();

async function byDoi(doi) {
  const url = `${API}/works/https://doi.org/${encodeURIComponent(doi)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'rc-lit-portal/3.2 seed' } });
  if (!res.ok) return null;
  return res.json();
}

const corpus = loadCorpus(DATA);
const existing = new Set(corpus.items.map((p) => norm(p.doi)).filter(Boolean));
const imported = JSON.parse(fs.readFileSync(path.join(DATA, 'imported.json'), 'utf8'));
let maxId = 0;
for (const p of imported) {
  const m = /^RC-N-(\d+)$/.exec(String(p.id || ''));
  if (m) maxId = Math.max(maxId, Number(m[1]));
}

const added = [];
for (const doi of [...new Set(SEEDS.map(norm))]) {
  if (existing.has(doi)) {
    console.log('[skip] 已存在', doi);
    continue;
  }
  const work = await byDoi(doi);
  if (!work) {
    console.log('[fail] 取不到', doi);
    continue;
  }
  const rec = mapWork(work);
  if (!rec) {
    console.log('[fail] 字段不全', doi);
    continue;
  }
  const cls = classifyRecord({
    title_zh: rec.title,
    title_en: rec.title,
    keywords: rec.keywords,
    abstract_en: rec.abstract,
    review: false,
  });
  maxId += 1;
  added.push({
    id: `RC-N-${String(maxId).padStart(3, '0')}`,
    category: cls.category,
    sub: cls.sub,
    title_zh: rec.title,
    title_en: rec.title,
    authors: rec.authors,
    journal: rec.journal,
    year: rec.year,
    published: rec.published,
    volume: rec.volume,
    issue: rec.issue,
    pages: rec.pages,
    doi: rec.doi,
    keywords: rec.keywords,
    abstract_zh: '',
    abstract_en: rec.abstract,
    review: cls.type === 'review',
    type: TYPE_NAMES[cls.type],
    source: '经典文献',
    imported_at: new Date().toISOString().slice(0, 16).replace('T', ' '),
    url: rec.url,
    cited: rec.cited,
  });
  console.log('[add]', rec.year, rec.journal, '|', rec.title.slice(0, 70));
}

if (DRY) {
  console.log(`[dry-run] 可补 ${added.length} 篇`);
  process.exit(0);
}
if (!added.length) {
  console.log('没有需要补充的文献');
  process.exit(0);
}

const merged = imported.concat(added);
const tmp = path.join(ROOT, '.tmp', `seed-${process.pid}`);
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
fs.copyFileSync(path.join(DATA, 'categories.json'), path.join(tmp, 'categories.json'));
fs.copyFileSync(path.join(DATA, 'papers.json'), path.join(tmp, 'papers.json'));
fs.writeFileSync(path.join(tmp, 'imported.json'), JSON.stringify(merged, null, 1), 'utf8');
const check = loadCorpus(tmp);
fs.rmSync(tmp, { recursive: true, force: true });
fs.writeFileSync(path.join(DATA, 'imported.json'), JSON.stringify(merged, null, 1) + '\n', 'utf8');
console.log(`[done] 补入 ${added.length} 篇，总量 ${check.items.length}`);
