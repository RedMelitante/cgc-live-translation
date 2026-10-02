// Big screen: the current caption, large, with the line before it dimmed
// above. Open it full screen on the projector (double-click toggles full
// screen). It only ever reads published lines.

import config from '../shared/config.js';
import { openFeed } from '../shared/feed.js';
import { dir, present, placeholder, setText } from '../shared/captions.js';
import { qrSvg, shortUrl } from '../shared/qr.js';

const $ = id => document.getElementById(id);
// A blip shorter than this doesn't flash "Reconnecting…" at the room.
const RECONNECT_GRACE_MS = 2500;
const MIN_FIT = 0.55;

let session = null, lines = [], mode = 'firebase';
let lostTimer = null, reconnecting = false;

start();

async function start() {
  let feed;
  try {
    feed = await openFeed({ role: 'screen' });
  } catch {
    // The SDK couldn't load (no internet yet when the projector PC woke).
    showReconnecting(true);
    setTimeout(() => location.reload(), 10000);
    return;
  }
  mode = feed.mode;
  feed.watchSession(s => { session = s; render(); });
  feed.watchPublished(2, l => { lines = l; render(); });
  feed.watchConnected(c => {
    clearTimeout(lostTimer);
    if (c) showReconnecting(false);
    else lostTimer = setTimeout(() => showReconnecting(true), RECONNECT_GRACE_MS);
  });
  $('qr').innerHTML = qrSvg(config.phoneUrl, { dark: '#1E2780' });
  $('qr-url').textContent = shortUrl(config.phoneUrl);
}

function showReconnecting(on) {
  reconnecting = on;
  $('stage').classList.toggle('reconnecting', on);
  render();
}

function render() {
  if (!session) {
    $('top-right').textContent = reconnecting ? 'Reconnecting…' : 'Scan for captions on your phone';
    return;
  }
  const d = dir(session);
  const label = $('live-label');
  label.textContent = '';
  const word = document.createElement('span');
  word.textContent = mode === 'demo' ? 'Demo · ' : 'Live · ';
  const what = document.createElement('span');
  setText(what, d.tgt === 'zh' ? '中文字幕' : 'English captions', d.tgt);
  label.append(word, what);
  $('top-right').textContent = reconnecting ? 'Reconnecting…' : 'Scan for captions on your phone';

  const cur = lines[lines.length - 1];
  const prev = lines[lines.length - 2];
  const p = cur ? present(cur, session) : placeholder(session);
  setText($('current'), p.main, p.mainLang);
  $('current').classList.toggle('placeholder', !cur);
  setText($('sub'), p.sub, p.subLang);
  $('sub').hidden = !(session.showSource && p.sub);
  if (prev) { const pp = present(prev, session); setText($('previous'), pp.main, pp.mainLang); }
  $('previous').hidden = !prev;

  $('qr-panel').hidden = !session.showQr;
  setText($('qr-t1'), d.tgt === 'zh' ? '扫码，在手机上看字幕' : 'Captions on your phone', d.tgt);

  fit();
}

// A long line must never run off the top of the screen: drop the previous
// line first, then shrink the current one until it fits. The previous line
// also goes when the current one fills most of the screen, so the two
// never crowd against the top row.
const CURRENT_MAX_SHARE = 0.6;
function fit() {
  const box = $('captions');
  const root = document.documentElement;
  root.style.setProperty('--fit', '1');
  // The captions sit at the bottom, so a long line overflows *upward*, and
  // scrollHeight doesn't count that. Compare where the first line starts.
  const over = () => {
    const first = $('previous').hidden ? box.querySelector('.current-block') : $('previous');
    return first.getBoundingClientRect().top < box.getBoundingClientRect().top - 1;
  };
  const crowded = () => box.querySelector('.current-block').offsetHeight > box.clientHeight * CURRENT_MAX_SHARE;
  if (!over() && !crowded()) return;
  $('previous').hidden = true;
  let f = 1;
  while (over() && f > MIN_FIT) {
    f = Math.max(MIN_FIT, f - 0.05);
    root.style.setProperty('--fit', String(f));
  }
}

addEventListener('resize', () => render());
// The fit is measured in the real font, which may arrive after the first line.
document.fonts && document.fonts.ready.then(() => render());

addEventListener('dblclick', () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
});

// Keep the projector PC from sleeping or dimming mid-sermon.
async function keepAwake() {
  try { if (document.visibilityState === 'visible') await navigator.wakeLock.request('screen'); } catch {}
}
keepAwake();
document.addEventListener('visibilitychange', keepAwake);
