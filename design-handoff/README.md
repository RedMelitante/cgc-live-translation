# Handoff: CGC Live Sermon Translation

## Overview
Live sermon captioning for Cagayan Gospel Church. A booth laptop runs Chrome speech recognition on the pastor's mic feed. A broadcast layer translates each recognized line once with Google Cloud Translation and pushes it to every client. An operator console holds each line for a short, editable buffer before it is published to two audience screens: a projected **big screen** and a **phone/QR page**. It works in both directions: **EN → 中文** (default) and **中文 → EN**.

Read `Build Spec.md` (in this folder) first. It covers architecture, accounts, cost, the build plan, the testing checklist and open decisions. This README covers the UI and behaviour.

## About the design files
`CGC Live Translation.dc.html` is a **design reference built in HTML**: a working prototype of the intended look and behaviour, not production code. Open it in a browser (keep `support.js` next to it). A demo timer stands in for speech recognition and the broadcast layer.

Recreate the three screens as real web pages. No codebase exists yet, so pick the simplest stack that fits the spec. A suggestion:
- Three static pages (`/console`, `/screen`, `/live`) served from the existing cPanel hosting at cgcmultimedia.com
- Vanilla JS or a light framework (Preact, Vue or Svelte), no heavy build needed
- Broadcast layer: Firebase Realtime Database (easiest, since cPanel can't host WebSockets well) or a small Node + WebSocket service. This is still an open decision in the spec.

## Fidelity
**High-fidelity.** Colours, type, spacing, radii and states are final. Match them closely. All values are listed below.

---

## Screens

### 1. Operator console (`/console`) — booth laptop, designed at 1440 × 900
Purpose: watch recognition live, fix translations before they go out, control publishing.

**Frame:** background `#F7F7FC`. A 4px accent bar at the top: `linear-gradient(90deg,#3B4EC8,#00CACC,#F5A623)`.

**Header** (68px, white, bottom border 1px `#E4E4F0`, padding 0 28px, flex row, gap 24px, nothing wraps):
- App mark: 36×36, radius 10, bg `#3B4EC8`, white "译" in Nunito 900 15px.
- Title "CGC Live Translation" in Nunito 800 17px `#2D3142`. Below it, "OPERATOR CONSOLE" in DM Mono 10px, tracking .14em, uppercase, `#9B9BAD`.
- Status chips (pill, padding 6px 12px, DM Sans 500 13px, 16px Tabler icon, gap 6):
  - Mic: `ti-microphone`. Live: bg `#E8F8EF`, text `#1A7A41`, "Mic live". Paused: bg `#FDEEEA`, text `#9D2A18`, "Mic paused".
  - `ti-broadcast` "Broadcast connected": bg `#E8F8EF`, text `#1A7A41`. Turns red/coral when disconnected.
  - `ti-device-mobile` + count of connected phones: bg `#ECEFFE`, text `#1E2780`.
- Right group (margin-left auto, gap 16):
  - "CHARS THIS MONTH" (DM Mono 10px label) over "128,518 / 500k" (DM Mono 500 13px). This is the Google Translate free-tier usage.
  - **Direction switch**: segmented pill (bg `#F7F7FC`, 1px `#E4E4F0` border, padding 3) with options "EN → 中文" and "中文 → EN". Each option is 32px tall with padding 0 14px, DM Sans 600 13px. Active: bg `#3B4EC8`, white text, shadow `0 4px 24px rgba(59,78,200,.20)`. Inactive: transparent bg, text `#6B6B80`.
  - **Auto-publish toggle**: pill button with 1.5px `#E4E4F0` border and a 36×20 track. On: track `#3B4EC8`, knob at 18px. Off: track `#E4E4F0`, knob at 2px. Transition 180ms.
  - **Pause / Resume** recognition: pill, padding 10px 18px, white text. Bg `#2D3142` while running and `#3B4EC8` while paused. Press: scale(.97).

**Body:** grid `420px | minmax(0,1fr) | 360px`, gap 20, padding 20px 28px 24px.

Left column:
1. **Hearing now** card (white, 1px `#E4E4F0`, radius 16, padding 20): label "HEARING NOW · ENGLISH" (or "· 中文"), plus a 6-bar cyan (`#00CACC`) audio level meter. The interim recognition text uses the source-language font at 500 20px/1.5, min-height 90, followed by a 2px indigo caret.
2. **On the big screen now**: a 16:9 mini preview (radius 10, bg `#1E2780`) mirroring the big screen's current line.
3. **Phone page QR** card, pinned to the bottom: a 72px QR code, the URL `cgcmultimedia.com/live` in DM Mono, and a "Show on big screen →" link. **The QR in the mock is a placeholder; generate a real one.**

Middle column — **Publish queue**:
- Heading "Publish queue" (Nunito 800 20px). The note on the right reads "Lines wait Ns before going out", or "Auto-publish off · every line needs approval".
- Empty state: 1.5px dashed `#E4E4F0` box, radius 16, with "Waiting for the next line from the pastor's mic."
- Each pending line is a card (white, radius 16, 1.5px border, shadow `0 1px 4px rgba(45,49,66,.06)`):
  - A 4px progress bar on top (track `#ECEFFE`) that fills as the buffer counts down.
  - "LINE 14" (DM Mono 11px) on the left and a status pill on the right (DM Mono 500 12px, uppercase).
  - Source text: 400 14px/1.6 `#6B6B80`.
  - Translation: 500 22px/1.5 `#2D3142`. In edit mode it becomes a textarea with a 1.5px `#3B4EC8` border and an indigo glow.
  - Actions (pills, 13px 600): **Edit** / **Hold**↔**Resume** (outline `#E4E4F0`), **Save edit** (only while editing; bg `#ECEFFE`, border and text `#3B4EC8`), **Discard** (text `#9D2A18`, hover bg `#FDEEEA`), and **Publish now →**, right-aligned (bg `#3B4EC8`, hover `#2D3BA0` + glow).
  - Status variants:
    - Counting: "PUBLISHES IN 6S". Pill `#E0FAFA` / `#00696B`, bar `#00CACC`, card border `#E4E4F0`.
    - On hold: "ON HOLD". Pill `#FEF3DC` / `#8A5A05`, bar and card border `#F5A623`.
    - Editing: "EDITING · PAUSED". Pill `#ECEFFE` / `#1E2780`, bar and card border `#3B4EC8`.
    - Auto-publish off: "NEEDS APPROVAL". Amber pill, neutral border.

Right column — **Published** history (white card, radius 16): header "Published" plus "N LINES". Rows are newest first, padded 12px 20px with a bottom border. Each row has a DM Mono 11px timestamp (HH:MM:SS) and an optional "EDITED" tag (`#FEF3DC` / `#8A5A05`, radius 3), the translation (500 15px), and the source line (400 12px `#9B9BAD`).

### 2. Big screen (`/screen`) — projector, 16:9 (mock shown at 1280 × 720; build fluid with vw/clamp)
- Bg `#1E2780`. A soft cyan radial glow in the top-right corner (`rgba(0,202,204,.16)` fading to 0). A 5px gradient accent bar along the bottom.
- Top row (padding 36px 64px 0, DM Mono 500 14px, tracking .14em, `#E0FAFA`): a cyan dot plus "LIVE · 中文字幕" (or "LIVE · ENGLISH CAPTIONS") on the left, "SCAN FOR CAPTIONS ON YOUR PHONE" on the right.
- Captions sit at the bottom (padding 0 64px 72px, gap 28):
  - Previous line: 500 34px/1.5 `#9BA6E8` (dimmed).
  - A divider (2px `rgba(224,250,250,.18)`, padding-top 28), then the **current line** in 700 64px/1.35 white, then the source line in 500 28px/1.45 `#E0FAFA`. Hide the source line in "translation only" mode.
- Before the first line: "字幕将在这里显示" / "Captions will appear here".
- Legibility must be tested from the back of the room (see the spec's checklist).

### 3. Phone / QR page (`/live`) — mobile, designed at 390 × 844
- White page. Header (padding 8px 20px 14px, bottom border): "Cagayan Gospel Church" (Nunito 800 19px), a green dot (`#27AE60`) plus "LIVE SERMON CAPTIONS" (DM Mono 10px `#1A7A41`), and a 44×44 round **Aa** button that cycles text size.
- Language segmented control (bg `#F7F7FC`, pill, 36px tall buttons): "中文 + English" / "中文" (labels flip in 中文 → EN mode). Active: white bg, `#3B4EC8` text, shadow-sm.
- Caption list anchored to the bottom, gap 18, showing the last 5 lines:
  - Older lines: translation 400 / `#6B6B80`, source 13px `#9B9BAD`.
  - Latest line: a card with bg `#ECEFFE` and radius 16 (padding 16px 18px). Translation 700 / `#1E2780`, source 14px `#3D3D4E`.
  - Text size steps (older / latest): 16/20, **18/23 (default)**, 21/27 px.
- Footer note (12px `#9B9BAD`): "Captions are machine-translated and checked by our media team."
- Keep it lightweight. It must work on iOS and Android on church wifi. Reconnect automatically after a drop.

---

## Interactions & behaviour

**Pipeline**
1. The booth page runs `webkitSpeechRecognition` (continuous, interimResults). The language is `en-US` for EN → 中文 and `zh-CN` (or `cmn-Hans-CN`) for 中文 → EN. Interim results go to "Hearing now". Each **final** result becomes one line.
2. Each final line goes to the broadcast layer. It calls Translation once (`source`/`target` = `en`/`zh-CN`, or reversed), stores `{id, src, tgt, createdAt, status:'pending'}` and notifies all consoles.
3. The console shows the line as pending, with a countdown of `bufferSeconds` (default **8s**; the mock allows 3–20).
4. When the countdown reaches 0 (and auto-publish is on), or the operator clicks **Publish now**, the line's status becomes `published` with `publishedAt`. The big screen and phones subscribe only to published lines.

**Console controls**
- **Edit**: pauses that line's countdown and turns the translation into a textarea. **Save edit** applies the change, marks the line `edited`, and resets the countdown to at least 3s. Publish now while editing publishes the draft.
- **Hold** / **Resume**: freezes or unfreezes that line's countdown.
- **Discard**: removes the line. It is never published.
- **Auto-publish off**: no countdowns run. Every line shows "Needs approval" and waits for Publish now. Whether this is on by default is an open decision; the mock defaults to on.
- **Pause** stops recognition and switches the mic chip to the paused state.
- **Direction switch** flips source and target everywhere: the recognition language, the translation call, the fonts, the labels, and which text is shown large on the audience screens. Lines that are already published keep both `src` and `tgt`. Store the direction in the broadcast layer so every client follows it.

**Motion**: gentle ease-out `cubic-bezier(.22,.61,.36,1)` with 120–180ms colour/shadow transitions. The progress bar animates width linearly. Buttons scale to .97 on press. No bounces or decorative loops.

**Failure states to build** (not in the mock): broadcast disconnected (coral chip on the console; a quiet "Reconnecting…" line on the phone and big screen), Translation API error (show the line with the source only and flag it in the console), mic silent for more than 30s (an amber hint).

## State / data model (suggested)
```
session: { direction: 'en-zh' | 'zh-en', autoPublish: bool, bufferSeconds: number, paused: bool }
lines/{id}: { id, src, tgt, status: 'pending'|'held'|'published'|'discarded',
              edited: bool, createdAt, publishAt, publishedAt }
usage: { monthKey, chars }
```
- Use the server timestamp for `publishAt`, so every console agrees on the countdown. Any console, or a small server job, publishes lines once `publishAt` has passed. Holding or editing a line clears `publishAt`.
- Audience clients query `status == 'published'`, ordered by `publishedAt`, last N.
- Phone preferences (language mode, text size) are per device and live in localStorage.

## Design tokens (Dsm design system)
- Colours:
  - Indigo `#3B4EC8`, indigo-dim `#2D3BA0`, indigo-dark `#1E2780`, indigo-light `#ECEFFE`
  - Cyan `#00CACC`, cyan-light `#E0FAFA`, cyan text-on-light `#00696B`
  - Amber `#F5A623`, amber-light `#FEF3DC`, warning-text `#8A5A05`
  - Coral `#E8543A`, coral-light `#FDEEEA`, error-text `#9D2A18`
  - Success `#27AE60`, success-bg `#E8F8EF`, success-text `#1A7A41`
  - Neutrals: charcoal `#2D3142`, dark `#3D3D4E`, mid `#6B6B80`, muted `#9B9BAD`, border `#E4E4F0`, surface `#F7F7FC`, white
  - Dimmed caption on the big screen: `#9BA6E8`
- Type: **Nunito** 800/900 (headings), **DM Sans** 400–600 (UI and English text), **DM Mono** 400/500 (labels: uppercase, tracking .10–.14em), **Noto Sans SC** 400/500/700 (all Chinese text). All are on Google Fonts. Use the font that matches the language of each text block.
- Spacing: 4px base (4, 8, 12, 16, 20, 24, 28, 32, 48, 64).
- Radii: 3 (tags), 6, 10 (small cards), 16 (cards), 52/40 (the phone shell in the mock only), 100px (all pills and buttons).
- Shadows: sm `0 1px 4px rgba(45,49,66,.06)`, md `0 4px 14px rgba(45,49,66,.10)`, lg `0 8px 28px rgba(45,49,66,.13)`, indigo glow `0 4px 24px rgba(59,78,200,.20)`.

## Assets
- Icons: Tabler Icons webfont (`https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/tabler-icons.min.css`): `ti-microphone`, `ti-broadcast`, `ti-device-mobile`, `ti-player-pause`, `ti-player-play`, `ti-pencil`, `ti-check`, `ti-trash`, `ti-arrow-right`, `ti-wifi`.
- QR code: placeholder in the mock. Generate a real one for `cgcmultimedia.com/live` (any QR library).
- The sample sermon lines (John 15) and the phone count / character numbers are demo data.

## Files
- `CGC Live Translation.dc.html`: the interactive prototype of all three screens (open in a browser alongside `support.js`). The demo logic (queue, countdown, edit, hold, direction) is in the `<script>` class near the bottom of the file, and its state shape mirrors the model above.
- `screenshots/`: static captures of each screen. 01–03 show EN → 中文 (operator console, big screen, phone page). 04–06 show the same screens in 中文 → EN.
- `Build Spec.md`: the original build spec (architecture, accounts, cost, build plan, testing, open decisions).

## Suggested first prompt for Claude Code
"Read README.md and Build Spec.md. Then scaffold the project: a Firebase Realtime Database broadcast layer (or ask me first if you think Node + WebSocket is better), and the three pages `/console`, `/screen` and `/live`, matching the prototype. Start with the demo timer as the line source, then swap in Web Speech API recognition."
