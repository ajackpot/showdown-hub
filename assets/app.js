import { CATEGORIES, ORIGINS, LANGUAGES, SOURCE_GROUPS, DEFAULT_FILTERS, PAGE_SIZE } from './config.js';
import { assertCatalog, safeWebUrl, parseRoute, routeHref, cleanFilters, selectRecords, dateText, timestampText, isImportant } from './model.js';

const main = document.querySelector('#main');
const status = document.querySelector('#status');
const mode = document.querySelector('meta[name="app-mode"]').content;
let catalog = null;
let route = parseRoute(location.hash);
let renderedHash = '';
let announceTimer;
let loading = false;
let listResult;

/** Only text nodes and fixed element names are used for imported content. No HTML injection. */
function node(tag, attrs = {}, ...children) {
  const result = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== false && value !== undefined) result.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined) continue;
    result.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return result;
}
function title(record) { return record.title.ko || record.title.original; }
function sourceOf(record) { return catalog.sources.find(s => s.id === record.sourceId); }
function heading(text, id = 'page-title', level = 'h1') { return node(level, { id, tabindex: '-1' }, text); }
function internal(text, href, attrs = {}) { return node('a', { href, 'data-route': '', ...attrs }, text); }
function external(text, href, attrs = {}) {
  const safe = safeWebUrl(href);
  return safe ? node('a', { href: safe, rel: 'noopener noreferrer', ...attrs }, text) : node('span', {}, text);
}
function badge(text, type = '') { return node('span', { class: `badge ${type}`.trim() }, text); }
function infoPair(dl, label, value) { dl.append(node('dt', {}, label), node('dd', {}, value ?? '확인 안 됨')); }
function announce(message) {
  clearTimeout(announceTimer);
  status.textContent = '';
  announceTimer = setTimeout(() => { status.textContent = message; }, 80);
}
function silence() { clearTimeout(announceTimer); status.textContent = ''; }
function focusAt(id, y = null) {
  const target = document.getElementById(id);
  if (!target) return false;
  target.focus({ preventScroll: true });
  if (Number.isFinite(y)) window.scrollTo(0, y);
  else target.scrollIntoView({ block: 'start' });
  const rect = target.getBoundingClientRect();
  if (rect.bottom < 0 || rect.top > innerHeight) target.scrollIntoView({ block: 'nearest' });
  return document.activeElement === target;
}
function snapshot() {
  const form = document.querySelector('#search-form');
  return {
    focusId: document.activeElement?.id || null,
    scrollY: window.scrollY,
    expanded: Boolean(document.querySelector('#more-filters')?.open),
    draft: form ? Object.fromEntries(new FormData(form)) : null
  };
}
function remember() {
  history.replaceState({ ...(history.state || {}), hub: true, ui: snapshot() }, '', location.href);
}
function updateNav(filters) {
  for (const name of ['list', 'sources']) {
    const link = document.querySelector(`#nav-${name}`);
    link.href = routeHref(name, filters);
    if (route.view === name || (name === 'list' && route.view === 'item')) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}
function navigate(hash, { replace = false, restore = null } = {}) {
  silence();
  const previousHash = location.hash || '#/list';
  remember();
  const previous = history.state;
  const listContext = parseRoute(previousHash).view === 'list' ? { hash: previousHash, ui: previous.ui } : previous.listContext || null;
  const nextState = { hub: true, fromHash: previousHash, returnUI: previous.ui, listContext, ui: null };
  if (replace) history.replaceState(nextState, '', hash);
  else history.pushState(nextState, '', hash);
  route = parseRoute(hash);
  render({ reason: 'navigate', restore });
}
function goBackToList() {
  const target = routeHref('list', route.filters);
  if (history.state?.hub && history.state.fromHash === target) {
    remember();
    history.back();
  } else {
    const ui = history.state?.listContext?.hash === target ? history.state.listContext.ui : null;
    navigate(target, { replace: true, restore: ui });
  }
}
function dataNote() {
  if (mode === 'preview') return node('p', { class: 'data-note' }, node('span', {}, '테스트 데이터 기준'), node('span', {}, timestampText(catalog.dataAsOf)));
  return node('p', { class: 'data-note' }, node('span', {}, '자료 확인 기준'), node('span', {}, catalog.dataAsOf ? timestampText(catalog.dataAsOf) : '등록된 자료 없음'));
}
function labeledSelect(name, label, options, selected) {
  const select = node('select', { id: name, name }, options.map(([value, text]) => node('option', { value }, text)));
  select.value = selected;
  return node('div', { class: 'field' }, node('label', { for: name }, label), select);
}
function searchForm(filters) {
  const input = node('input', { id: 'q', name: 'q', type: 'search', maxlength: '200', autocomplete: 'off', value: filters.q, placeholder: '예: 대회, 규칙, 훈련', 'aria-describedby': 'search-help' });
  const fields = node('div', { class: 'fields' },
    node('div', { class: 'field' }, node('label', { for: 'q' }, '찾을 내용'), input),
    labeledSelect('category', '자료 종류', [['all', '전체'], ...Object.entries(CATEGORIES)], filters.category),
    labeledSelect('sort', '정렬', [['added', '최근 추가순'], ['published', '게시일순']], filters.sort));
  const details = node('details', { class: 'more-filters', id: 'more-filters' }, node('summary', { id: 'more-summary' }, '지역·기간 조건'),
    node('div', { class: 'advanced-fields' },
      labeledSelect('origin', '지역', [['all', '전체'], ['domestic', '국내'], ['overseas', '해외·국제']], filters.origin),
      node('div', { class: 'field' }, node('label', { for: 'from' }, '게시일 시작'), node('input', { id: 'from', name: 'from', type: 'date', value: filters.from, 'aria-describedby': 'date-help form-error' })),
      node('div', { class: 'field' }, node('label', { for: 'to' }, '게시일 끝'), node('input', { id: 'to', name: 'to', type: 'date', value: filters.to, 'aria-describedby': 'date-help form-error' }))),
    node('p', { id: 'date-help', class: 'muted' }, '기간을 정하면 게시일이 해당 기간 안에 있는 자료만 표시합니다. 날짜가 없거나 범위가 불확실한 자료는 제외합니다.'));
  details.open = filters.origin !== 'all' || Boolean(filters.from || filters.to);
  const form = node('form', { id: 'search-form', role: 'search', 'aria-label': '모아둔 자료 검색' }, fields, details,
    node('p', { id: 'form-error', class: 'field-error', hidden: true }),
    node('div', { class: 'search-actions' }, node('button', { type: 'submit', class: 'primary', id: 'search-button' }, '검색'),
      node('button', { type: 'button', id: 'clear-button' }, '조건 지우기'),
      node('p', { id: 'search-help', class: 'search-help' }, '조건을 고른 뒤 검색을 누르세요.')));
  form.addEventListener('submit', event => {
    event.preventDefault();
    const f = cleanFilters(Object.fromEntries(new FormData(form)));
    const error = form.querySelector('#form-error');
    const to = form.elements.to;
    error.hidden = true; to.removeAttribute('aria-invalid');
    if (f.from && f.to && f.from > f.to) {
      details.open = true;
      error.textContent = '끝 날짜는 시작 날짜와 같거나 늦어야 합니다.';
      error.hidden = false; to.setAttribute('aria-invalid', 'true'); to.focus();
      silence();
      return;
    }
    applySearch({ ...f, page: 1 });
  });
  form.querySelector('#clear-button').addEventListener('click', () => {
    for (const [key, value] of Object.entries(DEFAULT_FILTERS)) if (form.elements.namedItem(key)) form.elements.namedItem(key).value = String(value);
    details.open = false;
    form.querySelector('#form-error').hidden = true;
    form.elements.to.removeAttribute('aria-invalid');
    applySearch(DEFAULT_FILTERS);
  });
  return node('div', { class: 'search-panel' }, form);
}
function applySearch(filters) {
  remember();
  const hash = routeHref('list', filters);
  // Leave the submitted form in the DOM: keyboard focus stays at the field/button.
  if (location.hash !== hash) history.pushState({ hub: true, ui: null }, '', hash);
  route = parseRoute(hash); renderedHash = location.hash;
  renderResults(); updateNav(route.filters);
  const prefix = mode === 'preview' ? '테스트 자료' : '자료';
  announce(listResult.total ? `${prefix} ${listResult.total}건을 찾았습니다.` : '조건에 맞는 자료가 없습니다.');
}
function recordRow(record) {
  const tags = node('div', { class: 'record-top' }, badge(CATEGORIES[record.category]));
  if (record.isTest) tags.append(badge('테스트 자료', 'test'));
  if (isImportant(record)) tags.append(badge('중요', 'important'));
  const link = internal(title(record), routeHref('item', route.filters, record.id), { id: `record-${record.id}` });
  if (!record.title.ko) link.lang = record.language;
  const row = node('li', {}, tags, node('h3', {}, link));
  if (record.summary.ko) row.append(node('p', { class: 'record-summary' }, record.summary.ko));
  row.append(node('p', { class: 'record-meta' },
    node('span', {}, sourceOf(record).name),
    node('span', {}, `게시일: ${dateText(record.dates.published)}`),
    node('span', {}, `${ORIGINS[record.origin]} · ${LANGUAGES[record.language] || record.language}`)));
  return row;
}
function pagination(result) {
  if (result.pages <= 1) return null;
  const nav = node('nav', { class: 'pagination', 'aria-label': '자료 페이지' });
  if (result.page > 1) nav.append(internal('이전', routeHref('list', { ...route.filters, page: result.page - 1 }), { class: 'button', 'data-page': '', id: 'previous-page' }));
  nav.append(node('span', { class: 'page-number' }, `${result.page} / ${result.pages}페이지`));
  if (result.page < result.pages) nav.append(internal('다음', routeHref('list', { ...route.filters, page: result.page + 1 }), { class: 'button', 'data-page': '', id: 'next-page' }));
  return nav;
}
function renderResults() {
  listResult = selectRecords(catalog, route.filters);
  if (listResult.page !== route.filters.page) {
    route.filters = listResult.filters;
    history.replaceState(history.state, '', routeHref('list', route.filters));
    renderedHash = location.hash;
  }
  const region = document.querySelector('#results');
  const label = mode === 'preview' ? '테스트 자료' : '자료';
  const headingRow = node('div', { class: 'result-heading' }, heading(`${label} ${listResult.total}건`, 'results-title', 'h2'),
    node('p', {}, listResult.total ? `${(listResult.page - 1) * PAGE_SIZE + 1}–${Math.min(listResult.page * PAGE_SIZE, listResult.total)}번째 · ${route.filters.sort === 'added' ? '최근 추가순' : '게시일순'}` : ''));
  region.replaceChildren(headingRow);
  if (listResult.items.length) region.append(node('ul', { class: 'record-list', role: 'list' }, listResult.items.map(recordRow)), pagination(listResult) || '');
  else region.append(node('div', { class: 'empty' }, node('h3', {}, catalog.records.length ? '조건에 맞는 자료가 없습니다.' : '등록된 자료가 없습니다.'),
    node('p', { class: 'muted' }, catalog.records.length ? '검색어나 조건을 바꿔 보세요.' : '확인을 마친 자료부터 이곳에 올립니다.')));
}
function renderList() {
  document.title = '자료 찾기 · 쇼다운 모아보기';
  main.replaceChildren(node('div', { class: 'hero' }, node('div', {}, node('p', { class: 'eyebrow' }, 'IBSA 쇼다운 자료 모음'), heading('자료 찾기'), node('p', { class: 'lead' }, '쇼다운의 소식, 대회, 규칙과 연구를 한곳에서 살펴보세요.')), dataNote()),
    searchForm(route.filters), node('section', { class: 'result-section', id: 'results', 'aria-labelledby': 'results-title' }));
  const reload = node('button', {type:'button', id:'reload-data'}, '목록 다시 불러오기');
  reload.addEventListener('click', () => load({refresh:true}));
  document.querySelector('.hero').append(node('div',{},reload,node('p',{id:'reload-message',class:'muted'},'배포된 자료를 다시 확인합니다.')));
  renderResults();
}
function renderItem() {
  const record = catalog.records.find(r => r.id === route.id);
  if (!record) { renderMissing('자료를 찾을 수 없습니다.'); return; }
  document.title = `${title(record)} · 쇼다운 모아보기`;
  const article = node('article', { class: 'detail' }, internal('자료 목록으로', routeHref('list', route.filters), { class: 'back-link', 'data-back': '', id: 'back-to-list' }),
    node('div', { class: 'record-top' }, badge(CATEGORIES[record.category]), record.isTest ? badge('테스트 자료', 'test') : null),
    heading(title(record)));
  if (!record.title.ko) article.querySelector('h1').lang = record.language;
  if (record.title.ko && record.title.original !== record.title.ko) article.append(node('p', { class: 'original-title' }, '원제: ', node('span', { lang: record.language }, record.title.original)));
  if (isImportant(record)) article.append(node('p', {}, badge('중요', 'important'), ' ', record.importance.reason));
  const info = node('dl', { class: 'detail-grid' });
  infoPair(info, '출처', sourceOf(record).name);
  infoPair(info, '지역·언어', `${ORIGINS[record.origin]} · ${LANGUAGES[record.language] || record.language}`);
  infoPair(info, '게시일', dateText(record.dates.published));
  for (const [key, label] of [['modified', '수정일'], ['eventStart', '행사 시작일'], ['eventEnd', '행사 종료일'], ['effective', '시행일']]) if (record.dates[key]) infoPair(info, label, dateText(record.dates[key]));
  infoPair(info, '목록 추가일', timestampText(record.dates.firstSeenAt));
  infoPair(info, '원문 확인일', record.dates.lastVerifiedAt ? timestampText(record.dates.lastVerifiedAt) : '확인 안 됨');
  if (record.doi) infoPair(info, 'DOI', record.doi);
  article.append(node('section', { class: 'detail-card', 'aria-labelledby': 'info-title' }, node('h2', { id: 'info-title' }, '자료 정보'), info));
  article.append(node('section', { class: 'detail-card', 'aria-labelledby': 'summary-title' }, node('h2', { id: 'summary-title' }, '내용'), node('p', {}, record.summary.ko || '한국어 요약이 없습니다. 원제를 확인해 주세요.')));
  if (record.research) {
    const research = record.research;
    const types = { journal_article: '학술 논문', conference_paper: '학술대회 발표', preprint: '사전 공개 원고', dataset: '연구 원자료', training_case: '훈련 사례', simulation: '모의실험', vr_study: '가상현실 연구' };
    const dl = node('dl', { class: 'detail-grid' });
    infoPair(dl, '연구 종류', types[research.type] || '확인 안 됨');
    infoPair(dl, '참가자 수', research.participants === null ? '확인 안 됨' : `${research.participants}명`);
    infoPair(dl, '연구 결과', research.findings || '확인 안 됨');
    infoPair(dl, '해석 시 주의', research.limitations || '확인 안 됨');
    infoPair(dl, '원자료', research.datasetStatus === 'confirmed' && research.datasetUrl ? external('공개 원자료 보기', research.datasetUrl) : research.datasetStatus === 'not_shared' ? '공유하지 않음' : '공개 원자료 확인 안 됨');
    article.append(node('section', { class: 'detail-card', 'aria-labelledby': 'research-title' }, node('h2', { id: 'research-title' }, '연구 정보'), dl));
  }
  if (record.ruleInfo) {
    const states = { unconfirmed: '시행 여부 확인 안 됨', draft: '초안', approved: '승인본', translation: '번역본', supplement: '보충 문서', historical: '과거 문서' };
    article.append(node('section', { class: 'detail-card', 'aria-labelledby': 'rule-title' }, node('h2', { id: 'rule-title' }, '문서 상태'), node('p', {}, states[record.ruleInfo.status] || '확인 안 됨'), record.ruleInfo.version ? node('p', {}, `버전: ${record.ruleInfo.version}`) : null, node('p', {}, record.ruleInfo.note)));
  }
  const scopes = { metadata: '제목·기본 정보', search_excerpt: '검색 결과 일부', abstract: '초록', full_text: '원문 본문', test: '테스트 자료' };
  article.append(node('section', { class: 'detail-card', 'aria-labelledby': 'review-title' }, node('h2', { id: 'review-title' }, '확인 범위'),
    node('p', {}, scopes[record.review.scope]), node('p', { class: 'muted' }, record.review.note)));
  if (record.originalUrl) article.append(node('div', { class: 'detail-links' }, external('원문 보기', record.originalUrl, { class: 'button primary', id: 'original-link' })));
  else article.append(node('p', { class: 'muted' }, '실제 원문이 없는 테스트 자료입니다.'));
  if (record.attachments.length) article.append(node('section', { class: 'detail-card' }, node('h2', {}, '첨부 자료'), node('ul', { class: 'attachments' }, record.attachments.map(a => node('li', {}, external(`${a.name} (${a.format})`, a.url), a.accessNote ? node('p', { class: 'muted' }, a.accessNote) : null)))));
  if (record.relatedIds.length) article.append(node('section', { class: 'detail-card' }, node('h2', {}, '관련 자료'), node('ul', {}, record.relatedIds.map(id => {
    const related = catalog.records.find(r => r.id === id);
    return node('li', {}, internal(title(related), routeHref('item', route.filters, id), { id: `related-${id}` }));
  }))));
  main.replaceChildren(article);
}
function renderSources() {
  document.title = '자료 출처 · 쇼다운 모아보기';
  main.replaceChildren(heading('자료 출처'), node('p', { class: 'lead' }, '자료를 찾을 곳과 연결 상태를 모았습니다.'),
    node('p', { class: 'muted' }, '사이트 조사일과 자료 수집일은 다릅니다. 검색 경로는 자료의 원발행처가 아닐 수 있습니다.'));
  for (const [group, label] of Object.entries(SOURCE_GROUPS)) {
    const sources = catalog.sources.filter(s => s.group === group);
    if (!sources.length) continue;
    const list = node('ul', { class: 'source-list', role: 'list' });
    for (const source of sources) {
      const connection = { candidate: '연결 검토 중', manual: '직접 검색하는 곳', active: '자료 연결 중' }[source.connection];
      list.append(node('li', { id: `source-${source.id}` }, node('h3', {}, external(source.name, source.homepage, { id: `source-link-${source.id}` })),
        node('p', {}, `${source.region} · ${source.description}`), node('span', { class: 'source-status' }, connection),
        node('p', { class: 'source-info' }, `사이트 조사일: ${source.reviewedOn ? dateText({ value: source.reviewedOn, precision: 'day' }) : '확인 안 됨'}`),
        source.lastSuccessfulCollectionAt ? node('p', { class: 'source-info' }, `마지막 수집: ${timestampText(source.lastSuccessfulCollectionAt)}`) : null));
    }
    main.append(node('section', { class: 'source-group', 'aria-labelledby': `group-${group}` }, node('h2', { id: `group-${group}` }, `${label} ${sources.length}곳`), list));
  }
}
function renderMissing(message = '페이지를 찾을 수 없습니다.') {
  document.title = '자료 찾기 · 쇼다운 모아보기';
  main.replaceChildren(heading(message), node('p', { class: 'muted' }, '주소를 확인하거나 자료 목록으로 돌아가 주세요.'), internal('자료 목록으로', routeHref('list', route.filters), { class: 'button' }));
}
function render({ reason = 'navigate', restore = null } = {}) {
  if (!catalog) return;
  silence();
  renderedHash = location.hash;
  if (route.view === 'list') renderList();
  else if (route.view === 'item') renderItem();
  else if (route.view === 'sources') renderSources();
  else renderMissing();
  updateNav(route.filters);
  if (restore?.draft && route.view === 'list') {
    const form = document.querySelector('#search-form');
    for (const [key, value] of Object.entries(restore.draft)) if (form.elements.namedItem(key)) form.elements.namedItem(key).value = value;
    document.querySelector('#more-filters').open = restore.expanded;
  }
  requestAnimationFrame(() => {
    if (restore?.focusId && focusAt(restore.focusId, restore.scrollY)) return;
    if (reason === 'initial') return;
    focusAt(route.view === 'list' ? 'results-title' : 'page-title');
  });
}
function onHistory() {
  if (!catalog || location.hash === renderedHash) return;
  route = parseRoute(location.hash);
  render({ reason: 'history', restore: history.state?.ui || null });
}
window.addEventListener('popstate', onHistory);
window.addEventListener('hashchange', onHistory);
window.addEventListener('pagehide', () => { if (catalog) remember(); });
document.addEventListener('click', event => {
  const link = event.target.closest('a');
  if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  if (link.classList.contains('skip-link')) { event.preventDefault(); focusAt('main'); return; }
  if (!link.hasAttribute('data-route')) {
    if (catalog && link.href.startsWith('http')) remember();
    return;
  }
  event.preventDefault();
  if (link.hasAttribute('data-back')) { goBackToList(); return; }
  const hash = new URL(link.href).hash;
  if (hash === location.hash && route.view === 'list') { focusAt('results-title'); return; }
  navigate(hash);
});
async function load({refresh=false} = {}) {
  if (loading) return;
  loading = true;
  const retry = document.querySelector('#retry');
  const reload = document.querySelector('#reload-data');
  const previous = catalog;
  const restore = refresh ? snapshot() : history.state?.ui || null;
  if (retry) { retry.disabled = true; retry.textContent = '불러오는 중'; }
  if (reload) reload.setAttribute('aria-disabled','true');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(new URL('./data/catalog.json', document.baseURI), { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error('자료 파일에 접근하지 못했습니다.');
    const next = assertCatalog(await response.json(), mode);
    const releaseId = document.querySelector('meta[name="release-id"]')?.content;
    if (releaseId && next.releaseId !== releaseId) throw new Error('새 배포본이 있습니다. 페이지를 새로고침해 주세요.');
    if (refresh && previous && previous.releaseId === next.releaseId) {
      announce('현재 배포된 자료와 같습니다.');
      return;
    }
    catalog = next;
    if (!location.hash) history.replaceState({ hub: true, ui: null }, '', '#/list');
    else if (!history.state?.hub) history.replaceState({ hub: true, ui: null }, '', location.href);
    route = parseRoute(location.hash);
    render({ reason: refresh ? 'history' : retry ? 'navigate' : 'initial', restore });
    if (refresh) announce('배포된 자료를 다시 불러왔습니다.');
  } catch (error) {
    catalog = previous;
    if (previous) {
      const text = `목록을 갱신하지 못했습니다. 기존 자료를 유지합니다. ${error.message}`;
      const note = document.querySelector('#reload-message');
      if (note) { note.replaceChildren(document.createTextNode(text));
        const reopen=node('button',{type:'button'},'페이지 새로고침');
        reopen.addEventListener('click',()=>{remember();location.reload();});note.append(' ',reopen); }
      announce(text);
    } else {
      document.title = '자료 불러오기 오류 · 쇼다운 모아보기';
      main.replaceChildren(heading('자료를 불러오지 못했습니다.'), node('p', { class: 'muted' }, '연결 상태와 화면·자료 파일의 버전을 확인한 뒤 다시 시도해 주세요.'), node('button', { type: 'button', id: 'retry', class: 'primary' }, '다시 시도'));
      document.querySelector('#retry').addEventListener('click', () => load());
      focusAt('page-title');
    }
  } finally {
    clearTimeout(timeout); loading = false;
    document.querySelector('#reload-data')?.removeAttribute('aria-disabled');
  }
}
if (mode === 'preview') {
  const notice = document.querySelector('#preview-notice');
  notice.hidden = false;
  notice.querySelector('span').textContent = '자료 목록은 모두 가상 자료입니다. 출처 목록은 실제 조사한 사이트입니다.';
}
load();
