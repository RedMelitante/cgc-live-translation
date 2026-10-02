// Stands in for the pastor's mic: "hears" the sample sermon (John 15) a few
// characters at a time, then hands over a finished line with its translation
// already known, so the demo never calls Google.

import { every } from '../shared/clock.js';

const LINES = [
  { en: 'Good morning, church. Please open your Bibles to John chapter fifteen.', zh: '早安，教会。请打开圣经，翻到约翰福音第十五章。' },
  { en: 'Jesus said, I am the vine; you are the branches.', zh: '耶稣说：我是葡萄树，你们是枝子。' },
  { en: 'Whoever abides in me and I in him, he it is that bears much fruit.', zh: '常在我里面的，我也常在他里面，这人就多结果子。' },
  { en: 'For apart from me you can do nothing.', zh: '因为离了我，你们就不能做什么。' },
  { en: 'To abide means to remain, to stay connected day after day.', zh: '常在，意思是留下来，日复一日与祂保持连结。' },
  { en: 'Fruit is not something we manufacture. It grows out of that connection.', zh: '果子不是我们制造出来的，而是从这份连结中长出来的。' },
  { en: 'So this week, ask yourself: where am I trying to grow on my own?', zh: '所以这个星期，问问自己：我在哪些方面想靠自己成长？' },
  { en: 'Let us bow our heads and pray together.', zh: '让我们一起低头祷告。' },
];

const TICK_MS = 250;
const GAP_MS = 1200;

export function createDemoSource({ onInterim, onFinal }) {
  let lang = 'en';
  let cursor = 0, typed = 0, gap = 600, stopTimer = null;

  function step() {
    if (gap > 0) { gap -= TICK_MS; onInterim(''); return; }
    const line = LINES[cursor % LINES.length];
    const text = line[lang];
    typed += lang === 'en' ? 4 : 1;
    if (typed >= text.length) {
      onInterim('');
      onFinal(text, line[lang === 'en' ? 'zh' : 'en']);
      cursor++; typed = 0; gap = GAP_MS;
    } else onInterim(text.slice(0, typed));
  }

  return {
    kind: 'demo',
    start() { if (!stopTimer) stopTimer = every(TICK_MS, step); },
    stop() { if (stopTimer) stopTimer(); stopTimer = null; onInterim(''); },
    setLanguage(l) { if (l !== lang) { lang = l; typed = 0; gap = 600; } },
    // Fake meter: a gentle wave while "speaking".
    level: () => (stopTimer && gap <= 0 ? 0.35 + 0.4 * Math.abs(Math.sin(Date.now() / 160)) : 0),
  };
}
