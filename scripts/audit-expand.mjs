/* 完整性审计 + 扩充：按被引排序抓取 OpenAlex 全时段辐射制冷文献，
 * 与现有库比对，找出缺失的高被引文献并补入 data/imported.json。
 *
 * 用法：
 *   node scripts/audit-expand.mjs --dry-run            # 只审计，不写盘
 *   node scripts/audit-expand.mjs --add 120            # 补入最多 120 篇
 *   node scripts/audit-expand.mjs --add 120 --min-cited 10
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCorpus } from './lib/corpus.mjs';
import { classifyRecord, CATEGORY_NAMES, TYPE_NAMES } from './lib/classify.mjs';
import { isRelevant, mapWork, abstractFromInvertedIndex } from './lib/openalex.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const API = process.env.OPENALEX_BASE_URL || 'https://api.openalex.org';
const MAILTO = process.env.OPENALEX_MAILTO || '';
const KEY = process.env.OPENALEX_API_KEY || '';

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const DRY = process.argv.includes('--dry-run');
const ADD = Math.max(0, Number(arg('--add', '0')));
const MIN_CITED = Math.max(0, Number(arg('--min-cited', '3')));

const QUERIES = [
  '"radiative cooling"',
  '"passive daytime radiative cooling"',
  '"daytime radiative cooling"',
  '"colored radiative cooling"',
  '"transparent radiative cooling"',
  '"radiative cooling" coating',
  '"radiative cooling" film',
  '"radiative cooling" textile',
  '"radiative cooling" building',
  '"radiative cooler"',
  '"sky cooling"',
  '辐射制冷',
];

const norm = (s) => String(s || '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

// 排除天体物理 / 大气科学语境（这些领域的 radiative cooling 指气体冷却）
const BAD_JOURNAL = /astrophysical|geophysical|atmospheric|climate|astronom|solar physics|space science|icarus|monthly notices|earth system|geoscience|oceanograph|meteorolog/i;
const BAD_TITLE = /galax|stellar|quasar|accretion|supernova|interstellar|molecular cloud|stratospher|tropospher|convective|monsoon|ozone|cosmolog|dark matter|coronal|solar wind|climate model|general circulation|radio jet|plasma/i;
const REQ_TITLE = /radiative cooling|radiative cooler|radiative sky cooling|sky cooling/i;
const REQ_APP = /coating|film|paint|textile|fabric|building|roof|window|emitter|reflector|material|polymer|ceramic|composite|metamaterial|device|fibre|fiber|membrane|hydrogel|aerogel|nanoparticle|photonic|glass|wood|concrete|cement|pigment|dye|textile|wearable|radiator|cooler/i;

function acceptable(rec) {
  const title = rec.title;
  const text = `${title} ${rec.abstract}`;
  if (BAD_JOURNAL.test(rec.journal || '')) return false;
  if (BAD_TITLE.test(title)) return false;
  if (!REQ_TITLE.test(title)) return false;
  if (!REQ_APP.test(text)) return false;
  return true;
}

async function fetchTop(query, perPage = 200) {
  const url = new URL(`${API}/works`);
  url.searchParams.set('filter', `title_and_abstract.search:${query}`);
  url.searchParams.set('sort', 'cited_by_count:desc');
  url.searchParams.set('per-page', String(perPage));
  if (MAILTO) url.searchParams.set('mailto', MAILTO);
  if (KEY) url.searchParams.set('api_key', KEY);
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'rc-lit-portal/3.2 audit' },
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`OpenAlex ${res.status} for ${query}`);
  const data = await res.json();
  return data.results || [];
}

function stamp() {
  return new Date().toISOString().slice(0, 16).replace('T', ' ');
}

async function main() {
  const corpus = loadCorpus(DATA);
  const existing = corpus.items;
  const seenDoi = new Set(existing.map((p) => String(p.doi || '').toLowerCase()).filter(Boolean));
  const seenTitle = new Set(existing.map((p) => norm(p.title_en || p.title_zh)).filter(Boolean));

  const found = new Map();
  for (const q of QUERIES) {
    let rows = [];
    try {
      rows = await fetchTop(q);
    } catch (e) {
      console.warn(`[warn] ${q}: ${e.message}`);
      continue;
    }
    let kept = 0;
    for (const w of rows) {
      const rec = mapWork(w);
      if (!rec) continue;
      const text = `${rec.title} ${rec.abstract}`;
      if (!isRelevant(rec.title, rec.abstract)) continue;
      if (!acceptable(rec)) continue;
      if (!/radiative cooling|radiative cooler|sky cooling|辐射制冷|辐射冷却|辐射致冷/.test(text.toLowerCase())) continue;
      if (rec.cited < MIN_CITED) continue;
      if (seenDoi.has(rec.doi.toLowerCase())) continue;
      if (seenTitle.has(norm(rec.title))) continue;
      const key = rec.doi.toLowerCase();
      if (!found.has(key) || found.get(key).cited < rec.cited) found.set(key, rec);
      kept += 1;
    }
    console.log(`[query] ${q} -> 返回 ${rows.length}，新增候选 ${kept}`);
  }

  const missing = [...found.values()].sort((a, b) => b.cited - a.cited);
  const add = missing.slice(0, ADD);

  console.log(`\n[审计] 现有 ${existing.length} 篇；缺失候选 ${missing.length} 篇（被引 ≥ ${MIN_CITED}）`);
  console.log('[审计] 缺失的高被引文献 Top 20：');
  for (const m of missing.slice(0, 20)) {
    console.log(`  ${String(m.cited).padStart(5)}  ${m.year}  ${m.journal.slice(0, 34).padEnd(34)}  ${m.title.slice(0, 66)}`);
  }
  if (missing.length > 20) console.log(`  … 其余 ${missing.length - 20} 篇`);

  fs.mkdirSync(path.join(ROOT, '.tmp'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, '.tmp', 'missing.json'), JSON.stringify(missing, null, 1), 'utf8');
  if (DRY || !ADD) {
    console.log('\n[dry-run] 未写入。加 --add N 执行补入。');
    return;
  }

  const imported = JSON.parse(fs.readFileSync(path.join(DATA, 'imported.json'), 'utf8'));
  let maxId = 0;
  for (const p of imported) {
    const m = /^RC-N-(\d+)$/.exec(String(p.id || ''));
    if (m) maxId = Math.max(maxId, Number(m[1]));
  }

  const stampStr = stamp();
  const added = [];
  for (const rec of add) {
    const cls = classifyRecord({
      title_zh: rec.title,
      title_en: rec.title,
      keywords: rec.keywords,
      abstract_en: rec.abstract,
      type: '',
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
      source: '批量扩充',
      imported_at: stampStr,
      url: rec.url,
      cited: rec.cited,
    });
  }

  const merged = imported.concat(added);
  // 用 loadCorpus 校验（临时目录）
  const tmp = path.join(ROOT, '.tmp', `audit-${process.pid}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  fs.copyFileSync(path.join(DATA, 'categories.json'), path.join(tmp, 'categories.json'));
  fs.copyFileSync(path.join(DATA, 'papers.json'), path.join(tmp, 'papers.json'));
  fs.writeFileSync(path.join(tmp, 'imported.json'), JSON.stringify(merged, null, 1), 'utf8');
  const check = loadCorpus(tmp);
  fs.rmSync(tmp, { recursive: true, force: true });

  fs.writeFileSync(path.join(DATA, 'imported.json'), JSON.stringify(merged, null, 1) + '\n', 'utf8');

  const byCat = {};
  for (const a of added) byCat[a.category] = (byCat[a.category] || 0) + 1;
  console.log(`\n[补入] ${added.length} 篇 -> imported.json（校验通过，总量 ${check.items.length}）`);
  console.log('[补入] 分类：' + Object.entries(byCat).map(([k, v]) => `${CATEGORY_NAMES[k]} ${v}`).join(' · '));
  console.log('[补入] 年份：' + [...new Set(added.map((a) => a.year))].sort().join(', '));
  console.log('[补入] 被引合计：' + added.reduce((s, a) => s + a.cited, 0));
}

await main();
