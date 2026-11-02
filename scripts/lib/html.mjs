/* 页面外壳与通用组件：<head>、顶栏、侧栏、文献卡片、分页、页脚。 */

export const SITE = {
  name: '辐射制冷文献检索系统',
  short: '辐射制冷文献库',
  tagline: '白色、彩色与透明辐射制冷',
  version: '3.2',
  repo: 'rc-lit-portal',
};

export const BASE_URL = String(
  process.env.SITE_URL || process.env.CF_PAGES_URL || 'https://radiative-cooling-lit.pages.dev',
).replace(/\/+$/, '');

export const BUILD_DATE = new Date();
export const BUILD_STAMP = BUILD_DATE.toISOString().slice(0, 10);

export function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

export function absoluteUrl(p) {
  return `${BASE_URL}${p === '/' ? '/' : p}`;
}

const NAV = [
  { key: 'white', href: '/browse/white/', label: '白色' },
  { key: 'colored', href: '/browse/colored/', label: '彩色' },
  { key: 'transparent', href: '/browse/transparent/', label: '透明' },
  { key: 'research', href: '/type/research/', label: '研究型论文' },
  { key: 'review', href: '/type/review/', label: '综述' },
  { key: 'latest', href: '/latest/', label: '最新' },
  { key: 'journals', href: '/journals/', label: '期刊' },
  { key: 'stats', href: '/stats/', label: '统计' },
];

const FAV_ICON =
  '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M10 2.6l2.3 4.7 5.2.8-3.8 3.6.9 5.2-4.6-2.4-4.6 2.4.9-5.2L2.5 8.1l5.2-.8z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';

const LOGO =
  '<svg viewBox="0 0 48 48" width="26" height="26" aria-hidden="true"><circle cx="24" cy="24" r="10" fill="none" stroke="currentColor" stroke-width="3"/><path d="M24 4v6M24 38v6M4 24h6M38 24h6M9.9 9.9l4.2 4.2M33.9 33.9l4.2 4.2M38.1 9.9l-4.2 4.2M14.1 33.9l-4.2 4.2" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';

export function topbar(active = '') {
  const links = NAV.map(
    (n) => `<a href="${n.href}" data-nav="${n.key}"${active === n.key ? ' class="on" aria-current="page"' : ''}>${n.label}</a>`,
  ).join('');
  return `
  <header class="topbar" id="topbar">
    <a class="brand" href="/" aria-label="返回首页">
      <span class="brand-mark">${LOGO}</span>
      <span class="brand-text">
        <strong>${SITE.name}</strong>
        <small>${SITE.tagline} · 公开只读版 V${SITE.version}</small>
      </span>
    </a>
    <form class="searchbox" action="/search/" method="get" role="search">
      <svg class="search-ico" viewBox="0 0 20 20" width="17" height="17" aria-hidden="true"><circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M13.5 13.5 18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <input id="q" name="q" type="search" autocomplete="off" spellcheck="false"
             placeholder="检索题名、作者、期刊、关键词，如：结构色、BaSO4、织物" aria-label="检索文献">
      <kbd title="按 / 快速聚焦">/</kbd>
    </form>
    <button class="nav-toggle" id="nav-toggle" type="button" aria-expanded="false" aria-controls="topnav" aria-label="展开导航">☰</button>
    <nav class="topnav" id="topnav" aria-label="主导航">
      ${links}
      <a class="fav-link" href="/favorites/"${active === 'favorites' ? ' class="on"' : ''}>${FAV_ICON}<span class="fav-text">收藏</span><span class="pill" id="fav-count">0</span></a>
    </nav>
  </header>`;
}

export function sidebar(stats, { activeCat = '', activeSub = '', activeAll = false, activeType = '', activePage = '' } = {}) {
  const catRows = stats.categories
    .map((c) => {
      const subs = c.subs
        .map(
          (s) => `<a class="sub-item${activeSub === s.key ? ' on' : ''}" href="/browse/${c.key}/${s.key}/" title="${esc(s.desc)}">
            <span class="nm">${esc(s.name)}</span><span class="count">${s.count}</span></a>`,
        )
        .join('');
      return `<div class="cat-group">
        <a class="cat-head${activeCat === c.key && !activeSub ? ' on' : ''}" href="/browse/${c.key}/">
          <span class="dot ${c.key}"></span><span>${esc(c.name)}</span><span class="count">${c.count}</span>
        </a>
        <div class="sub-list">${subs}</div>
      </div>`;
    })
    .join('');

  const typeRows = (stats.types || [])
    .map(
      (t) => `<a class="side-all${activeType === t.key ? ' on' : ''}" href="/type/${t.key}/" title="${esc(t.desc || '')}">
        <span><span class="dot type-dot"></span>${esc(t.name)}</span><span>${t.count}</span></a>`,
    )
    .join('');

  return `
  <aside class="sidebar" id="sidebar" aria-label="分类导航">
    <details class="side-toggle" open>
      <summary>分类与筛选</summary>
      <div class="side-card">
        <div class="side-title"><span>文献分类</span><span>${stats.total} 篇</span></div>
        <a class="side-all${activeAll ? ' on' : ''}" href="/"><span>全部文献</span><span>${stats.total}</span></a>
        ${catRows}
        <div class="side-divider"></div>
        <div class="side-title"><span>文献类型</span></div>
        ${typeRows}
        <div class="side-note">白色方向聚焦“高反射 + 强发射”的亚环境制冷；彩色方向聚焦“颜色显示与制冷性能”的平衡。</div>
      </div>
      <div class="side-card">
        <div class="side-title"><span>快捷入口</span></div>
        <a class="side-all${activePage === 'latest' ? ' on' : ''}" href="/latest/"><span>最新文献</span><span>${stats.total}</span></a>
        <a class="side-all${activePage === 'journals' ? ' on' : ''}" href="/journals/"><span>期刊目录</span><span>${stats.journals}</span></a>
        <a class="side-all${activePage === 'keywords' ? ' on' : ''}" href="/keywords/"><span>关键词索引</span><span>${stats.keywords.length}</span></a>
        <a class="side-all${activePage === 'stats' ? ' on' : ''}" href="/stats/"><span>数据统计</span></a>
        <a class="side-all${activePage === 'favorites' ? ' on' : ''}" href="/favorites/"><span>我的收藏</span><span id="side-fav">0</span></a>
        <a class="side-all${activePage === 'about' ? ' on' : ''}" href="/about/"><span>关于本站</span></a>
      </div>
    </details>
  </aside>`;
}

export function layout({
  title,
  description,
  path,
  active = '',
  stats,
  sidebarHtml = '',
  main,
  scripts = [],
  noindex = false,
  bodyClass = '',
}) {
  const fullTitle = path === '/' ? `${SITE.name} · ${SITE.tagline}` : `${title} · ${SITE.name}`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(absoluteUrl(path))}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(SITE.name)}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(absoluteUrl(path))}">
<meta name="theme-color" content="#0f766e">
${noindex ? '<meta name="robots" content="noindex, follow">' : ''}
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/css/style.css?v=${SITE.version}">
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
<a class="skip-link" href="#main">跳到正文</a>
${topbar(active)}
<div class="layout${sidebarHtml ? '' : ' no-sidebar'}">
  ${sidebarHtml}
  <main class="main" id="main" tabindex="-1">
    ${main}
  </main>
</div>
<footer class="footer">
  <span>${SITE.name} V${SITE.version} · 白色 / 彩色 / 透明辐射制冷 · 共 ${stats.total} 篇 · 数据更新于 ${BUILD_STAMP}</span>
  <span class="footer-dim">公开只读站点 · 题录元数据经 OpenAlex 开放元数据接口校核；中文简介由编者整理，供检索与选题参考 · <a href="/about/">关于本站</a></span></footer>
<div id="modal-root"></div>
<div id="toast" class="toast" hidden></div>
<script src="/assets/js/site.js?v=${SITE.version}" defer></script>
${scripts.map((s) => `<script src="${s}${s.includes('?') ? '&' : '?'}v=${SITE.version}" defer></script>`).join('\n')}
</body>
</html>
`;
}

export function breadcrumbs(items) {
  const parts = items.map((it) =>
    it.href ? `<a href="${it.href}">${esc(it.label)}</a>` : `<span>${esc(it.label)}</span>`,
  );
  return `<div class="crumbs">${parts.join('<span class="sep">/</span>')}</div>`;
}

export function isFresh(p) {
  const t = Date.parse(p.published || '');
  return Number.isFinite(t) && Date.now() - t < 120 * 86400000;
}

export function paperCard(p, { snippet = '', actions = true } = {}) {
  const sameTitle = String(p.title_zh || '').trim().toLowerCase() === String(p.title_en || '').trim().toLowerCase();
  const kw = (p.keywords || [])
    .slice(0, 4)
    .map((k) => `<a class="kw" href="/search/?kw=${encodeURIComponent(k)}">${esc(k)}</a>`)
    .join('');
  const vol = p.volume ? `${esc(p.volume)}${p.issue ? `(${esc(p.issue)})` : ''}` : '';
  const catChip = p.category === 'white' ? 'cat-white' : p.category === 'colored' ? 'cat-colored' : 'cat-transparent';
  return `
  <article class="paper" data-id="${esc(p.id)}">
    <div class="paper-top">
      <div class="idx">${esc(p.id)}</div>
      <div class="paper-body">
        <a class="paper-title" href="/paper/${esc(p.id)}/">${esc(p.title_zh || p.title_en)}</a>
        ${sameTitle ? '' : `<div class="paper-title-en">${esc(p.title_en)}</div>`}
        <div class="paper-meta">
          <a class="chip ${catChip}" href="/browse/${p.category}/">${esc(p.category_name)}</a>
          <a class="chip" href="/browse/${p.category}/${p.sub}/">${esc(p.sub_name)}</a>
          <span class="chip ${p.type === '综述' ? 'type' : 'type-academic'}">${esc(p.type)}</span>
          ${p.source !== '内置库' && p.source !== p.type ? `<span class="chip source">${esc(p.source)}</span>` : ''}
          ${isFresh(p) ? '<span class="chip new">新</span>' : ''}
          <span class="sep">·</span><a class="jrn" href="/search/?journal=${encodeURIComponent(p.journal)}">${esc(p.journal)}</a>
          <span class="sep">·</span><span>${esc(p.published)}</span>
          ${vol ? `<span class="sep">·</span><span>${vol}</span>` : ''}
          ${p.doi ? `<span class="sep">·</span><span class="doi">${esc(p.doi)}</span>` : ''}
        </div>
        ${snippet ? `<div class="paper-snippet">${snippet}</div>` : ''}
        <div class="paper-foot">
          <div class="kw-cloud">${kw}</div>
          <span class="sp"></span>
          ${actions ? `<div class="paper-acts">
            <button class="icon-btn" type="button" data-act="fav" data-id="${esc(p.id)}" title="收藏" aria-label="收藏">☆</button>
            <button class="btn sm" type="button" data-act="cite" data-id="${esc(p.id)}">题录</button>
            <a class="btn sm" href="/paper/${esc(p.id)}/">详情</a>
          </div>` : ''}
        </div>
      </div>
    </div>
  </article>`;
}

export function pager(page, pages, hrefFor) {
  if (pages <= 1) return '';
  const nums = [];
  let ellipsis = false;
  const push = (n) =>
    nums.push(`<a class="pg${n === page ? ' on' : ''}" href="${hrefFor(n)}"${n === page ? ' aria-current="page"' : ''}>${n}</a>`);
  for (let n = 1; n <= pages; n += 1) {
    if (n === 1 || n === pages || Math.abs(n - page) <= 2) {
      push(n);
      ellipsis = false;
    } else if (!ellipsis) {
      nums.push('<span class="pg dis">…</span>');
      ellipsis = true;
    }
  }
  return `<nav class="pager" aria-label="分页">
    <a class="pg${page <= 1 ? ' dis' : ''}" href="${hrefFor(Math.max(1, page - 1))}" rel="prev">上一页</a>
    ${nums.join('')}
    <a class="pg${page >= pages ? ' dis' : ''}" href="${hrefFor(Math.min(pages, page + 1))}" rel="next">下一页</a>
    <span class="info">第 ${page} / ${pages} 页</span>
  </nav>`;
}

export function pagePath(base, n) {
  return n === 1 ? base : `${base}page/${n}/`;
}

export function paginate(items, page, size) {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * size;
  return { items: items.slice(start, start + size), page: current, pages, total, size };
}
