import { APP_VERSION, SCHEMA_VERSION, PAGE_SIZE, CATEGORIES, DEFAULT_FILTERS } from './config.js';

/** Network-free helpers; reused by Node unit tests and the browser. */
export function safeWebUrl(value) {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/u.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}
export function isDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.valueOf()) && d.toISOString().slice(0, 10) === value;
}
export function dateBounds(date) {
  if (!date || date.value == null || date.precision === 'unknown') return null;
  const s = date.value;
  if (date.precision === 'day' && isDay(s)) return [s, s];
  if (date.precision === 'month' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s)) {
    const [year, month] = s.split('-').map(Number);
    const end = new Date(`${s}-01T00:00:00Z`);
    end.setUTCMonth(month, 0);
    return [`${s}-01`, end.toISOString().slice(0, 10)];
  }
  if (date.precision === 'year' && /^\d{4}$/.test(s) && Number(s) >= 1000) return [`${s}-01-01`, `${s}-12-31`];
  return null;
}
export function dateText(date) {
  if (!dateBounds(date)) return '날짜 확인 안 됨';
  const [y, m, d] = date.value.split('-');
  return `${y}년${m ? ` ${Number(m)}월` : ''}${d ? ` ${Number(d)}일` : ''}`;
}
export function timestampText(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '확인 안 됨';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date(value));
}
export function cleanFilters(input = {}) {
  const page = Number(input.page);
  return {
    q: String(input.q ?? '').normalize('NFKC').trim().slice(0, 200),
    category: Object.hasOwn(CATEGORIES, input.category) ? input.category : 'all',
    origin: ['domestic', 'overseas'].includes(input.origin) ? input.origin : 'all',
    from: isDay(input.from) ? input.from : '', to: isDay(input.to) ? input.to : '',
    sort: input.sort === 'published' ? 'published' : 'added',
    page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 100000) : 1
  };
}
export function parseRoute(hash = '') {
  const text = hash.replace(/^#/, '') || '/list';
  const [path, query = ''] = text.split('?');
  const filters = cleanFilters(Object.fromEntries(new URLSearchParams(query)));
  if (path === '/list' || path === '/') return { view: 'list', filters };
  if (path === '/sources') return { view: 'sources', filters };
  const match = path.match(/^\/item\/([A-Za-z0-9_-]{1,80})$/);
  if (match) return { view: 'item', id: match[1], filters };
  return { view: 'missing', filters };
}
export function routeHref(view = 'list', filters = DEFAULT_FILTERS, id = '') {
  const clean = cleanFilters(filters);
  const query = new URLSearchParams();
  for (const key of Object.keys(DEFAULT_FILTERS)) {
    if (clean[key] !== DEFAULT_FILTERS[key]) query.set(key, String(clean[key]));
  }
  const path = view === 'item' ? `/item/${encodeURIComponent(id)}` : view === 'sources' ? '/sources' : '/list';
  return `#${path}${query.size ? `?${query}` : ''}`;
}
function normalized(value) { return String(value || '').normalize('NFKC').toLocaleLowerCase('ko-KR'); }
export function selectRecords(catalog, rawFilters) {
  const f = cleanFilters(rawFilters);
  const terms = normalized(f.q).split(/\s+/).filter(Boolean);
  const sources = new Map(catalog.sources.map(s => [s.id, s.name]));
  const records = catalog.records.filter(r => {
    if (f.category !== 'all' && r.category !== f.category) return false;
    if (f.origin === 'domestic' && r.origin !== 'domestic') return false;
    if (f.origin === 'overseas' && !['overseas', 'international'].includes(r.origin)) return false;
    if (f.from || f.to) {
      const bounds = dateBounds(r.dates.published);
      // Do not invent a day for a month/year-only date: include only a fully contained interval.
      if (!bounds || (f.from && bounds[0] < f.from) || (f.to && bounds[1] > f.to)) return false;
    }
    const haystack = normalized([r.title.ko, r.title.original, r.summary.ko, ...r.tags, sources.get(r.sourceId)].join(' '));
    return terms.every(term => haystack.includes(term));
  });
  records.sort((a, b) => {
    if (f.sort === 'published') {
      const da = dateBounds(a.dates.published)?.[0] ?? '';
      const db = dateBounds(b.dates.published)?.[0] ?? '';
      if (da !== db) return db.localeCompare(da);
    }
    const added = (b.dates.firstSeenAt ?? '').localeCompare(a.dates.firstSeenAt ?? '');
    return added || a.id.localeCompare(b.id);
  });
  const total = records.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(f.page, pages);
  return { items: records.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total, pages, page, filters: { ...f, page } };
}
export function isImportant(record, now = new Date()) {
  if (!record.importance) return false;
  // End dates use Korean calendar dates, not the viewer's local/UTC date.
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return !record.importance.until || record.importance.until >= ymd;
}
const topKeys = ['schemaVersion', 'appVersion', 'releaseId', 'mode', 'generatedAt', 'dataAsOf', 'sources', 'records'];
const sourceKeys = ['id', 'name', 'group', 'region', 'description', 'homepage', 'reviewedOn', 'connection', 'lastSuccessfulCollectionAt'];
const recordKeys = ['id', 'sourceId', 'isTest', 'category', 'origin', 'language', 'title', 'summary', 'originalUrl', 'canonicalUrl', 'doi', 'dates', 'review', 'importance', 'tags', 'attachments', 'relatedIds', 'research', 'ruleInfo'];
function exactKeys(obj, keys) { return obj && typeof obj === 'object' && !Array.isArray(obj) && keys.every(k => Object.hasOwn(obj, k)) && Object.keys(obj).every(k => keys.includes(k)); }
function fail(message) { throw new Error(message); }
/** Defensive render-time guard, not a replacement for the full build-time JSON Schema check. */
export function assertCatalog(c, mode) {
  if (!exactKeys(c, topKeys) || c.schemaVersion !== SCHEMA_VERSION || c.appVersion !== APP_VERSION || c.mode !== mode) fail('화면과 자료의 버전이 맞지 않습니다.');
  if (!['public', 'preview'].includes(mode) || !Array.isArray(c.sources) || !Array.isArray(c.records) || c.records.length > 50000) fail('자료 형식이 올바르지 않습니다.');
  const sourceIds = new Set();
  for (const s of c.sources) {
    if (!exactKeys(s, sourceKeys) || !/^[A-Z]\d{2}$/.test(s.id) || sourceIds.has(s.id) || typeof s.name !== 'string') fail('출처 정보가 올바르지 않습니다.');
    if (!['sport', 'research', 'discovery', 'test'].includes(s.group) || !['candidate', 'manual', 'active', 'test'].includes(s.connection)) fail('출처 상태를 확인해 주세요.');
    if (s.homepage !== null && !safeWebUrl(s.homepage)) fail('출처 주소가 올바르지 않습니다.');
    if (mode === 'public' && (s.group === 'test' || s.connection === 'test')) fail('공개 자료에 테스트 출처가 있습니다.');
    sourceIds.add(s.id);
  }
  const ids = new Set();
  for (const r of c.records) {
    if (!exactKeys(r, recordKeys) || !/^[A-Za-z0-9_-]{1,80}$/.test(r.id) || ids.has(r.id) || !sourceIds.has(r.sourceId)) fail('자료 식별 정보가 올바르지 않습니다.');
    if (!Object.hasOwn(CATEGORIES, r.category) || !['domestic', 'overseas', 'international', 'unknown'].includes(r.origin)) fail('자료 분류를 확인해 주세요.');
    if (!exactKeys(r.title, ['ko', 'original', 'status']) || !exactKeys(r.summary, ['ko', 'status']) || !exactKeys(r.review, ['state', 'scope', 'note'])) fail('제목·요약·검토 정보가 올바르지 않습니다.');
    if (typeof r.title.original !== 'string' || !r.title.original || !(r.title.ko === null || typeof r.title.ko === 'string') || !(r.summary.ko === null || typeof r.summary.ko === 'string')) fail('제목이나 요약이 올바르지 않습니다.');
    if (mode === 'public' && (r.isTest !== false || r.review.state !== 'approved' || !safeWebUrl(r.originalUrl) || !['reviewed', 'original_only'].includes(r.title.status) || !['reviewed', 'not_provided'].includes(r.summary.status))) fail('공개 검토가 끝나지 않은 자료가 있습니다.');
    if (mode === 'preview' && (r.isTest !== true || r.review.state !== 'test')) fail('미리보기에는 테스트 자료만 넣을 수 있습니다.');
    if (!exactKeys(r.dates, ['published', 'modified', 'eventStart', 'eventEnd', 'effective', 'firstSeenAt', 'lastVerifiedAt'])) fail('날짜 정보가 올바르지 않습니다.');
    for (const k of ['published', 'modified', 'eventStart', 'eventEnd', 'effective']) {
      const d = r.dates[k];
      if (d !== null && (!exactKeys(d, ['value', 'precision', 'basis']) || !dateBounds(d))) fail('자료 날짜가 올바르지 않습니다.');
    }
    if (!r.dates.firstSeenAt || !Number.isFinite(Date.parse(r.dates.firstSeenAt))) fail('추가일이 올바르지 않습니다.');
    if (!Array.isArray(r.tags) || !r.tags.every(t => typeof t === 'string') || !Array.isArray(r.relatedIds) || !Array.isArray(r.attachments)) fail('부가 정보가 올바르지 않습니다.');
    if (r.importance !== null && (!exactKeys(r.importance, ['reason', 'until']) || typeof r.importance.reason !== 'string' || (r.importance.until !== null && !isDay(r.importance.until)))) fail('중요 표시 정보가 올바르지 않습니다.');
    for (const url of [r.originalUrl, r.canonicalUrl]) if (url !== null && !safeWebUrl(url)) fail('자료 주소가 올바르지 않습니다.');
    for (const a of r.attachments) if (!exactKeys(a, ['name', 'url', 'format', 'accessNote']) || !safeWebUrl(a.url)) fail('첨부 주소가 올바르지 않습니다.');
    if (r.research !== null && (!exactKeys(r.research, ['type', 'participants', 'findings', 'limitations', 'datasetStatus', 'datasetUrl']) || (r.research.datasetUrl !== null && !safeWebUrl(r.research.datasetUrl)))) fail('연구 정보가 올바르지 않습니다.');
    if (r.ruleInfo !== null && !exactKeys(r.ruleInfo, ['status', 'version', 'note'])) fail('규칙 정보가 올바르지 않습니다.');
    ids.add(r.id);
  }
  for (const r of c.records) if (!r.relatedIds.every(id => ids.has(id) && id !== r.id)) fail('관련 자료를 찾을 수 없습니다.');
  return c;
}
