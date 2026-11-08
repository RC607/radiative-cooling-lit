/* 专利模块：读取 data/patents.json，生成专利列表页与详情页。 */
import fs from 'node:fs';
import path from 'node:path';
import { esc, layout, sidebar, breadcrumbs } from './html.mjs';

const SUBS = [
  { key: 'white_coating', name: '白色辐射制冷涂料/涂层' },
  { key: 'colored_coating', name: '彩色辐射制冷涂料/涂层' },
  { key: 'film', name: '辐射制冷膜' },
];

export function loadPatents(root) {
  const file = path.join(root, 'data', 'patents.json');
  if (!fs.existsSync(file)) return [];
  let raw = [];
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
  const nameOf = Object.fromEntries(SUBS.map((s) => [s.key, s.name]));
  return raw
    .filter((p) => p && p.patent_no && nameOf[p.sub])
    .map((p) => ({ ...p, sub_name: nameOf[p.sub] }))
    .sort((a, b) => String(b.app_date || '').localeCompare(String(a.app_date || '')));
}

function card(p) {
  const catChip = p.sub === 'white_coating' ? 'cat-white' : 'cat-colored';
  const inventors = (p.inventors || []).join('；');
  const text = [p.title, p.patent_no, p.application_no, p.applicant, inventors, p.abstract]
    .join(' ')
    .toLowerCase();
  return `
  <article class="paper" data-sub="${esc(p.sub)}" data-text="${esc(text)}">
    <div class="paper-top">
      <div class="idx">${esc(p.id || '')}</div>
      <div class="paper-body">
        <a class="paper-title" href="/patents/${esc(p.id)}/">${esc(p.title)}</a>
        <div class="paper-meta">
          <span class="chip ${catChip}">${esc(p.sub_name)}</span>
          <span class="chip type">${esc(p.status || '公开')}</span>
          <span class="sep">·</span><span class="jrn">${esc(p.patent_no)}</span>
          <span class="sep">·</span><span>${esc(p.applicant)}</span>
          <span class="sep">·</span><span>申请 ${esc(p.app_date)}</span>
        </div>
        <div class="paper-snippet">${esc(String(p.abstract || '').slice(0, 170))}${String(p.abstract || '').length > 170 ? '…' : ''}</div>
        <div class="paper-foot">
          <span class="sp"></span>
          <div class="paper-acts"><a class="btn sm" href="/patents/${esc(p.id)}/">详情</a></div>
        </div>
      </div>
    </div>
  </article>`;
}

export function patentsIndex({ patents, stats }) {
  const count = (key) => patents.filter((p) => p.sub === key).length;
  const tabs = SUBS.map(
    (s) => `<button class="btn sm" type="button" data-sub="${s.key}">${s.name}（${count(s.key)}）</button>`,
  ).join('');
  const main = `
    ${breadcrumbs([{ label: '首页', href: '/' }, { label: '专利' }])}
    <div class="page-head">
      <h1>专利</h1>
      <div class="desc">白色辐射制冷涂料/涂层、彩色辐射制冷涂料/涂层、辐射制冷膜三类中国专利，按申请日倒序；
        仅展示题录与说明书摘要，不提供专利全文。</div>
      <div class="count">共 ${patents.length} 件</div>
    </div>

    <div class="toolbar">
      <button class="btn sm on" type="button" data-sub="all">全部（${patents.length}）</button>
      ${tabs}
      <span class="grow"></span>
      <input id="pat-q" type="search" placeholder="筛选专利名称、申请人、公开号"
             style="height:28px;padding:0 9px;border:1px solid var(--line);border-radius:7px;font-size:12px;width:240px">
    </div>

    <div class="result-list" id="pat-list">
      ${patents.map(card).join('') || '<div class="empty"><h3>暂无专利数据</h3></div>'}
    </div>

    <script>
    (() => {
      const q = document.getElementById('pat-q');
      const items = [...document.querySelectorAll('#pat-list .paper')];
      const tabs = [...document.querySelectorAll('button[data-sub]')];
      let sub = 'all';
      const apply = () => {
        const t = (q.value || '').trim().toLowerCase();
        items.forEach((el) => {
          const okSub = sub === 'all' || el.dataset.sub === sub;
          const okTxt = !t || (el.dataset.text || '').includes(t);
          el.hidden = !(okSub && okTxt);
        });
      };
      q.addEventListener('input', apply);
      tabs.forEach((b) => b.addEventListener('click', () => {
        sub = b.dataset.sub;
        tabs.forEach((x) => x.classList.toggle('on', x === b));
        apply();
      }));
    })();
    </script>`;

  return {
    path: '/patents/',
    html: layout({
      title: '专利',
      description: '白色/彩色辐射制冷涂料涂层与辐射制冷膜专利题录与说明书摘要',
      path: '/patents/',
      active: 'patents',
      stats,
      sidebarHtml: sidebar(stats, { activePage: 'patents' }),
      main,
    }),
  };
}

export function patentDetail(p, { stats }) {
  const inventors = (p.inventors || []).map((x) => esc(x)).join('；');
  const main = `
    ${breadcrumbs([
      { label: '首页', href: '/' },
      { label: '专利', href: '/patents/' },
      { label: p.sub_name, href: '/patents/' },
      { label: p.patent_no },
    ])}
    <article class="detail">
      <div class="detail-head">
        <div class="kicker">
          <span class="chip ${p.sub === 'white_coating' ? 'cat-white' : 'cat-colored'}">${esc(p.sub_name)}</span>
          <span class="chip type">${esc(p.status || '公开')}</span>
        </div>
        <h1>${esc(p.title)}</h1>
      </div>
      <div class="detail-body">
        <dl class="meta-table">
          <dt>公开号</dt><dd>${esc(p.patent_no)}</dd>
          ${p.application_no ? `<dt>申请号</dt><dd>${esc(p.application_no)}</dd>` : ''}
          ${p.applicant ? `<dt>申请人</dt><dd>${esc(p.applicant)}</dd>` : ''}
          ${inventors ? `<dt>发明人</dt><dd>${inventors}</dd>` : ''}
          ${p.app_date ? `<dt>申请日</dt><dd>${esc(p.app_date)}</dd>` : ''}
          <dt>法律状态</dt><dd>${esc(p.status || '公开')}</dd>
        </dl>
        <div class="block">
          <h3>说明书摘要</h3>
          <div class="txt">${esc(p.abstract || '（暂无摘要）')}</div>
        </div>
      </div>
    </article>`;

  return {
    path: `/patents/${p.id}/`,
    html: layout({
      title: `${p.title}（${p.patent_no}）`,
      description: String(p.abstract || '').slice(0, 120),
      path: `/patents/${p.id}/`,
      active: 'patents',
      stats,
      sidebarHtml: sidebar(stats, { activePage: 'patents' }),
      main,
    }),
  };
}
