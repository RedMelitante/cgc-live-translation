// What every screen needs to know about languages and directions.
//
// A line keeps the two languages it was made in (srcLang/tgtLang), so a line
// published before the operator flipped the direction still has both texts.
// What a screen shows *large* follows the session's current direction: the
// text in the current target language, whichever field holds it.

export const DIRECTIONS = {
  'en-zh': { src: 'en', tgt: 'zh', label: 'EN → 中文', recognition: 'en-US' },
  'zh-en': { src: 'zh', tgt: 'en', label: '中文 → EN', recognition: 'cmn-Hans-CN' },
};

export function dir(session) {
  return DIRECTIONS[session && session.direction] || DIRECTIONS['en-zh'];
}

// Google Translate's language codes.
export const API_LANG = { en: 'en', zh: 'zh-CN' };
// The HTML lang attribute, which picks the font (tokens.css).
export const HTML_LANG = { en: 'en', zh: 'zh-CN' };
// Names as the audience reads them.
export const NAME = { en: 'English', zh: '中文' };

function textIn(line, lang) {
  if (line.tgtLang === lang && line.tgt) return line.tgt;
  if (line.srcLang === lang && line.src) return line.src;
  return null;
}

// { main, mainLang, sub, subLang } for showing a line under this session's
// direction. A line that never got a translation shows its source large, and
// has no second line.
export function present(line, session) {
  const d = dir(session);
  const main = textIn(line, d.tgt);
  const sub = textIn(line, d.src);
  if (main) return { main, mainLang: d.tgt, sub: sub && sub !== main ? sub : null, subLang: d.src };
  const only = sub || line.src || line.tgt || '';
  return { main: only, mainLang: sub ? d.src : line.srcLang, sub: null, subLang: d.src };
}

export function placeholder(session) {
  return dir(session).tgt === 'zh'
    ? { main: '字幕将在这里显示', mainLang: 'zh', sub: null }
    : { main: 'Captions will appear here', mainLang: 'en', sub: null };
}

// Sets an element's text and the lang attribute that picks its font.
export function setText(el, text, lang) {
  if (el.textContent !== (text || '')) el.textContent = text || '';
  const l = HTML_LANG[lang] || 'en';
  if (el.getAttribute('lang') !== l) el.setAttribute('lang', l);
}

export const fmtTime = ms => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
