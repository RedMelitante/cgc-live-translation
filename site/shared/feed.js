// The broadcast layer, as every page sees it. Two backends with one shape:
//
//   firebase  the real thing: Firebase Realtime Database, set up in
//             config.js. Every console, big screen and phone shares it.
//   demo      this browser only: localStorage, shared between tabs of the
//             same browser. Used until Firebase is set up, or with ?demo in
//             the address to rehearse without touching the real feed.
//
// Database layout (rules: database.rules.json):
//   session          { direction, autoPublish, bufferSeconds, paused,
//                      showSource, showQr }        everyone reads
//   queue/{id}       lines waiting to publish (shared/queue.js)
//                                                  operators only
//   published/{id}   what the audience sees, ordered by publishedAt
//                                                  everyone reads
//   usage            { month, chars, limit }       operators only
//   presence/{id}    one per open phone page, removed when it disconnects
//   operators/{uid}  true for each signed-in account allowed to run the
//                    console; added by hand in the Firebase console
//
// The audience pages never see the queue: publishing moves a line from
// queue/ to published/ in one atomic write.

import config from './config.js';

export const DEFAULT_SESSION = {
  direction: 'en-zh', autoPublish: true, bufferSeconds: 8,
  // A fresh service starts paused, so the mic doesn't caption the band
  // warming up just because the console page was opened early.
  paused: true, showSource: true, showQr: false,
};

export function feedMode() {
  const forced = new URLSearchParams(location.search).has('demo');
  return forced || !config.firebase ? 'demo' : 'firebase';
}

export async function openFeed({ role }) {
  if (feedMode() === 'demo') {
    const { openDemoFeed } = await import('./feed-demo.js');
    return openDemoFeed({ role });
  }
  const { openFirebaseFeed } = await import('./feed-firebase.js');
  return openFirebaseFeed({ role, firebaseConfig: config.firebase });
}

export function withDefaults(session) {
  return { ...DEFAULT_SESSION, ...(session || {}) };
}

// A queue snapshot ({id: line}) as a list in line order.
export function queueList(obj) {
  return Object.entries(obj || {})
    .filter(([, v]) => v && typeof v === 'object')
    .map(([id, v]) => ({ ...v, id }))
    .sort((a, b) => (a.n || 0) - (b.n || 0) || (a.createdAt || 0) - (b.createdAt || 0));
}

export function publishedList(obj, limit) {
  const list = Object.entries(obj || {})
    .filter(([, v]) => v && typeof v === 'object' && v.publishedAt)
    .map(([id, v]) => ({ ...v, id }))
    .sort((a, b) => a.publishedAt - b.publishedAt);
  return limit ? list.slice(-limit) : list;
}

// The month Google bills by: calendar months, Pacific time (translate.php
// uses the same), so the console's count resets when Google's does.
const MONTH_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit' });
export const monthKey = (ms = Date.now()) => MONTH_FMT.format(new Date(ms)).slice(0, 7);
