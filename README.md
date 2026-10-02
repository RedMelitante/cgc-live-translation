# CGC Live Translation

Live sermon captions for Cagayan Gospel Church. The booth laptop listens to
the pastor's mic in Chrome. Each line is translated once (EN → 中文, or
中文 → EN) and waits a few seconds in the operator console, where it can be
fixed. Then it goes out to the projected big screen and to every phone that
scanned the QR code.

The design is in `design-handoff/` (README.md, Build Spec.md, the prototype
and screenshots). This is its own app, separate from the CGC Booth Console
(the Electron program that drives PowerPoint, in RedMelitante/cgc-booth-console).
It's three web pages on cgcmultimedia.com, with Firebase for the broadcast
and one PHP file for Google Translate. It began on that repo's
`live-translation` branch and moved here on 2026-10-03.

```
npm test                         # the buffer rules and the speech-to-lines logic
node tools/build.mjs live-test   # dist/live-test.zip, for cgcmultimedia.com/live-test
node tools/build.mjs             # dist/live.zip, the real cgcmultimedia.com/live
```

There's nothing to `npm install`: the tests use Node's own test runner, and
the pages load Firebase from Google's CDN.

| Page | Address | Runs on |
| --- | --- | --- |
| Phone page | `cgcmultimedia.com/live` | Phones, from the QR code |
| Big screen | `cgcmultimedia.com/live/screen/` | The projector PC, full screen (double-click or F11) |
| Operator console | `cgcmultimedia.com/live/console/` | The booth laptop, in **Google Chrome** |

The handoff suggested `/console`, `/screen` and `/live` as three top-level
folders. All three live under one `live/` folder here instead, so a release
is one upload.

## Try it now: demo mode

Until Firebase is set up (`site/shared/config.js` has `firebase: null`),
every page runs in demo mode. Lines come from a sample sermon, and the
"broadcast" is this one browser's storage, shared between its tabs. Open the
console, the big screen and the phone page in three tabs of one browser.
They follow each other, like the handoff's prototype. Demo mode is labelled
in every page ("Demo · this browser only", "DEMO" on the big screen), so it
can't be mistaken for the real feed. Add `?demo` to any address to use demo
mode even after Firebase is set up.

Locally: `python -m http.server 8642 --directory site`, then
open `http://localhost:8642/console/`. The pages are ES modules, so opening
the files directly (`file://`) doesn't work.

## How it works

```
pastor's mic → USB interface → booth laptop, Chrome speech recognition
   → console: line queued as "translating"
   → api/translate.php → Google Cloud Translation (key stays on the server)
   → console: line counts down the buffer (8 s), editable
   → Firebase Realtime Database: published/{id}
   → big screen and phones (they can read published lines and nothing else)
```

- `site/shared/feed.js` is the broadcast layer and its database layout.
  `feed-firebase.js` is the real one; `feed-demo.js` is the demo one.
- `site/shared/queue.js` holds the buffer rules: countdown, hold, edit,
  auto-publish, failed translations. These are plain functions, tested in
  `test/queue.test.mjs`.
- The countdown uses the **server's** clock (`publishAt` in server time), so
  every console shows the same seconds and any of them can publish. Hold, edit
  or auto-publish off clear `publishAt` and keep the time left.
- `site/api/translate.php` answers only signed-in operators. It asks
  Firebase whether the console's sign-in token belongs to an account under
  `operators/`, and it stops sending lines to Google once the month's
  allowance (490,000 characters by default) is used.
- `database.rules.json` is what protects the feed. The Firebase web config in
  the pages is public by design. Audiences can read `session` and
  `published` only. Operators can do everything. Phones may add and remove
  their own presence entry, which is how the console counts them.

### Rules that matter on a Sunday

- **A failed translation never publishes by itself.** It waits, flagged red,
  for Retry, a typed translation (Edit), or Publish now. Publish now sends the
  source line alone, marked "Not translated" in the console.
- **A new service starts paused.** "New service" (Published panel) clears the
  screens, the queue and the history, and pauses the mic, so opening the
  console early doesn't caption the band warming up. Press **Start**.
- **Silence is not success.** The console says "Mic blocked", "No mic",
  "Recognition offline" or "Mic not starting" rather than waiting quietly. It
  warns after 30 s without speech, shows refused database writes in a red
  strip, and turns the broadcast chip coral when the connection drops.
  Phones and the big screen show a quiet "Reconnecting…" and catch up by
  themselves.
- Closing the console tab while the mic is live asks first.

### Small additions to the design

The handoff left these open or unspecified. Each is small and uses the
design's own tokens:

- a **Line source** picker in the Hearing now card (Chrome speech
  recognition, the demo sermon, or none for a second console that only
  watches);
- the buffer length as a picker in "Lines wait **8s** before going out";
- **Hide/Show the English line** above the preview, which sets the big
  screen's "translation only" mode for every screen;
- **Show on big screen →** puts the QR code in the big screen's top corner,
  and the same link hides it again;
- the sign-in screen, the translation-failed card, the mic hints and
  **New service**;
- Enter saves an edit;
- a line too long for the big screen first drops the dimmed previous line,
  then shrinks until it fits.

## Setting it up (Red)

Only you can do steps 1–3: they need your Google account and billing. None of
the passwords or keys pass through Claude.

### 1. Firebase

1. [console.firebase.google.com](https://console.firebase.google.com) →
   **Create a project** (e.g. `cgc-live`). Analytics isn't needed.
2. **Build → Realtime Database → Create database**. Location: Singapore
   (`asia-southeast1`), the closest to Cagayan. Start in **locked mode**.
3. On the database's **Rules** tab, paste all of `database.rules.json`, then
   **Publish**.
4. **Build → Authentication → Get started → Email/Password → Enable**. Then,
   under **Users → Add user**, create the operator account (one shared booth
   login is fine). Copy its **User UID**.
5. Back in **Realtime Database → Data**, add a child `operators`, and under
   it a child named the UID with the value `true`. The console's sign-in
   screen also shows this UID if you forget.
6. **Project settings → General → Your apps → Web (`</>`)** → register an
   app. Copy the `firebaseConfig` object into
   `firebase-config.json`, as JSON (quoted keys):
   `{"apiKey": "...", "authDomain": "...", "databaseURL": "...", "projectId": "...", "appId": "..."}`.
   For this project, copy `firebase-config.example.json` and paste in the
   `apiKey`. The file isn't secret (it ends up in every page), but git
   ignores it because its key looks like a Google API key to GitHub's secret
   scanning.

**Connections:** the free Spark plan allows 100 at once. Every phone, big
screen and console counts as one. For more than about 90 phones, switch the
project to **Blaze** (pay as you go). At this volume it still costs about
$0, but set a budget alert of a few dollars.

### 2. Google Cloud Translation

The Firebase project is also a Google Cloud project, so use the same one.

1. [console.cloud.google.com](https://console.cloud.google.com) → pick the
   project → **Billing**: link a billing account. Translation requires one
   even inside the free 500,000 characters a month. Add a budget alert.
2. **APIs & Services → Library → Cloud Translation API → Enable**.
3. **APIs & Services → Credentials → Create credentials → API key**. Edit it.
   Under **API restrictions**, choose *Restrict key* → **Cloud Translation
   API** only.

### 3. The server (cPanel)

1. In File Manager, open the **home folder** (`/home/mmkuo2cihvxr`, the
   parent of `public_html`). Create `cgc-live-config.php` from
   `cgc-live-config.example.php` and type in the API key, the
   `databaseURL` and the `projectId`.
2. On this laptop: `node tools/build.mjs live-test`.
   It writes `dist/live-test.zip`, with the Firebase
   config and a QR code for `cgcmultimedia.com/live-test`.
3. Upload the zip into `public_html/cgcmultimedia.com` and **Extract**. It
   lands as `live-test/`. That's 19 files, which matters with inodes at 97%.
4. Rehearse there (see below). When it's right, build and upload `live` the
   same way (`node tools/build.mjs`), which is the address
   the real QR code opens.

### 4. The booth laptop

- Open the console in **Chrome** and sign in. Allow the microphone when
  asked.
- Chrome picks the input itself: click the icon left of the address →
  **Site settings → Microphone** → choose the USB audio interface.
- Keep the console tab visible during the sermon.

## Before using it live

From the spec's checklist. None of this has been done yet:

- [ ] Recognition tested against a recorded sermon, not a quiet reading.
      Tune `MAX_INTERIM` in `site/console/recognizer.js` if lines run too long.
- [ ] Translation checked against church vocabulary (names, doctrinal terms,
      book titles). Translation Basic has no glossary, so fixes are edits.
- [ ] Big screen read from the back of the room.
- [ ] QR code scanned on iOS and Android, on the church wifi.
- [ ] A deliberately wrong line fixed with Edit before it publishes.
- [ ] Internet dropped mid-test: chips go coral, phones say Reconnecting…,
      everything catches up after.
- [ ] Full run-through with the real sound board feed.

## Where it's set up (2026-10-03)

- **Firebase:** project `cgc-live` on redmelitante@gmail.com, Realtime
  Database in Singapore (`cgc-live-default-rtdb.asia-southeast1.firebasedatabase.app`),
  `database.rules.json` published, one operator login (redmelitante@gmail.com)
  listed under `operators`. Spark (free) plan: 100 connections at once.
- **Google Translate key:** in the Google Cloud project **Red-Portfolio-DB**,
  not `cgc-live`. The billing account had reached its 5-project limit, so
  `cgc-live` couldn't get billing. The key, "CGC Live captions
  (cgcmultimedia.com server)", is restricted to Cloud Translation only. To
  move it later, make a new key in a project with billing and change the one
  line in `cgc-live-config.php`.
- **Server:** `/home/mmkuo2cihvxr/cgc-live-config.php` (key typed in by
  Red), and the test copy at **cgcmultimedia.com/live-test/**. The real
  `/live` hasn't been uploaded yet.

## What has and hasn't been verified

In demo mode, in a desktop Chrome-based browser: all three pages,
edit/save/publish, hold/resume, auto-publish off and on, the direction switch
(old lines show the other language large), the QR on the big screen, New
service, the failed-translation card, the "Mic blocked" path, the long-line
fit, and the phone's text size and language buttons. Unit tests cover the
buffer rules and how recognition events become lines
(`npm test`).

Against the real Firebase project and server:
- **Rules:** probed from outside. Public reads of `session`/`published` work;
  `queue`, `usage` and `operators` are refused, and so is any write without
  sign-in.
- **Sign-in and the operator check** work.
- **Feed:** lines went from the console to a big screen in another browser
  that wasn't signed in. Phone presence counts.
- **Countdown:** every line published 8.0–8.3 s after it was heard, including
  in a background tab past Chrome's 5-minute throttling (the worker clock in
  `shared/clock.js`).
- **`translate.php`:** real Google translations both ways (EN → 中文 and
  中文 → EN), about 1.2 s for the first line and 0.4 s after. Fake sign-ins are
  refused.
- **Real speech** on the booth laptop's built-in mic, with a sermon recording.
  Every final Chrome produced became a line, word for word, and was
  translated.

Found by real testing, and fixed:
- **Recognition stuck at start.** Started while Chrome was still asking for
  the mic, it never started, failed or ended, and blocked every later attempt
  until a reload. The mic is now opened first, and a stuck start is abandoned
  for a fresh one (`console/recognizer.js`).
- **Lost sentences.** Chrome sometimes ends a session with an *empty* final
  after showing the words. That lost whole sentences. The last heard text now
  becomes the line (`console/transcript.js`).
- **Overwritten phrases.** After a pause, Chrome sometimes starts the next
  phrase on top of the previous one, which was never finalized, and the
  earlier phrase vanished. Chrome also flickers between guesses and comes
  back. So an overwritten phrase is now held for 3 s, and becomes a line only
  if Chrome doesn't return to it; the longest version Chrome showed is used.
  Replayed against real logs, one 3-minute run went from 94 to 154 words kept
  with no repeats, and the last run kept every phrase Chrome showed.
- **Slow handovers.** A short word at each of Chrome's own session handovers
  (every 20–60 s) went missing: "upside down" became "side down". The
  restart is now immediate. Chrome's own warm-up (about 0.3 s) still applies.
- **Stale scripts.** No caching rules meant browsers could keep running old
  scripts after an update. `.htaccess` now says `no-cache`.

**Still not verified:** phones (iOS Safari especially) on the church wifi,
the USB audio interface and sound board feed, more than about 20 phones at
once, legibility from the back of the room, and a full-length sermon.
Recognition mistakes are real ("I am the vine" was heard as "I am divine",
and translated as "I am God"), which is what the edit buffer is for. Rehearse
before using it live.
