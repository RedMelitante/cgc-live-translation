// Demo backend: the whole "database" is one localStorage entry, so every tab
// of this browser on this site sees the same feed (the storage event tells
// the other tabs). Nothing leaves the browser; phones elsewhere see nothing.

import { DEFAULT_SESSION, withDefaults, queueList, publishedList, monthKey } from './feed.js';

const KEY = 'cgc-live-demo-v1';
const PRESENCE_KEY = 'cgc-live-demo-presence';
const PHONE_FRESH_MS = 12000;

function fresh() {
  // Unlike a real service, the demo starts running so the screens fill up.
  return { session: { ...DEFAULT_SESSION, paused: false }, queue: {}, published: {}, usage: { month: monthKey(), chars: 128400, limit: 500000 } };
}

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || fresh(); } catch { return fresh(); }
}

let seq = 0;
const newId = () => `d${Date.now().toString(36)}${(seq++).toString(36)}`;

export function openDemoFeed() {
  const subs = new Set();
  const notify = () => { const db = load(); for (const s of subs) s(db); };
  const watch = fn => { const s = db => fn(db); subs.add(s); s(load()); return () => subs.delete(s); };
  const write = fn => { const db = load(); fn(db); localStorage.setItem(KEY, JSON.stringify(db)); notify(); return Promise.resolve(); };
  addEventListener('storage', e => { if (e.key === KEY || e.key === null) notify(); });

  return {
    mode: 'demo',
    now: () => Date.now(),

    watchConnected(cb) { cb(true); return () => {}; },
    watchSession(cb) { return watch(db => cb(withDefaults(db.session))); },
    watchPublished(limit, cb) { return watch(db => cb(publishedList(db.published, limit))); },
    watchQueue(cb) { return watch(db => cb(queueList(db.queue))); },
    watchUsage(cb) { return watch(db => cb(db.usage || null)); },
    watchPhones(cb) {
      const count = () => {
        let p = {};
        try { p = JSON.parse(localStorage.getItem(PRESENCE_KEY)) || {}; } catch {}
        cb(Object.values(p).filter(t => Date.now() - t < PHONE_FRESH_MS).length);
      };
      count();
      const t = setInterval(count, 2000);
      return () => clearInterval(t);
    },
    // No accounts in the demo: whoever opens the console is the operator.
    watchUser(cb) { cb({ uid: 'demo', email: null, operator: true }); return () => {}; },
    signIn: () => Promise.resolve(),
    signOut: () => Promise.resolve(),
    idToken: () => Promise.resolve(null),

    setSession: patch => write(db => { db.session = { ...withDefaults(db.session), ...patch }; }),
    addLine: line => {
      const id = newId();
      return { id, done: write(db => { db.queue[id] = line; }) };
    },
    patchLine: (id, patch) => write(db => {
      // Like the real rules: a patch never brings back a line that has
      // already been published or discarded.
      if (!db.queue[id]) return;
      const line = { ...db.queue[id], ...patch };
      for (const k of Object.keys(line)) if (line[k] === null) delete line[k];
      db.queue[id] = line;
    }),
    publishLine: (id, record) => write(db => {
      delete db.queue[id];
      db.published[id] = record;
      const ids = publishedList(db.published).map(l => l.id);
      for (const old of ids.slice(0, -200)) delete db.published[old];
    }),
    discardLine: id => write(db => { delete db.queue[id]; }),
    newService: () => write(db => { db.queue = {}; db.published = {}; db.session = { ...withDefaults(db.session), paused: true, showQr: false }; }),
    setUsage: usage => write(db => { db.usage = usage; }),

    joinAsPhone() {
      const me = newId();
      const beat = () => {
        let p = {};
        try { p = JSON.parse(localStorage.getItem(PRESENCE_KEY)) || {}; } catch {}
        p[me] = Date.now();
        for (const [k, t] of Object.entries(p)) if (Date.now() - t > PHONE_FRESH_MS) delete p[k];
        try { localStorage.setItem(PRESENCE_KEY, JSON.stringify(p)); } catch {}
      };
      beat();
      setInterval(beat, 4000);
    },
  };
}
