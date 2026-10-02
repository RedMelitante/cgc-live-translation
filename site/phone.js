// Phone page (cgcmultimedia.com/live, from the QR code): the last few
// captions, newest at the bottom. Must stay light and keep working on
// church wifi: the Firebase SDK reconnects by itself after a drop, and this
// page only says so quietly.
//
// Language mode and text size are per phone, kept in localStorage.

import { openFeed } from './shared/feed.js';
import { dir, present, placeholder, setText, NAME } from './shared/captions.js';

const $ = id => document.getElementById(id);
const SHOW = 5;
const SIZES = [[16, 20], [18, 23], [21, 27]]; // older / latest, px
const PREFS_KEY = 'cgc-live-phone';
const RECONNECT_GRACE_MS = 2500;

const prefs = loadPrefs();
let session = null, lines = [], reconnecting = false, lostTimer = null;

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
    return { mode: p.mode === 'tgt' ? 'tgt' : 'both', size: [0, 1, 2].includes(p.size) ? p.size : 1 };
  } catch { return { mode: 'both', size: 1 }; }
}
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
}

$('size').addEventListener('click', () => { prefs.size = (prefs.size + 1) % SIZES.length; savePrefs(); render(); });
$('langs').addEventListener('click', e => {
  const b = e.target.closest('button[data-mode]');
  if (b) { prefs.mode = b.dataset.mode; savePrefs(); render(); }
});

start();

async function start() {
  render();
  let feed;
  try {
    feed = await openFeed({ role: 'phone' });
  } catch {
    showReconnecting(true);
    setTimeout(() => location.reload(), 8000);
    return;
  }
  feed.watchSession(s => { session = s; render(); });
  feed.watchPublished(SHOW, l => { lines = l; render(); });
  feed.watchConnected(c => {
    clearTimeout(lostTimer);
    if (c) showReconnecting(false);
    else lostTimer = setTimeout(() => showReconnecting(true), RECONNECT_GRACE_MS);
  });
  feed.joinAsPhone();
}

function showReconnecting(on) {
  reconnecting = on;
  $('page').classList.toggle('reconnecting', on);
  render();
}

function render() {
  const d = dir(session);
  $('live-label').textContent = reconnecting ? 'Reconnecting…' : 'Live sermon captions';

  // Tab labels follow the direction: 中文 + English / 中文, or the reverse.
  const [both, tgt] = $('langs').children;
  both.innerHTML = '';
  const a = document.createElement('span'); setText(a, NAME[d.tgt], d.tgt);
  const b = document.createElement('span'); setText(b, ' + ' + NAME[d.src], d.src);
  both.append(a, b);
  both.setAttribute('aria-label', `${NAME[d.tgt]} + ${NAME[d.src]}`);
  setText(tgt, NAME[d.tgt], d.tgt);
  both.classList.toggle('on', prefs.mode === 'both');
  tgt.classList.toggle('on', prefs.mode === 'tgt');

  const [older, latest] = SIZES[prefs.size];
  const box = $('lines');
  box.style.setProperty('--old', older + 'px');
  box.style.setProperty('--new', latest + 'px');
  box.replaceChildren();

  if (!lines.length) {
    const w = document.createElement('div');
    w.className = 'waiting';
    const p = placeholder(session);
    setText(w, p.main, p.mainLang);
    box.append(w);
    return;
  }
  lines.forEach((line, i) => {
    const p = present(line, session || {});
    const item = document.createElement('div');
    item.className = i === lines.length - 1 ? 'latest' : 'old';
    const main = document.createElement('div');
    main.className = 'main';
    setText(main, p.main, p.mainLang);
    item.append(main);
    if (prefs.mode === 'both' && p.sub) {
      const sub = document.createElement('div');
      sub.className = 'sub';
      setText(sub, p.sub, p.subLang);
      item.append(sub);
    }
    box.append(item);
  });
}

// Phones dim after a minute or so; captions are read for forty.
async function keepAwake() {
  try { if (document.visibilityState === 'visible') await navigator.wakeLock.request('screen'); } catch {}
}
keepAwake();
document.addEventListener('visibilitychange', keepAwake);
