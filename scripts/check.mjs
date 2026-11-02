/* 构建产物自检：
 *   1. 内部链接是否都能解析到文件
 *   2. 是否残留 /api、写操作表单、管理入口
 *   3. 页面必备标签（title / description / canonical / lang）
 *   4. 是否引用外部脚本、是否出现密钥特征
 *   5. sitemap 中的 URL 是否可访问
 * 用法：node scripts/check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const BASE = (process.env.SITE_URL || process.env.CF_PAGES_URL || 'https://radiative-cooling-lit.pages.dev').replace(/\/+$/, '');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}

function resolveUrl(url) {
  const clean = decode(url.split('#')[0].split('?')[0]);
  if (!clean.startsWith('/')) return null;
  const rel = clean.slice(1);
  if (!rel || rel.endsWith('/')) return path.join(DIST, rel, 'index.html');
  if (path.extname(rel)) return path.join(DIST, rel);
  const asHtml = path.join(DIST, `${rel}.html`);
  if (fs.existsSync(asHtml)) return asHtml;
  return path.join(DIST, rel, 'index.html');
}

const files = walk(DIST);
const htmlFiles = files.filter((f) => f.endsWith('.html'));
const problems = [];
const warnings = [];

/* ── 链接检查 ───────────────────────────────────────────────────────── */
let linkCount = 0;
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const urls = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  for (const url of urls) {
    if (/^(https?:|mailto:|data:|#|javascript:)/i.test(url)) continue;
    const target = resolveUrl(url);
    if (!target) continue;
    linkCount += 1;
    if (!fs.existsSync(target)) {
      problems.push(`${path.relative(DIST, file)} → 断链 ${url}`);
    }
  }
}

/* ── 页面必备标签 / 外部资源 ────────────────────────────────────────── */
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const rel = path.relative(DIST, file);
  if (!/<html lang="zh-CN">/.test(html)) problems.push(`${rel} 缺少 lang="zh-CN"`);
  if (!/<title>[^<]{4,}<\/title>/.test(html)) problems.push(`${rel} 缺少 <title>`);
  if (!/<meta name="description" content="[^"]{10,}"/.test(html)) problems.push(`${rel} 缺少 description`);
  if (rel !== '404.html' && !/<link rel="canonical"/.test(html)) problems.push(`${rel} 缺少 canonical`);
  if (!/<meta name="viewport"/.test(html)) problems.push(`${rel} 缺少 viewport（移动端）`);
  if (/<script[^>]+src="https?:/i.test(html)) problems.push(`${rel} 引用了外部脚本`);
  if (/<img[^>]+src="https?:/i.test(html)) warnings.push(`${rel} 引用了外部图片`);
  for (const m of html.matchAll(/<img\b[^>]*>/g)) {
    if (!/\balt=/.test(m[0])) problems.push(`${rel} 存在缺少 alt 的图片`);
    if (!/\bloading=/.test(m[0])) warnings.push(`${rel} 图片未设置 loading="lazy"`);
  }
  for (const m of html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) {
    if (!/\brel="[^"]*noopener/.test(m[0])) problems.push(`${rel} 外链缺少 rel="noopener"`);
  }
}

/* ── 图片 / PDF / 安全头 / manifest ─────────────────────────────────── */
if (files.some((f) => f.toLowerCase().endsWith('.pdf'))) {
  problems.push('公开站包含 PDF 文件（不应托管论文全文）');
}
const headersFile = path.join(DIST, '_headers');
if (!fs.existsSync(headersFile)) {
  problems.push('缺少 _headers');
} else if (!/Content-Security-Policy:/.test(fs.readFileSync(headersFile, 'utf8'))) {
  problems.push('_headers 缺少 Content-Security-Policy');
}
if (!fs.existsSync(path.join(DIST, 'data', 'manifest.json'))) {
  problems.push('缺少 data/manifest.json');
}
const robotsFile = path.join(DIST, 'robots.txt');
if (!fs.existsSync(robotsFile)) {
  problems.push('缺少 robots.txt');
} else {
  const robots = fs.readFileSync(robotsFile, 'utf8');
  if (!/Disallow: \/favorites\//.test(robots) || !/Disallow: \/search\//.test(robots)) {
    problems.push('robots.txt 未屏蔽 /favorites/ 或 /search/');
  }
}

/* ── 写操作 / 管理接口残留 ──────────────────────────────────────────── */
const forbidden = [
  [/\/api\//, '/api 路径'],
  [/method="post"/i, 'POST 表单'],
  [/<button[^>]*>\s*(立即更新|批量扩充|导入|同步|收录|上传|删除)\s*<\/button>/, '写操作按钮'],
  [/data-act="(import|sync|expand|upload|delete)"/i, '写操作 data-act'],
  [/(api[_-]?key|access[_-]?token|secret[_-]?key|authorization:\s*bearer)/i, '密钥特征'],
  [/管理后台|后台管理|admin\.html|login\.html/i, '管理入口'],
];
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  for (const [re, label] of forbidden) {
    if (re.test(html)) problems.push(`${path.relative(DIST, file)} 命中 ${label}`);
  }
}
for (const file of files.filter((f) => f.endsWith('.js'))) {
  const js = fs.readFileSync(file, 'utf8');
  for (const [re, label] of [
    [/\/api\//, '/api 路径'],
    [/(api[_-]?key|access[_-]?token|secret[_-]?key|authorization:\s*bearer)/i, '密钥特征'],
    [/method:\s*['"]POST['"]/i, 'POST 请求'],
    [/fetch\(\s*['"`]https?:\/\//, '外部 fetch'],
  ]) {
    if (re.test(js)) problems.push(`${path.relative(DIST, file)} 命中 ${label}`);
  }
}

/* ── Pagefind 索引 ─────────────────────────────────────────────────── */
for (const file of ['pagefind.js', 'pagefind-entry.json']) {
  if (!fs.existsSync(path.join(DIST, 'pagefind', file))) {
    problems.push(`缺少 Pagefind 索引文件 pagefind/${file}`);
  }
}

/* ── sitemap ───────────────────────────────────────────────────────── */
const sitemapFile = path.join(DIST, 'sitemap.xml');
if (!fs.existsSync(sitemapFile)) {
  problems.push('缺少 sitemap.xml');
} else {
  const xml = fs.readFileSync(sitemapFile, 'utf8');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  for (const loc of locs) {
    if (!loc.startsWith(BASE)) {
      problems.push(`sitemap 含站外地址 ${loc}`);
      continue;
    }
    const target = resolveUrl(loc.slice(BASE.length) || '/');
    if (!target || !fs.existsSync(target)) problems.push(`sitemap 地址无对应页面 ${loc}`);
  }
  console.log(`[check] sitemap ${locs.length} 条`);
}

/* ── 输出 ───────────────────────────────────────────────────────────── */
console.log(`[check] HTML ${htmlFiles.length} 个 · 内部链接 ${linkCount} 条 · 产物 ${files.length} 个文件`);

const uniqueProblems = [...new Set(problems)];
if (warnings.length) {
  console.log(`[check] 提示 ${warnings.length} 条：`);
  for (const w of warnings.slice(0, 10)) console.log(`  - ${w}`);
}
if (uniqueProblems.length) {
  console.error(`[check] 失败：${uniqueProblems.length} 个问题`);
  for (const p of uniqueProblems.slice(0, 40)) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log('[check] 通过：无断链、无写操作残留、无管理入口、无密钥特征。');
