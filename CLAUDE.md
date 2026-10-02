# CGC Live Translation

Live sermon captions for Cagayan Gospel Church. The operator console runs in
Chrome on the booth laptop and listens to the pastor's mic. Lines are
translated by `site/api/translate.php` and held in an editable 8 s buffer,
then published through Firebase to the big screen and to phones. README.md
covers setup, the database layout, where everything is deployed, and what
has and hasn't been verified. Read it first.

**This is live-service software.** It runs in front of a congregation on a
Sunday. A change that "probably works" is worse than a missing feature.

```bash
npm test                         # node's own test runner; nothing to install
node tools/build.mjs live-test   # dist/live-test.zip -> cgcmultimedia.com/live-test
node tools/build.mjs             # dist/live.zip -> cgcmultimedia.com/live (the real QR address)
```

## The thing that will bite you

**Chrome's speech recognition fails silently, in several ways.** Each one
below was found in a recorded session, and none shows up as an error. Each
fix lives in `site/console/transcript.js` or `site/console/recognizer.js`,
with tests built from the real logs in `test/transcript.test.mjs`:

- A session started while Chrome was still asking for the mic never starts,
  fails or ends, and blocks every later one until a reload. So the mic is
  opened first, and a stuck start is abandoned.
- Empty finals after the words were shown.
- Phrases overwritten in the same result slot without a final. Chrome also
  flickers between guesses, so an overwritten phrase is held 3 s before it
  counts as lost.
- Echoes of the previous line at the start of a new session.
- Sessions that keep "listening" but return nothing while sound goes in. The
  stall watchdog uses the mic meter to catch these.

When captions go missing, assume Chrome went quiet, not that our code
dropped them, and get evidence before changing the rules. Install the event
recorder (patch `SpeechRecognition.prototype.start` to log every event),
have someone play a sermon, then replay the log through `createAssembler`
inside the page and compare. Don't reason from the code alone: every rule
in transcript.js exists because a log contradicted the obvious design.

## Conventions

- Comments explain *why*, especially where behaviour looks wrong but is
  deliberate. Most record something found in real testing. Read them before
  changing nearby code, and update them when the reasoning changes.
- Never put secrets in the repo. The Google key is in
  `/home/mmkuo2cihvxr/cgc-live-config.php` on the server (typed in by Red;
  never open it). `firebase-config.json` is gitignored.
- The server is shared GoDaddy cPanel hosting with about 35 client sites,
  and inodes are near the limit. Keep the PHP small and strict, and keep
  uploads to the one zip (deploy steps in README.md).
- Test on `/live-test` first. `/live` is what the printed QR code opens.
