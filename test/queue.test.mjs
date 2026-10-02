// The publish buffer's rules (site/shared/queue.js) and how a line is shown
// (site/shared/captions.js). Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../site/shared/queue.js';
import { present } from '../site/shared/captions.js';

const AUTO = { autoPublish: true };
const MANUAL = { autoPublish: false };
const T = 1_000_000;

// A line as the broadcast layer holds it after a patch: null fields gone.
const apply = (line, patch) => {
  const next = { ...line, ...patch };
  for (const k of Object.keys(next)) if (next[k] === null) delete next[k];
  return next;
};
const fresh = (session = AUTO, now = T) => {
  const line = { id: 'a', ...Q.newLine({ n: 1, src: 'For apart from me you can do nothing.', srcLang: 'en', tgtLang: 'zh', bufferMs: 8000, now }) };
  return apply(line, Q.translated(line, '因为离了我，你们就不能做什么。', session, now));
};

test('a translated line counts down the buffer and is due when it runs out', () => {
  const line = fresh();
  assert.equal(line.status, 'pending');
  assert.equal(line.publishAt, T + 8000);
  assert.equal(Q.view(line, AUTO, T + 2000).kind, 'counting');
  assert.equal(Q.view(line, AUTO, T + 2000).secs, 6);
  assert.equal(Q.isDue(line, AUTO, T + 7999), false);
  assert.equal(Q.isDue(line, AUTO, T + 8000), true);
});

test('a line still translating never counts down or publishes', () => {
  const line = { id: 'a', ...Q.newLine({ n: 1, src: 'x', srcLang: 'en', tgtLang: 'zh', bufferMs: 8000, now: T }) };
  assert.equal(Q.view(line, AUTO, T).kind, 'translating');
  assert.equal(Q.isDue(line, AUTO, T + 60000), false);
});

test('with auto-publish off a new line waits for approval with its full buffer', () => {
  const line = fresh(MANUAL);
  assert.equal(line.publishAt, undefined);
  assert.equal(line.remainingMs, 8000);
  assert.equal(Q.view(line, MANUAL, T + 50000).kind, 'approval');
  assert.equal(Q.isDue(line, MANUAL, T + 50000), false);
});

test('a line whose publishAt passed does not publish while auto-publish is off', () => {
  // Another console turned auto-publish off and hasn't frozen this line yet.
  const line = fresh();
  assert.equal(Q.isDue(line, MANUAL, T + 9000), false);
});

test('hold freezes the time left and resume continues from it', () => {
  let line = fresh();
  line = apply(line, Q.hold(line, T + 3000));
  assert.equal(line.status, 'held');
  assert.equal(line.publishAt, undefined);
  assert.equal(line.remainingMs, 5000);
  assert.equal(Q.isDue(line, AUTO, T + 600000), false);
  line = apply(line, Q.resume(line, AUTO, T + 600000));
  assert.equal(line.status, 'pending');
  assert.equal(line.publishAt, T + 600000 + 5000);
});

test('resume never publishes instantly, even from almost zero', () => {
  let line = fresh();
  line = apply(line, Q.hold(line, T + 7990));
  line = apply(line, Q.resume(line, AUTO, T + 20000));
  assert.equal(line.publishAt, T + 20000 + Q.MIN_AFTER_RESUME_MS);
});

test('editing pauses the countdown; saving marks it edited and gives at least 3s', () => {
  let line = fresh();
  line = apply(line, Q.startEdit(line, T + 7000));
  assert.equal(Q.view(line, AUTO, T + 7000).kind, 'editing');
  assert.equal(line.publishAt, undefined);
  assert.equal(Q.isDue(line, AUTO, T + 99999), false);
  line = apply(line, Q.saveEdit(line, '因为离了我，你们就不能作什么。', AUTO, T + 30000));
  assert.equal(line.editing, false);
  assert.equal(line.edited, true);
  assert.equal(line.tgt, '因为离了我，你们就不能作什么。');
  assert.equal(line.publishAt, T + 30000 + Q.MIN_AFTER_EDIT_MS);
});

test('saving an unchanged draft is not an edit', () => {
  let line = fresh();
  line = apply(line, Q.startEdit(line, T));
  line = apply(line, Q.saveEdit(line, line.tgt, AUTO, T + 1000));
  assert.equal(line.edited, false);
});

test('editing a held line and saving keeps it held', () => {
  let line = fresh();
  line = apply(line, Q.hold(line, T + 1000));
  line = apply(line, Q.startEdit(line, T + 2000));
  line = apply(line, Q.saveEdit(line, '改过的', AUTO, T + 3000));
  assert.equal(line.status, 'held');
  assert.equal(line.publishAt, undefined);
  assert.equal(Q.isDue(line, AUTO, T + 99999), false);
});

test('a failed translation never publishes by itself', () => {
  const start = { id: 'a', ...Q.newLine({ n: 1, src: 'x', srcLang: 'en', tgtLang: 'zh', bufferMs: 8000, now: T }) };
  const line = apply(start, Q.translateFailed(start, '403'));
  assert.equal(line.status, 'failed');
  assert.equal(line.error, '403');
  assert.equal(Q.view(line, AUTO, T).kind, 'failed');
  assert.equal(Q.isDue(line, AUTO, T + 99999), false);
  assert.equal(Q.hold(line, T), null);
});

test('typing a translation into a failed line sends it into the countdown', () => {
  const start = { id: 'a', ...Q.newLine({ n: 1, src: 'x', srcLang: 'en', tgtLang: 'zh', bufferMs: 8000, now: T }) };
  let line = apply(start, Q.translateFailed(start, '403'));
  line = apply(line, Q.startEdit(line, T + 1000));
  line = apply(line, Q.saveEdit(line, '翻译', AUTO, T + 2000));
  assert.equal(line.status, 'pending');
  assert.equal(line.error, undefined);
  assert.equal(line.tgt, '翻译');
  assert.equal(line.publishAt, T + 2000 + 8000);
});

test('saving a failed line with nothing typed leaves it failed', () => {
  const start = { id: 'a', ...Q.newLine({ n: 1, src: 'x', srcLang: 'en', tgtLang: 'zh', bufferMs: 8000, now: T }) };
  let line = apply(start, Q.translateFailed(start, '403'));
  line = apply(line, Q.startEdit(line, T));
  line = apply(line, Q.saveEdit(line, '   ', AUTO, T + 1000));
  assert.equal(line.status, 'failed');
  assert.equal(Q.isDue(line, AUTO, T + 99999), false);
});

test('a retry after a failure goes back to translating', () => {
  const start = { id: 'a', ...Q.newLine({ n: 1, src: 'x', srcLang: 'en', tgtLang: 'zh', bufferMs: 8000, now: T }) };
  let line = apply(start, Q.translateFailed(start, '403'));
  line = apply(line, Q.retrying(line));
  assert.equal(line.status, 'translating');
  line = apply(line, Q.translated(line, '好', AUTO, T + 5000));
  assert.equal(line.publishAt, T + 5000 + 8000);
});

test('switching auto-publish freezes and restarts only pending, unedited lines', () => {
  const counting = fresh();
  const held = apply(fresh(), Q.hold(fresh(), T + 1000));
  const editing = apply(fresh(), Q.startEdit(fresh(), T + 1000));
  const off = Q.autoPublishChanged([counting, { ...held, id: 'h' }, { ...editing, id: 'e' }], false, T + 2000);
  assert.deepEqual(Object.keys(off), ['a']);
  assert.deepEqual(off.a, { publishAt: null, remainingMs: 6000 });
  const frozen = apply(counting, off.a);
  const on = Q.autoPublishChanged([frozen], true, T + 50000);
  assert.deepEqual(on.a, { publishAt: T + 50000 + 6000, remainingMs: null });
});

test('the buffer a line started with is kept when the session buffer changes', () => {
  const line = fresh();
  assert.equal(Q.view(line, { autoPublish: true, bufferSeconds: 20 }, T + 4000).pct, 50);
});

test('publishing while editing sends the draft and marks it edited', () => {
  let line = fresh();
  line = apply(line, Q.startEdit(line, T));
  const rec = Q.publishedRecord(line, '草稿', T + 500);
  assert.equal(rec.tgt, '草稿');
  assert.equal(rec.edited, true);
  assert.equal(rec.publishedAt, T + 500);
  assert.equal(rec.untranslated, false);
});

test('publishing a failed line sends the source alone, flagged', () => {
  const start = { id: 'a', ...Q.newLine({ n: 1, src: 'The Holy Spirit', srcLang: 'en', tgtLang: 'zh', bufferMs: 8000, now: T }) };
  const line = apply(start, Q.translateFailed(start, '403'));
  const rec = Q.publishedRecord(line, undefined, T);
  assert.equal(rec.tgt, null);
  assert.equal(rec.untranslated, true);
  const p = present(rec, { direction: 'en-zh' });
  assert.equal(p.main, 'The Holy Spirit');
  assert.equal(p.mainLang, 'en');
  assert.equal(p.sub, null);
});

test('after the direction flips, a line already published shows its English large', () => {
  const rec = { src: 'Jesus wept.', srcLang: 'en', tgt: '耶稣哭了。', tgtLang: 'zh' };
  assert.deepEqual(present(rec, { direction: 'en-zh' }), { main: '耶稣哭了。', mainLang: 'zh', sub: 'Jesus wept.', subLang: 'en' });
  assert.deepEqual(present(rec, { direction: 'zh-en' }), { main: 'Jesus wept.', mainLang: 'en', sub: '耶稣哭了。', subLang: 'zh' });
});
