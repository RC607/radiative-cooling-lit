/* 检索页：客户端精确子串匹配 + 筛选。
 * 数据来自 /data/literature.json；不请求任何外部 API，也不依赖分词引擎。
 * 中文查询按完整词语匹配（“水泥”不会拆成“水”“泥”），多词为 AND。
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

/* 中英文术语等价：只扩展完整术语，绝不拆成单字。
 * 例如“水泥”会匹配 cement / cementitious，但不会匹配只含“水”或“泥”的文献。
 */
const SYNONYMS = {
  '水泥': ['cement', 'cementitious', 'concrete'],
  'cement': ['水泥', 'cementitious', 'concrete'],
  '混凝土': ['concrete', 'cementitious', 'cement'],
  'concrete': ['混凝土', 'cementitious', 'cement'],
  '水泥基': ['cementitious', 'cement-based'],
  '织物': ['textile', 'fabric', 'cloth'],
  '纺织品': ['textile', 'fabric'],
  '面料': ['fabric', 'textile'],
  'textile': ['织物', '纺织品', 'fabric'],
  'fabric': ['织物', '面料', 'textile'],
  '涂料': ['coating', 'paint'],
  '涂层': ['coating', 'paint'],
  'coating': ['涂料', '涂层'],
  'paint': ['涂料', '涂层'],
  '薄膜': ['film', 'membrane'],
  'film': ['薄膜', 'membrane'],
  'membrane': ['薄膜'],
  '陶瓷': ['ceramic'],
  'ceramic': ['陶瓷'],
  '聚合物': ['polymer', 'polymeric'],
  '高分子': ['polymer', 'polymeric'],
  'polymer': ['聚合物', '高分子'],
  '无机': ['inorganic'],
  'inorganic': ['无机'],
  '自适应': ['adaptive', 'switchable'],
  'adaptive': ['自适应', 'switchable'],
  'switchable': ['自适应', '可切换'],
  '彩色': ['colored', 'colour', 'color'],
  'colored': ['彩色'],
  'color': ['彩色'],
  'colour': ['彩色'],
  '透明': ['transparent', 'transparency'],
  'transparent': ['透明'],
  '辐射制冷': ['radiative cooling'],
  '辐射冷却': ['radiative cooling'],
  'radiative cooling': ['辐射制冷', '辐射冷却'],
  '被动辐射制冷': ['passive radiative cooling'],
  '被动辐射冷却': ['passive radiative cooling'],
  'passive radiative cooling': ['被动辐射制冷', '被动辐射冷却'],
  '日间辐射制冷': ['daytime radiative cooling'],
  'daytime radiative cooling': ['日间辐射制冷'],
  '彩色辐射制冷': ['colored radiative cooling'],
  'colored radiative cooling': ['彩色辐射制冷'],
  '透明辐射制冷': ['transparent radiative cooling'],
  'transparent radiative cooling': ['透明辐射制冷'],
  '结构色': ['structural color', 'structural colour'],
  'structural color': ['结构色'],
  'structural colour': ['结构色'],
  '被动': ['passive'],
  'passive': ['被动'],
  '日间': ['daytime'],
  'daytime': ['日间'],
  '建筑': ['building', 'architecture'],
  'building': ['建筑'],
  '可穿戴': ['wearable'],
  'wearable': ['可穿戴'],
  '气凝胶': ['aerogel'],
  'aerogel': ['气凝胶'],
  '多孔': ['porous'],
  'porous': ['多孔'],
  '颜料': ['pigment'],
  'pigment': ['颜料'],
  '染料': ['dye'],
  'dye': ['染料'],
  '荧光': ['fluorescent', 'fluorescence', 'photoluminescent'],
  'fluorescent': ['荧光'],
  '发射率': ['emissivity'],
  'emissivity': ['发射率'],
  '太阳': ['solar'],
  'solar': ['太阳'],
  '智能窗': ['smart window', 'thermochromic'],
  'smart window': ['智能窗'],
  '热致变色': ['thermochromic'],
  'thermochromic': ['热致变色'],
};

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
let CORPUS = [];
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

/* 归一化：大小写、全半角、标点统一为空格；保留所有文字与数字。 */
function norm(value) {
  return String(value == null ? '' : value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function queryTerms(q) {
  return [...new Set(norm(q).split(' ').filter(Boolean))];
}

function variantsOf(term) {
  const key = String(term || '').toLowerCase();
  return [...new Set([key, ...(SYNONYMS[key] || []).map(norm)].filter(Boolean))];
}

/* 整句优先：已知术语/短语作为一个匹配组；否则按空格拆分，多词 AND。 */
function buildGroups(q) {
  const phrase = norm(q);
  if (phrase && SYNONYMS[phrase]) return [{ original: phrase, variants: variantsOf(phrase) }];
  return queryTerms(q).map((term) => ({ original: term, variants: variantsOf(term) }));
}

function countOf(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count += 1;
    pos += needle.length;
  }
  return count;
}

/* 中文用子串匹配；拉丁字母/数字按词边界匹配，避免 cement 命中 placement/replacement。 */
const CJK_RE = /\p{Script=Han}/u;

function includesTerm(haystack, term) {
  if (!term) return false;
  if (CJK_RE.test(term)) return haystack.includes(term);
  return new RegExp(`(^| )${escapeReg(term)}( |$)`).test(haystack);
}

function countTerm(haystack, term) {
  if (!term) return 0;
  if (CJK_RE.test(term)) return countOf(haystack, term);
  const re = new RegExp(`(?:^| )${escapeReg(term)}(?= |$)`, 'g');
  return (haystack.match(re) || []).length;
}

function toast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2200);
}

/* ── 数据加载 ───────────────────────────────────────────────────────── */
async function loadData() {
  const [metaRes, corpusRes] = await Promise.all([
    fetch('/data/meta.json', { headers: { Accept: 'application/json' } }),
    fetch('/data/literature.json', { headers: { Accept: 'application/json' } }),
  ]);
  if (!metaRes.ok) throw new Error(`元数据加载失败（HTTP ${metaRes.status}）`);
  if (!corpusRes.ok) throw new Error(`文献数据加载失败（HTTP ${corpusRes.status}）`);

  META = await metaRes.json();
  CORPUS = await corpusRes.json();
  const s = META.stats;
  OPTIONS = {
    categories: s.categories || [],
    types: s.types || [],
    years: s.years || [],
    journals: s.journals_list || [],
    keywords: s.keywords || [],
  };

  for (const rec of CORPUS) {
    const zhAbstract = /^（网络收录/.test(String(rec.abstract_zh || '')) ? '' : rec.abstract_zh;
    rec._title = norm(`${rec.title_zh || ''} ${rec.title_en || ''}`);
    rec._authors = norm((rec.authors || []).join(' '));
    rec._journal = norm(rec.journal || '');
    rec._keywords = norm((rec.keywords || []).join(' '));
    rec._abstract = norm(`${zhAbstract || ''} ${rec.abstract_en || ''}`);
    rec._all = [rec._title, rec._authors, rec._journal, rec._keywords, rec._abstract].filter(Boolean).join(' ');
  }
}

/* ── 筛选与检索 ─────────────────────────────────────────────────────── */
function passesFilters(rec) {
  if (state.cat && rec.category !== state.cat) return false;
  if (state.sub && rec.sub !== state.sub) return false;
  if (state.type) {
    const key = rec.type === '综述' ? 'review' : 'research';
    if (key !== state.type) return false;
  }
  if (state.journal && rec.journal !== state.journal) return false;
  if (state.keywords.length) {
    const set = new Set(rec.keywords || []);
    if (!state.keywords.every((k) => set.has(k))) return false;
  }
  const year = Number(rec.year);
  const from = parseInt(state.yearFrom, 10);
  const to = parseInt(state.yearTo, 10);
  if (Number.isFinite(from) && year < from) return false;
  if (Number.isFinite(to) && year > to) return false;
  return true;
}

function scoreRecord(rec, groups) {
  let score = 0;
  for (const group of groups) {
    for (const term of group.variants) {
      if (includesTerm(rec._title, term)) score += 100 + Math.min(40, countTerm(rec._title, term) * 8);
      if (includesTerm(rec._keywords, term)) score += 60 + Math.min(20, countTerm(rec._keywords, term) * 4);
      if (includesTerm(rec._authors, term)) score += 50;
      if (includesTerm(rec._journal, term)) score += 40;
      if (includesTerm(rec._abstract, term)) score += 12 + Math.min(12, countTerm(rec._abstract, term) * 2);
    }
    if (group.original && includesTerm(rec._title, group.original)) score += 20;
  }
  return score;
}

function sortResults(mode) {
  const byDate = (a, b) => String(a.rec.published || a.rec.year || '').localeCompare(String(b.rec.published || b.rec.year || ''));
  if (mode === 'relevance') {
    RESULTS.sort((a, b) => b.score - a.score || byDate(b, a) || String(a.rec.title_zh).localeCompare(String(b.rec.title_zh), 'zh-CN'));
  } else if (mode === 'date_asc') {
    RESULTS.sort((a, b) => byDate(a, b));
  } else {
    RESULTS.sort((a, b) => byDate(b, a));
  }
}

function setStatus(html) {
  const el = $('#search-status');
  if (el) el.innerHTML = html;
}

function runSearch() {
  const seq = ++searchSeq;
  setStatus('正在检索…');
  const root = $('#results');
  if (root) root.innerHTML = '<div class="loading"><span class="spinner"></span>正在检索…</div>';

  try {
    const q = state.q.trim();
    const groups = buildGroups(q);
    const hasQuery = groups.length > 0;
    const synonymTerms = [...new Set(
      groups.flatMap((group) => group.variants.filter((term) => term !== group.original)),
    )].slice(0, 3);
    const t0 = performance.now();

    let list = CORPUS.filter(passesFilters);
    if (hasQuery) {
      list = list.filter((rec) => groups.every((group) => group.variants.some((term) => {
        if (term === group.original) return includesTerm(rec._all, term);
        /* 等价词只匹配题名与关键词，避免摘要里偶然出现的水泥/混凝土被误收 */
        return includesTerm(rec._title, term) || includesTerm(rec._keywords, term);
      })));
    }

    RESULTS = list.map((rec) => ({ rec, score: hasQuery ? scoreRecord(rec, groups) : 0 }));
    const mode = state.sort === 'relevance' && hasQuery ? 'relevance' : state.sort === 'date_asc' ? 'date_asc' : 'date_desc';
    sortResults(mode);

    LAST = {
      total: RESULTS.length,
      took: Math.round(performance.now() - t0),
      q,
      groups,
      highlight: [...new Set(groups.flatMap((group) => group.variants))],
      hasSynonym: synonymTerms.length > 0,
      synonymLabel: synonymTerms.join(' / '),
    };
    state.page = Math.min(state.page, Math.max(1, Math.ceil(RESULTS.length / PAGE_SIZE)));
    if (seq !== searchSeq) return;
    renderPage(seq);
  } catch (err) {
    if (seq !== searchSeq) return;
    setStatus(`<b>检索失败</b>：${esc(err.message)}`);
    if (root) {
      root.innerHTML = `<div class="empty"><h3>检索数据不可用</h3>
        <p>${esc(err.message)}</p>
        <p style="margin-top:8px">本地预览请先运行 <code>npm run build</code>。</p></div>`;
    }
    const pager = $('#search-pager');
    if (pager) pager.innerHTML = '';
  }
}

function renderPage(seq = searchSeq) {
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
  if (LAST.hasSynonym) bits.push(`含术语等价：${esc(LAST.synonymLabel)}`);
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
    const hint = LAST.q
      ? `没有文献的题名、作者、期刊、关键词或摘要完整包含“${esc(LAST.q)}”或对应英文术语。`
      : '当前筛选条件下没有文献。';
    root.innerHTML = `<div class="empty"><h3>没有匹配的文献</h3>
      <p>${hint}</p>
      <p>可尝试更短的词、减少限定词，或使用右侧的关键词筛选。</p>
      <p style="margin-top:12px"><button class="btn" type="button" id="clear-all">清除全部筛选</button></p></div>`;
    const pager = $('#search-pager');
    if (pager) pager.innerHTML = '';
    return;
  }

  const terms = LAST.highlight || [];
  PAGE_IDS = slice.map((x) => x.rec.id);
  root.innerHTML = slice.map((x) => cardHtml(x.rec, terms)).join('');
  renderPager(page, pages);
}

function excerptOf(rec, terms) {
  let text = String(rec.abstract_zh || '').trim();
  if (!text || text.startsWith('（网络收录')) text = String(rec.abstract_en || '').trim();
  if (!text) text = `${rec.title_zh || ''} ${rec.title_en || ''}`.trim();

  let pos = -1;
  for (const term of terms) {
    if (!term) continue;
    let hit = -1;
    if (CJK_RE.test(term)) hit = text.toLowerCase().indexOf(term.toLowerCase());
    else {
      const m = text.match(new RegExp(`\\b${escapeReg(term)}\\b`, 'i'));
      hit = m ? m.index : -1;
    }
    if (hit >= 0 && (pos < 0 || hit < pos)) pos = hit;
  }
  if (pos < 0) pos = 0;
  const start = Math.max(0, pos - 70);
  const end = Math.min(text.length, start + 240);
  const snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${hl(snippet, terms)}${end < text.length ? '…' : ''}`;
}

function cardHtml(rec, terms) {
  const id = rec.id;
  const catChip = rec.category === 'white' ? 'cat-white' : rec.category === 'colored' ? 'cat-colored' : 'cat-transparent';
  const typeKey = rec.type === '综述' ? 'review' : 'research';
  const title = rec.title_zh || rec.title_en || '';
  const authors = rec.authors_short || (rec.authors || []).join('；');
  const journal = rec.journal || '';
  const published = rec.published || rec.year || '';
  const doi = rec.doi || '';
  const keywords = (rec.keywords || []).slice(0, 4);
  const excerpt = excerptOf(rec, terms);
  return `
  <article class="paper" data-id="${esc(id)}">
    <div class="paper-top">
      <div class="idx">${esc(id)}</div>
      <div class="paper-body">
        <a class="paper-title" href="/paper/${esc(id)}/">${hl(title, terms)}</a>
        ${authors ? `<div class="paper-authors">${esc(authors)}</div>` : ''}
        <div class="paper-meta">
          <span class="chip ${catChip}">${esc(rec.category_name || '')}</span>
          <span class="chip">${esc(rec.sub_name || '')}</span>
          <span class="chip ${typeKey === 'review' ? 'type' : 'type-academic'}">${esc(rec.type || '')}</span>
          ${rec.source && rec.source !== '内置库' ? `<span class="chip source">${esc(rec.source)}</span>` : ''}
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
  setStatus('正在加载检索数据…');
  try {
    await loadData();
  } catch (err) {
    setStatus(`<b>数据加载失败</b>：${esc(err.message)}`);
    return;
  }
  renderFilters();
  bind();
  runSearch();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
})();
