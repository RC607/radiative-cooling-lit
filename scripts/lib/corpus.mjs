/* 语料加载：读取 data/*.json → 校验 → 去重 → 派生字段 → 统计。
 *
 * 这是全站唯一的数据入口。构建（build.mjs）与更新（update-data.mjs）都走这里，
 * 任何一条记录不合规都会抛出带 id 的错误，避免把坏数据带上线。
 */
import fs from 'node:fs';
import path from 'node:path';
import { TYPE_NAMES } from './classify.mjs';

const REQUIRED = ['id', 'category', 'sub', 'title_zh', 'title_en', 'authors', 'journal', 'year', 'keywords'];
const TYPE_VALUES = new Set(Object.values(TYPE_NAMES));

export function readJson(file, fallback = undefined) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (fallback !== undefined) return fallback;
    throw new Error(`读取 ${file} 失败：${err.message}`);
  }
}

function asArray(v) {
  return Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
}

function normalizeDate(value, year) {
  const y = Number(year);
  const s = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  if (/^\d{4}$/.test(s)) return `${s}-01-01`;
  return Number.isFinite(y) ? `${y}-01-01` : '';
}

export function shortAuthors(authors, n = 3) {
  const list = authors || [];
  if (list.length <= n) return list.join('；');
  return list.slice(0, n).join('；') + ' 等';
}

function makeExcerpt(p) {
  const zh = String(p.abstract_zh || '');
  const en = String(p.abstract_en || '');
  const text = !/^（网络收录文献/.test(zh) && zh ? zh : en || zh;
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 150 ? clean.slice(0, 150) + '…' : clean;
}

function normalizeType(p) {
  const t = String(p.type || '').trim();
  if (TYPE_VALUES.has(t)) return t;
  if (t === '学术论文') return TYPE_NAMES.research;
  if (t === '综述') return TYPE_NAMES.review;
  return p.review ? TYPE_NAMES.review : TYPE_NAMES.research;
}

function validate(p, catName, subName, subCat) {
  const missing = ['id', 'category', 'sub', 'authors', 'year', 'keywords'].filter(
    (k) => p[k] === undefined || p[k] === null || p[k] === '',
  );
  if (missing.length) throw new Error(`文献 ${p.id || '?'} 缺少字段：${missing.join(', ')}`);
  if (!catName.has(p.category)) throw new Error(`文献 ${p.id} 分类非法：${p.category}`);
  if (!subName.has(p.sub)) throw new Error(`文献 ${p.id} 细分非法：${p.sub}`);
  if (subCat.get(p.sub) !== p.category) {
    throw new Error(`文献 ${p.id} 的细分 ${p.sub} 不属于分类 ${p.category}`);
  }
  if (!p.title_zh && !p.title_en) throw new Error(`文献 ${p.id} 中英文题名不能同时为空`);
  if (!Array.isArray(p.authors) || !p.authors.length) throw new Error(`文献 ${p.id} 作者为空或不是数组`);
  if (!Array.isArray(p.keywords)) throw new Error(`文献 ${p.id} 的 keywords 必须是数组`);
  const year = Number(p.year);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    throw new Error(`文献 ${p.id} 年份异常：${p.year}`);
  }
  const type = normalizeType(p);
  if (!TYPE_VALUES.has(type)) throw new Error(`文献 ${p.id} 文献类型非法：${p.type}`);
  if (!p.title_zh || !p.title_en) throw new Error(`文献 ${p.id} 需要中英文题名`);
  if (!p.journal) throw new Error(`文献 ${p.id} 缺少期刊`);
}

function cleanText(v) {
  return String(v || '').replace(/\s+/g, ' ').trim();
}

function enrich(p, catName, subName) {
  const out = { ...p };
  out.year = Number(p.year);
  out.authors = asArray(p.authors).map(cleanText);
  out.keywords = asArray(p.keywords).map(cleanText);
  out.authors_short = shortAuthors(out.authors);
  out.category_name = catName.get(out.category);
  out.sub_name = subName.get(out.sub);
  out.type = normalizeType(p);
  out.review = out.type === TYPE_NAMES.review;
  out.source = cleanText(p.source) || '内置库';
  out.doi = cleanText(p.doi);
  out.abstract_zh = String(p.abstract_zh || '').trim();
  out.abstract_en = String(p.abstract_en || '').trim();
  out.published = normalizeDate(p.published, out.year);
  out.title_zh = cleanText(p.title_zh);
  out.title_en = cleanText(p.title_en);
  out.journal = cleanText(p.journal);
  out.has_zh_abstract = Boolean(out.abstract_zh) && !/^（网络收录文献/.test(out.abstract_zh);
  out.excerpt = makeExcerpt(out);
  return out;
}

function countBy(items, fn) {
  const map = new Map();
  for (const it of items) {
    const k = fn(it);
    map.set(k, (map.get(k) || 0) + 1);
  }
  return map;
}

function lastMonths(n) {
  const now = new Date();
  const out = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

const DEFAULT_TYPES = [
  { key: 'research', name: TYPE_NAMES.research, desc: '原始研究：提出材料、结构或方法并给出实验或仿真结果' },
  { key: 'review', name: TYPE_NAMES.review, desc: '领域综述、进展梳理与展望' },
];

function computeStats(items, categories, typesMeta) {
  const total = items.length;
  const yearCounts = countBy(items, (p) => p.year);
  const journalCounts = countBy(items, (p) => p.journal);
  const keywordCounts = new Map();
  for (const p of items) {
    for (const k of p.keywords) keywordCounts.set(k, (keywordCounts.get(k) || 0) + 1);
  }
  const sourceCounts = countBy(items, (p) => p.source);

  const catStats = categories.map((c) => {
    const subs = c.subs.map((s) => ({
      key: s.key,
      name: s.name,
      desc: s.desc,
      count: items.filter((p) => p.category === c.key && p.sub === s.key).length,
    }));
    return {
      key: c.key,
      name: c.name,
      desc: c.desc,
      count: subs.reduce((n, s) => n + s.count, 0),
      subs,
    };
  });

  const typeStats = typesMeta.map((t) => ({
    key: t.key,
    name: t.name,
    desc: t.desc,
    count: items.filter((p) => p.type === t.name).length,
  }));

  const journals = [...journalCounts.entries()]
    .map(([name, count]) => {
      const rows = items.filter((p) => p.journal === name);
      return {
        name,
        count,
        white: rows.filter((p) => p.category === 'white').length,
        colored: rows.filter((p) => p.category === 'colored').length,
        transparent: rows.filter((p) => p.category === 'transparent').length,
        network: rows.filter((p) => p.source !== '内置库').length,
        latest: rows.map((p) => p.published).sort().pop() || '',
      };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const months = lastMonths(12).map((month) => ({
    month,
    count: items.filter((p) => p.published.startsWith(month)).length,
  }));

  const sourceLabels = {
    内置库: '内置库',
    网络收录: '网络收录',
    自动同步: '自动同步',
    'X-MOL': 'X-MOL',
    批量扩充: '批量扩充',
  };

  return {
    total,
    white: items.filter((p) => p.category === 'white').length,
    colored: items.filter((p) => p.category === 'colored').length,
    transparent: items.filter((p) => p.category === 'transparent').length,
    research: items.filter((p) => p.type === TYPE_NAMES.research).length,
    reviews: items.filter((p) => p.type === TYPE_NAMES.review).length,
    local: items.filter((p) => p.source === '内置库').length,
    network: items.filter((p) => p.source !== '内置库').length,
    journals: journalCounts.size,
    year_min: Math.min(...items.map((p) => p.year)),
    year_max: Math.max(...items.map((p) => p.year)),
    categories: catStats,
    types: typeStats,
    years: [...yearCounts.entries()]
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => b.year - a.year),
    months,
    journals_list: journals,
    keywords: [...keywordCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    sources: [...sourceCounts.entries()]
      .map(([name, count]) => ({ key: name, name: sourceLabels[name] || name, count }))
      .sort((a, b) => b.count - a.count),
  };
}

export function loadCorpus(dataDir) {
  const categoriesRaw = readJson(path.join(dataDir, 'categories.json'));
  const categories = categoriesRaw.categories || categoriesRaw;
  const typesMeta = Array.isArray(categoriesRaw.types) ? categoriesRaw.types : DEFAULT_TYPES;

  const catName = new Map(categories.map((c) => [c.key, c.name]));
  const subName = new Map();
  const subCat = new Map();
  for (const c of categories) {
    for (const s of c.subs) {
      subName.set(s.key, s.name);
      subCat.set(s.key, c.key);
    }
  }

  const papers = readJson(path.join(dataDir, 'papers.json'));
  const imported = readJson(path.join(dataDir, 'imported.json'), []);
  if (!Array.isArray(papers) || !Array.isArray(imported)) {
    throw new Error('papers.json / imported.json 必须是数组');
  }

  // 人工纠正：{ "RC-W-001": { "category": "white", "sub": "hybrid", "type": "research" } }
  const overrides = readJson(path.join(dataDir, 'classification.overrides.json'), {});

  const seenIds = new Set();
  const seenDois = new Set();
  const items = [];

  for (const raw of [...papers, ...imported]) {
    if (!raw || typeof raw !== 'object') throw new Error('存在非对象记录');
    const id = String(raw.id || '').trim();
    if (!id) throw new Error('存在缺少 id 的记录');
    if (seenIds.has(id)) continue;

    const record = { ...raw, id };
    const ov = overrides[id];
    if (ov && typeof ov === 'object') {
      if (ov.category) record.category = ov.category;
      if (ov.sub) record.sub = ov.sub;
      if (ov.type) record.type = TYPE_NAMES[ov.type] || ov.type;
    }

    validate(record, catName, subName, subCat);
    const p = enrich(record, catName, subName);
    if (p.doi) {
      const key = p.doi.toLowerCase();
      if (seenDois.has(key)) continue;
      seenDois.add(key);
    }
    seenIds.add(id);
    items.push(p);
  }

  items.sort(
    (a, b) => (b.published || '').localeCompare(a.published || '') || a.title_en.localeCompare(b.title_en),
  );

  const stats = computeStats(items, categories, typesMeta);
  return { categories, types: typesMeta, items, byId: new Map(items.map((p) => [p.id, p])), stats };
}

export function relatedPapers(corpus, paper, limit = 4) {
  const kw = new Set(paper.keywords);
  const scored = [];
  for (const p of corpus.items) {
    if (p.id === paper.id) continue;
    let score = 0;
    if (p.sub === paper.sub) score += 3;
    if (p.category === paper.category) score += 1;
    for (const k of p.keywords) if (kw.has(k)) score += 2;
    if (score > 0) scored.push([score, p]);
  }
  scored.sort((a, b) => b[0] - a[0] || b[1].year - a[1].year || a[1].title_en.localeCompare(b[1].title_en));
  return scored.slice(0, limit).map(([, p]) => p);
}
