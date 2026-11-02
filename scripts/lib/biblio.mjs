/* 题录格式化：GB/T 7714、BibTeX、RIS。 */

function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return ['', ''];
  if (parts.length === 1) return [parts[0], ''];
  return [parts[parts.length - 1], parts.slice(0, -1).join(' ')];
}

function initials(given) {
  return String(given || '')
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((chunk) => (/^[A-Z]\.?$/.test(chunk) ? chunk.replace(/\.$/, '') : chunk[0].toUpperCase()))
    .join(' ');
}

function gbtAuthors(authors, maxN = 3) {
  const list = (authors || []).slice(0, maxN).map((a) => {
    const [sur, giv] = splitName(a);
    return `${sur} ${initials(giv)}`.trim();
  });
  return list.join(', ') + ((authors || []).length > maxN ? ', 等' : '');
}

export function gbt7714(p) {
  const pages = p.pages || '';
  const vol = p.volume || '';
  const iss = p.issue || '';
  const loc = vol + (iss ? `(${iss})` : '') + (pages ? `: ${pages}` : '');
  return (
    `${gbtAuthors(p.authors)}. ${p.title_en}[J]. ${p.journal}, ${p.year}` +
    (loc ? `, ${loc}` : '') +
    `. DOI: ${p.doi || '—'}.`
  );
}

function bibtexAuthors(authors) {
  return (authors || [])
    .map((a) => {
      const [sur, giv] = splitName(a);
      return `${sur}, ${giv}`.replace(/^,\s*|,\s*$/g, '');
    })
    .join(' and ');
}

function bibtexKey(p) {
  const [sur] = splitName((p.authors || [''])[0]);
  const title = p.title_en || p.title_zh || 'ref';
  const word = String(title.split(/\s+/)[0] || 'ref').replace(/[^A-Za-z]/g, '').toLowerCase();
  const fallback = String(p.id || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return (sur.toLowerCase().replace(/[^a-z]/g, '') || 'ref') + p.year + (word || fallback);
}

export function bibtex(p) {
  const pages = String(p.pages || '').replace(/-/g, '--');
  const fields = [
    ['title', `{${p.title_en || ''}}`],
    ['author', `{${bibtexAuthors(p.authors)}}`],
    ['journal', `{${p.journal || ''}}`],
    ['year', `{${p.year}}`],
  ];
  if (p.volume) fields.push(['volume', `{${p.volume}}`]);
  if (p.issue) fields.push(['number', `{${p.issue}}`]);
  if (pages) fields.push(['pages', `{${pages}}`]);
  if (p.doi) fields.push(['doi', `{${p.doi}}`]);
  const body = fields.map(([k, v]) => `  ${k} = ${v}`).join(',\n');
  return `@article{${bibtexKey(p)},\n${body}\n}`;
}

export function ris(p) {
  let sp = p.pages || '';
  let ep = '';
  const m = /^(\S+)-(\S+)$/.exec(p.pages || '');
  if (m) {
    sp = m[1];
    ep = m[2];
  }
  const lines = ['TY  - JOUR'];
  for (const a of p.authors || []) {
    const [sur, giv] = splitName(a);
    lines.push(giv ? `AU  - ${sur}, ${giv}` : `AU  - ${sur}`);
  }
  lines.push(`TI  - ${p.title_en || ''}`, `JO  - ${p.journal || ''}`, `PY  - ${p.year}`);
  if (p.volume) lines.push(`VL  - ${p.volume}`);
  if (p.issue) lines.push(`IS  - ${p.issue}`);
  if (sp) lines.push(`SP  - ${sp}`);
  if (ep) lines.push(`EP  - ${ep}`);
  if (p.doi) lines.push(`DO  - ${p.doi}`);
  lines.push(`N2  - ${p.abstract_zh || ''}`);
  lines.push('ER  - ');
  return lines.join('\n');
}

export const FORMATS = {
  gbt: { name: 'GB/T 7714', ext: 'txt', fn: gbt7714 },
  bibtex: { name: 'BibTeX', ext: 'bib', fn: bibtex },
  ris: { name: 'RIS', ext: 'ris', fn: ris },
};

export function renderCitations(papers) {
  const out = {};
  for (const p of papers) {
    out[p.id] = {
      citation: gbt7714(p),
      bibtex: bibtex(p),
      ris: ris(p),
    };
  }
  return out;
}
