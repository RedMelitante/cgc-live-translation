// The pastor's mic, through Chrome's speech recognition (webkitSpeechRecognition).
// Only Chrome (and Edge) have it, and only on https or localhost. The audio
// goes to Google's recognizer; Chrome uses the microphone picked in its own
// site settings (the lock icon → Site settings → Microphone), so that's where
// the USB audio interface is chosen.
//
// Chrome ends a recognition session on its own: after silence, after a
// network blip, or every few minutes regardless. While we want to listen,
// every end is followed by a fresh start. Words spoken in the fraction of a
// second between the two are lost; that's the API, not something to fix here.
//
// Found on the first real run (Chrome 154, Windows): a recognition session
// started while Chrome was still asking for the microphone never started,
// never failed and never ended, and every later session on that page queued
// behind it until a reload. So the mic is opened (and the question answered)
// *before* recognition starts, and a session that hasn't reported starting
// within a few seconds is abandoned for a fresh one.

// A line shouldn't grow forever when the pastor doesn't pause: past this
// much interim text, ask Chrome to finish the line (stop() keeps what it has
// heard; the restart picks up the next words). Tune at rehearsal.
import { createAssembler, plainEvent } from './transcript.js';
import { every } from '../shared/clock.js';

const MAX_INTERIM = { en: 160, zh: 60 };
const MAX_INTERIM_MS = 15000;
// Chrome ends a session every 20-60 s even mid-speech, and the mic is deaf
// until the next one is listening: measured 100-200 ms of our own delay plus
// Chrome's warm-up, enough to lose a short word ("upside down" became
// "side down"). So a normal end restarts at once; only errors back off.
const RESTART_MS = 0;
const ERROR_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 5000;
const START_TIMEOUT_MS = 5000;
const STUCK_TRIES = 3;
// A session that's listening but has stopped returning words. Seen on the
// fourth test run: Chrome opened session #3 ("audiostart"), then sent no
// words, no error and no end for 45 s while the sermon played, until the
// operator pressed Pause. Real silence ends in a "no-speech" error after
// about 8 s; this didn't. So when the mic meter shows sound going in but no
// words have come out for this long, the session is dropped for a fresh one
// (a restart costs about 0.1 s). In a quiet room, or with only music
// playing, it may restart now and then; that loses nothing.
const STALL_MS = 10000;
const STALL_SOUND_MS = 6000; // of the STALL_MS, at least this much had sound
const SOUND_LEVEL = 0.08; // meter level counted as sound (0..1)
const STALL_CHECK_MS = 250;
const ABORT_GRACE_MS = 2000; // a stalled session that won't even end is replaced

export function speechSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function createRecognizer({ onInterim, onFinal, onState }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let lang = 'en';
  let langTag = 'en-US';
  let wanted = false;
  let rec = null;
  let backoff = RESTART_MS;
  let restartTimer = null;
  let interimSince = 0;
  let finishing = false;
  let meter = null;
  let blocked = null; // why Chrome refused the mic; survives the end event
  let errorAt = 0;
  let okTimer = null;
  let startTimer = null;
  let stuckTries = 0;
  let generation = 0; // bumps on every start(), so a late mic answer for an old start is ignored
  let current = 'stopped';
  // The last line made, across sessions: a new session sometimes re-hears
  // the end of the previous one (transcript.js drops that echo).
  const lastLine = { text: '' };
  // Stall watch (see STALL_MS): when words last came, and how much sound
  // went in since.
  let wordsAt = 0;
  let soundMs = 0;
  let stopWatch = null;
  const stats = { stalls: 0 };

  function state(s, detail) { current = s; onState && onState(s, detail); }

  function clean(text) {
    const t = text.replace(/\s+/g, ' ').trim();
    return lang === 'en' && t ? t[0].toUpperCase() + t.slice(1) : t;
  }

  function begin() {
    if (!wanted) return;
    const r = rec = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.lang = langTag;
    finishing = false;
    interimSince = 0;
    // Every handler checks it still belongs to the current session: an
    // abandoned (stuck) one may wake up later and must not restart anything.
    const live = () => r === rec;
    const startedAt = Date.now();
    let heardAnything = false;
    wordsAt = startedAt;
    soundMs = 0;
    // Lines are assembled per session: see transcript.js for why an empty
    // final mustn't lose the words "Hearing now" showed.
    const words = createAssembler({
      onFinal: text => onFinal(clean(text)),
      onInterim: text => onInterim(clean(text), true),
      lastLine,
    });

    // After a network error Chrome starts again and fails again a moment
    // later; don't flash "Mic live" in between. A real result settles it.
    r.onstart = () => {
      if (!live()) return;
      clearTimeout(startTimer);
      stuckTries = 0;
      clearTimeout(okTimer);
      okTimer = setTimeout(() => state('listening'), Date.now() - errorAt < 6000 ? 6000 : 0);
    };
    r.onresult = e => {
      if (!live()) return;
      if (current !== 'listening') { clearTimeout(okTimer); state('listening'); }
      heardAnything = true;
      wordsAt = Date.now();
      soundMs = 0;
      words.result(plainEvent(e));
      backoff = RESTART_MS;
      const interim = words.pending();
      if (!interim) { interimSince = 0; return; }
      if (!interimSince) interimSince = Date.now();
      if (!finishing && (interim.length > MAX_INTERIM[lang] || Date.now() - interimSince > MAX_INTERIM_MS)) {
        finishing = true;
        try { r.stop(); } catch {}
      }
    };
    r.onerror = e => {
      if (!live()) return;
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      clearTimeout(okTimer);
      errorAt = Date.now();
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        // Retrying can't help until someone allows the mic, so stop wanting
        // it: Pause then Resume (or Start) tries again.
        wanted = false;
        blocked = 'Chrome isn’t allowed to use the microphone here. Allow it (the icon left of the address → Site settings → Microphone), then press Pause and Resume.';
        state('blocked', blocked);
      } else if (e.error === 'audio-capture') {
        state('no-mic', 'No microphone found. Check the USB audio interface is plugged in.');
      } else if (e.error === 'network') {
        state('network', 'Speech recognition can’t reach Google. Check the internet connection.');
      } else {
        state('error', 'Speech recognition stopped: ' + e.error);
      }
      backoff = Math.min(Math.max(backoff * 2, ERROR_BACKOFF_MS), MAX_BACKOFF_MS);
    };
    r.onend = () => {
      if (!live()) return;
      clearTimeout(startTimer);
      rec = null;
      clearTimeout(okTimer);
      // Words still being heard become a line, unless the session was
      // ended for a language switch: then they belong to the old language.
      if (r.discardPending) onInterim('', false); else words.end();
      if (!wanted) { if (!blocked) state('stopped'); return; }
      clearTimeout(restartTimer);
      // A session that ends at once having heard nothing, over and over,
      // must not become a tight start/end loop.
      const instant = !heardAnything && Date.now() - startedAt < 1000;
      restartTimer = setTimeout(begin, instant ? Math.max(backoff, ERROR_BACKOFF_MS) : backoff);
    };
    try { r.start(); } catch (err) {
      rec = null;
      restartTimer = setTimeout(begin, (backoff = Math.min(Math.max(backoff * 2, ERROR_BACKOFF_MS), MAX_BACKOFF_MS)));
      return;
    }
    // No start, no error, no end: the stuck session. Abandon it and try a
    // fresh one; after a few, only a reload has been seen to clear it.
    clearTimeout(startTimer);
    startTimer = setTimeout(() => {
      if (!live() || !wanted) return;
      rec = null;
      try { r.abort(); } catch {}
      stuckTries++;
      if (stuckTries >= STUCK_TRIES) {
        state('stuck', 'Chrome’s speech recognition isn’t responding. Reload this page (Ctrl+R), then press Resume.');
      }
      clearTimeout(restartTimer);
      restartTimer = setTimeout(begin, stuckTries >= STUCK_TRIES ? MAX_BACKOFF_MS : RESTART_MS);
    }, START_TIMEOUT_MS);
  }

  return {
    kind: 'mic',
    start() {
      if (!SR) { state('unsupported', 'This browser has no speech recognition. Open the console in Google Chrome.'); return; }
      if (wanted) return;
      wanted = true;
      blocked = null;
      backoff = RESTART_MS;
      stuckTries = 0;
      state('starting');
      if (!stopWatch) stopWatch = every(STALL_CHECK_MS, watchStall);
      // Mic first, recognition after: see the note at the top.
      const gen = ++generation;
      startMeter().then(result => {
        if (gen !== generation || !wanted) return;
        if (result === 'denied') {
          wanted = false;
          blocked = 'Chrome isn’t allowed to use the microphone here. Allow it (the icon left of the address → Site settings → Microphone), then press Pause and Resume.';
          state('blocked', blocked);
          return;
        }
        begin();
      });
    },
    stop() {
      wanted = false;
      blocked = null;
      generation++;
      if (stopWatch) { stopWatch(); stopWatch = null; }
      clearTimeout(restartTimer);
      clearTimeout(okTimer);
      clearTimeout(startTimer);
      // stop(), not abort(): a line half-heard when the operator pauses is
      // still finished and queued, where they can discard it.
      if (rec) { try { rec.stop(); } catch {} } else state('stopped');
      stopMeter();
    },
    setLanguage(l, tag) {
      if (l === lang && tag === langTag) return;
      lang = l; langTag = tag;
      // A running session keeps its language until it ends, so end it.
      if (rec) { rec.discardPending = true; try { rec.abort(); } catch {} }
    },
    level: () => (meter ? meter.level() : 0),
    stats: () => ({ ...stats }),
    deviceLabel: () => (meter ? meter.label : ''),
  };

  function watchStall() {
    const r = rec;
    if (!wanted || !r || !meter || r.stalled) return;
    if (meter.level() >= SOUND_LEVEL) soundMs += STALL_CHECK_MS;
    if (Date.now() - wordsAt < STALL_MS || soundMs < STALL_SOUND_MS) return;
    // Sound going in, nothing coming out: drop this session. Its end event
    // restarts as usual (and keeps any words still pending); if it won't
    // even end, replace it.
    r.stalled = true;
    stats.stalls++;
    console.warn('[recognizer] no words for ' + STALL_MS / 1000 + ' s while the mic hears sound; restarting (' + stats.stalls + ')');
    try { r.abort(); } catch {}
    setTimeout(() => {
      if (rec !== r || !wanted) return;
      rec = null;
      clearTimeout(restartTimer);
      begin();
    }, ABORT_GRACE_MS);
  }

  // A real level meter from the same microphone, so the operator can see the
  // feed is alive even when recognition hears nothing it can use.
  // Resolves 'ok', 'denied' (the operator or Chrome refused the mic), or
  // 'failed' (anything else: recognition is still tried and reports itself).
  async function startMeter() {
    if (meter) return 'ok';
    if (!navigator.mediaDevices) return 'failed';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      if (!wanted) { stream.getTracks().forEach(t => t.stop()); return 'ok'; }
      const ctx = new AudioContext();
      ctx.resume().catch(() => {});
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      const track = stream.getAudioTracks()[0];
      meter = {
        label: track ? track.label : '',
        level() {
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += v * v;
          return Math.min(1, Math.sqrt(sum / buf.length) * 6);
        },
        close() { stream.getTracks().forEach(t => t.stop()); ctx.close().catch(() => {}); },
      };
      return 'ok';
    } catch (e) {
      return e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'denied' : 'failed';
    }
  }
  function stopMeter() { if (meter) { meter.close(); meter = null; } }
}
