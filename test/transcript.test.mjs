// How Chrome's recognition events become lines (site/console/transcript.js).
// The sequences are shortened from a real session logged on 2026-10-03
// (Chrome 154, Windows, the booth laptop's built-in mic).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssembler } from '../site/console/transcript.js';

const run = (events, { end = false } = {}) => {
  const lines = [];
  const a = createAssembler({ onFinal: t => lines.push(t) });
  for (const e of events) a.result(e);
  if (end) a.end();
  return lines;
};
const int = t => ({ isFinal: false, transcript: t });
const fin = t => ({ isFinal: true, transcript: t });
const FULL = 'good morning church please open your bibles to john chapter 15 jesus said i am divine and you are the branches';

test('a normal final becomes one line, and the empty finals after it add nothing', () => {
  // Session #1: interims, one real final, then two empty finals and the end.
  const lines = run([
    { resultIndex: 0, results: [int('good')] },
    { resultIndex: 0, results: [int('good morning church'), int(' please')] },
    { resultIndex: 0, results: [fin(FULL)] },
    { resultIndex: 1, results: [fin(FULL), fin('')] },
    { resultIndex: 2, results: [fin(FULL), fin(''), fin('')] },
  ], { end: true });
  assert.deepEqual(lines, [FULL]);
});

test('an empty final after interim text keeps the heard words', () => {
  // Session #3: Chrome showed the words, then finished with "".
  const heard = 'for me first when i get to know some the beginning and they say where is it coming from who are you';
  const lines = run([
    { resultIndex: 0, results: [int('for')] },
    { resultIndex: 0, results: [int('for me first when i get to know some the beginning'), int(' and')] },
    { resultIndex: 0, results: [int(heard)] },
    { resultIndex: 0, results: [fin('')] },
  ]);
  assert.deepEqual(lines, [heard]);
});

test('a session that ends with words still pending turns them into a line', () => {
  const lines = run([
    { resultIndex: 0, results: [int('let us pray')] },
  ], { end: true });
  assert.deepEqual(lines, ['let us pray']);
});

test('nothing heard means no line, even with empty finals', () => {
  // Session #2: only empty finals.
  const lines = run([
    { resultIndex: 0, results: [fin('')] },
    { resultIndex: 1, results: [fin(''), fin('')] },
  ], { end: true });
  assert.deepEqual(lines, []);
});

test('interim split over several results is kept whole', () => {
  const lines = run([
    { resultIndex: 0, results: [int('good morning church'), int(' please open')] },
    { resultIndex: 0, results: [fin('')] },
  ]);
  assert.deepEqual(lines, ['good morning church please open']);
});

test('two sentences finalized separately become two lines, never repeated', () => {
  const lines = run([
    { resultIndex: 0, results: [int('jesus wept')] },
    { resultIndex: 0, results: [fin('jesus wept')] },
    { resultIndex: 1, results: [fin('jesus wept'), int('he is risen')] },
    { resultIndex: 1, results: [fin('jesus wept'), fin('he is risen')] },
  ], { end: true });
  assert.deepEqual(lines, ['jesus wept', 'he is risen']);
});

test('a real final wins over the interim it replaces', () => {
  const lines = run([
    { resultIndex: 0, results: [int('i am divine')] },
    { resultIndex: 0, results: [fin('i am the vine')] },
  ], { end: true });
  assert.deepEqual(lines, ['i am the vine']);
});

// ---- phrases Chrome overwrites without finalizing (session log, 2026-10-03) ----

const at = (t, resultIndex, results) => ({ resultIndex, results, at: t * 1000 });
const runAt = (events, opts) => {
  const lines = [];
  const a = createAssembler({ onFinal: t => lines.push(t), ...opts });
  for (const e of events) a.result(e);
  a.end();
  return lines;
};

test('a phrase overwritten after a pause, and never finalized, still becomes a line, in order', () => {
  // Session #1: two phrases overwritten in slot 0; only the third was finalized.
  const lines = runAt([
    at(18.88, 0, [int('no so')]),
    at(20.20, 0, [int('no so if you\'re going to go up that stairs')]),
    at(20.77, 0, [int('no so if you\'re going to go up that stairs')]),
    at(22.68, 0, [int('going')]),
    at(23.88, 0, [int('going to the corner i don\'t know')]),
    at(25.88, 0, [int('going to the corner i don\'t know')]),
    at(34.79, 0, [int('it')]),
    at(34.96, 0, [int('it look like')]),
    at(34.98, 0, [fin('it look like')]),
  ]);
  assert.deepEqual(lines, ['no so if you\'re going to go up that stairs', 'going to the corner i don\'t know', 'it look like']);
});

test('Chrome flickering to another guess and back makes one line, not copies', () => {
  // Session #4: " or maybe ikaw" came and went; the stairway phrase was finalized.
  const images = fin('let me show your feet a few images');
  const stair = ' what they call the stairway to heaven';
  const lines = runAt([
    at(163.93, 1, [images, int(' what they call the stairway')]),
    at(164.40, 1, [images, int(stair)]),
    at(168.71, 1, [images, int(stair)]),
    at(169.91, 1, [images, int(stair)]),
    at(171.51, 1, [images, int(' or')]),
    at(171.70, 1, [images, int(' or may')]),
    at(171.81, 1, [images, int(stair)]),
    at(171.91, 1, [images, int(' or maybe')]),
    at(172.01, 1, [images, int(stair)]),
    at(172.15, 1, [images, int(' or maybe ikaw')]),
    at(172.22, 1, [images, int(stair)]),
    at(188.11, 1, [images, int(stair)]),
    at(188.19, 1, [images, fin(stair)]),
  ]);
  assert.deepEqual(lines, ['what they call the stairway to heaven']);
});

test('a new session re-hearing the end of the last line is not a new line', () => {
  // Session #2 began with "it look like", the end of #1's last line, then an empty final.
  const lastLine = { text: 'it look like' };
  const lines = runAt([
    at(36.26, 0, [int('it')]),
    at(36.46, 0, [int('it look like')]),
    at(62.75, 0, [fin('')]),
  ], { lastLine });
  assert.deepEqual(lines, []);
});

test('a genuine repeat that Chrome finalizes is kept', () => {
  const lastLine = { text: 'praise the lord' };
  const lines = runAt([at(1, 0, [fin('praise the lord')])], { lastLine });
  assert.deepEqual(lines, ['praise the lord']);
});

test('a quick revision within a phrase is not mistaken for a new phrase', () => {
  const lines = runAt([
    at(1.0, 0, [int('good morning church please open')]),
    at(1.2, 0, [int('could')]),
    at(1.4, 0, [int('good morning church please open your bibles')]),
    at(2.0, 0, [fin('good morning church please open your bibles')]),
  ]);
  assert.deepEqual(lines, ['good morning church please open your bibles']);
});

test('Chinese phrases are compared by their first characters', () => {
  const lines = runAt([
    at(1.0, 0, [int('我们要彼此相爱')]),
    at(3.0, 0, [int('因为')]),
    at(7.0, 0, [int('因为爱是从神来的')]),
    at(7.5, 0, [fin('因为爱是从神来的')]),
  ]);
  assert.deepEqual(lines, ['我们要彼此相爱', '因为爱是从神来的']);
});

test('a rescued phrase is the longest version Chrome showed, not the last flicker', () => {
  // Session #6: Chrome flickered between a short and a long version, then
  // moved on to "ness" without finalizing either.
  const two = [fin('of how to live'), fin(' like the world tells us do what makes you happy')];
  const lines = runAt([
    at(219.19, 2, [...two, int(' or follow your heart we watch that in movies in'), int(' inspirational')]),
    at(220.06, 2, [...two, int(' or follow your heart we watch that in movies in inspirational videos')]),
    at(220.78, 2, [...two, int(' or follow your heart')]),
    at(221.00, 2, [...two, int(' or follow your heart'), int(' we watch that in movies in inspirational videos or maybe the')]),
    at(221.18, 2, [...two, int(' or follow your heart')]),
    at(223.00, 2, [...two, int(' ness')]),
    at(227.00, 2, [...two, fin(' ness')]),
  ]);
  // The two finals came before this excerpt (they sit below resultIndex), so
  // they aren't repeated here.
  assert.deepEqual(lines, ['or follow your heart we watch that in movies in inspirational videos or maybe the', 'ness']);
});

test('a phrase replaced after a long pause by a longer one is kept', () => {
  // Third test run: 6 s of silence, then a different and longer phrase in the same slot.
  const lines = runAt([
    at(85.78, 0, [int('spiritual construction')]),
    at(86.39, 0, [int('spiritual construction plan')]),
    at(92.37, 0, [int('blueprint but it\'s not a building')]),
    at(94.88, 0, [int('blueprint but it\'s not a building made of bricks but a')]),
    at(99.00, 0, [fin('blueprint but it\'s not a building made of bricks but a building made of mature believers')]),
  ]);
  assert.deepEqual(lines, ['spiritual construction plan', 'blueprint but it\'s not a building made of bricks but a building made of mature believers']);
});
