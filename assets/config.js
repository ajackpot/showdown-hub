export const APP_VERSION = '0.6.1';
export const SCHEMA_VERSION = '1.0.0';
export const PAGE_SIZE = 20;
export const CATEGORIES = Object.freeze({
  news: '소식', events: '대회·결과', rules: '규칙·운영', training: '훈련·장비', research: '연구'
});
export const ORIGINS = Object.freeze({ domestic: '국내', overseas: '해외', international: '국제', unknown: '지역 미확인' });
export const LANGUAGES = Object.freeze({ ko: '한국어', en: '영어', de: '독일어', fr: '프랑스어', it: '이탈리아어', cs: '체코어', ru: '러시아어', fi: '핀란드어', nl: '네덜란드어', und: '언어 미확인' });
export const SOURCE_GROUPS = Object.freeze({ sport: '종목·기관·전문 사이트', research: '연구 발행처', discovery: '자료 검색 경로' });
export const DEFAULT_FILTERS = Object.freeze({ q: '', category: 'all', origin: 'all', from: '', to: '', sort: 'added', page: 1 });
