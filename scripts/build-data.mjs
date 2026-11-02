/* 数据导出：data/*.json → public/data/*.json + public/download/*
 *
 * 输出：
 *   public/data/literature.json  全量文献（含中英文摘要），对外统一数据源
 *   public/data/index.json       检索/列表用的轻量索引（无摘要全文，带摘录）
 *   public/data/meta.json        统计、分类、期刊、关键词
 *   public/data/citations.json   三种题录格式（按需加载）
 *   public/download/*.bib|ris    全库题录批量下载
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCorpus } from './lib/corpus.mjs';
import { renderCitations, FORMATS } from './lib/biblio.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const OUT_DIR = path.join(ROOT, 'public', 'data');
const DOWNLOAD_DIR = path.join(ROOT, 'public', 'download');

function writeJson(file, value, { pretty = false } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
  fs.writeFileSync(file, text + '\n', 'utf8');
  return Buffer.byteLength(text, 'utf8');
}

export function buildData({ quiet = false } = {}) {
  const corpus = loadCorpus(DATA_DIR);
  const { items, stats, categories } = corpus;

  const literature = items.map((p) => ({
    id: p.id,
    category: p.category,
    category_name: p.category_name,
    sub: p.sub,
    sub_name: p.sub_name,
    title_zh: p.title_zh,
    title_en: p.title_en,
    authors: p.authors,
    authors_short: p.authors_short,
    journal: p.journal,
    year: p.year,
    published: p.published,
    volume: p.volume || '',
    issue: p.issue || '',
    pages: p.pages || '',
    doi: p.doi,
    keywords: p.keywords,
    type: p.type,
    review: p.review,
    source: p.source,
    abstract_zh: p.abstract_zh,
    abstract_en: p.abstract_en,
    has_zh_abstract: p.has_zh_abstract,
    enriched_by: p.enriched_by || '',
  }));

  const index = literature.map((p) => ({
    id: p.id,
    category: p.category,
    category_name: p.category_name,
    sub: p.sub,
    sub_name: p.sub_name,
    title_zh: p.title_zh,
    title_en: p.title_en,
    authors_short: p.authors_short,
    journal: p.journal,
    year: p.year,
    published: p.published,
    doi: p.doi,
    keywords: p.keywords,
    type: p.type,
    type_key: p.type === '综述' ? 'review' : 'research',
    review: p.review,
    source: p.source,
    has_zh_abstract: p.has_zh_abstract,
    has_en_abstract: Boolean(p.abstract_en),
  }));

  const meta = {
    generated_at: new Date().toISOString(),
    count: stats.total,
    stats,
  };

  const citations = renderCitations(items);

  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  for (const [fmt, conf] of Object.entries(FORMATS)) {
    const text = items.map((p) => conf.fn(p)).join('\n\n') + '\n';
    fs.writeFileSync(path.join(DOWNLOAD_DIR, `radiative-cooling.${conf.ext}`), text, 'utf8');
  }

  const sizes = {
    literature: writeJson(path.join(OUT_DIR, 'literature.json'), literature),
    index: writeJson(path.join(OUT_DIR, 'index.json'), index),
    meta: writeJson(path.join(OUT_DIR, 'meta.json'), meta),
    citations: writeJson(path.join(OUT_DIR, 'citations.json'), citations),
  };

  /* 数据量超过阈值时按方向分片；当前规模不生成额外文件 */
  const sharded = literature.length > 2000;
  const shards = {};
  if (sharded) {
    for (const c of categories) {
      const rows = literature.filter((p) => p.category === c.key);
      const name = `literature.${c.key}.json`;
      sizes[`shard:${c.key}`] = writeJson(path.join(OUT_DIR, name), rows);
      shards[c.key] = { path: `/data/${name}`, count: rows.length };
    }
  }

  writeJson(path.join(OUT_DIR, 'manifest.json'), {
    generated_at: meta.generated_at,
    count: literature.length,
    sharded,
    shards,
    load_strategy: {
      search: 'Pagefind 分片索引（/pagefind/），按查询增量加载',
      favorites: '/data/index.json（轻量索引，无摘要）',
      export: '/data/citations.json（点击题录或导出时按需加载）',
      full: '/data/literature.json（全量，供外部消费）',
    },
  });

  if (!quiet) {
    const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
    console.log(`[data] ${stats.total} 篇（白色 ${stats.white} / 彩色 ${stats.colored} / 透明 ${stats.transparent}，期刊 ${stats.journals} 种）`);
    for (const [k, v] of Object.entries(sizes)) console.log(`[data] ${k}.json  ${kb(v)}`);
  }
  return corpus;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildData();
}
