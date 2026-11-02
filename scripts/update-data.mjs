/* 更新文献数据：从 OpenAlex 拉取最近的辐射制冷文献，分类后合并进 data/imported.json。
 *
 * 设计要点：
 *  - 每天在 GitHub Actions 里运行，不在访客端抓取；
 *  - 按 DOI / 题名去重，只追加新记录，不改动已有记录；
 *  - 先合并到临时目录并用 loadCorpus 校验，校验通过才原子写回；
 *  - 任一数据源失败不影响已有数据；全部失败时退出码 1，不写任何文件；
 *  - API Key 只从环境变量读取，不写入仓库或前端。
 *
 * 用法：
 *   node scripts/update-data.mjs [--dry-run] [--window-days 60] [--max-new 80] [--data-dir path]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCorpus } from './lib/corpus.mjs';
import { classifyRecord } from './lib/classify.mjs';
import { fetchWorks, isRelevant, mapWork } from './lib/openalex.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const QUERIES = [
  'passive radiative cooling',
  'daytime radiative cooling',
  'radiative cooling coating',
  'radiative cooling film',
  'radiative cooling textile',
  'colored radiative cooling',
  'transparent radiative cooling',
  'radiative cooling building',
  '辐射制冷',
];

const PLACEHOLDER_ZH = '（网络收录文献，暂未整理中文简介；英文原文摘要见下方。）';

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const dryRun = process.argv.includes('--dry-run');
const dataDir = path.resolve(argValue('--data-dir') || path.join(ROOT, 'data'));
const windowDays = Math.max(1, Number(argValue('--window-days') || process.env.UPDATE_WINDOW_DAYS || 60));
const maxNew = Math.max(1, Number(argValue('--max-new') || process.env.MAX_NEW || 80));
const apiKey = process.env.OPENALEX_API_KEY || '';
const mailto = process.env.OPENALEX_MAILTO || '';

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function normTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
}

function isoDay(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

function nowStamp() {
  return new Date().toISOString();
}

function importedAt() {
  return new Date().toISOString().slice(0, 16).replace('T', ' ');
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 1) + '\n', 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch {
    fs.copyFileSync(tmp, file);
    fs.rmSync(tmp, { force: true });
  }
}

function validateMerged(merged) {
  const tmp = path.join(ROOT, '.tmp', `validate-${process.pid}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  try {
    fs.copyFileSync(path.join(dataDir, 'categories.json'), path.join(tmp, 'categories.json'));
    fs.copyFileSync(path.join(dataDir, 'papers.json'), path.join(tmp, 'papers.json'));
    fs.writeFileSync(path.join(tmp, 'imported.json'), JSON.stringify(merged, null, 1), 'utf8');
    loadCorpus(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  const papers = readJson(path.join(dataDir, 'papers.json'), null);
  const imported = readJson(path.join(dataDir, 'imported.json'), null);
  const categories = readJson(path.join(dataDir, 'categories.json'), null);
  if (!Array.isArray(papers) || !Array.isArray(imported) || !categories) {
    throw new Error(`数据目录不完整：${dataDir}`);
  }

  const existing = [...papers, ...imported];
  const seenDois = new Set(existing.map((p) => String(p.doi || '').toLowerCase()).filter(Boolean));
  const seenTitles = new Set(existing.map((p) => normTitle(p.title_en || p.title_zh)).filter(Boolean));

  let maxId = 0;
  for (const p of imported) {
    const m = /^RC-N-(\d+)$/.exec(String(p.id || ''));
    if (m) maxId = Math.max(maxId, Number(m[1]));
  }

  const since = isoDay(-windowDays);
  const failures = [];
  const candidates = [];
  let scanned = 0;

  for (const query of QUERIES) {
    try {
      const works = await fetchWorks({ query, since, size: 100, apiKey, mailto });
      scanned += works.length;
      for (const work of works) {
        const item = mapWork(work);
        if (!item) continue;
        if (!isRelevant(item.title, item.abstract)) continue;
        const doiKey = item.doi.toLowerCase();
        const titleKey = normTitle(item.title);
        if (seenDois.has(doiKey) || seenTitles.has(titleKey)) continue;
        seenDois.add(doiKey);
        seenTitles.add(titleKey);
        candidates.push(item);
      }
      console.log(`[update] 「${query}」返回 ${works.length} 条，累计候选 ${candidates.length}`);
    } catch (err) {
      failures.push(`${query}: ${err.message}`);
      console.warn(`[update] 「${query}」失败：${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  if (failures.length === QUERIES.length) {
    console.error('[update] 所有数据源请求均失败，未修改任何数据。');
    process.exit(1);
  }

  candidates.sort((a, b) => String(b.published).localeCompare(String(a.published)));
  const selected = candidates.slice(0, maxNew);

  const newRecords = [];
  const lowConfidence = [];
  let nextId = maxId + 1;
  for (const item of selected) {
    const isReview = item.type === 'review' || /\breview\b|综述|progress|prospects|advances|overview|perspective/i.test(item.title);
    const cls = classifyRecord({
      title_zh: item.title,
      title_en: item.title,
      keywords: item.keywords,
      journal: item.journal,
      abstract_zh: '',
      abstract_en: item.abstract,
      type: isReview ? '综述' : '研究型论文',
      review: isReview,
    });
    if (cls.confidence === 'low') lowConfidence.push(item.title);
    const record = {
      id: `RC-N-${String(nextId).padStart(3, '0')}`,
      category: cls.category,
      sub: cls.sub,
      title_zh: item.title,
      title_en: item.title,
      authors: item.authors,
      journal: item.journal,
      year: item.year,
      published: item.published,
      volume: item.volume,
      issue: item.issue,
      pages: item.pages,
      doi: item.doi,
      keywords: item.keywords,
      abstract_zh: PLACEHOLDER_ZH,
      abstract_en: item.abstract,
      review: cls.type === 'review',
      type: cls.type === 'review' ? '综述' : '研究型论文',
      source: '自动同步',
      imported_at: importedAt(),
      url: item.url,
    };
    nextId += 1;
    newRecords.push(record);
  }

  console.log(
    `[update] 扫描 ${scanned} 条，候选 ${candidates.length} 条，选中 ${newRecords.length} 条，低置信 ${lowConfidence.length} 条`,
  );
  for (const r of newRecords.slice(0, 20)) {
    console.log(`  + ${r.id} [${r.type}/${r.category}/${r.sub}] ${r.title_en.slice(0, 90)}`);
  }

  if (dryRun) {
    console.log('[update] --dry-run：未写入任何文件');
    return;
  }

  const statePath = path.join(dataDir, 'sync-state.json');
  const state = readJson(statePath, {
    last_run: '',
    last_success: '',
    last_new: 0,
    total_added: 0,
    last_error: '',
    scans: 0,
  });

  if (newRecords.length) {
    const merged = [...imported, ...newRecords];
    validateMerged(merged);
    fs.mkdirSync(path.join(ROOT, '.tmp'), { recursive: true });
    fs.copyFileSync(
      path.join(dataDir, 'imported.json'),
      path.join(ROOT, '.tmp', `imported-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
    );
    writeJsonAtomic(path.join(dataDir, 'imported.json'), merged);
    state.total_added = Number(state.total_added || 0) + newRecords.length;
    state.last_ids = newRecords.slice(-20).map((r) => r.id);
    console.log(`[update] 已写入 ${newRecords.length} 条到 ${path.relative(ROOT, dataDir)}/imported.json`);
  } else {
    console.log('[update] 没有新文献，数据文件保持不变');
  }

  state.last_run = nowStamp();
  state.last_success = state.last_run;
  state.last_new = newRecords.length;
  state.last_error = failures.length ? failures.join('；').slice(0, 500) : '';
  state.scans = Number(state.scans || 0) + 1;
  state.scanned = scanned;
  state.window_days = windowDays;
  state.queries = QUERIES.length;
  writeJsonAtomic(statePath, state);
}

main().catch((err) => {
  console.error(`[update] 失败：${err.stack || err.message}`);
  process.exit(1);
});
