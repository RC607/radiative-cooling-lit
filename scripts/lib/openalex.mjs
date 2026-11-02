/* OpenAlex 客户端与辐射制冷主题过滤（构建期/CI 使用，不在前端运行）。 */

const BASE_URL = process.env.OPENALEX_BASE_URL || 'https://api.openalex.org';
const ALLOWED_TYPES = new Set([
  'article',
  'review',
  'preprint',
  'posted-content',
  'proceedings-article',
  'book-chapter',
  'report',
]);

const TOPIC_KEYS = [
  'passive radiative cooling',
  'daytime radiative cooling',
  'radiative cooler',
  'radiative cooling cooler',
  'sky cooling',
  'sub-ambient radiative',
  'subambient radiative',
  'radiative cooling paint',
  'radiative cooling coating',
  'radiative cooling film',
  'radiative cooling textile',
  'radiative cooling fabric',
  'radiative cooling building',
  'colored radiative cooling',
  'transparent radiative cooling',
  '辐射制冷',
  '辐射冷却',
  '辐射致冷',
  '辐射降温',
  '天空辐射制冷',
  '被动制冷',
];

const SUPPORT_KEYS = [
  'thermal',
  'temperature',
  'emissivity',
  'solar',
  'heat',
  'cooling power',
  'building',
  'fabric',
  'textile',
  'coating',
  'film',
  'paint',
  'cooler',
  'roof',
  'window',
  'material',
];

// 天体物理/等离子体语境里的 “radiative cooling” 指气体冷却，不是材料制冷
const ASTRO_KEYS = [
  'galaxy',
  'galaxies',
  'agn',
  'quasar',
  'protostar',
  'protostellar',
  'interstellar',
  'molecular cloud',
  'supernova',
  'accretion',
  'cosmological',
  'dark matter',
  'x-ray',
  'xrism',
  'perseus',
  'lofar',
  'radio jet',
  'stellar',
  'planetary',
  'intracluster',
  'igm',
  'dust grain',
  'plasma',
  'magnetosphere',
];

// 大气/云物理语境：只在题名中出现时才排除，避免误伤摘要里提到 cloud cover 的制冷论文
const ATMOS_KEYS = [
  'cloud',
  'clouds',
  'microphysical',
  'arctic',
  'mixed-phase',
  'precipitation',
  'aerosol',
  'boundary layer',
  'atmospheric model',
  'general circulation',
];

const BAD_TITLE = /\b(erratum|corrigendum|correction|retraction|editorial|comment on|reply to)\b/i;

function decodeHtml(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function isRelevant(title, abstract = '') {
  const text = `${title} ${abstract}`.toLowerCase();
  if (!text.trim()) return false;
  if (BAD_TITLE.test(title)) return false;
  if (ASTRO_KEYS.some((k) => text.includes(k))) return false;
  const titleLower = title.toLowerCase();
  if (ATMOS_KEYS.some((k) => titleLower.includes(k))) return false;
  if (TOPIC_KEYS.some((k) => text.includes(k))) return true;
  return text.includes('radiative cooling') && SUPPORT_KEYS.some((k) => text.includes(k));
}

export function abstractFromInvertedIndex(index, limit = 1600) {
  if (!index || typeof index !== 'object') return '';
  const entries = [];
  for (const [word, positions] of Object.entries(index)) {
    if (!Array.isArray(positions)) continue;
    for (const p of positions) entries.push([Number(p), word]);
  }
  entries.sort((a, b) => a[0] - b[0]);
  const text = entries.map(([, w]) => w).join(' ').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function pagesOf(bib) {
  const first = bib?.first_page || '';
  const last = bib?.last_page || '';
  if (!first) return '';
  return !last || last === first ? first : `${first}-${last}`;
}

function stripDoi(raw) {
  return String(raw || '')
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:/i, '')
    .trim();
}

export function mapWork(work) {
  const title = decodeHtml(work?.title || work?.display_name || '');
  if (!title) return null;
  if (work.type && !ALLOWED_TYPES.has(String(work.type))) return null;
  if (BAD_TITLE.test(title)) return null;

  const doi = stripDoi(work.doi);
  if (!doi) return null;

  const source = work.primary_location?.source || work.host_venue || null;
  const journal = decodeHtml(source?.display_name || '');
  if (!journal) return null;

  const authors = (work.authorships || [])
    .map((a) => decodeHtml(a?.author?.display_name || ''))
    .filter(Boolean)
    .slice(0, 20);
  if (!authors.length) return null;

  const year = Number(work.publication_year);
  if (!Number.isInteger(year) || year < 1900) return null;

  const published = String(work.publication_date || `${year}-01-01`).slice(0, 10);
  const biblio = work.biblio || {};
  const keywords = (work.keywords || [])
    .map((k) => decodeHtml(k?.display_name || ''))
    .filter(Boolean);

  return {
    title,
    doi,
    journal,
    year,
    published,
    volume: biblio.volume || '',
    issue: biblio.issue || '',
    pages: pagesOf(biblio),
    authors,
    keywords: [...new Set(keywords)].slice(0, 8),
    abstract: abstractFromInvertedIndex(work.abstract_inverted_index),
    type: String(work.type || ''),
    language: work.language || '',
    url: work.primary_location?.landing_page_url || `https://doi.org/${doi}`,
    cited: Number(work.cited_by_count) || 0,
  };
}

function buildUrl(params) {
  const url = new URL(`${BASE_URL}/works`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function once(query, since, size, apiKey, mailto) {
  const url = buildUrl({
    search: query,
    filter: `from_publication_date:${since}`,
    sort: 'publication_date:desc',
    'per-page': size,
    mailto,
    api_key: apiKey,
  });
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'rc-lit-portal/3.0 (static literature portal)',
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 200);
    const err = new Error(`OpenAlex HTTP ${res.status}：${body}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** 带重试的检索：429/5xx 重试，其余错误直接抛出。 */
export async function fetchWorks({
  query,
  since,
  size = 50,
  apiKey = '',
  mailto = '',
  retries = 2,
} = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const data = await once(query, since, Math.min(Math.max(size, 1), 100), apiKey, mailto);
      return data.results || [];
    } catch (err) {
      lastError = err;
      const retryable = !err.status || err.status === 429 || err.status >= 500;
      if (!retryable || attempt === retries) break;
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    }
  }
  throw lastError;
}
