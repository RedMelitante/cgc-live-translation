// Operator console: hears the pastor (or the demo sermon), sends each line
// to be translated, holds it in the publish buffer, and publishes it to the
// big screen and the phones.
//
// Everything shared lives in the broadcast layer (shared/feed.js) and this
// page only renders it, so a second console, or this one after a reload,
// shows the same queue and the same countdowns. The only things kept here
// are per-console: which line source this laptop runs, and the text of an
// edit still being typed.

import config from '../shared/config.js';
import { openFeed, monthKey } from '../shared/feed.js';
import * as Q from '../shared/queue.js';
import { dir, present, placeholder, setText, fmtTime, API_LANG, NAME } from '../shared/captions.js';
import { qrSvg, shortUrl } from '../shared/qr.js';
import { every } from '../shared/clock.js';
import { createRecognizer } from './recognizer.js';
import { createDemoSource } from './demo-source.js';

const $ = id => document.getElementById(id);
const SILENCE_MS = 30000;
const FREE_TIER = 500000;
const HISTORY = 100;
const SOURCE_KEY = 'cgc-live-source';
const TRANSLATE_TIMEOUT_MS = 10000;

let feed;
const st = {
  session: null, queue: [], published: [], connected: false, phones: 0, usage: null,
  interim: '', heardAt: 0, listeningSince: 0, mic: { state: 'stopped', detail: '', since: 0 },
  drafts: new Map(), lastIssued: 0,
};
const publishing = new Set();
const cards = new Map();
let focusNext = null;
let source = null;
let applied = {};
let started = false;

main();

async function main() {
  try {
    feed = await openFeed({ role: 'console' });
  } catch (e) {
    $('loading').textContent = 'Couldn’t load the broadcast layer. Check the internet connection, then reload. (' + e.message + ')';
    return;
  }
  feed.watchUser(gate);
}

// ---- sign in ---------------------------------------------------------------

function gate(user) {
  if (started) { if (!user || user.operator === false) location.reload(); return; }
  $('loading').hidden = !(user && user.operator == null);
  $('loading').textContent = 'Checking the account…';
  $('signin').hidden = !!(user && user.operator == null);
  $('signin-form').hidden = !!user;
  $('not-operator').hidden = !(user && user.operator === false);
  if (user && user.operator === false) {
    $('not-operator-email').textContent = user.email || '(no email)';
    $('not-operator-uid').textContent = user.uid;
  }
  if (user && user.operator === true) start();
}

$('signin-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const err = $('signin-error');
  err.hidden = true;
  try {
    await feed.signIn(String(f.get('email')).trim(), String(f.get('password')));
  } catch (x) {
    err.hidden = false;
    err.textContent = /invalid-credential|wrong-password|user-not-found/.test(x.code || '')
      ? 'That email and password don’t match an operator account.'
      : 'Couldn’t sign in: ' + (x.code || x.message);
  }
});
$('signout').addEventListener('click', () => feed.signOut());

// ---- start -----------------------------------------------------------------

function start() {
  started = true;
  $('loading').hidden = true;
  $('signin').hidden = true;
  $('app').hidden = false;

  $('qr').innerHTML = qrSvg(config.phoneUrl);
  $('qr-url').textContent = shortUrl(config.phoneUrl);
  $('source').value = loadSource();

  feed.watchConnected(c => { st.connected = c; renderHeader(); });
  feed.watchPhones(n => { st.phones = n; renderHeader(); });
  feed.watchUsage(u => { st.usage = u; renderHeader(); });
  feed.watchSession(s => {
    const autoChanged = !st.session || st.session.autoPublish !== s.autoPublish || st.session.bufferSeconds !== s.bufferSeconds;
    st.session = s;
    if (autoChanged) renderQueueNote();
    renderHeader(); renderLeft(); renderHistory(); renderQueue(); syncSource();
  });
  feed.watchQueue(q => { st.queue = q; renderQueue(); renderHeader(); });
  feed.watchPublished(HISTORY, p => { st.published = p; renderHistory(); renderLeft(); renderHeader(); });

  // Not setInterval: see shared/clock.js (hidden tabs).
  every(250, tick);
}

function tick() {
  if (!st.session) return;
  const now = feed.now();
  for (const line of st.queue) if (Q.isDue(line, st.session, now)) publish(line);
  renderQueue();
  renderMeter();
  renderHearing();
  renderHeader();
}

// ---- problems the operator must see -----------------------------------------
// Firebase reports a refused write (wrong account, rules) only through the
// returned promise. Nothing here swallows one: the console says so.

function guard(promise, what) {
  return Promise.resolve(promise).catch(e => {
    showAlert(`Couldn’t ${what}: ${e && (e.code || e.message) || e}`);
    throw e;
  }).catch(() => {});
}
function showAlert(text) {
  $('alert').hidden = false;
  $('alert').querySelector('span').textContent = text;
}
$('alert').querySelector('button').addEventListener('click', () => { $('alert').hidden = true; });

// ---- line source: the mic, the demo sermon, or nothing -----------------------

function loadSource() {
  let v = null;
  try { v = localStorage.getItem(SOURCE_KEY); } catch {}
  return v === 'mic' || v === 'demo' || v === 'off' ? v : feed.mode === 'demo' ? 'demo' : 'mic';
}

$('source').addEventListener('change', e => {
  try { localStorage.setItem(SOURCE_KEY, e.target.value); } catch {}
  syncSource();
});

function syncSource() {
  if (!st.session) return;
  const kind = $('source').value;
  const d = dir(st.session);
  const paused = st.session.paused;
  if (!source || source.kind !== kind) {
    if (source) source.stop();
    source = null;
    applied = {};
    st.mic = { state: 'stopped', detail: '', since: Date.now() };
    if (kind === 'mic') source = createRecognizer({ onInterim, onFinal: text => onFinal(text), onState: onMicState });
    if (kind === 'demo') source = createDemoSource({ onInterim, onFinal });
  }
  if (!source) { st.interim = ''; renderHeader(); renderHearing(); return; }
  if (applied.lang !== d.src) source.setLanguage(d.src, d.recognition);
  if (applied.paused !== paused) {
    if (paused) source.stop();
    else { source.start(); st.listeningSince = Date.now(); st.heardAt = 0; }
  }
  applied = { lang: d.src, paused };
  renderHeader(); renderHearing();
}

function onInterim(text) {
  st.interim = text || '';
  if (text) st.heardAt = Date.now();
}

function onMicState(state, detail) {
  const before = st.mic.state;
  st.mic = { state, detail: detail || '', since: before === state ? st.mic.since : Date.now() };
  // Chrome restarts its session every few seconds of silence and that stays
  // 'listening'; only a real change restarts the silence clock.
  if (state === 'listening' && before !== 'listening') st.listeningSince = Date.now();
  renderHeader(); renderHearing();
}

// Recognition that never reports starting is a failure too, not a wait:
// the console must not say "starting" forever while nothing is heard.
const STUCK_MS = 10000;
function micStuck() {
  return $('source').value === 'mic' && st.session && !st.session.paused
    && (st.mic.state === 'starting' || st.mic.state === 'stopped')
    && Date.now() - (st.mic.since || 0) > STUCK_MS;
}

// For checking a rehearsal from the browser's console (no UI): how often the
// recognizer had to restart a stalled session, and the mic level it sees.
window.cgcDiagnostics = {
  stats: () => (source && source.stats ? source.stats() : null),
  level: () => (source ? source.level() : null),
};

addEventListener('beforeunload', e => {
  if (source && source.kind === 'mic' && st.session && !st.session.paused) e.preventDefault();
});

// ---- a heard line: queue it, translate it -----------------------------------

function nextLineNumber() {
  let max = st.lastIssued;
  for (const l of st.queue) max = Math.max(max, l.n || 0);
  for (const l of st.published) max = Math.max(max, l.n || 0);
  return (st.lastIssued = max + 1);
}

function onFinal(src, knownTranslation) {
  st.heardAt = Date.now();
  const s = st.session;
  const d = dir(s);
  const line = Q.newLine({ n: nextLineNumber(), src, srcLang: d.src, tgtLang: d.tgt, bufferMs: s.bufferSeconds * 1000, now: feed.now() });
  const { id, done } = feed.addLine(line);
  guard(done, 'add a line to the queue');
  if (knownTranslation != null) {
    // The demo sermon knows its own translations and never calls Google.
    guard(feed.patchLine(id, Q.translated(line, knownTranslation, st.session, feed.now())), 'update a line');
    const u = currentUsage();
    guard(feed.setUsage({ month: monthKey(), chars: u + src.length, limit: FREE_TIER }), 'update the usage count');
    return;
  }
  translateLine(id, line);
}

async function translateLine(id, line) {
  const latest = () => st.queue.find(l => l.id === id) || line;
  try {
    if (feed.mode === 'demo') throw new Error('Demo mode doesn’t translate. Set up Firebase and the translation key first (README)');
    const result = await translate(line.src, line.srcLang, line.tgtLang);
    const patch = Q.translated(latest(), result.text, st.session, feed.now());
    if (patch) guard(feed.patchLine(id, patch), 'update a line');
    if (result.usage) guard(feed.setUsage(result.usage), 'update the usage count');
  } catch (e) {
    const patch = Q.translateFailed({ ...latest(), status: 'translating' }, e.message);
    guard(feed.patchLine(id, patch), 'update a line');
  }
}

async function translate(text, from, to) {
  const token = await feed.idToken();
  let res;
  try {
    res = await fetch(new URL(config.translateUrl, location.href), {
      method: 'POST',
      // The sign-in token rides in the body, not an Authorization header:
      // shared Apache hosting often strips that header before PHP sees it.
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, source: API_LANG[from], target: API_LANG[to], idToken: token }),
      signal: AbortSignal.timeout(TRANSLATE_TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(e.name === 'TimeoutError' ? 'The translation service took too long to answer' : 'Couldn’t reach the translation service');
  }
  let data = null;
  try { data = await res.json(); } catch {}
  if (!data) throw new Error(`The translation service answered ${res.status} with no result`);
  if (!res.ok || !data.ok) throw new Error(data.message || `Translation failed (${res.status})`);
  return data;
}

function currentUsage() {
  return st.usage && st.usage.month === monthKey() ? st.usage.chars || 0 : 0;
}

// ---- publishing ------------------------------------------------------------

function publish(line) {
  if (publishing.has(line.id)) return;
  publishing.add(line.id);
  const record = Q.publishedRecord(line, st.drafts.get(line.id), feed.now());
  st.drafts.delete(line.id);
  guard(feed.publishLine(line.id, record), 'publish a line').finally(() => publishing.delete(line.id));
}

// ---- header ----------------------------------------------------------------

function chip(el, cls, text) {
  el.className = 'chip ' + cls;
  el.querySelector('span').textContent = text;
}

function renderHeader() {
  if (!st.session) return;
  const s = st.session;
  const kind = $('source').value;

  if (kind === 'off') chip($('chip-mic'), 'idle', 'No line source');
  else if (s.paused) chip($('chip-mic'), 'bad', kind === 'demo' ? 'Demo paused' : 'Mic paused');
  else if (kind === 'demo') chip($('chip-mic'), 'info', 'Demo sermon');
  else {
    const m = st.mic.state;
    if (m === 'listening') chip($('chip-mic'), 'ok', 'Mic live');
    else if (m === 'blocked') chip($('chip-mic'), 'bad', 'Mic blocked');
    else if (m === 'no-mic') chip($('chip-mic'), 'bad', 'No mic');
    else if (m === 'unsupported') chip($('chip-mic'), 'bad', 'Needs Chrome');
    else if (m === 'network') chip($('chip-mic'), 'bad', 'Recognition offline');
    else if (m === 'error') chip($('chip-mic'), 'bad', 'Mic error');
    else if (m === 'stuck') chip($('chip-mic'), 'bad', 'Recognition stuck');
    else if (micStuck()) chip($('chip-mic'), 'bad', 'Mic not starting');
    else chip($('chip-mic'), 'warn', 'Mic starting…');
  }

  if (feed.mode === 'demo') chip($('chip-broadcast'), 'info', 'Demo · this browser only');
  else if (st.connected) chip($('chip-broadcast'), 'ok', 'Broadcast connected');
  else chip($('chip-broadcast'), 'bad', 'Broadcast disconnected');
  $('chip-phones').querySelector('span').textContent = String(st.phones);

  const used = currentUsage();
  const u = $('usage');
  u.textContent = `${used.toLocaleString('en-US')} / 500k`;
  u.className = 'usage-value' + (used >= FREE_TIER ? ' over' : used >= FREE_TIER * 0.8 ? ' near' : '');

  for (const b of $('direction').querySelectorAll('button')) {
    const on = b.dataset.dir === s.direction;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  }
  $('auto').classList.toggle('on', !!s.autoPublish);
  $('auto').setAttribute('aria-checked', String(!!s.autoPublish));

  const p = $('pause');
  p.classList.toggle('paused', !!s.paused);
  p.querySelector('i').className = 'ti ' + (s.paused ? 'ti-player-play' : 'ti-player-pause');
  const nothingYet = !st.queue.length && !st.published.length;
  const label = s.paused ? (nothingYet ? 'Start' : 'Resume') : 'Pause';
  p.querySelector('span').textContent = label;
  p.setAttribute('aria-label', label);
}

$('pause').addEventListener('click', () => {
  if (st.session) guard(feed.setSession({ paused: !st.session.paused }), 'pause or resume');
});

$('direction').addEventListener('click', e => {
  const b = e.target.closest('button[data-dir]');
  if (b && st.session && b.dataset.dir !== st.session.direction) guard(feed.setSession({ direction: b.dataset.dir }), 'change the direction');
});

$('auto').addEventListener('click', () => {
  if (!st.session) return;
  const on = !st.session.autoPublish;
  // Session first: while it says off, no console publishes, and while the
  // lines have no publishAt yet, none counts down. Either order is safe.
  guard(feed.setSession({ autoPublish: on }), 'switch auto-publish');
  const patches = Q.autoPublishChanged(st.queue, on, feed.now());
  for (const [id, patch] of Object.entries(patches)) guard(feed.patchLine(id, patch), 'update a line');
});

function renderQueueNote() {
  const note = $('queue-note');
  note.textContent = '';
  if (!st.session.autoPublish) { note.textContent = 'Auto-publish off · every line needs approval'; return; }
  const sel = document.createElement('select');
  sel.title = 'How long each line waits in the queue';
  for (let s = 3; s <= 20; s++) sel.add(new Option(`${s}s`, String(s), false, s === st.session.bufferSeconds));
  sel.addEventListener('change', () => guard(feed.setSession({ bufferSeconds: Number(sel.value) }), 'change the buffer'));
  note.append('Lines wait ', sel, ' before going out');
}

// ---- left column -----------------------------------------------------------

function renderHearing() {
  if (!st.session) return;
  const s = st.session;
  const d = dir(s);
  const kind = $('source').value;
  $('hearing-label').textContent = 'Hearing now · ' + NAME[d.src];

  const box = $('interim');
  let text = st.interim, quiet = false, lang = d.src;
  if (kind === 'off') { text = 'No line source on this console.'; quiet = true; lang = 'en'; }
  else if (s.paused) { text = 'Recognition paused.'; quiet = true; lang = 'en'; }
  box.classList.toggle('quiet', quiet);
  setText(box.querySelector('.interim-text'), text, lang);

  const hint = $('silence');
  const stuck = micStuck();
  const micProblem = stuck || (kind === 'mic' && !s.paused && ['blocked', 'no-mic', 'unsupported', 'network', 'error', 'stuck'].includes(st.mic.state));
  const quietFor = Date.now() - Math.max(st.heardAt, st.listeningSince);
  const silent = kind === 'mic' && !s.paused && st.mic.state === 'listening' && st.listeningSince && quietFor > SILENCE_MS;
  hint.hidden = !(micProblem || silent);
  hint.classList.toggle('bad', micProblem);
  hint.querySelector('i').className = 'ti ' + (micProblem ? 'ti-microphone-off' : 'ti-volume-off');
  hint.querySelector('span').textContent = stuck
    // The recognizer opens the mic before anything else, so a long wait here
    // is almost always Chrome waiting for someone to answer its mic question.
    ? 'The microphone hasn’t opened. If Chrome is asking to use it (by the address bar), choose Allow. Otherwise reload this page (Ctrl+R) and press Resume.'
    : micProblem ? st.mic.detail
    : `No speech heard for ${Math.floor(quietFor / 1000)}s. Check the feed from the sound board.`;

  $('device').textContent = kind === 'mic'
    ? (source && source.deviceLabel && source.deviceLabel() ? source.deviceLabel() : 'Chrome’s chosen microphone')
    : kind === 'demo' ? 'Sample sermon, John 15 · no microphone' : '';
}

function renderMeter() {
  const level = source && st.session && !st.session.paused ? source.level() : 0;
  const bars = $('meter').children;
  $('meter').classList.toggle('off', !level);
  const t = Date.now() / 120;
  for (let i = 0; i < bars.length; i++) {
    const wobble = 0.55 + 0.45 * Math.abs(Math.sin(t + i * 1.7));
    bars[i].style.height = `${4 + Math.round(level * wobble * 12)}px`;
  }
}

function renderLeft() {
  if (!st.session) return;
  const s = st.session;
  const d = dir(s);
  const last = st.published[st.published.length - 1];
  const p = last ? present(last, s) : placeholder(s);
  const main = $('preview').querySelector('.preview-main');
  setText(main, p.main, p.mainLang);
  main.classList.toggle('placeholder', !last);
  const sub = $('preview').querySelector('.preview-sub');
  setText(sub, p.sub, p.subLang);
  sub.hidden = !(s.showSource && p.sub);
  $('show-source').textContent = s.showSource ? `Hide the ${NAME[d.src]} line` : `Show the ${NAME[d.src]} line`;
  $('show-qr').textContent = s.showQr ? 'Hide from big screen' : 'Show on big screen →';
}

$('show-source').addEventListener('click', () => guard(feed.setSession({ showSource: !st.session.showSource }), 'change the big screen'));
$('show-qr').addEventListener('click', () => guard(feed.setSession({ showQr: !st.session.showQr }), 'change the big screen'));

// ---- publish queue -----------------------------------------------------------

const PILL = {
  counting: v => `Publishes in ${v.secs}s`,
  held: () => 'On hold',
  editing: () => 'Editing · paused',
  approval: () => 'Needs approval',
  translating: () => 'Translating…',
  failed: () => 'Translation failed',
};

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

function makeCard(id) {
  const root = el('div', 'line');
  root.innerHTML = `
    <div class="bar"><div></div></div>
    <div class="inner">
      <div class="row"><span class="mono-label num"></span><span class="pill"></span></div>
      <div class="src"></div>
      <div class="tgt"></div>
      <textarea rows="2" hidden></textarea>
      <div class="actions">
        <button class="btn outline" data-act="edit"><i class="ti ti-pencil"></i>Edit</button>
        <button class="btn outline" data-act="hold"><i class="ti"></i><span></span></button>
        <button class="btn outline" data-act="retry"><i class="ti ti-refresh"></i>Retry translation</button>
        <button class="btn save" data-act="save"><i class="ti ti-check"></i>Save edit</button>
        <button class="btn discard" data-act="discard"><i class="ti ti-trash"></i>Discard</button>
        <button class="btn publish" data-act="publish">Publish now<i class="ti ti-arrow-right"></i></button>
      </div>
    </div>`;
  const q = s => root.querySelector(s);
  const card = {
    root, bar: q('.bar > div'), num: q('.num'), pill: q('.pill'), src: q('.src'), tgt: q('.tgt'), area: q('textarea'),
    btn: Object.fromEntries([...root.querySelectorAll('[data-act]')].map(b => [b.dataset.act, b])),
  };
  card.area.addEventListener('input', () => st.drafts.set(id, card.area.value));
  card.area.addEventListener('keydown', e => {
    // Captions are one line: Enter saves, as the Save edit button does.
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); act(id, 'save'); }
  });
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (b && !b.disabled) act(id, b.dataset.act);
  });
  return card;
}

function act(id, what) {
  const line = st.queue.find(l => l.id === id);
  if (!line) return;
  const now = feed.now();
  if (what === 'publish') return publish(line);
  if (what === 'discard') { st.drafts.delete(id); return guard(feed.discardLine(id), 'discard a line'); }
  if (what === 'retry') {
    const patch = Q.retrying(line);
    if (!patch) return;
    guard(feed.patchLine(id, patch), 'update a line');
    return translateLine(id, { ...line, ...patch });
  }
  let patch = null;
  if (what === 'edit') {
    patch = Q.startEdit(line, now);
    st.drafts.set(id, line.tgt || '');
    focusNext = id;
  }
  if (what === 'save') {
    const draft = st.drafts.has(id) ? st.drafts.get(id) : line.tgt;
    patch = Q.saveEdit(line, draft, st.session, now);
    st.drafts.delete(id);
  }
  if (what === 'hold') patch = line.status === 'held' ? Q.resume(line, st.session, now) : Q.hold(line, now);
  if (patch) guard(feed.patchLine(id, patch), 'update a line');
}

function renderQueue() {
  if (!st.session) return;
  const now = feed.now();
  const box = $('queue');
  const seen = new Set();
  let prev = $('queue-empty');
  $('queue-empty').hidden = st.queue.length > 0;

  for (const line of st.queue) {
    seen.add(line.id);
    let card = cards.get(line.id);
    if (!card) { card = makeCard(line.id); cards.set(line.id, card); }
    if (prev.nextSibling !== card.root) prev.after(card.root);
    prev = card.root;

    const v = Q.view(line, st.session, now);
    card.root.className = 'line k-' + v.kind;
    card.bar.style.width = v.pct + '%';
    card.num.textContent = 'Line ' + line.n;
    card.pill.textContent = PILL[v.kind](v);
    setText(card.src, line.src, line.srcLang);

    const editing = !!line.editing;
    card.area.hidden = !editing;
    card.tgt.hidden = editing;
    if (editing) {
      if (!st.drafts.has(line.id)) st.drafts.set(line.id, line.tgt || '');
      if (document.activeElement !== card.area && card.area.value !== st.drafts.get(line.id)) card.area.value = st.drafts.get(line.id);
      if (card.area.getAttribute('lang') !== (line.tgtLang === 'zh' ? 'zh-CN' : 'en')) card.area.setAttribute('lang', line.tgtLang === 'zh' ? 'zh-CN' : 'en');
      if (focusNext === line.id) { focusNext = null; card.area.focus(); card.area.select(); }
    } else {
      st.drafts.delete(line.id);
      card.tgt.classList.toggle('waiting', v.kind === 'translating');
      card.tgt.classList.toggle('missing', !line.tgt && v.kind === 'failed');
      if (line.tgt) setText(card.tgt, line.tgt, line.tgtLang);
      else if (v.kind === 'translating') setText(card.tgt, 'Translating…', 'en');
      else setText(card.tgt, `No translation: ${line.error || 'it failed'}. Retry, type one with Edit, or publish the ${NAME[line.srcLang] || 'source'} line alone.`, 'en');
    }

    const b = card.btn;
    b.edit.hidden = editing || v.kind === 'translating';
    b.hold.hidden = editing || !(line.status === 'pending' || line.status === 'held');
    b.hold.querySelector('i').className = 'ti ' + (line.status === 'held' ? 'ti-player-play' : 'ti-player-pause');
    b.hold.querySelector('span').textContent = line.status === 'held' ? 'Resume' : 'Hold';
    b.hold.setAttribute('aria-label', line.status === 'held' ? 'Resume' : 'Hold');
    b.retry.hidden = line.status !== 'failed';
    b.save.hidden = !editing;
    b.publish.disabled = v.kind === 'translating';
  }

  for (const [id, card] of cards) {
    if (!seen.has(id)) { card.root.remove(); cards.delete(id); st.drafts.delete(id); }
  }
}

// ---- published history -------------------------------------------------------

function renderHistory() {
  if (!st.session) return;
  const box = $('history');
  const frag = document.createDocumentFragment();
  for (const line of [...st.published].reverse()) {
    const p = present(line, st.session);
    const row = el('div', 'entry');
    const meta = el('div', 'meta');
    meta.append(el('span', 'time'));
    meta.firstChild.textContent = fmtTime(line.publishedAt);
    if (line.edited) { const t = el('span', 'tag edited'); t.textContent = 'Edited'; meta.append(t); }
    if (line.untranslated) { const t = el('span', 'tag untranslated'); t.textContent = 'Not translated'; meta.append(t); }
    const main = el('div', 'main');
    setText(main, p.main, p.mainLang);
    row.append(meta, main);
    if (p.sub) { const sub = el('div', 'sub'); setText(sub, p.sub, p.subLang); row.append(sub); }
    frag.append(row);
  }
  const keep = box.scrollTop;
  box.replaceChildren(frag);
  box.scrollTop = keep;
  $('published-count').textContent = `${st.published.length} line${st.published.length === 1 ? '' : 's'}`;
}

$('new-service').addEventListener('click', () => {
  const ok = confirm('Start a new service?\n\nThis clears the big screen, the phones, the queue and this list, and pauses the mic. Do it before the service, not during it.');
  if (!ok) return;
  st.drafts.clear();
  st.lastIssued = 0;
  guard(feed.newService(), 'start a new service');
});
