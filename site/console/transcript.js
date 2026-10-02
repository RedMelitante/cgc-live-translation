// Turns Chrome's recognition events into finished lines. Kept apart from
// recognizer.js so it can be tested without a browser
// (test/transcript.test.mjs), with event sequences taken
// from real sessions.
//
// Chrome (154, Windows) loses words in two ways, both found in logged
// sessions of a recorded sermon on 2026-10-03, and neither visible in
// Chrome's own events:
//
// 1. It ends a session with an EMPTY final after showing the words as
//    interim text (seen when the operator pressed Pause). So an empty final,
//    or a session that ends without one, finishes the line with the latest
//    interim text.
//
// 2. After a pause it starts the next phrase in the SAME result slot,
//    overwriting the previous phrase without ever finalizing it. "no so if
//    you're going to go up that stairs" turned into "going", "going to the
//    corner i don't know" turned into "it", and only "it look like" ever
//    arrived as a final.
//
// But Chrome also flickers: mid-phrase it tries another guess for a moment
// (" or maybe ikaw") and then goes back to "what they call the stairway to
// heaven" and finalizes that. Publishing an overwritten phrase at once made
// three copies of it. So an overwritten phrase is held back as an *orphan*
// and published only if Chrome doesn't come back to it within a few seconds
// (or the session ends, or a different line is finalized first, which
// would otherwise put it out of order). Chrome also flickers between a short
// and a long version of the same phrase (" or follow your heart" and " or
// follow your heart we watch that in movies in inspirational videos"), so
// rescued text is the longest version shown of that phrase, not whichever
// was on screen last. When Chrome does finalize, its final wins.
// Rescued text that just repeats the
// line before it is dropped: a new session sometimes re-hears the last
// words of the previous one.
//
// Events are passed as plain data, with the time they arrived:
//   { resultIndex, results: [{ isFinal, transcript }], at }

export const RESET_GAP_MS = 1000; // a pause this long before a shorter, different phrase
// After a pause this long, a different phrase is new whatever its length:
// "spiritual construction plan" was replaced 6 s later by the longer
// "blueprint but it's not a building", and was lost when only shorter
// replacements counted.
export const LONG_GAP_MS = 3000;
export const ORPHAN_CONFIRM_MS = 3000; // how long an overwritten phrase may come back

export function norm(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

const plain = text => norm(text).toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, '');

// The phrase's opening: its first word, or for Chinese (no spaces) its first
// two characters.
function opening(text) {
  const t = plain(text);
  if (!t) return '';
  return t.includes(' ') ? t.split(' ')[0] : t.slice(0, 2);
}

const sameStart = (a, b) => !!opening(a) && opening(a) === opening(b);

// "it look like" after a line ending "...it look like": an echo, not speech.
export function isEcho(text, previousLine) {
  const t = plain(text), p = plain(previousLine);
  return !!t && !!p && p.endsWith(t);
}

// lastLine: shared across sessions, so the first words of a new session can
// be recognised as an echo of the last line of the previous one.
export function createAssembler({ onFinal, onInterim, lastLine = { text: '' } }) {
  let pending = '';
  let lastAt = null;
  let orphan = null; // { text, at }
  let best = ''; // the longest version shown of the phrase now being heard

  // What to rescue for the phrase being heard: its longest version.
  const rescue = () => (best && sameStart(best, pending) ? best : pending);

  function out(text, rescued) {
    const t = norm(text);
    if (!t) return;
    if (rescued && isEcho(t, lastLine.text)) return;
    lastLine.text = t;
    onFinal(t);
  }
  function releaseOrphan() {
    if (orphan) { const o = orphan; orphan = null; out(o.text, true); }
  }

  return {
    result(e) {
      const at = e.at != null ? e.at : Date.now();
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (!r.isFinal) continue;
        const text = norm(r.transcript);
        if (text) {
          // Chrome finalized the orphan after all: one copy, not two.
          if (orphan && sameStart(orphan.text, text)) orphan = null;
          releaseOrphan();
          out(text, false);
          pending = '';
          best = '';
        } else if (pending) {
          releaseOrphan();
          out(rescue(), true);
          pending = '';
          best = '';
        }
      }
      // Everything not yet final, in order: that's what's being heard now.
      let interim = '';
      for (const r of e.results) if (!r.isFinal) interim += r.transcript;
      interim = norm(interim);

      if (orphan) {
        // Chrome went back to the old phrase: it was a flicker.
        if (sameStart(orphan.text, interim)) orphan = null;
        else if (at - orphan.at >= ORPHAN_CONFIRM_MS) releaseOrphan();
      }
      // A different, shorter phrase after a pause: Chrome may have dropped
      // the last one without finalizing it (2 above). Hold it back.
      const gap = lastAt == null ? 0 : at - lastAt;
      if (!orphan && pending && interim && !sameStart(interim, pending)
          && (gap >= LONG_GAP_MS || (gap >= RESET_GAP_MS && interim.length < pending.length))) {
        orphan = { text: rescue(), at };
        best = '';
      }
      best = sameStart(best, interim) && best.length >= interim.length ? best : interim;
      pending = interim;
      lastAt = at;
      onInterim && onInterim(pending);
    },
    // The session ended: an orphan and whatever was still being heard become
    // lines, in that order.
    end() {
      releaseOrphan();
      if (pending) out(rescue(), true);
      pending = '';
      best = '';
      onInterim && onInterim('');
    },
    pending: () => pending,
  };
}

// Chrome's event, as the plain data above.
export function plainEvent(e, at = Date.now()) {
  const results = [];
  for (let i = 0; i < e.results.length; i++) results.push({ isFinal: e.results[i].isFinal, transcript: e.results[i][0].transcript });
  return { resultIndex: e.resultIndex, results, at };
}
