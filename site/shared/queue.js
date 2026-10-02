// The publish buffer's rules, as plain functions so they can be tested
// without a browser or a database (test/queue.test.mjs).
//
// A line waiting in the queue looks like:
//   { id, n, src, srcLang, tgt, tgtLang,
//     status: 'translating' | 'pending' | 'held' | 'failed',
//     editing, edited, error, createdAt,
//     bufferMs,      the buffer it started with (a later change to the
//                    session's buffer doesn't skew lines already waiting)
//     publishAt,     server time it goes out; set ONLY while counting down
//     remainingMs }  what's left while the countdown is frozen
//
// A line counts down only while it's pending, nobody is editing it and
// auto-publish is on, and only then does it carry publishAt. Holding,
// editing or turning auto-publish off clears publishAt and keeps the time
// left in remainingMs, so whatever console resumes it picks up from there.
// "now" is always the server-corrected clock, so every console agrees.
//
// Functions return a patch for the line (null fields are deleted), never a
// mutated line: the patch is what gets written to the broadcast layer.

export const MIN_AFTER_EDIT_MS = 3000; // a saved edit gets at least this long
export const MIN_AFTER_RESUME_MS = 1000; // so Resume never publishes instantly

export function remaining(line, now) {
  if (line.publishAt != null) return Math.max(0, line.publishAt - now);
  if (line.remainingMs != null) return Math.max(0, line.remainingMs);
  return line.bufferMs || 0;
}

export function isCounting(line, session) {
  return line.status === 'pending' && !line.editing && line.publishAt != null && !!(session && session.autoPublish);
}

export function isDue(line, session, now) {
  return isCounting(line, session) && line.publishAt <= now;
}

// What the console card shows.
export function view(line, session, now) {
  const left = remaining(line, now);
  const buf = line.bufferMs || 1;
  const pct = Math.max(0, Math.min(100, 100 - (left / buf) * 100));
  let kind;
  if (line.status === 'translating') kind = 'translating';
  else if (line.editing) kind = 'editing';
  else if (line.status === 'failed') kind = 'failed';
  else if (line.status === 'held') kind = 'held';
  else if (!(session && session.autoPublish)) kind = 'approval';
  else kind = 'counting';
  return { kind, remaining: left, secs: Math.ceil(left / 1000), pct: kind === 'translating' ? 0 : pct };
}

// A new line, before its translation comes back.
export function newLine({ n, src, srcLang, tgtLang, bufferMs, now }) {
  return {
    n, src, srcLang, tgtLang, tgt: null,
    status: 'translating', editing: false, edited: false, error: null,
    createdAt: now, bufferMs, remainingMs: bufferMs, publishAt: null,
  };
}

function startOrFreeze(remainingMs, session, now) {
  return session && session.autoPublish
    ? { publishAt: now + remainingMs, remainingMs: null }
    : { publishAt: null, remainingMs };
}

export function translated(line, tgt, session, now) {
  if (line.status !== 'translating' && line.status !== 'failed') return null;
  return { tgt, status: 'pending', error: null, ...startOrFreeze(line.bufferMs, session, now) };
}

// A line whose translation failed never publishes on its own: it waits for
// the operator to retry, type a translation, or publish the source alone.
export function translateFailed(line, message) {
  if (line.status !== 'translating') return null;
  return { status: 'failed', error: String(message || 'Translation failed'), publishAt: null, remainingMs: line.bufferMs };
}

export function retrying(line) {
  if (line.status !== 'failed' && line.status !== 'translating') return null;
  return { status: 'translating', error: null, publishAt: null };
}

export function hold(line, now) {
  if (line.status !== 'pending') return null;
  return { status: 'held', remainingMs: remaining(line, now), publishAt: null };
}

export function resume(line, session, now) {
  if (line.status !== 'held') return null;
  const left = Math.max(remaining(line, now), MIN_AFTER_RESUME_MS);
  return { status: 'pending', ...(line.editing ? { publishAt: null, remainingMs: left } : startOrFreeze(left, session, now)) };
}

export function startEdit(line, now) {
  if (line.editing || line.status === 'translating') return null;
  return { editing: true, remainingMs: remaining(line, now), publishAt: null };
}

export function saveEdit(line, draft, session, now) {
  if (!line.editing) return null;
  const text = String(draft || '').trim();
  const changed = text !== (line.tgt || '');
  const patch = { editing: false };
  if (changed && text) { patch.tgt = text; patch.edited = true; }
  // A failed line that now has a translation joins the normal countdown.
  let status = line.status;
  if (status === 'failed' && (text || line.tgt)) { status = 'pending'; patch.status = 'pending'; patch.error = null; }
  const left = Math.max(remaining(line, now), MIN_AFTER_EDIT_MS);
  Object.assign(patch, status === 'pending' ? startOrFreeze(left, session, now) : { publishAt: null, remainingMs: left });
  return patch;
}

// Auto-publish switched: every countdown freezes, or every pending line
// that isn't being edited starts again from where it froze.
export function autoPublishChanged(lines, on, now) {
  const patches = {};
  for (const line of lines) {
    if (line.status !== 'pending' || line.editing) continue;
    if (on && line.publishAt == null) patches[line.id] = { publishAt: now + Math.max(remaining(line, now), MIN_AFTER_RESUME_MS), remainingMs: null };
    if (!on && line.publishAt != null) patches[line.id] = { publishAt: null, remainingMs: remaining(line, now) };
  }
  return patches;
}

// The record the audience screens receive. Publishing while editing sends
// the draft as it stands.
export function publishedRecord(line, draft, now) {
  let tgt = line.tgt || null;
  let edited = !!line.edited;
  if (line.editing && draft != null) {
    const text = String(draft).trim();
    if (text && text !== tgt) { tgt = text; edited = true; }
  }
  return {
    n: line.n, src: line.src, srcLang: line.srcLang, tgt, tgtLang: line.tgtLang,
    edited, untranslated: !tgt, createdAt: line.createdAt || now, publishedAt: now,
  };
}
