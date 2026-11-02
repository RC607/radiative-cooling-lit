/* 把人工修订后的分类复核表写回数据。
 *
 * 用法：
 *   1. 用 Excel 打开 data/classification-review.csv，修改 type / category / sub 三列（填中文名）
 *   2. node scripts/apply-classification-csv.mjs
 *   3. npm run build
 *
 * 只按 id 更新这三列，其余字段不动；无法识别的名称会跳过并提示。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TYPE_NAMES } from './lib/classify.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const CSV = path.join(DATA, 'classification-review.csv');

const categories = JSON.parse(fs.readFileSync(path.join(DATA, 'categories.json'), 'utf8'));
const catByName = new Map(categories.categories.map((c) => [c.name, c.key]));
const subKeysByName = new Map();
const subCat = new Map();
for (const c of categories.categories) {
  for (const s of c.subs) {
    if (!subKeysByName.has(s.name)) subKeysByName.set(s.name, []);
    subKeysByName.get(s.name).push(s.key);
    subCat.set(s.key, c.key);
  }
}
function resolveSub(name, catKey) {
  const keys = subKeysByName.get(name) || [];
  return keys.find((k) => subCat.get(k) === catKey) || '';
}
const typeByName = new Map(Object.values(TYPE_NAMES).map((name) => [name, name]));

/* ── 最小 CSV 解析（支持引号、转义引号、CRLF、BOM） ─────────────────── */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell);
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    if (row.some((v) => v !== '')) rows.push(row);
  }
  return rows;
}

if (!fs.existsSync(CSV)) {
  console.error(`[apply] 找不到 ${path.relative(ROOT, CSV)}`);
  process.exit(2);
}

const rows = parseCsv(fs.readFileSync(CSV, 'utf8'));
const header = rows.shift();
const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
for (const key of ['id', 'type', 'category', 'sub']) {
  if (col[key] === undefined) {
    console.error(`[apply] CSV 缺少列：${key}`);
    process.exit(2);
  }
}

const files = ['papers.json', 'imported.json'].filter((f) => fs.existsSync(path.join(DATA, f)));
const data = {};
for (const f of files) data[f] = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const locate = new Map();
for (const f of files) for (const p of data[f]) locate.set(p.id, f);

let changed = 0;
const skipped = [];
for (const row of rows) {
  const id = row[col.id]?.trim();
  if (!id || !locate.has(id)) continue;
  const typeNameRaw = row[col.type]?.trim();
  const catNameRaw = row[col.category]?.trim();
  const subNameRaw = row[col.sub]?.trim();

  const typeName = typeByName.get(typeNameRaw);
  const catKey = catByName.get(catNameRaw);
  const subKey = catKey ? resolveSub(subNameRaw, catKey) : '';
  if (!typeName || !catKey || !subKey) {
    skipped.push(`${id}（${typeNameRaw} / ${catNameRaw} / ${subNameRaw}）`);
    continue;
  }

  const p = data[locate.get(id)].find((x) => x.id === id);
  if (p.type === typeName && p.category === catKey && p.sub === subKey) continue;
  p.type = typeName;
  p.review = typeName === '综述';
  p.category = catKey;
  p.sub = subKey;
  changed += 1;
}

for (const f of files) {
  fs.writeFileSync(path.join(DATA, f), JSON.stringify(data[f], null, 1) + '\n', 'utf8');
}

console.log(`[apply] 已更新 ${changed} 条`);
if (skipped.length) {
  console.log(`[apply] 跳过 ${skipped.length} 条（名称无法识别）：`);
  for (const s of skipped.slice(0, 20)) console.log('  -', s);
}
console.log('[apply] 下一步：npm run build');
