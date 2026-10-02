// Firebase backend. The SDK is loaded from Google's own CDN, pinned to one
// version so an SDK release can't change behaviour on a Sunday.

import { withDefaults, queueList, publishedList } from './feed.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';

export async function openFirebaseFeed({ role, firebaseConfig }) {
  const { initializeApp } = await import(SDK + 'firebase-app.js');
  const fdb = await import(SDK + 'firebase-database.js');
  const { getDatabase, ref, onValue, query, orderByChild, limitToLast, update, set, push, remove, onDisconnect, serverTimestamp } = fdb;

  const app = initializeApp(firebaseConfig);
  const db = getDatabase(app);

  // Server clock: every console counts down against the same time.
  let offset = 0;
  onValue(ref(db, '.info/serverTimeOffset'), s => { offset = s.val() || 0; });

  const watchValue = (path, fn) => onValue(typeof path === 'string' ? ref(db, path) : path, s => fn(s.val(), s));

  const feed = {
    mode: 'firebase',
    now: () => Date.now() + offset,

    watchConnected: cb => watchValue('.info/connected', v => cb(v === true)),
    watchSession: cb => watchValue('session', v => cb(withDefaults(v))),
    watchPublished: (limit, cb) =>
      watchValue(query(ref(db, 'published'), orderByChild('publishedAt'), limitToLast(limit)), v => cb(publishedList(v, limit))),
    watchQueue: cb => watchValue('queue', v => cb(queueList(v))),
    watchUsage: cb => watchValue('usage', v => cb(v || null)),
    watchPhones: cb => watchValue('presence', (v, s) => cb(s.size)),

    setSession: patch => update(ref(db, 'session'), patch),
    addLine: line => {
      // push() makes the id locally, so the line can be shown and patched
      // before the server has confirmed it.
      const r = push(ref(db, 'queue'));
      return { id: r.key, done: set(r, line) };
    },
    // Rejected by the rules (queue/$id must keep its src) if the line has
    // already been published or discarded, so a late Hold or Save can't
    // bring back a half-line.
    patchLine: (id, patch) => update(ref(db, 'queue/' + id), patch),
    publishLine: (id, record) => update(ref(db), { ['queue/' + id]: null, ['published/' + id]: record }),
    discardLine: id => remove(ref(db, 'queue/' + id)),
    newService: () => update(ref(db), { queue: null, published: null, 'session/paused': true, 'session/showQr': false }),
    setUsage: usage => set(ref(db, 'usage'), usage),

    joinAsPhone() {
      // Re-registered after every reconnect: the server removes the entry
      // when the connection drops, and a phone that comes back should
      // count again.
      const me = push(ref(db, 'presence'));
      onValue(ref(db, '.info/connected'), s => {
        if (s.val() !== true) return;
        onDisconnect(me).remove().then(() => set(me, serverTimestamp())).catch(() => {});
      });
    },

    watchUser: cb => { cb(null); return () => {}; },
    signIn: () => Promise.reject(new Error('Signing in is only needed on the console.')),
    signOut: () => Promise.resolve(),
    idToken: () => Promise.resolve(null),
  };

  if (role === 'console') {
    const { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } = await import(SDK + 'firebase-auth.js');
    const auth = getAuth(app);
    feed.watchUser = cb => {
      let stopOperator = null;
      const stopAuth = onAuthStateChanged(auth, user => {
        if (stopOperator) { stopOperator(); stopOperator = null; }
        if (!user) return cb(null);
        cb({ uid: user.uid, email: user.email, operator: null }); // still checking
        // Reading your own operators entry is allowed only when it's yours,
        // and a missing entry reads as null: not an operator.
        stopOperator = onValue(ref(db, 'operators/' + user.uid),
          s => cb({ uid: user.uid, email: user.email, operator: s.val() === true }),
          () => cb({ uid: user.uid, email: user.email, operator: false }));
      });
      return () => { stopAuth(); if (stopOperator) stopOperator(); };
    };
    feed.signIn = (email, password) => signInWithEmailAndPassword(auth, email, password);
    feed.signOut = () => signOut(auth);
    feed.idToken = () => (auth.currentUser ? auth.currentUser.getIdToken() : Promise.resolve(null));
  }

  return feed;
}
