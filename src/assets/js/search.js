/* 检索页：Pagefind 构建期索引 + 纯前端筛选。
 * 不请求任何外部 API；索引文件随站点发布。
 */
'use strict';

(() => {
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const PAGE_SIZE = 20;
const CATS = [
  { key: 'white', name: '白色辐射制冷', chip: 'cat-white' },
  { key: 'colored', name: '彩色辐射制冷', chip: 'cat-colored' },
  { key: 'transparent', name: '透明辐射制冷', chip: 'cat-transparent' },
];
const TYPE_NAMES = { research: '研究型论文', review: '综述' };

const state = {
  q: '',
  cat: '',
  sub: '',
  type: '',
  yearFrom: '',
  yearTo: '',
  journal: '',
  keywords: [],
  sort: 'relevance',
  page: 1,
};

let META = null;
let OPTIONS = { categories: [], types: [], years: [], journals: [], keywords: [] };
let pagefind = null;
let pagefindPromise = null;
let RESULTS = [];
let LAST = { total: 0, took: 0, q: '' };
let PAGE_IDS = [];
let searchSeq = 0;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function escapeReg(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hl(text, terms) {
  const raw = String(text == null ? '' : text);
  const list = [...new Set((terms || []).filter((t) => t && t.length >= 1))].sort((a, b) => b.length - a.length);
  if (!list.length) return esc(raw);
  try {
    const re = new RegExp('(' + list.map(escapeReg).join('|') + ')', 'gi');
    return raw.split(re).map((part, i) => (i % 2 === 1 ? '<mark>' + esc(part) + '</mark>' : esc(part))).join('');
  } catch (e) {
    return esc(raw);
  }
}

function termsOf(q) {
  return [...new Set(String(q || '').trim().split(/\s+/).filter(Boolean))];
}

function toast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2200);
}

/* ── 元数据与 Pagefind 加载 ─────────────────────────────────────────── */
async function loadMeta() {
  const res = await fetch('/data/meta.json', { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`元数据加载失败（HTTP ${res.status}）`);
  META = await res.json();
  const s = META.stats;
  OPTIONS = {
    categories: s.categories || [],
    types: s.types || [],
    years: s.years || [],
    journals: s.journals_list || [],
    keywords: s.keywords || [],
  };
}

async function getPagefind() {
  if (pagefind) return pagefind;
  if (!pagefindPromise) {
    pagefindPromise = import('/pagefind/pagefind.js').then(async (mod) => {
      if (typeof mod.init === 'function') await mod.init();
      pagefind = mod;
      return mod;
    }).catch((err) => {
      pagefindPromise = null;
      throw new Error(`检索索引加载失败：${err.message}。请先运行 npm run build 生成 Pagefind 索引。`);
    });
  }
  return pagefindPromise;
}

/* ── 查询与筛选 ─────────────────────────────────────────────────────── */
function buildFilters() {
  const filters = {};
  if (state.cat) filters.category = state.cat;
  if (state.sub) filters.sub = state.sub;
  if (state.type) filters.type = state.type;
  if (state.journal) filters.journal = state.journal;
  if (state.keywords.length) filters.keyword = state.keywords.slice();
  const years = yearValues();
  if (years) filters.year = { any: years };
  return filters;
}

function yearValues() {
  const from = parseInt(state.yearFrom, 10);
  const to = parseInt(state.yearTo, 10);
  if (!Number.isFinite(from) && !Number.isFinite(to)) return null;
  const all = OPTIONS.years.map((y) => Number(y.year)).filter(Number.isFinite);
  if (!all.length) return null;
  let start = Number.isFinite(from) ? from : Math.min(...all);
  let end = Number.isFinite(to) ? to : Math.max(...all);
  if (start > end) [start, end] = [end, start];
  start = Math.max(1900, start);
  end = Math.min(2100, end);
  const out = [];
  for (let y = start; y <= end; y += 1) out.push(String(y));
  return out;
}

function setStatus(html) {
  const el = $('#search-status');
  if (el) el.innerHTML = html;
}

async function runSearch() {
  const seq = ++searchSeq;
  setStatus('正在检索…');
  const root = $('#results');
  if (root) root.innerHTML = '<div class="loading"><span class="spinner"></span>正在检索…</div>';

  try {
    const pf = await getPagefind();
    const q = state.q.trim();
    const filters = buildFilters();
    const options = {};
    if (Object.keys(filters).length) options.filters = filters;

    const effectiveSort = !q && state.sort === 'relevance' ? 'date_desc' : state.sort;
    if (effectiveSort === 'date_desc') options.sort = { published: 'desc' };
    else if (effectiveSort === 'date_asc') options.sort = { published: 'asc' };

    const t0 = performance.now();
    const search = await pf.search(q || null, options);
    if (seq !== searchSeq) return;
    RESULTS = search.results || [];
    LAST = { total: RESULTS.length, took: Math.round(performance.now() - t0), q };
    state.page = Math.min(state.page, Math.max(1, Math.ceil(RESULTS.length / PAGE_SIZE)));
    await renderPage(seq);
  } catch (err) {
    if (seq !== searchSeq) return;
    setStatus(`<b>检索失败</b>：${esc(err.message)}`);
    const root = $('#results');
    if (root) {
      root.innerHTML = `<div class="empty"><h3>检索索引不可用</h3>
        <p>${esc(err.message)}</p>
        <p style="margin-top:8px">本地预览请先运行 <code>npm install &amp;&amp; npm run build</code>。</p></div>`;
    }
    const pager = $('#search-pager');
    if (pager) pager.innerHTML = '';
  }
}

async function renderPage(seq = searchSeq) {
  const pages = Math.max(1, Math.ceil(LAST.total / PAGE_SIZE));
  const page = Math.min(Math.max(1, state.page), pages);
  const slice = RESULTS.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const bits = [];
  const filtered = Boolean(
    state.cat || state.sub || state.type || state.journal || state.keywords.length || state.yearFrom || state.yearTo,
  );
  if (LAST.q) bits.push(`命中 <b>${LAST.total}</b> 篇`);
  else if (filtered) bits.push(`筛选出 <b>${LAST.total}</b> 篇`);
  else bits.push(`全部 <b>${LAST.total}</b> 篇`);
  bits.push(`用时 ${LAST.took > 0 ? LAST.took : '<1'} ms`);
  const active = [];
  if (state.cat) active.push(CATS.find((c) => c.key === state.cat)?.name);
  if (state.type) active.push(TYPE_NAMES[state.type]);
  if (state.journal) active.push(state.journal);
  if (state.keywords.length) active.push(state.keywords.join(' + '));
  if (active.length) bits.push(`筛选：${active.map(esc).join(' / ')}`);
  setStatus(bits.join(' · '));

  const root = $('#results');
  if (!root) return;

  if (!slice.length) {
    root.innerHTML = `<div class="empty"><h3>没有匹配的文献</h3>
      <p>可尝试更短的关键词（如“结构色”“BaSO4”“织物”），或清除年份、期刊与关键词筛选。</p>
      <p style="margin-top:12px"><button class="btn" type="button" id="clear-all">清除全部筛选</button></p></div>`;
    const pager = $('#search-pager');
    if (pager) pager.innerHTML = '';
    return;
  }

  const terms = termsOf(LAST.q);
  const items = await Promise.all(
    slice.map((r) => r.data().then((d) => ({ ...d, _id: idFromUrl(d.url) })).catch(() => null)),
  );
  if (seq !== searchSeq) return;
  const valid = items.filter(Boolean);
  PAGE_IDS = valid.map((d) => d._id);

  root.innerHTML = valid.map((d) => cardHtml(d, terms)).join('');
  renderPager(page, pages);
}

function idFromUrl(url) {
  const parts = String(url || '').split('/').filter(Boolean);
  return decodeURIComponent(parts[parts.length - 1] || '');
}

function cardHtml(d, terms) {
  const m = d.meta || {};
  const id = d._id;
  const cat = (d.filters && d.filters.category && d.filters.category[0]) || '';
  const catChip = cat === 'white' ? 'cat-white' : cat === 'colored' ? 'cat-colored' : 'cat-transparent';
  const typeLabel = m.type_label || '';
  const typeKey = typeLabel === '综述' ? 'review' : 'research';
  const title = m.title || '';
  const authors = m.authors_short || m.authors || '';
  const journal = m.journal || '';
  const year = m.year || '';
  const published = m.published || year;
  const doi = m.doi || '';
  const keywords = (m.keywords || '').split('、').map((x) => x.trim()).filter(Boolean).slice(0, 4);
  const excerpt = d.excerpt || '';
  return `
  <article class="paper" data-id="${esc(id)}">
    <div class="paper-top">
      <div class="idx">${esc(id)}</div>
      <div class="paper-body">
        <a class="paper-title" href="/paper/${esc(id)}/">${hl(title, terms)}</a>
        ${authors ? `<div class="paper-authors">${esc(authors)}</div>` : ''}
        <div class="paper-meta">
          <span class="chip ${catChip}">${esc(m.category_name || '')}</span>
          <span class="chip">${esc(m.sub_name || '')}</span>
          <span class="chip ${typeKey === 'review' ? 'type' : 'type-academic'}">${esc(typeLabel)}</span>
          ${m.source && m.source !== '内置库' ? `<span class="chip source">${esc(m.source)}</span>` : ''}
          <span class="sep">·</span><span class="jrn">${hl(journal, terms)}</span>
          <span class="sep">·</span><span>${esc(published)}</span>
          ${doi ? `<span class="sep">·</span><span class="doi">${esc(doi)}</span>` : ''}
        </div>
        ${excerpt ? `<div class="paper-snippet">${excerpt}</div>` : ''}
        <div class="paper-foot">
          <div class="kw-cloud">${keywords
            .map((k) => `<a class="kw" href="/search/?kw=${encodeURIComponent(k)}">${esc(k)}</a>`).join('')}</div>
          <span class="sp"></span>
          <div class="paper-acts">
            <button class="icon-btn" type="button" data-act="fav" data-id="${esc(id)}" title="收藏">☆</button>
            <button class="btn sm" type="button" data-act="cite" data-id="${esc(id)}">题录</button>
            <a class="btn sm" href="/paper/${esc(id)}/">详情</a>
          </div>
        </div>
      </div>
    </div>
  </article>`;
}

function renderPager(page, pages) {
  const pager = $('#search-pager');
  if (!pager) return;
  if (pages <= 1) {
    pager.innerHTML = '';
    return;
  }
  const nums = [];
  let ellipsis = false;
  for (let n = 1; n <= pages; n += 1) {
    if (n === 1 || n === pages || Math.abs(n - page) <= 2) {
      nums.push(`<button class="pg${n === page ? ' on' : ''}" type="button" data-page="${n}">${n}</button>`);
      ellipsis = false;
    } else if (!ellipsis) {
      nums.push('<span class="pg dis">…</span>');
      ellipsis = true;
    }
  }
  pager.innerHTML = `<nav class="pager" aria-label="分页">
    <button class="pg${page <= 1 ? ' dis' : ''}" type="button" data-page="${Math.max(1, page - 1)}">上一页</button>
    ${nums.join('')}
    <button class="pg${page >= pages ? ' dis' : ''}" type="button" data-page="${Math.min(pages, page + 1)}">下一页</button>
    <span class="info">第 ${page} / ${pages} 页</span>
  </nav>`;
}

/* ── 筛选面板 ───────────────────────────────────────────────────────── */
function optionRow(name, value, label, count, checked) {
  return `<label class="filter-row">
    <input type="radio" name="${name}" value="${esc(value)}"${checked ? ' checked' : ''}>
    <span>${esc(label)}</span>${count !== undefined ? `<span class="cnt">${count}</span>` : ''}
  </label>`;
}

function renderFilters() {
  const box = $('#filters-body');
  if (!box || !META) return;
  const total = META.stats.total;
  const catCount = (key) => OPTIONS.categories.find((c) => c.key === key)?.count || 0;
  const typeCount = (key) => OPTIONS.types.find((t) => t.key === key)?.count || 0;

  const subOption = (s) => `<option value="${esc(s.key)}"${state.sub === s.key ? ' selected' : ''}>${esc(s.name)}（${s.count}）</option>`;
  const subOptions = state.cat
    ? (OPTIONS.categories.find((c) => c.key === state.cat)?.subs || []).map(subOption).join('')
    : OPTIONS.categories.map((c) => {
        if (!c.subs.length) return '';
        return `<optgroup label="${esc(c.name)}">${c.subs.map(subOption).join('')}</optgroup>`;
      }).join('');

  box.innerHTML = `
    <div class="filter-card">
      <div class="filter-title">方向 <button class="reset" type="button" data-reset="cat">重置</button></div>
      ${optionRow('cat', '', '全部方向', total, !state.cat)}
      ${CATS.map((c) => optionRow('cat', c.key, c.name, catCount(c.key), state.cat === c.key)).join('')}
    </div>

    <div class="filter-card">
      <div class="filter-title">文献类型 <button class="reset" type="button" data-reset="type">重置</button></div>
      ${optionRow('type', '', '全部类型', total, !state.type)}
      ${OPTIONS.types.map((t) => optionRow('type', t.key, t.name, typeCount(t.key), state.type === t.key)).join('')}
    </div>

    <div class="filter-card">
      <div class="filter-title">细分主题 <button class="reset" type="button" data-reset="sub">重置</button></div>
      <select class="filter-select" id="f-sub" aria-label="细分主题">
        <option value="">全部细分</option>
        ${subOptions}
      </select>
    </div>

    <div class="filter-card">
      <div class="filter-title">年份 <button class="reset" type="button" data-reset="year">重置</button></div>
      <div class="year-range">
        <input type="number" id="f-year-from" value="${esc(state.yearFrom)}" placeholder="${OPTIONS.years.at(-1)?.year || 1900}" min="1900" max="2100" aria-label="起始年份">
        <span>—</span>
        <input type="number" id="f-year-to" value="${esc(state.yearTo)}" placeholder="${OPTIONS.years[0]?.year || 2100}" min="1900" max="2100" aria-label="结束年份">
      </div>
    </div>

    <div class="filter-card">
      <div class="filter-title">期刊 <button class="reset" type="button" data-reset="journal">重置</button></div>
      <select class="filter-select" id="f-journal" aria-label="期刊">
        <option value="">全部期刊</option>
        ${OPTIONS.journals.map((j) => `<option value="${esc(j.name)}"${state.journal === j.name ? ' selected' : ''}>${esc(j.name)}（${j.count}）</option>`).join('')}
      </select>
    </div>

    <div class="filter-card">
      <div class="filter-title">关键词 <button class="reset" type="button" data-reset="kw">重置</button></div>
      <input class="filter-input" id="f-kw" type="search" autocomplete="off" placeholder="输入关键词后选择，如 结构色">
      <div class="kw-suggest" id="kw-suggest" hidden></div>
      <div class="kw-selected" id="kw-selected">${state.keywords
        .map((k) => `<button class="kw" type="button" data-kw="${esc(k)}">${esc(k)}</button>`)
        .join('')}</div>
    </div>`;

  bindFilterEvents();
}

function bindFilterEvents() {
  for (const radio of $$('#filters input[type="radio"]')) {
    radio.addEventListener('change', () => {
      state[radio.name] = radio.value;
      if (radio.name === 'cat') state.sub = '';
      state.page = 1;
      sync();
      renderFilters();
      runSearch();
    });
  }

  const sub = $('#f-sub');
  if (sub) sub.addEventListener('change', () => {
    state.sub = sub.value;
    state.page = 1;
    sync();
    runSearch();
  });

  const journal = $('#f-journal');
  if (journal) journal.addEventListener('change', () => {
    state.journal = journal.value;
    state.page = 1;
    sync();
    runSearch();
  });

  let yearTimer = null;
  for (const [id, key] of [['#f-year-from', 'yearFrom'], ['#f-year-to', 'yearTo']]) {
    const input = $(id);
    if (!input) continue;
    input.addEventListener('input', () => {
      clearTimeout(yearTimer);
      yearTimer = setTimeout(() => {
        state[key] = input.value.trim();
        state.page = 1;
        sync();
        runSearch();
      }, 300);
    });
  }

  const kw = $('#f-kw');
  if (kw) {
    kw.addEventListener('input', () => renderKwSuggest(kw.value.trim()));
    kw.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const first = $('#kw-suggest button');
        if (first) first.click();
      }
    });
  }

  const selected = $('#kw-selected');
  if (selected) selected.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-kw]');
    if (!btn) return;
    state.keywords = state.keywords.filter((k) => k !== btn.dataset.kw);
    state.page = 1;
    sync();
    renderFilters();
    runSearch();
  });

  for (const reset of $$('#filters [data-reset]')) {
    reset.addEventListener('click', () => {
      const what = reset.dataset.reset;
      if (what === 'cat') { state.cat = ''; state.sub = ''; }
      if (what === 'type') state.type = '';
      if (what === 'sub') state.sub = '';
      if (what === 'year') { state.yearFrom = ''; state.yearTo = ''; }
      if (what === 'journal') state.journal = '';
      if (what === 'kw') state.keywords = [];
      state.page = 1;
      sync();
      renderFilters();
      runSearch();
    });
  }
}

function renderKwSuggest(q) {
  const box = $('#kw-suggest');
  if (!box) return;
  const query = q.toLowerCase();
  if (!query) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  const hits = OPTIONS.keywords
    .filter((k) => k.name.toLowerCase().includes(query) && !state.keywords.includes(k.name))
    .slice(0, 10);
  if (!hits.length) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  box.innerHTML = hits
    .map((k) => `<button type="button" class="kw" data-add="${esc(k.name)}">${esc(k.name)}<b>${k.count}</b></button>`)
    .join('');
  box.hidden = false;
  box.onclick = (e) => {
    const btn = e.target.closest('[data-add]');
    if (!btn) return;
    if (!state.keywords.includes(btn.dataset.add)) state.keywords.push(btn.dataset.add);
    const input = $('#f-kw');
    if (input) input.value = '';
    box.hidden = true;
    state.page = 1;
    sync();
    renderFilters();
    runSearch();
  };
}

/* ── URL 同步 ───────────────────────────────────────────────────────── */
function readURL() {
  const p = new URLSearchParams(location.search);
  state.q = p.get('q') || '';
  state.cat = p.get('cat') || '';
  state.sub = p.get('sub') || '';
  state.type = p.get('type') || '';
  state.yearFrom = p.get('year_from') || '';
  state.yearTo = p.get('year_to') || '';
  state.journal = p.get('journal') || '';
  state.keywords = p.getAll('kw').filter(Boolean);
  state.sort = p.get('sort') || (state.q ? 'relevance' : 'date_desc');
  state.page = Math.max(1, parseInt(p.get('page') || '1', 10) || 1);
}

function sync() {
  const p = new URLSearchParams();
  if (state.q.trim()) p.set('q', state.q.trim());
  if (state.cat) p.set('cat', state.cat);
  if (state.sub) p.set('sub', state.sub);
  if (state.type) p.set('type', state.type);
  if (state.yearFrom) p.set('year_from', state.yearFrom);
  if (state.yearTo) p.set('year_to', state.yearTo);
  if (state.journal) p.set('journal', state.journal);
  for (const k of state.keywords) p.append('kw', k);
  if (state.sort) p.set('sort', state.sort);
  if (state.page > 1) p.set('page', String(state.page));
  const qs = p.toString();
  history.replaceState(null, '', '/search/' + (qs ? `?${qs}` : ''));
}

/* ── 事件 ───────────────────────────────────────────────────────────── */
function bind() {
  const form = $('#search-form');
  const input = $('#search-input');
  if (input) input.value = state.q;
  if (form && input) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      state.q = input.value;
      state.page = 1;
      sync();
      runSearch();
    });
  }

  if (input) {
    let timer = null;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.q = input.value;
        state.page = 1;
        sync();
        runSearch();
      }, 180);
    });
  }

  const sort = $('#search-sort');
  if (sort) {
    sort.value = state.sort;
    sort.addEventListener('change', () => {
      state.sort = sort.value;
      state.page = 1;
      sync();
      runSearch();
    });
  }

  const pager = $('#search-pager');
  if (pager) pager.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-page]');
    if (!btn) return;
    state.page = Number(btn.dataset.page) || 1;
    sync();
    renderPage();
    const box = $('.results');
    if (box) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('#clear-all')) {
      state.cat = '';
      state.sub = '';
      state.type = '';
      state.yearFrom = '';
      state.yearTo = '';
      state.journal = '';
      state.keywords = [];
      state.page = 1;
      sync();
      renderFilters();
      runSearch();
    }
  });

  const exportBtn = $('#export-results');
  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      if (!PAGE_IDS.length) {
        toast('当前页没有可导出的文献');
        return;
      }
      try {
        const res = await fetch('/data/citations.json', { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error('题录数据加载失败');
        const all = await res.json();
        const text = PAGE_IDS.map((id) => all[id] && all[id].bibtex).filter(Boolean).join('\n\n');
        if (!text) throw new Error('没有可导出的题录');
        const blob = new Blob([text + '\n'], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'radiative-cooling-page.bib';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast(`已导出 ${PAGE_IDS.length} 条 BibTeX`);
      } catch (err) {
        toast(err.message);
      }
    });
  }
}

async function boot() {
  readURL();
  setStatus('正在加载检索索引…');
  try {
    await loadMeta();
  } catch (err) {
    setStatus(`<b>元数据加载失败</b>：${esc(err.message)}`);
    return;
  }
  renderFilters();
  bind();
  await runSearch();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
})();
