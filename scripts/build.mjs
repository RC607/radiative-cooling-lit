/* 静态站点构建：生成全部 HTML 页面 + 数据 + 资源，输出到 dist/。
 *
 * 用法：node scripts/build.mjs [--no-pagefind]
 * 构建结束后自动生成 Pagefind 全文索引（dist/pagefind/）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildData } from './build-data.mjs';
import { loadCorpus } from './lib/corpus.mjs';
import { BUILD_STAMP, BASE_URL, SITE } from './lib/html.mjs';
import * as pages from './lib/pages.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const SRC = path.join(ROOT, 'src');
const PUBLIC = path.join(ROOT, 'public');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else if (entry.isFile()) fs.copyFileSync(src, dest);
  }
}

function writePage(page) {
  if (!page) return 0;
  const { path: urlPath, html } = page;
  const target =
    urlPath === '/404.html'
      ? path.join(DIST, '404.html')
      : urlPath.endsWith('/')
        ? path.join(DIST, urlPath.slice(1), 'index.html')
        : path.join(DIST, urlPath.slice(1));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, html, 'utf8');
  return 1;
}

function chunkPages(total, size) {
  return Math.max(1, Math.ceil(total / size));
}

function buildSitemap(urls) {  const rows = urls
    .map(
      (u) => `  <url><loc>${BASE_URL}${u}</loc><lastmod>${BUILD_STAMP}</lastmod></url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${rows}
</urlset>
`;
}

function buildSearchIndex() {
  if (process.argv.includes('--no-pagefind')) {
    console.log('[search] 已跳过 Pagefind 索引（--no-pagefind）');
    return;
  }
  const cli = path.join(ROOT, 'node_modules', 'pagefind', 'lib', 'runner', 'bin.cjs');
  if (!fs.existsSync(cli)) {
    console.warn('[search] 未安装 pagefind，跳过索引；请先运行 npm install');
    return;
  }
  console.log('[search] 生成 Pagefind 索引…');
  execFileSync(
    process.execPath,
    [cli, '--site', DIST, '--glob', 'paper/**/index.html', '--output-subdir', 'pagefind'],
    { stdio: 'inherit' },
  );
}

function build() {
  const started = Date.now();
  const corpus = buildData({ quiet: true });
  const { stats } = corpus;

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  const generated = [];
  const sitemapUrls = [];

  const add = (page, { sitemap = true } = {}) => {
    if (!page) return;
    writePage(page);
    generated.push(page.path);
    if (sitemap && page.sitemap !== false) sitemapUrls.push(page.path);
  };

  /* 首页 */
  add(pages.home(corpus));

  /* 分类浏览：2 个方向 + 8 个细分 + 分页 */
  for (const cat of stats.categories) {
    const catCount = cat.count;
    for (let n = 1; n <= chunkPages(catCount, 20); n += 1) add(pages.browse(corpus, cat.key, null, n));
    for (const sub of cat.subs) {
      for (let n = 1; n <= chunkPages(sub.count, 20); n += 1) add(pages.browse(corpus, cat.key, sub.key, n));
    }
  }

  /* 文献类型：研究型论文 / 综述，各自再按方向与细分组织 */
  for (const t of stats.types) {
    for (let n = 1; n <= chunkPages(t.count, 20); n += 1) add(pages.typePage(corpus, t.key, '', '', n));
    if (!t.count) continue;
    for (const cat of stats.categories) {
      const catCount = corpus.items.filter((p) => p.type === t.name && p.category === cat.key).length;
      if (!catCount) continue;
      for (let n = 1; n <= chunkPages(catCount, 20); n += 1) add(pages.typePage(corpus, t.key, cat.key, '', n));
      for (const sub of cat.subs) {
        const subCount = corpus.items.filter(
          (p) => p.type === t.name && p.category === cat.key && p.sub === sub.key,
        ).length;
        if (!subCount) continue;
        for (let n = 1; n <= chunkPages(subCount, 20); n += 1) {
          add(pages.typePage(corpus, t.key, cat.key, sub.key, n));
        }
      }
    }
  }

  /* 最新文献 */
  for (let n = 1; n <= chunkPages(stats.total, 30); n += 1) add(pages.latest(corpus, n));

  /* 固定页 */
  add(pages.journals(corpus));
  add(pages.keywords(corpus));
  add(pages.statsPage(corpus));
  add(pages.about(corpus));
  add(pages.searchPage(corpus), { sitemap: false });
  add(pages.favorites(corpus), { sitemap: false });

  /* 文献详情 */
  for (const p of corpus.items) add(pages.paper(corpus, p));

  /* 404 */
  add(pages.notFound(corpus), { sitemap: false });

  /* 静态资源与数据 */
  copyDir(path.join(SRC, 'assets'), path.join(DIST, 'assets'));
  copyDir(PUBLIC, DIST);

  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), buildSitemap(sitemapUrls), 'utf8');
  fs.writeFileSync(
    path.join(DIST, 'robots.txt'),
    `User-agent: *\nAllow: /\nDisallow: /favorites/\nDisallow: /search/\n\nSitemap: ${BASE_URL}/sitemap.xml\n`,
    'utf8',
  );

  /* 检索索引（只索引文献详情页） */
  buildSearchIndex();

  const htmlFiles = generated.filter((p) => p.endsWith('/')).length + generated.filter((p) => p.endsWith('.html')).length;

  console.log(
    `[build] ${SITE.name} V${SITE.version} · ${stats.total} 篇 · ${htmlFiles} 个 HTML 页面 · ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
  console.log(`[build] 输出目录 ${DIST}`);
  console.log(`[build] 站点地址 ${BASE_URL}`);
  console.log(`[build] 页面示例 ${generated.slice(0, 3).join('  ')} …`);
}

build();
