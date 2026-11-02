/* 页面渲染：每个函数返回 { path, html, sitemap? }，由 build.mjs 写入 dist。 */
import {
  BUILD_STAMP,
  SITE,
  esc,
  layout,
  sidebar,
  breadcrumbs,
  paperCard,
  pager,
  pagePath,
  paginate,
} from './html.mjs';
import { relatedPapers } from './corpus.mjs';
import { FORMATS, gbt7714, bibtex, ris } from './biblio.mjs';

const PAGE_SIZE = 20;
const LATEST_SIZE = 30;

function renderPage(opts, main) {
  return layout({ ...opts, main });
}

function head(title, description, path, active, stats, opts = {}) {
  return {
    title,
    description,
    path,
    active,
    stats,
    sidebarHtml: opts.sidebarHtml ?? sidebar(stats, opts.sideState || {}),
    scripts: opts.scripts || [],
    noindex: opts.noindex || false,
  };
}

/* ── 首页 ───────────────────────────────────────────────────────────── */
export function home(corpus) {
  const { stats } = corpus;
  const latest = corpus.items.slice(0, 8);
  const maxSub = Math.max(1, ...stats.categories.flatMap((c) => c.subs.map((s) => s.count)));

  const catCard = (c) => `
    <a class="cat-card ${c.key}" href="/browse/${c.key}/">
      <div class="ch"><span class="dot ${c.key}"></span><h2>${esc(c.name)}</h2>
        <span class="cc">${c.count} 篇 / ${c.subs.length} 个细分</span></div>
      <p>${esc(c.desc)}</p>
      ${c.subs
        .map(
          (s) => `<div class="sub-bar">
            <span class="name">${esc(s.name)}</span>
            <span class="track"><span class="fill" style="width:${Math.round((s.count / maxSub) * 100)}%"></span></span>
            <span class="num">${s.count}</span>
          </div>`,
        )
        .join('')}
    </a>`;

  const body = `
    <section class="hero">
      <h1>辐射制冷领域文献检索</h1>
      <p>覆盖白色、彩色与透明辐射制冷三大方向、十三个细分主题，收录 ${stats.total} 篇代表性文献
         （${stats.year_min}—${stats.year_max} 年），并按研究型论文与综述两类分开整理。本站为公开只读库，
         数据由维护者通过 GitHub Actions 每日定时构建发布，访客端不请求任何外部接口。</p>
      <div class="hero-tags">
        <span>试试：</span>
        ${['结构色', '透明窗', '水泥', '织物', '荧光', '自适应', 'BaSO4', '卷对卷']
          .map((t) => `<a class="tag" href="/search/?q=${encodeURIComponent(t)}">${esc(t)}</a>`)
          .join('')}
        <a class="tag" href="/search/">高级检索 →</a>
      </div>
    </section>

    <div class="infobar">
      <span class="pulse"></span>
      <span><b>公开只读</b>：全部页面为构建时生成的静态文件，无需维护者电脑开机</span>
      <span>· 数据更新于 ${BUILD_STAMP}</span>
      <span class="sp"></span>
      <a class="btn sm" href="/latest/">最新文献 →</a>
    </div>

    <section class="stat-grid">
      <div class="stat"><div class="k">文献总量</div><div class="v">${stats.total}<small>篇</small></div>
        <div class="sub">白色 ${stats.white} / 彩色 ${stats.colored} / 透明 ${stats.transparent}</div></div>
      <div class="stat"><div class="k">文献类型</div><div class="v">${stats.research}<small>研究型</small></div>
        <div class="sub">综述 ${stats.reviews}</div></div>
      <div class="stat"><div class="k">来源期刊</div><div class="v">${stats.journals}<small>种</small></div>
        <div class="sub">含网络来源期刊</div></div>
      <div class="stat"><div class="k">年份跨度</div><div class="v">${stats.year_min}<small>— ${stats.year_max}</small></div>
        <div class="sub">13 个细分主题</div></div>
    </section>

    <section class="cat-cards">${stats.categories.map(catCard).join('')}</section>

    <div class="home-bottom">
      <section class="panel">
        <div class="section-title"><h2>最新文献（按发表时间）</h2>
          <a class="more" href="/latest/">全部最新 →</a></div>
        ${latest
          .map(
            (p) => `<div class="latest-item">
              <span class="yr">${esc(p.published)}</span>
              <div>
                <a class="ti" href="/paper/${esc(p.id)}/">${esc(p.title_zh || p.title_en)}</a>
                <div class="mj">${esc(p.journal)} · ${esc(p.category_name)} / ${esc(p.sub_name)}${p.source !== '内置库' ? ' · ' + esc(p.source) : ''}</div>
              </div>
            </div>`,
          )
          .join('')}
      </section>
      <section class="panel">
        <div class="section-title"><h2>高频关键词</h2>
          <a class="more" href="/keywords/">全部关键词 →</a></div>
        <div class="kw-cloud">
          ${stats.keywords
            .slice(0, 26)
            .map((k) => `<a class="kw" href="/search/?kw=${encodeURIComponent(k.name)}">${esc(k.name)}<b>${k.count}</b></a>`)
            .join('')}
        </div>
      </section>
    </div>`;

  return {
    path: '/',
    html: renderPage(
      head(
        '',
        `辐射制冷文献检索系统：收录 ${stats.total} 篇白色、彩色与透明辐射制冷文献，按研究型论文与综述分开整理，支持题名、作者、期刊、关键词、年份检索，公开只读，每日自动更新。`,
        '/',
        'home',
        stats,
        { sidebarHtml: sidebar(stats, { activeAll: true }) },
      ),
      body,
    ),
  };
}

/* ── 分类浏览 ───────────────────────────────────────────────────────── */
export function browse(corpus, catKey, subKey, page = 1) {
  const { stats } = corpus;
  const cat = stats.categories.find((c) => c.key === catKey);
  if (!cat) return null;
  const sub = subKey ? cat.subs.find((s) => s.key === subKey) : null;
  if (subKey && !sub) return null;

  const items = corpus.items.filter((p) => p.category === catKey && (!subKey || p.sub === subKey));
  const slice = paginate(items, page, PAGE_SIZE);
  const base = sub ? `/browse/${catKey}/${subKey}/` : `/browse/${catKey}/`;
  const href = (n) => pagePath(base, n);

  const body = `
    ${breadcrumbs([{ label: '首页', href: '/' }, { label: cat.name, href: `/browse/${cat.key}/` }, ...(sub ? [{ label: sub.name }] : [])])}
    <div class="page-head">
      <h1>${esc(sub ? sub.name : cat.name)}</h1>
      <div class="desc">${esc(sub ? sub.desc : cat.desc)}</div>
      <div class="count">共 ${slice.total} 篇</div>
    </div>

    <div class="toolbar subnav">
      <a class="btn sm${!sub ? ' on' : ''}" href="/browse/${cat.key}/">全部（${cat.count}）</a>
      ${cat.subs
        .map((s) => `<a class="btn sm${subKey === s.key ? ' on' : ''}" href="/browse/${cat.key}/${s.key}/">${esc(s.name)}（${s.count}）</a>`)
        .join('')}
      <span class="grow"></span>
      <span class="toolbar-note">按发表时间倒序</span>
    </div>

    <div class="result-list">
      ${slice.items.map((p) => paperCard(p)).join('') || '<div class="empty"><h3>暂无文献</h3><p>请选择其他分类。</p></div>'}
    </div>
    ${pager(slice.page, slice.pages, href)}`;

  return {
    path: pagePath(base, slice.page),
    html: renderPage(
      head(sub ? sub.name : cat.name, `${esc(sub ? sub.desc : cat.desc)} 共 ${slice.total} 篇辐射制冷文献，按发表时间倒序。第 ${slice.page} / ${slice.pages} 页。`, pagePath(base, slice.page), catKey, stats, {
        sidebarHtml: sidebar(stats, { activeCat: catKey, activeSub: subKey || '' }),
      }),
      body,
    ),
  };
}

/* ── 文献类型（研究型论文 / 综述，各自再按方向与细分组织） ── */
export function typePage(corpus, typeKey, catKey = '', subKey = '', page = 1) {
  const { stats } = corpus;
  const conf = stats.types.find((t) => t.key === typeKey);
  if (!conf) return null;
  const cat = catKey ? stats.categories.find((c) => c.key === catKey) : null;
  if (catKey && !cat) return null;
  const sub = subKey && cat ? cat.subs.find((s) => s.key === subKey) : null;
  if (subKey && !sub) return null;

  const typeItems = corpus.items.filter((p) => p.type === conf.name);
  const catItems = cat ? typeItems.filter((p) => p.category === cat.key) : typeItems;
  const items = sub ? catItems.filter((p) => p.sub === sub.key) : catItems;
  const slice = paginate(items, page, PAGE_SIZE);

  const base = `/type/${typeKey}/` + (cat ? `${cat.key}/` : '') + (sub ? `${sub.key}/` : '');
  const href = (n) => pagePath(base, n);
  const catCount = (key) => typeItems.filter((p) => p.category === key).length;
  const subCount = (key) => catItems.filter((p) => p.sub === key).length;

  const headTitle = [conf.name, cat ? cat.name : '', sub ? sub.name : ''].filter(Boolean).join(' · ');
  const crumbs = [
    { label: '首页', href: '/' },
    { label: '文献类型' },
    { label: conf.name, href: `/type/${typeKey}/` },
    ...(cat ? [{ label: cat.name, href: `/type/${typeKey}/${cat.key}/` }] : []),
    ...(sub ? [{ label: sub.name }] : []),
  ];

  const body = `
    ${breadcrumbs(crumbs)}
    <div class="page-head">
      <h1>${headTitle}</h1>
      <div class="desc">${esc(conf.desc)}。与白色 / 彩色 / 透明三大方向、十三个细分主题交叉组织，便于按研究目的取用。共 ${slice.total} 篇。</div>
      <div class="count">共 ${slice.total} 篇</div>
    </div>

    <div class="toolbar subnav">
      <a class="btn sm${!cat ? ' on' : ''}" href="/type/${typeKey}/">全部方向（${typeItems.length}）</a>
      ${stats.categories
        .filter((c) => catCount(c.key) > 0)
        .map((c) => `<a class="btn sm${catKey === c.key ? ' on' : ''}" href="/type/${typeKey}/${c.key}/">${esc(c.name)}（${catCount(c.key)}）</a>`)
        .join('')}
      <span class="grow"></span>
      <span class="toolbar-note">按发表时间倒序</span>
    </div>

    ${cat
      ? `<div class="toolbar subnav">
          <span class="toolbar-note">细分主题：</span>
          <a class="btn sm${!sub ? ' on' : ''}" href="/type/${typeKey}/${cat.key}/">全部（${catItems.length}）</a>
          ${cat.subs
            .filter((s) => subCount(s.key) > 0)
            .map((s) => `<a class="btn sm${subKey === s.key ? ' on' : ''}" href="/type/${typeKey}/${cat.key}/${s.key}/">${esc(s.name)}（${subCount(s.key)}）</a>`)
            .join('')}
        </div>`
      : ''}

    <div class="result-list">
      ${slice.items.map((p) => paperCard(p)).join('') ||
      `<div class="empty"><h3>暂无收录</h3><p>该分类下暂无文献，可返回上一层或其他方向。</p></div>`}
    </div>
    ${pager(slice.page, slice.pages, href)}`;

  return {
    path: pagePath(base, slice.page),
    html: renderPage(
      head(headTitle, `${headTitle} 共 ${slice.total} 篇，按白色、彩色、透明三大方向与十三个细分主题组织。`, pagePath(base, slice.page), typeKey, stats, {
        sidebarHtml: sidebar(stats, { activeType: typeKey }),
      }),
      body,
    ),
  };
}

/* ── 最新文献 ───────────────────────────────────────────────────────── */
export function latest(corpus, page = 1) {
  const { stats } = corpus;
  const slice = paginate(corpus.items, page, LATEST_SIZE);
  const base = '/latest/';
  const body = `
    ${breadcrumbs([{ label: '首页', href: '/' }, { label: '最新文献' }])}
    <div class="page-head">
      <h1>最新文献</h1>
      <div class="desc">内置库与网络收录文献同表呈现，一律按发表时间倒序，最近见刊或上传的成果排在最前。数据随每日构建更新。</div>
      <div class="count">共 ${slice.total} 篇</div>
    </div>
    <div class="toolbar subnav">
      <span class="toolbar-note">按发表时间倒序 · 第 ${slice.page} / ${slice.pages} 页</span>
      <span class="grow"></span>
      <a class="btn sm" href="/download/radiative-cooling.bib" download>下载全库 BibTeX</a>
    </div>
    <div class="result-list">
      ${slice.items.map((p) => paperCard(p)).join('')}
    </div>
    ${pager(slice.page, slice.pages, (n) => pagePath(base, n))}`;

  return {
    path: pagePath(base, slice.page),
    html: renderPage(
      head('最新文献', '按发表时间倒序浏览辐射制冷领域最新文献，含自动同步与人工收录。', pagePath(base, slice.page), 'latest', stats, {
        sidebarHtml: sidebar(stats, { activePage: 'latest' }),
      }),
      body,
    ),
  };
}

/* ── 期刊目录 ───────────────────────────────────────────────────────── */
export function journals(corpus) {
  const { stats } = corpus;
  const rows = stats.journals_list
    .map(
      (j) => `<tr data-name="${esc(j.name.toLowerCase())}">
        <td><a href="/search/?journal=${encodeURIComponent(j.name)}">${esc(j.name)}</a></td>
        <td class="n">${j.count}</td>
        <td class="n">${j.white || '—'}</td>
        <td class="n">${j.colored || '—'}</td>
        <td class="n">${j.transparent || '—'}</td>
        <td class="n">${j.latest || '—'}</td>
      </tr>`,
    )
    .join('');

  const body = `
    ${breadcrumbs([{ label: '首页', href: '/' }, { label: '期刊目录' }])}
    <div class="page-head">
      <h1>期刊目录</h1>
      <div class="desc">按期刊汇总库内 ${stats.total} 篇文献：白色 / 彩色 / 透明分布与最近发表时间。点击期刊名进入该刊文献检索，便于按刊筛选与跟踪目标期刊。</div>
      <div class="count">${stats.journals} 种期刊</div>
    </div>
    <div class="toolbar">
      <span class="field">筛选 <input id="journal-filter" placeholder="输入刊名关键词，如 Advanced / Nano" style="width:260px"></span>
      <span class="grow"></span>
      <a class="btn sm" href="/download/radiative-cooling.bib" download>下载全库 BibTeX</a>
    </div>
    <div class="chart-card" style="padding:6px 14px">
      <table class="jt" id="journal-table">
        <thead><tr><th>期刊</th><th style="width:62px">总数</th><th style="width:62px">白色</th>
          <th style="width:62px">彩色</th><th style="width:62px">透明</th><th style="width:104px">最近发表</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="empty" id="journal-empty" hidden><h3>没有匹配的期刊</h3><p>换个关键词试试。</p></div>`;

  return {
    path: '/journals/',
    html: renderPage(
      head('期刊目录', `${stats.journals} 种来源期刊的辐射制冷文献分布，含白色 / 彩色 / 透明方向与最近发表时间。`, '/journals/', 'journals', stats, {
        sidebarHtml: sidebar(stats, { activePage: 'journals' }),
      }),
      body,
    ),
  };
}

/* ── 关键词索引 ─────────────────────────────────────────────────────── */
export function keywords(corpus) {
  const { stats } = corpus;
  const chips = stats.keywords
    .map((k) => `<a class="kw" href="/search/?kw=${encodeURIComponent(k.name)}" data-kw="${esc(k.name.toLowerCase())}">${esc(k.name)}<b>${k.count}</b></a>`)
    .join('');

  const body = `
    ${breadcrumbs([{ label: '首页', href: '/' }, { label: '关键词索引' }])}
    <div class="page-head">
      <h1>关键词索引</h1>
      <div class="desc">全库 ${stats.keywords.length} 个关键词按出现次数排序；点击任一关键词进入检索，结果只包含打上该关键词的文献。</div>
      <div class="count">${stats.keywords.length} 个关键词</div>
    </div>
    <div class="toolbar">
      <span class="field">查找 <input id="kw-filter" placeholder="输入关键词，如 结构色 / BaSO4" style="width:260px"></span>
      <span class="grow"></span>
      <span class="toolbar-note">数字为该关键词的文献数</span>
    </div>
    <section class="panel">
      <div class="kw-cloud" id="kw-cloud">${chips}</div>
      <div class="empty" id="kw-empty" hidden><h3>没有匹配的关键词</h3><p>试试更短的词。</p></div>
    </section>`;

  return {
    path: '/keywords/',
    html: renderPage(
      head('关键词索引', `辐射制冷文献库的 ${stats.keywords.length} 个关键词及出现次数，可直接进入检索。`, '/keywords/', 'keywords', stats, {
        sidebarHtml: sidebar(stats, { activePage: 'keywords' }),
      }),
      body,
    ),
  };
}

/* ── 数据统计 ───────────────────────────────────────────────────────── */
export function statsPage(corpus) {
  const { stats } = corpus;
  const maxYear = Math.max(1, ...stats.years.map((y) => y.count));
  const maxSub = Math.max(1, ...stats.categories.flatMap((c) => c.subs.map((s) => s.count)));
  const maxMonth = Math.max(1, ...stats.months.map((m) => m.count));

  const catBars = stats.categories
    .map((c) => {
      const subs = c.subs
        .map(
          (s) => `<div class="hbar ${c.key}"><span class="lb">${esc(s.name)}</span>
            <span class="tr"><span class="fl" style="width:${Math.round((s.count / maxSub) * 100)}%"></span></span>
            <span class="vv">${s.count}</span></div>`,
        )
        .join('');
      return `<div class="hbar ${c.key}" style="margin-top:10px">
          <span class="lb"><b>${esc(c.name)}</b></span>
          <span class="tr"><span class="fl" style="width:${Math.round((c.count / stats.total) * 100)}%"></span></span>
          <span class="vv">${c.count}</span></div>${subs}`;
    })
    .join('');

  const years = stats.years.slice().sort((a, b) => a.year - b.year);
  const yearChart = years
    .map(
      (y) => `<div class="year-col" title="${y.year} 年：${y.count} 篇">
        <div class="bar" style="height:${Math.max(4, Math.round((y.count / maxYear) * 100))}%"></div>
        <div class="lb">${String(y.year).slice(2)}</div></div>`,
    )
    .join('');

  const body = `
    ${breadcrumbs([{ label: '首页', href: '/' }, { label: '数据统计' }])}
    <div class="page-head"><h1>文献库统计</h1>
      <div class="desc">按分类、年份、期刊三个维度呈现库内 ${stats.total} 篇文献的分布，可用于研判方向热度与选刊参考。</div></div>

    <div class="stat-grid">
      <div class="stat"><div class="k">文献总量</div><div class="v">${stats.total}</div><div class="sub">篇</div></div>
      <div class="stat"><div class="k">白色 / 彩色 / 透明</div><div class="v">${stats.white}<small>/ ${stats.colored} / ${stats.transparent}</small></div><div class="sub">三大方向</div></div>
      <div class="stat"><div class="k">研究型论文</div><div class="v">${stats.research}</div><div class="sub">综述 ${stats.reviews}</div></div>
      <div class="stat"><div class="k">期刊数</div><div class="v">${stats.journals}</div><div class="sub">${stats.year_min}—${stats.year_max}</div></div>
    </div>

    <section class="chart-card"><h3>细分主题分布</h3>${catBars}</section>

    <section class="chart-card"><h3>文献类型构成</h3>
      ${stats.types
        .map(
          (t) => `<div class="hbar"><span class="lb">${esc(t.name)}</span>
            <span class="tr"><span class="fl" style="width:${Math.round((t.count / stats.total) * 100)}%"></span></span>
            <span class="vv">${t.count}</span></div>`,
        )
        .join('')}
      <div class="side-note" style="padding:8px 0 0">研究型论文与综述分开统计；两者采用同一套方向 / 细分分类逻辑。</div>
    </section>

    <section class="chart-card"><h3>来源构成</h3>
      ${stats.sources
        .map(
          (s) => `<div class="hbar"><span class="lb">${esc(s.name)}</span>
            <span class="tr"><span class="fl" style="width:${Math.round((s.count / stats.total) * 100)}%"></span></span>
            <span class="vv">${s.count}</span></div>`,
        )
        .join('')}
      <div class="side-note" style="padding:8px 0 0">网络收录含站内检索人工收录与后台自动同步；两者均计入总量、分类计数与类型统计。</div>
    </section>

    <section class="chart-card"><h3>发布日期分布（近 12 个月）</h3>
      <div class="year-chart">${stats.months
        .map(
          (x) => `<div class="year-col" title="${esc(x.month)}：${x.count} 篇">
            <div class="bar" style="height:${Math.max(4, Math.round((x.count / maxMonth) * 100))}%"></div>
            <div class="lb">${esc(x.month.slice(2))}</div></div>`,
        )
        .join('')}</div>
      <div class="side-note" style="padding:8px 0 0">按发表日期归月统计，用于观察近期成果产出节奏；含网络同步进来的新文献。</div>
    </section>

    <section class="chart-card"><h3>年份分布（${stats.year_min}—${stats.year_max}）</h3>
      <div class="year-chart">${yearChart}</div>
    </section>

    <section class="chart-card"><h3>来源期刊（Top 12）<a class="more" href="/journals/" style="margin-left:auto;font-size:12px;color:var(--brand)">期刊目录 →</a></h3>
      <table class="jt">
        <thead><tr><th>期刊</th><th style="width:70px">数量</th><th style="width:90px">占比</th></tr></thead>
        <tbody>${stats.journals_list
          .slice(0, 12)
          .map(
            (j) => `<tr><td><a href="/search/?journal=${encodeURIComponent(j.name)}">${esc(j.name)}</a></td>
              <td class="n">${j.count}</td><td class="n">${((j.count / stats.total) * 100).toFixed(1)}%</td></tr>`,
          )
          .join('')}
        </tbody>
      </table>
    </section>

    <section class="chart-card"><h3>关键词分布</h3>
      <div class="kw-cloud">${stats.keywords
        .slice(0, 40)
        .map((k) => `<a class="kw" href="/search/?kw=${encodeURIComponent(k.name)}">${esc(k.name)}<b>${k.count}</b></a>`)
        .join('')}</div>
    </section>`;

  return {
    path: '/stats/',
    html: renderPage(
      head('数据统计', `文献库 ${stats.total} 篇文献的分类、年份、期刊与关键词分布统计。`, '/stats/', 'stats', stats, {
        sidebarHtml: sidebar(stats, { activePage: 'stats' }),
      }),
      body,
    ),
  };
}

/* ── 关于 ───────────────────────────────────────────────────────────── */
export function about(corpus) {
  const { stats } = corpus;
  const body = `
    ${breadcrumbs([{ label: '首页', href: '/' }, { label: '关于本站' }])}
    <div class="doc">
      <section class="doc-card">
        <h2>站点定位</h2>
        <p>本站面向辐射制冷（passive radiative cooling）方向的科研人员、研究生与工程技术人员，把分散在期刊中的代表性文献
           按<b>白色</b>、<b>彩色</b>与<b>透明</b>三大方向整理成可检索的文献库，三个方向共细分为十三个主题，并按
           <b>研究型论文</b>与<b>综述</b>两类分开整理，共
           ${stats.total} 篇文献、${stats.journals} 种期刊、${stats.year_min}—${stats.year_max} 年。</p>
        <p>本站为<b>公开只读站点</b>：所有页面在构建时生成，访客只能浏览与检索，不提供任何写入、导入或管理入口；
           文献数据由维护者通过 GitHub Actions 每日定时更新，不依赖任何一台个人电脑保持开机。</p>
        <h3>分类体系</h3>
        <ul>
          ${stats.categories
            .map(
              (c) => `<li><b>${esc(c.name)}</b>：${esc(c.desc)}
              <ul>${c.subs.map((s) => `<li>${esc(s.name)}（${s.count} 篇）—— ${esc(s.desc)}</li>`).join('')}</ul></li>`,
            )
            .join('')}
        </ul>
      </section>

      <section class="doc-card">
        <h2>文献类型：研究型论文与综述</h2>
        <p>除方向与主题外，站点按研究目的把文献分成两类，每类再沿用同一套方向 / 细分逻辑整理：</p>
        <ul>
          ${stats.types
            .map(
              (t) => `<li><b>${esc(t.name)}</b>（${t.count} 篇）：${esc(t.desc)}。入口：<a href="/type/${t.key}/">${esc(t.name)}</a></li>`,
            )
            .join('')}
        </ul>
      </section>

      <section class="doc-card">
        <h2>检索能力</h2>
        <ul>
          <li><b>全字段检索</b>：题名（中英）、中文简介、英文摘要、关键词、作者、期刊统一参与匹配，题名与关键词权重更高。</li>
          <li><b>精确匹配</b>：中文按完整词语检索，<code>水泥</code> 不会拆成“水”“泥”，并自动匹配 <code>cement</code> 等等价术语；英文不区分大小写，化学式（如 <code>BaSO4</code>、<code>SiO2</code>）可直接检索。</li>
          <li><b>筛选</b>：按方向 / 细分主题、文献类型（研究型论文 / 综述）、年份区间、期刊与关键词组合筛选。</li>
          <li><b>排序</b>：检索结果支持相关度、发表时间（新→旧 / 旧→新）。</li>
          <li><b>本地检索</b>：构建时导出文献数据，检索完全在浏览器本地完成，不请求任何外部 API，也不需要后端服务。</li>
        </ul>
      </section>

      <section class="doc-card">
        <h2>题录与导出</h2>
        <p>每篇文献提供完整题录（作者、期刊、年卷期页、DOI、关键词）与中文简介；英文原文摘要随附。
           可一键复制 <b>GB/T 7714</b> 格式题录，或导出 <b>BibTeX</b>、<b>RIS</b>，直接导入 LaTeX、EndNote、Zotero。
           站点另提供全库 BibTeX 批量下载。</p>
      </section>

      <section class="doc-card">
        <h2>数据来源与更新</h2>
        <p>内置库题录元数据（题名、作者、期刊、年卷期页、DOI、英文摘要）通过 OpenAlex 开放元数据接口批量校核；
           中文题名、中文简介、关键词与分类归属由编者依据原文内容整理。网络文献来自公开学术数据库的元数据，
           系统仅保存题录与摘要，<b>不存储、不提供论文全文</b>，原文请通过 DOI 跳转至出版方页面获取。</p>
        <p>数据更新流程：维护者在本地或 GitHub Actions 中运行更新脚本 → 合并新文献并校验 → 重新生成静态页面与检索数据 →
           部署到 Cloudflare Pages。站点每天构建一次，构建失败时保留上一版可用数据。</p>
      </section>

      <section class="doc-card">
        <h2>版权与免责</h2>
        <ul>
          <li>题录信息与摘要的版权归原作者及出版机构所有，本站仅用于学术检索与选题参考，不作商业用途。</li>
          <li>本站不托管 PDF 全文；如需全文请通过 DOI 或期刊官网获取，并遵守出版方的使用条款。</li>
          <li>中文简介为编者整理，可能存在理解偏差，引用前请核对原文。</li>
          <li>收藏夹仅保存在访客本机浏览器（localStorage），不上传、不追踪。</li>
        </ul>
      </section>

      <section class="doc-card">
        <h2>技术架构</h2>
        <p>静态站点生成（Node.js，无运行时框架）+ 浏览器端精确匹配（纯前端检索，不请求外部 API）
           + Cloudflare Pages 托管；无数据库、无服务端 API、无第三方统计脚本、无 Cookie。全站页面可直接缓存与 CDN 分发，日访问 5000 次以内毫无压力。</p>
      </section>

      <section class="doc-card">
        <h2>快捷键</h2>
        <table class="kbd-table">
          <tr><td><code>/</code></td><td>聚焦检索框</td></tr>
          <tr><td><code>Enter</code></td><td>提交检索</td></tr>
          <tr><td><code>Esc</code></td><td>关闭弹窗</td></tr>
        </table>
      </section>
    </div>`;

  return {
    path: '/about/',
    html: renderPage(
      head('关于本站', '辐射制冷文献检索系统的定位、检索能力、数据来源、版权说明与技术架构。', '/about/', 'about', stats, {
        sidebarHtml: sidebar(stats, { activePage: 'about' }),
      }),
      body,
    ),
  };
}

/* ── 文献详情 ───────────────────────────────────────────────────────── */
export function paper(corpus, p) {
  const { stats } = corpus;
  const loc = [p.volume ? `${p.volume}${p.issue ? `(${p.issue})` : ''}` : '', p.pages].filter(Boolean).join(': ');
  const sameTitle = String(p.title_zh || '').trim().toLowerCase() === String(p.title_en || '').trim().toLowerCase();
  const related = relatedPapers(corpus, p);
  const cite = { citation: gbt7714(p), bibtex: bibtex(p), ris: ris(p) };
  const citeJson = JSON.stringify(cite).replace(/</g, '\\u003c');
  const typeKey = p.type === '综述' ? 'review' : 'research';
  const catChip = p.category === 'white' ? 'cat-white' : p.category === 'colored' ? 'cat-colored' : 'cat-transparent';

  const kwLinks = (p.keywords || [])
    .map((k) => `<a class="kw" data-pagefind-filter="keyword:${esc(k)}" href="/search/?kw=${encodeURIComponent(k)}">${esc(k)}</a>`)
    .join(' ');

  const body = `
    ${breadcrumbs([
      { label: '首页', href: '/' },
      { label: p.category_name, href: `/browse/${p.category}/` },
      { label: p.sub_name, href: `/browse/${p.category}/${p.sub}/` },
      { label: p.id },
    ])}

    <article class="detail" data-pagefind-body>
      <div class="detail-head">
        <div class="kicker" data-pagefind-ignore>
          <a class="chip ${catChip}" data-pagefind-filter="category:${p.category}" href="/browse/${p.category}/">${esc(p.category_name)}</a>
          <a class="chip" data-pagefind-filter="sub:${p.sub}" href="/browse/${p.category}/${p.sub}/">${esc(p.sub_name)}</a>
          <span class="chip ${typeKey === 'review' ? 'type' : 'type-academic'}" data-pagefind-filter="type:${typeKey}">${esc(p.type)}</span>
          <span class="chip">${p.year}</span>
        </div>
        <h1 data-pagefind-meta="title">${esc(p.title_zh || p.title_en)}</h1>
        ${sameTitle ? '' : `<div class="en">${esc(p.title_en)}</div>`}
        <div class="detail-authors">${p.authors.map(esc).join('；')}</div>
      </div>
      <div class="detail-body">
        <dl class="meta-table" data-pagefind-ignore>
          <dt>作者</dt><dd data-pagefind-meta="authors">${p.authors.map(esc).join('；')}</dd>
          <dt>期刊</dt><dd data-pagefind-meta="journal"><a href="/search/?journal=${encodeURIComponent(p.journal)}">${esc(p.journal)}</a></dd>
          <dt>年卷期页</dt><dd>${p.year}${loc ? `，${esc(loc)}` : ''}</dd>
          ${p.doi ? `<dt>DOI</dt><dd><a class="mono" href="https://doi.org/${esc(p.doi)}" target="_blank" rel="noopener">${esc(p.doi)}</a></dd>` : ''}
          <dt>关键词</dt><dd>${kwLinks || '—'}</dd>
          <dt>文献编号</dt><dd class="mono">${esc(p.id)}</dd>
          <dt>来源</dt><dd>${esc(p.source)}</dd>
          ${p.enriched_by ? `<dt>中文信息</dt><dd>题名与中文摘要由 <b>${esc(p.enriched_by)}</b> 提供（平台机器翻译），英文原文见题名与英文摘要</dd>` : ''}
        </dl>

        <div class="block">
          <h3 data-pagefind-ignore>中文简介</h3>
          ${p.has_zh_abstract
            ? `<div class="txt">${esc(p.abstract_zh)}</div>`
            : `<div class="txt muted-note">该条为网络收录文献，暂未整理中文简介；可参考下方英文摘要原文。</div>`}
        </div>

        <div class="block">
          <h3 data-pagefind-ignore>英文摘要（原文）</h3>
          ${p.abstract_en
            ? `<div class="txt abstract-en clamp" id="abs-en">${esc(p.abstract_en)}</div>
               <button class="btn ghost sm" id="abs-toggle" type="button" style="margin-top:6px">展开全文 ↓</button>`
            : `<div class="txt abstract-en">该刊未开放英文摘要原文，可点击下方“打开原文”跳转出版方页面查看。</div>`}
        </div>

        <div class="block" data-pagefind-ignore>
          <h3>题录（GB/T 7714）</h3>
          <div class="txt citation-box"><span id="citation-text">${esc(cite.citation)}</span></div>
        </div>

        <div class="detail-acts" data-pagefind-ignore>
          <button class="btn" type="button" data-act="fav" data-id="${esc(p.id)}">☆ 收藏</button>
          <button class="btn" type="button" data-act="copy-cite">复制题录</button>
          <button class="btn" type="button" data-act="download" data-id="${esc(p.id)}" data-fmt="bibtex">BibTeX</button>
          <button class="btn" type="button" data-act="download" data-id="${esc(p.id)}" data-fmt="ris">RIS</button>
          ${p.doi ? `<a class="btn" href="https://doi.org/${esc(p.doi)}" target="_blank" rel="noopener">打开原文</a>` : ''}
        </div>

        ${related.length
          ? `<div class="block" data-pagefind-ignore><h3>相关文献</h3><div class="rel-list">
              ${related
                .map(
                  (r) => `<a class="rel-item" href="/paper/${esc(r.id)}/">
                    <div>${esc(r.title_zh || r.title_en)}</div>
                    <div class="m">${esc(r.journal)} · ${r.year} · ${esc(r.sub_name)}</div>
                  </a>`,
                )
                .join('')}
            </div></div>`
          : ''}
      </div>

      <div class="pf-meta" data-pagefind-ignore hidden>
        <span data-pagefind-filter="year:${p.year}"></span>
        <span data-pagefind-filter="journal:${esc(p.journal)}"></span>
        <span data-pagefind-sort="published:${esc(p.published)}"></span>
        <span data-pagefind-meta="published:${esc(p.published)}"></span>
        <span data-pagefind-meta="year:${p.year}"></span>
        <span data-pagefind-meta="authors_short:${esc(p.authors_short)}"></span>
        <span data-pagefind-meta="category_name:${esc(p.category_name)}"></span>
        <span data-pagefind-meta="sub_name:${esc(p.sub_name)}"></span>
        <span data-pagefind-meta="type_label:${esc(p.type)}"></span>
        <span data-pagefind-meta="source:${esc(p.source)}"></span>
        <span data-pagefind-meta="doi:${esc(p.doi)}"></span>
        <span data-pagefind-meta="keywords:${esc((p.keywords || []).join('、'))}"></span>
      </div>
    </article>
    <script type="application/json" id="paper-cite">${citeJson}</script>`;

  return {
    path: `/paper/${p.id}/`,
    html: renderPage(
      head(p.title_zh || p.title_en, p.excerpt || `${p.journal} ${p.year}`, `/paper/${p.id}/`, '', stats, {
        sidebarHtml: sidebar(stats, { activeCat: p.category, activeSub: p.sub }),
      }),
      body,
    ),
  };
}

/* ── 检索页 ─────────────────────────────────────────────────────────── */
export function searchPage(corpus) {
  const { stats } = corpus;
  const body = `
    ${breadcrumbs([{ label: '首页', href: '/' }, { label: '文献检索' }])}
    <div class="page-head">
      <h1>文献检索</h1>
      <div class="desc">按题名、作者、期刊、关键词与摘要精确匹配全库 ${stats.total} 篇文献；中文按完整词语检索，不会把“水泥”拆成“水”“泥”，并自动匹配 cement 等等价术语。
        可叠加方向（白色 / 彩色 / 透明）、文献类型（研究型论文 / 综述）、年份、期刊与关键词筛选；检索在浏览器本地完成，不请求第三方接口。</div>
    </div>

    <form class="search-main" id="search-form" action="/search/" method="get" role="search">
      <svg class="search-ico" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M13.5 13.5 18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <input id="search-input" name="q" type="search" autocomplete="off" spellcheck="false"
             placeholder="输入完整词语，如：水泥、结构色、BaSO4、radiative cooling paint" aria-label="检索词">
      <button class="btn primary" type="submit">检索</button>
    </form>

    <div class="search-layout">
      <aside class="filters" id="filters" aria-label="筛选条件">
        <details class="filters-details" id="filters-details" open>
          <summary>筛选条件</summary>
          <div class="filters-body" id="filters-body">
            <div class="filters-loading">正在加载筛选项…</div>
          </div>
        </details>
      </aside>
      <section class="results" aria-live="polite">
        <div class="search-status" id="search-status">输入关键词开始检索；留空则浏览全部文献。</div>
        <div class="toolbar">
          <span class="field">排序
            <select id="search-sort">
              <option value="relevance">相关度</option>
              <option value="date_desc">发表时间（新→旧）</option>
              <option value="date_asc">发表时间（旧→新）</option>
            </select>
          </span>
          <span class="grow"></span>
          <button class="btn sm" type="button" id="export-results">导出本页 BibTeX</button>
        </div>
        <div class="result-list" id="results"></div>
        <div id="search-pager"></div>
      </section>
    </div>
    <noscript><div class="empty"><h3>需要启用 JavaScript</h3><p>本站检索在浏览器本地完成，请启用 JavaScript，或使用侧栏的分类浏览。</p></div></noscript>`;

  return {
    path: '/search/',
    html: renderPage(
      head('文献检索', `在 ${stats.total} 篇辐射制冷文献中按题名、作者、期刊、关键词与年份检索。`, '/search/', 'search', stats, {
        sidebarHtml: '',
        scripts: ['/assets/js/search.js'],
      }),
      body,
    ),
  };
}

/* ── 收藏夹（客户端渲染） ────────────────────────────────────────────── */
export function favorites(corpus) {
  const { stats } = corpus;
  const body = `
    ${breadcrumbs([{ label: '首页', href: '/' }, { label: '我的收藏' }])}
    <div class="page-head">
      <h1>我的收藏</h1>
      <div class="desc">收藏保存在本机浏览器（localStorage），不上传服务器，也不会随站点数据更新而丢失。</div>
    </div>
    <div id="fav-page">
      <div class="loading"><span class="spinner"></span>正在读取本地收藏…</div>
    </div>
    <noscript><div class="empty"><h3>需要启用 JavaScript</h3><p>收藏夹保存在本机浏览器，需要启用 JavaScript 才能读取。</p></div></noscript>`;

  return {
    path: '/favorites/',
    html: renderPage(
      head('我的收藏', '保存在本机浏览器的辐射制冷文献收藏。', '/favorites/', 'favorites', stats, {
        sidebarHtml: sidebar(stats, { activePage: 'favorites' }),
        noindex: true,
      }),
      body,
    ),
  };
}

/* ── 404 ────────────────────────────────────────────────────────────── */
export function notFound(corpus) {
  const { stats } = corpus;
  const body = `
    <div class="empty" style="padding:64px 24px">
      <h3 style="font-size:20px">页面不存在（404）</h3>
      <p style="margin-top:8px">链接可能已失效，或该文献编号有误。</p>
      <form class="search-main" action="/search/" method="get" style="max-width:560px;margin:20px auto 0">
        <input name="q" type="search" placeholder="在本站检索文献…" aria-label="检索文献">
        <button class="btn primary" type="submit">检索</button>
      </form>
      <p style="margin-top:18px">
        <a class="btn" href="/">返回首页</a>
        <a class="btn" href="/browse/white/">白色制冷</a>
        <a class="btn" href="/browse/colored/">彩色制冷</a>
        <a class="btn" href="/latest/">最新文献</a>
      </p>
    </div>`;

  return {
    path: '/404.html',
    html: renderPage(
      head('页面不存在', '页面不存在或链接已失效；可在本站检索辐射制冷文献，或返回首页浏览分类。', '/404.html', '', stats, { sidebarHtml: '', noindex: true }),
      body,
    ),
    sitemap: false,
  };
}
