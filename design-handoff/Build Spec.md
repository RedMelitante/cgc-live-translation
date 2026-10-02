# CGC Live Sermon Translation — Build Spec

Oct 2, 2026 · @Red

A build spec for a live English-to-Chinese sermon captioning system at Cagayan Gospel Church: a booth computer recognizes the pastor's speech, a shared broadcast layer translates and pushes it out in real time to a big-screen display and to a QR-code phone page, with an operator console in between to catch and fix mistakes before they go out. Written to hand to a development session (e.g. Claude Code) to implement.

## Architecture

&#91;embedded content: architecture · 7 components, audio to two client screens\]

Audio is recognized, translated once by the broadcast layer, and held in the operator console for a short editable window before publishing out to the big screen and the phone/QR page.

## Components & Responsibilities

| Component | Tech | Responsibility |
| --- | --- | --- |
| Pastor's Mic / Soundboard | Existing church audio gear + a small USB audio interface | Feeds a clean speech signal into the booth computer |
| Speech Recognition | Chrome's built-in Web Speech API | Turns the live audio into raw English text, continuously |
| Broadcast Layer | Small Node.js + WebSocket service, or Firebase Realtime Database | Receives recognized text, calls the Translation API once per line, and pushes the result to every connected client at once |
| Google Translation API | Google Cloud Translation (Basic or Advanced) | Translates each English line to Chinese; billed per character sent |
| Operator Console | Web page reading from the broadcast layer | Shows raw and translated text with a short buffer so a line can be fixed before it publishes |
| Big Screen Display | Web page, projected | Shows the current caption pair to the room |
| Phone / QR Page | Web page, opened by scanning a QR code | Shows the same captions on an individual's phone, with recent lines still visible |

## Accounts & Access to Set Up

| What | Why | Who sets it up |
| --- | --- | --- |
| Google Cloud project + Translation API key | Needed to call the Translation API; billing must be linked even while staying inside the free tier | Red — tied to his Google identity and billing, can't be done by anyone else |
| Broadcast-layer hosting (Firebase project, or a small Node host) | Runs the shared service that translates once and pushes the result to every connected client | Red, or whoever manages the hosting for cgcmultimedia.com |
| Page hosting for the three web pages | Serves the big-screen, phone/QR, and operator console pages | The existing GoDaddy cPanel hosting behind cgcmultimedia.com — already in place |
| Repo access (optional) | Keeps this project's code alongside and in sync with the existing cgc-worship-slides repo | Red, if he wants it in the same private GitHub repo |

## Hardware & Cost

The booth needs a clean audio feed: an aux or monitor send off the sound board into a small USB audio interface plugged into whichever laptop runs Chrome and the speech recognition, so it hears the pastor clearly instead of room echo.

Software cost is close to $0/month at CGC's scale. A 40-minute sermon runs roughly 30,000–35,000 characters of English text, and Google Cloud Translation's free tier covers 500,000 characters a month — comfortably more than even a sermon translated every single Sunday. Audience size doesn't change this: one translation call serves everyone watching, whether that's 20 phones or 200. Broadcast-layer hosting (Firebase or a small Node host) also runs free or near-free at this volume.

## Build Plan

1. Set up the Google Cloud project, enable the Translation API, and generate an API key.
2. Build the broadcast layer: one endpoint that accepts recognized English text, calls the Translation API, and stores/pushes the translated result.
3. Build the big-screen display page, reading live from the broadcast layer (the mockup already shown is the starting point).
4. Build the phone/QR page, reading the same feed in a layout suited to a smaller screen.
5. Build the operator console: raw text preview, translated text with an edit option, and the publish buffer.
6. Wire up real speech recognition in the booth browser in place of the demo timer, and connect the audio interface.
7. Generate and test the QR code against the live phone page.
8. Run a full rehearsal with real mic conditions — pauses, accent, background noise — and fix what breaks before using it live.

## Testing Checklist

- [ ] Recognition tested against an actual recorded sermon, not a quiet reading
- [ ] Translation checked against recurring church vocabulary (names, doctrinal terms, book titles)
- [ ] Big screen tested from the actual projector/room distance for legibility
- [ ] QR code tested on both iOS and Android phones, on the church wifi
- [ ] Operator edit-before-publish flow tested with a deliberately wrong line
- [ ] Behavior tested when the internet connection drops mid-service
- [ ] Full run-through at a rehearsal with the real sound board feed

## Open Decisions

- [ ] Broadcast layer: a small Node.js + WebSocket service, or Firebase Realtime Database
- [ ] Where the broadcast layer runs, since standard cPanel hosting usually can't support it well
- [ ] Which languages to offer beyond Chinese, if any, on the phone/QR page
- [ ] Whether auto-publish is on by default, or every line waits for the operator to approve it
- [ ] Whether this shares a repo with cgc-worship-slides or lives in its own
