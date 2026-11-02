/* 一次性迁移：把旧 8 细分体系迁移到 v3 体系（白/彩/透明 × 13 细分，研究/综述）。
 *
 * 用法：node scripts/migrate-taxonomy.mjs [--force]
 * 产出：
 *   data/papers.json / imported.json   写入新的 category / sub / type
 *   data/classification-report.json    分类统计与低置信度清单
 *   data/classification-review.csv     484 条逐条复核表（Excel 可直接打开）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyRecord, TYPE_NAMES } from './lib/classify.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const FILES = ['papers.json', 'imported.json'];

const force = process.argv.includes('--force');
const categories = JSON.parse(fs.readFileSync(path.join(DATA, 'categories.json'), 'utf8')).categories;
const catName = new Map(categories.map((c) => [c.key, c.name]));
const subName = new Map();
const subCat = new Map();
for (const c of categories) {
  for (const s of c.subs) {
    subName.set(s.key, s.name);
    subCat.set(s.key, c.key);
  }
}

function read(file) {
  return JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8'));
}

const papers = read('papers.json');
const imported = read('imported.json');
const all = [...papers, ...imported];

const already = all.some((p) => p.category === 'transparent' || p.type === '研究型论文');
if (already && !force) {
  console.error('[migrate] 数据看起来已经是 v3 体系；如需强制重跑请加 --force');
  process.exit(2);
}

/* 备份 */
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join(ROOT, '.tmp', `data-backup-${stamp}`);
fs.mkdirSync(backup, { recursive: true });
for (const f of FILES) fs.copyFileSync(path.join(DATA, f), path.join(backup, f));
console.log(`[migrate] 原数据已备份到 ${path.relative(ROOT, backup)}`);

/* 分类 */
const rows = [];
const byId = new Map();
for (const p of all) {
  const old = { category: p.category, sub: p.sub, type: p.type };
  const r = classifyRecord(p);
  if (!catName.has(r.category)) throw new Error(`${p.id} 分类非法 ${r.category}`);
  if (subCat.get(r.sub) !== r.category) throw new Error(`${p.id} 细分 ${r.sub} 不属于 ${r.category}`);
  p.category = r.category;
  p.sub = r.sub;
  p.type = TYPE_NAMES[r.type];
  p.review = r.type === 'review';
  byId.set(p.id, { old, result: r });
  rows.push({ p, old, r });
}

/* 统计 */
const counts = {};
for (const { r } of rows) {
  const k = `${r.type} | ${r.category}/${r.sub}`;
  counts[k] = (counts[k] || 0) + 1;
}

/* CSV 复核表 */
function csvCell(v) {
  return `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
}
const header = ['id', 'type', 'category', 'sub', 'confidence', 'old_category', 'old_sub', 'title_zh', 'title_en', 'journal', 'year', 'keywords', 'reasons'];
const lines = [header.join(',')];
for (const { p, old, r } of rows) {
  lines.push([
    p.id,
    TYPE_NAMES[r.type],
    catName.get(r.category) || r.category,
    subName.get(r.sub) || r.sub,
    r.confidence,
    old.category,
    old.sub,
    p.title_zh,
    p.title_en,
    p.journal,
    p.year,
    (p.keywords || []).join('、'),
    r.reasons.join(' / '),
  ].map(csvCell).join(','));
}
fs.writeFileSync(path.join(DATA, 'classification-review.csv'), '\uFEFF' + lines.join('\r\n') + '\r\n', 'utf8');

const low = rows.filter(({ r }) => r.confidence === 'low');
const report = {
  generated_at: new Date().toISOString(),
  total: rows.length,
  counts,
  confidence: {
    high: rows.filter(({ r }) => r.confidence === 'high').length,
    medium: rows.filter(({ r }) => r.confidence === 'medium').length,
    low: low.length,
  },
  low_confidence: low.map(({ p, old, r }) => ({
    id: p.id,
    title: p.title_en || p.title_zh,
    old: `${old.category}/${old.sub}`,
    next: `${r.category}/${r.sub}`,
    reasons: r.reasons,
  })),
};
fs.writeFileSync(path.join(DATA, 'classification-report.json'), JSON.stringify(report, null, 1) + '\n', 'utf8');

/* 回写 */
fs.writeFileSync(path.join(DATA, 'papers.json'), JSON.stringify(papers, null, 1) + '\n', 'utf8');
fs.writeFileSync(path.join(DATA, 'imported.json'), JSON.stringify(imported, null, 1) + '\n', 'utf8');

console.log(`[migrate] 已迁移 ${rows.length} 篇`);
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(String(v).padStart(4), k);
}
console.log(`[migrate] 置信度 high ${report.confidence.high} / medium ${report.confidence.medium} / low ${report.confidence.low}`);
console.log('[migrate] 复核表 data/classification-review.csv');
