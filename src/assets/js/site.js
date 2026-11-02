/* 全站只读交互：导航、收藏（localStorage）、题录弹窗、导出、筛选。
 * 不发任何写请求，不依赖后端。
 */
'use strict';

(() => {
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const FAV_KEY = 'rc-favs';
const state = { favs: new Set(loadFavs()), cite: null, citePromise: null, current: null };

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function loadFavs() {
  try {
    const v = JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch (e) {
    return [];
  }
}

function saveFavs() {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify([...state.favs]));
  } catch (e) {
    /* 隐私模式忽略 */
  }
  syncFavCount();
}

function syncFavCount() {
  const n = String(state.favs.size);
  for (const el of [$('#fav-count'), $('#side-fav')]) {
    if (el) el.textContent = n;
  }
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制到剪贴板');
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      toast('已复制到剪贴板');
    } catch (e2) {
      toast('复制失败，请手动选择文本');
    }
    ta.remove();
  }
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function loadCitations() {
  if (state.cite) return state.cite;
  if (!state.citePromise) {
    state.citePromise = fetch('/data/citations.json', { headers: { Accept: 'application/json' } })
      .then((r) => {
        if (!r.ok) throw new Error('题录数据加载失败');
        return r.json();
      })
      .then((data) => {
        state.cite = data;
        return data;
      })
      .catch((err) => {
        state.citePromise = null;
        throw err;
      });
  }
  return state.citePromise;
}

/* ── 收藏 ───────────────────────────────────────────────────────────── */
function favCard(p) {
  const sameTitle = String(p.title_zh || '').toLowerCase() === String(p.title_en || '').toLowerCase();
  return `
  <article class="paper" data-id="${esc(p.id)}">
    <div class="paper-top">
      <div class="idx">${esc(p.id)}</div>
      <div class="paper-body">
        <a class="paper-title" href="/paper/${esc(p.id)}/">${esc(p.title_zh || p.title_en)}</a>
        ${sameTitle ? '' : `<div class="paper-title-en">${esc(p.title_en)}</div>`}
        <div class="paper-meta">
          <span class="chip ${p.category === 'white' ? 'cat-white' : 'cat-colored'}">${esc(p.category_name)}</span>
          <span class="chip">${esc(p.sub_name)}</span>
          <span class="sep">·</span><a class="jrn" href="/search/?journal=${encodeURIComponent(p.journal)}">${esc(p.journal)}</a>
          <span class="sep">·</span><span>${esc(p.published)}</span>
        </div>
        <div class="paper-foot">
          <div class="kw-cloud">${(p.keywords || []).slice(0, 4)
            .map((k) => `<a class="kw" href="/search/?kw=${encodeURIComponent(k)}">${esc(k)}</a>`).join('')}</div>
          <span class="sp"></span>
          <div class="paper-acts">
            <button class="icon-btn on" type="button" data-act="fav" data-id="${esc(p.id)}" title="取消收藏">★</button>
            <button class="btn sm" type="button" data-act="cite" data-id="${esc(p.id)}">题录</button>
            <a class="btn sm" href="/paper/${esc(p.id)}/">详情</a>
          </div>
        </div>
      </div>
    </div>
  </article>`;
}

function toggleFav(id) {
  const on = !state.favs.has(id);
  if (on) state.favs.add(id);
  else state.favs.delete(id);
  saveFavs();
  for (const btn of $$(`[data-act="fav"][data-id="${CSS.escape(id)}"]`)) {
    btn.classList.toggle('on', on);
    const isIcon = btn.classList.contains('icon-btn');
    btn.textContent = isIcon ? (on ? '★' : '☆') : (on ? '★ 已收藏' : '☆ 收藏');
    btn.title = on ? '取消收藏' : '收藏';
  }
  toast(on ? '已加入收藏' : '已取消收藏');
  if ($('#fav-page')) renderFavorites();
}

async function renderFavorites() {
  const root = $('#fav-page');
  if (!root) return;
  const ids = [...state.favs];
  if (!ids.length) {
    root.innerHTML = `<div class="empty">
      <h3>收藏夹是空的</h3>
      <p>在文献卡片或详情页点击 ☆ 即可收藏；收藏保存在本机浏览器中，不会上传。</p>
      <p style="margin-top:14px"><a class="btn primary" href="/browse/white/">去浏览文献</a>
      <a class="btn" href="/search/">检索文献</a></p>
    </div>`;
    return;
  }
  root.innerHTML = '<div class="loading"><span class="spinner"></span>正在读取文献…</div>';
  try {
    const res = await fetch('/data/index.json', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('文献索引加载失败');
    const index = await res.json();
    const byId = new Map(index.map((p) => [p.id, p]));
    const items = ids.map((id) => byId.get(id)).filter(Boolean);
    if (!items.length) {
      root.innerHTML = `<div class="empty"><h3>收藏的文献不在当前库中</h3>
        <p>可能已被移除或编号变更。</p>
        <p style="margin-top:12px"><button class="btn" type="button" id="fav-clear">清空收藏</button></p></div>`;
      return;
    }
    root.innerHTML = `
      <div class="toolbar">
        <span class="toolbar-note">共 ${items.length} 篇 · 保存在本机浏览器</span>
        <span class="grow"></span>
        <button class="btn sm" type="button" data-act="fav-export" data-fmt="bibtex">导出全部（BibTeX）</button>
        <button class="btn sm" type="button" data-act="fav-export" data-fmt="gbt">导出全部（GB/T）</button>
        <button class="btn sm" type="button" id="fav-clear">清空收藏</button>
      </div>
      <div class="result-list">${items.map(favCard).join('')}</div>`;
  } catch (err) {
    root.innerHTML = `<div class="empty"><h3>文献索引加载失败</h3><p>${esc(err.message)}</p></div>`;
  }
}

/* ── 题录弹窗 ───────────────────────────────────────────────────────── */
const FMT_NAME = { gbt: 'GB/T 7714', bibtex: 'BibTeX', ris: 'RIS' };
const FMT_EXT = { gbt: 'txt', bibtex: 'bib', ris: 'ris' };

async function openCitation(id) {
  try {
    let cite = state.cite && state.cite[id];
    if (!cite) {
      const all = await loadCitations();
      cite = all[id];
    }
    if (!cite) {
      toast('未找到该文献的题录');
      return;
    }
    state.current = { id, ...cite };
    $('#modal-root').innerHTML = `
      <div class="modal-mask" data-mask="1">
        <div class="modal" role="dialog" aria-modal="true" aria-label="题录">
          <div class="modal-head"><h3>题录 · ${esc(id)}</h3>
            <button class="icon-btn x" type="button" data-act="modal-close" title="关闭">×</button></div>
          <div class="modal-body"><div class="citation-box" id="cite-text">${esc(cite.citation)}</div></div>
          <div class="modal-foot">
            <button class="btn primary sm" type="button" data-act="copy-text">复制题录</button>
            <button class="btn sm" type="button" data-act="dl" data-fmt="bibtex">下载 BibTeX</button>
            <button class="btn sm" type="button" data-act="dl" data-fmt="ris">下载 RIS</button>
            <span class="grow"></span>
            <button class="btn sm" type="button" data-act="modal-close">关闭</button>
          </div>
        </div>
      </div>`;
  } catch (err) {
    toast(err.message);
  }
}

function closeModal() {
  const root = $('#modal-root');
  if (root) root.innerHTML = '';
  state.current = null;
}

function currentText(fmt) {
  if (!state.current) return '';
  if (fmt === 'bibtex') return state.current.bibtex;
  if (fmt === 'ris') return state.current.ris;
  return state.current.citation;
}

function downloadCurrent(fmt) {
  if (!state.current) return;
  const name = fmt === 'gbt' ? 'txt' : FMT_EXT[fmt];
  downloadText(`radiative-cooling-${state.current.id}.${name}`, currentText(fmt) + '\n');
}

/* ── 页面初始化 ─────────────────────────────────────────────────────── */
function bindNav() {
  const toggle = $('#nav-toggle');
  const bar = $('#topbar');
  if (toggle && bar) {
    toggle.addEventListener('click', () => {
      const open = bar.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }
}

function bindKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) {
      const input = $('#search-input') || $('#q');
      if (input) {
        e.preventDefault();
        input.focus();
        input.select();
      }
    }
    if (e.key === 'Escape') {
      closeModal();
      const bar = $('#topbar');
      if (bar) bar.classList.remove('nav-open');
    }
  });
}

function bindTableFilters() {
  const journalFilter = $('#journal-filter');
  if (journalFilter) {
    const empty = $('#journal-empty');
    journalFilter.addEventListener('input', () => {
      const q = journalFilter.value.trim().toLowerCase();
      let shown = 0;
      for (const tr of $$('#journal-table tbody tr')) {
        const hit = !q || tr.dataset.name.includes(q);
        tr.hidden = !hit;
        if (hit) shown += 1;
      }
      if (empty) empty.hidden = shown > 0;
    });
  }

  const kwFilter = $('#kw-filter');
  if (kwFilter) {
    const empty = $('#kw-empty');
    kwFilter.addEventListener('input', () => {
      const q = kwFilter.value.trim().toLowerCase();
      let shown = 0;
      for (const a of $$('#kw-cloud .kw')) {
        const hit = !q || a.dataset.kw.includes(q);
        a.hidden = !hit;
        if (hit) shown += 1;
      }
      if (empty) empty.hidden = shown > 0;
    });
  }
}

function bindDetail() {
  const toggle = $('#abs-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const el = $('#abs-en');
      if (!el) return;
      const clamped = el.classList.toggle('clamp');
      toggle.textContent = clamped ? '展开全文 ↓' : '收起 ↑';
    });
  }
  const citeEl = $('#paper-cite');
  if (citeEl) {
    try {
      state.current = { id: location.pathname.split('/').filter(Boolean).pop(), ...JSON.parse(citeEl.textContent) };
    } catch (e) {
      /* ignore */
    }
  }
}

function bindGlobalActions() {
  document.addEventListener('click', (e) => {
    const fav = e.target.closest('[data-act="fav"]');
    if (fav) {
      toggleFav(fav.dataset.id);
      return;
    }

    const cite = e.target.closest('[data-act="cite"]');
    if (cite) {
      openCitation(cite.dataset.id);
      return;
    }

    const dl = e.target.closest('[data-act="download"],[data-act="dl"]');
    if (dl) {
      const fmt = dl.dataset.fmt || 'bibtex';
      if (dl.dataset.id && (!state.current || state.current.id !== dl.dataset.id)) {
        loadCitations().then((all) => {
          state.current = { id: dl.dataset.id, ...(all[dl.dataset.id] || {}) };
          downloadCurrent(fmt);
        }).catch((err) => toast(err.message));
      } else {
        downloadCurrent(fmt);
      }
      return;
    }

    if (e.target.closest('[data-act="copy-cite"]') || e.target.closest('[data-act="copy-text"]')) {
      const el = $('#cite-text');
      const text = el ? el.textContent : currentText('gbt');
      copyText(text);
      return;
    }

    const clear = e.target.closest('#fav-clear');
    if (clear) {
      if (!state.favs.size || confirm('确定清空全部收藏？')) {
        state.favs.clear();
        saveFavs();
        renderFavorites();
        toast('已清空收藏');
      }
      return;
    }

    const favExp = e.target.closest('[data-act="fav-export"]');
    if (favExp) {
      const fmt = favExp.dataset.fmt === 'gbt' ? 'gbt' : 'bibtex';
      loadCitations().then((all) => {
        const parts = [...state.favs]
          .map((id) => all[id])
          .filter(Boolean)
          .map((c) => (fmt === 'gbt' ? c.citation : c.bibtex));
        if (!parts.length) {
          toast('没有可导出的题录');
          return;
        }
        downloadText(`radiative-cooling-favorites.${fmt === 'gbt' ? 'txt' : 'bib'}`, parts.join('\n\n') + '\n');
        toast(`已导出 ${parts.length} 条题录`);
      }).catch((err) => toast(err.message));
      return;
    }

    if (e.target.closest('[data-act="modal-close"]')) {
      closeModal();
      return;
    }
    if (e.target.dataset.mask && !e.target.closest('.modal')) closeModal();
  });
}

function bindDisclosures() {
  const mq = window.matchMedia('(max-width: 960px)');
  const apply = () => {
    for (const d of $$('details.side-toggle, details.filters-details')) d.open = !mq.matches;
  };
  apply();
  if (mq.addEventListener) mq.addEventListener('change', apply);
}

function boot() {
  syncFavCount();
  bindNav();
  bindKeyboard();
  bindTableFilters();
  bindDetail();
  bindGlobalActions();
  bindDisclosures();
  if ($('#fav-page')) renderFavorites();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
})();
