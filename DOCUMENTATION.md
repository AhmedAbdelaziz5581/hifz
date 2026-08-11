# Hifz (حِفْظ) — Documentation

A single-file, client-only web app for memorizing and reading the Quran, with word-by-word
audio-synced recitation, a paginated mushaf reading view, multi-reciter support, and a
bilingual (Arabic/English) interface.

**Live app:** https://hifz-quran.com
**Repository:** https://github.com/AhmedAbdelaziz5581/hifz

---

## Table of contents

1. [High-level overview](#1-high-level-overview)
2. [Architecture](#2-architecture)
3. [Data structures](#3-data-structures)
4. [Data storage (localStorage)](#4-data-storage-localstorage)
5. [External integrations / APIs](#5-external-integrations--apis)
6. [Code walkthrough](#6-code-walkthrough)
7. [Design system](#7-design-system)
8. [Setup & infrastructure](#8-setup--infrastructure)
9. [Local development](#9-local-development)
10. [User guide](#10-user-guide)
11. [Known limitations](#11-known-limitations)

---

## 1. High-level overview

Hifz is **one HTML file** (`index.html`, ~1600 lines: inline `<style>` + inline `<script>`,
no build step, no framework, no bundler). It has two purposes:

- **Read mode** — browse the Quran page-by-page, styled like a real mushaf (physical Quran
  page), with optional continuous auto-advancing recitation.
- **Memorize mode** — each ayah (verse) is shown word-blurred; tapping reveals it word by
  word, and audio playback reveals words in sync with the actual recitation timing, for
  active-recall style memorization drills.

There is **no backend and no build process**. All Quran text, translation, and audio come
from free public APIs, fetched directly from the browser and cached in `localStorage`. All
user progress (memorized ayahs, bookmark, preferences) lives only in the browser's
`localStorage` — there is no account system and no server-side storage.

```
┌─────────────────────────────┐        ┌───────────────────────────┐
│   Browser (index.html)      │──GET──▶│  api.alquran.cloud         │  Quran text + translation
│   - renders UI               │        └───────────────────────────┘
│   - manages state in-memory  │        ┌───────────────────────────┐
│   - reads/writes localStorage│──GET──▶│  api.quran.com (v4)        │  Reciter audio URLs + word timings
└─────────────────────────────┘        └───────────────────────────┘
```

## 2. Architecture

### 2.1 High-level

- **Rendering model:** no virtual DOM, no diffing. Functions build HTML strings via template
  literals and assign them to `element.innerHTML`. Event handlers are wired with inline
  `onclick="..."` attributes referencing global functions (everything lives on `window`
  implicitly since the `<script>` isn't a module).
- **Two "pages":** `state.view` is either `'home'` (surah list) or `'surah'` (a single surah
  opened in Read or Memorize mode). `render()` dispatches to `renderHome()` or `renderSurah()`.
- **Two sub-modes inside a surah:** `state.mode` is `'read'` or `'memorize'`. Memorize mode
  renders one card per ayah (`ayahCardHTML`); Read mode renders one mushaf page at a time
  (`readPageHTML`), grouping ayahs by their real Quran page number.
- **i18n:** a small dictionary-based system (`I18N.ar` / `I18N.en`) with a `t(key, ...args)`
  helper. Arabic is the default language and the UI is RTL by default
  (`document.documentElement.dir`).
- **Audio:** a single shared `Audio` element (`audio` global) is created/destroyed per
  playback. A `setInterval` timer (not `requestAnimationFrame`, because rAF pauses when the
  tab/pane is backgrounded) polls `audio.currentTime` at ~20Hz to drive word-by-word reveal
  in sync with real per-word timing data fetched from Quran.com.

### 2.2 Low-level — module map (all in `index.html`)

| Section (search for the comment) | Responsibility |
|---|---|
| `State & storage` | `LS` (localStorage wrapper), global `state` object, `surahList`, `memorized`, `lastVisit`, `bookmark` |
| `Localization` | `I18N` dictionary, `t()`, `toDigits()` (Arabic-Indic numerals), `stripHarakat()`, `applyDir()`, `toggleLang()` |
| `Audio` | `RECITERS`, `SPEEDS`, `loadVerseAudio()`, `playAyah()`, `startPlayback()`, `wireAudioHandlers()`, `setSpeed()`, `setReciter()`, `stopAudio()` |
| `Data loading` | `fetchJSON()`, `loadSurahList()`, `loadSurah()` — talks to alquran.cloud, normalizes + caches the result |
| `Rendering` | `render()`, `renderHome()`, `renderIndexStrip()`, `renderSurahRows()`, `renderSurah()`, `readPageHTML()`, `ayahCardHTML()` |
| `Bookmark` | `setBookmarkHere()`, `openBookmark()`, `highlightBookmarkAyah()` |
| `Continuous recitation` | `toggleContinuous()`, `startContinuous()`, `stopContinuous()`, `advanceContinuous()` |
| `Interactions` | `setMode()`, `revealNext()`, `revealAll()`, `setRevealCount()`, `toggleMem()` |
| `Init` | `applyDir(); render();` — the only two lines that run on page load |

### 2.3 Rendering flow (a full page load)

```
applyDir() + render()
        │
        ▼
state.view === 'home'?
   ├─ yes → renderHome()
   │          - draws hero banner + progress ring + search + quick-index skeleton
   │          - loadSurahList() (async, cached) → renderIndexStrip() + renderSurahRows()
   └─ no  → renderSurah()
              - draws sticky header (surah name / ayah count / juz badge)
              - draws toolbar (Read/Memorize switch, language toggle)
              - draws controls (reciter / repeat / speed selects)
              - mode === 'memorize' → one <div class="ayah-card"> per ayah (ayahCardHTML)
              - mode === 'read'     → one mushaf page at a time (readPageHTML), using
                                       computeReadPages() to group ayahs by page number
```

### 2.4 Audio + word-sync flow

```
user taps ▶ on ayah N
        │
        ▼
playAyah(N)
  - stopAudio() any current playback
  - mark UI as "playing" (card highlight, pause icon)
  - loadVerseAudio(reciter, surah, N)   // fetch or read from cache: {url, starts[]}
        │
        ▼
startPlayback()
  - if memorize mode: hide all words of ayah N (setRevealCount(N, 0))
  - new Audio(url); audio.playbackRate = speed; audio.play()
  - wireAudioHandlers(N):
      setInterval(50ms):
        ms = audio.currentTime * 1000
        count = number of entries in starts[] that have passed
        if count changed → setRevealCount(N, count)   // un-blurs that many words
      audio.onended:
        - if repeats left → startPlayback() again
        - else if continuousMode → advanceContinuous(N)  (Read mode only)
        - else → stopAudio()
```

`starts[]` holds the **millisecond offset** at which each word begins, taken directly from
Quran.com's per-word audio segment data — this is why word reveal tracks the actual
recitation precisely instead of just guessing based on word length.

## 3. Data structures

### 3.1 `state` (global, in-memory only — not persisted directly)

```js
state = {
  view: 'home' | 'surah',
  surah: null | Surah,          // the currently open surah (see below)
  mode: 'memorize' | 'read',
  showTr: true,                 // (legacy flag, translation visibility is now lang-driven)
  repeat: 1,                    // 1–10, times to repeat an ayah's audio
  revealed: { [numberInSurah]: number },   // memorize mode: words revealed per ayah
  search: '',                   // home screen search box text
  readPages: null | ReadPage[], // read mode: ayahs of `surah` grouped by mushaf page
  readPageIdx: 0                // read mode: which page (index into readPages) is shown
}
```

### 3.2 `Surah` (returned by `loadSurah()`)

```js
{
  number: 2,
  name: "سُورَةُ البَقَرَةِ",          // Arabic name (Uthmani script)
  englishName: "Al-Baqara",
  englishNameTranslation: "The Cow",
  juzStart: 1, juzEnd: 3,             // range of juz' this surah spans
  basmala: "بِسْمِ ٱللَّهِ..." | null,  // extracted separately (see §6.3)
  ayahs: [
    {
      numberInSurah: 1,
      number: 262,          // global ayah number (1–6236) across the whole Quran
      juz: 1,
      page: 2,              // real Madani mushaf page number
      text: "الٓمٓ",         // Uthmani-script Arabic, basmala already stripped from ayah 1
      translation: "Alif, Lam, Meem."
    },
    ...
  ]
}
```

### 3.3 `ReadPage` (from `computeReadPages()`)

```js
{ page: 2, ayahs: [ /* subset of Surah.ayahs whose .page === 2 */ ] }
```

### 3.4 `RECITERS`

```js
[{ id: 7, ar: "مشاري العفاسي", en: "Mishary Alafasy" }, ...]  // id = Quran.com reciter ID
```

### 3.5 `audioState` (in-memory audio session)

```js
{
  key: "2:5" | null,      // "surahNumber:numberInSurah" of the ayah currently loaded
  left: 1,                // repeats remaining
  numInSurah: 5,
  starts: [0, .12, .3],   // fallback: fraction-of-ayah-duration per word (length-weighted)
  segStarts: [80,970,...],// preferred: absolute ms offset per word (from Quran.com)
  url: "https://...",     // resolved audio file URL for this reciter+ayah
  timer: <interval id>
}
```

## 4. Data storage (localStorage)

Everything is client-side; there is no server-side database. All keys are namespaced
`hifz:*`. Values are JSON-encoded via the `LS.get`/`LS.set` wrapper (which fails silently if
storage is unavailable, e.g. private browsing).

| Key | Shape | Purpose |
|---|---|---|
| `hifz:memorized` | `{ "surah:ayah": true, ... }` | Every ayah the user marked "تم الحفظ" |
| `hifz:bookmark` | `{ surah, surahAr, surahEn, page, ayah }` | Explicit "stopped here" marker set from Read mode |
| `hifz:last` | `{ surah, name }` | Last surah opened — home screen's fallback "Continue" button |
| `hifz:lang` | `"ar"` \| `"en"` | UI language |
| `hifz:reciter` | number | Selected reciter's Quran.com ID |
| `hifz:speed` | number | Selected playback speed (0.5–2) |
| `hifz:surahlist` | `Surah[]` (summary) | Cached list of all 114 surahs (name, ayah count, etc.) |
| `hifz:cache:v4:{n}` | `Surah` | Full cached surah `n` (text, translation, juz, page per ayah). Version-suffixed (`v4`) — bump this suffix whenever the cached shape changes, so old cached entries are transparently refetched instead of breaking. |
| `hifz:va` | `{ "reciterId:surah:ayah": { url, starts } }` | Cached audio URL + per-word timing, so replays/revisits don't refetch |
| `hifz:segments` | *(legacy)* | Superseded by `hifz:va`; harmless if still present from an older version |

**Practical implications:**
- Progress does **not** sync across devices or browsers — it's tied to one browser's local
  storage on one device.
- Clearing browser data (or private/incognito mode) wipes all progress.
- There is no way for the app itself to "reset" a user remotely — it's all local.

## 5. External integrations / APIs

No API keys are required for any of these — they're all public, unauthenticated endpoints.

### 5.1 alquran.cloud — Quran text & translation

- `GET https://api.alquran.cloud/v1/surah` — list of all 114 surahs (names, ayah counts).
- `GET https://api.alquran.cloud/v1/surah/{n}/editions/quran-uthmani,en.sahih` — full Uthmani
  Arabic text + Sahih International English translation for surah `n`, including each ayah's
  `juz` and `page` fields (used to build the mushaf pagination).

**Gotcha handled in code:** this API prepends the Basmala to the text of ayah 1 of every
surah except Al-Fatiha (1) and At-Tawba (9). `loadSurah()` detects and strips it (comparing
with diacritics removed, since the edition mixes different sukūn Unicode forms) and stores it
separately as `surah.basmala` so it can be rendered as its own decorative line.

### 5.2 Quran.com API v4 — reciter audio & word timing

- `GET https://api.quran.com/api/v4/verses/by_key/{surah}:{ayah}?audio={reciterId}` — returns
  `verse.audio.url` (the recitation file for that reciter/ayah) and `verse.audio.segments`
  (an array of `[wordIndex, wordNumber, startMs, endMs]` per word).

This single response provides both the playable file **and** exact per-word timing, which is
what makes the word-by-word reveal precise rather than an estimate. `startMs` (segment index
2) is extracted into `starts[]`.

Returned URLs are sometimes relative (`Alafasy/mp3/...`, prefixed with
`https://verses.quran.com/`) or protocol-relative (`//mirrors.quranicaudio.com/...`, prefixed
with `https:`) — `loadVerseAudio()` normalizes both cases.

### 5.3 Fonts

Google Fonts, loaded via `<link>` in `<head>`: **Amiri Quran** (Arabic Uthmani-style serif,
used for all Quran text and Arabic UI accents) and **Outfit** (Latin sans-serif, used for the
rest of the UI).

## 6. Code walkthrough

### 6.1 `LS` — localStorage wrapper

```js
const LS = {
  get(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
```
Wraps every read/write in `try/catch` so storage-disabled environments (private browsing,
storage quota errors) degrade gracefully to defaults instead of throwing.

### 6.2 Internationalization

`I18N` is a flat dictionary per language; values are either a string or a function (for
strings that need interpolation, e.g. `ayahsTotal: n => \`${n} / 6236 ayahs\``).
`t(key, ...args)` looks up the current `lang`'s entry and calls it if it's a function.
`toDigits(n)` converts Western digits to Arabic-Indic numerals (٠١٢٣...) whenever
`lang === 'ar'`, used everywhere a number is displayed. `toggleLang()` flips `lang`, persists
it, updates `<html dir>`, and does a full `render()`.

### 6.3 Basmala extraction (`loadSurah`)

```js
const bare = w => w.replace(/[ً-ٰٟۖ-ۭٱ]/g, '');   // strip harakat/tashkeel for comparison
if (n !== 1 && n !== 9 && words.length > 4 && bare(words[0]) === 'بسم') {
  surah.basmala = words.slice(0, 4).join(' ');
  surah.ayahs[0].text = words.slice(4).join(' ');
}
```
Never compare Arabic strings with hardcoded diacritics baked in — the source API mixes
different Unicode representations of the same diacritics, so comparisons must strip them
first.

### 6.4 Mushaf pagination (`computeReadPages`)

Groups the surah's ayahs by their real printed-mushaf `page` number (from the API), so Read
mode can show "one physical page at a time" with accurate page numbers and navigation —
rather than one continuous scroll.

### 6.5 Word-by-word reveal (`setRevealCount` / `revealNext` / `revealAll`)

`setRevealCount(numInSurah, count)` is the single source of truth: it clamps `count` to
`[0, totalWords]`, stores it in `state.revealed`, toggles the `.hid` (blurred) class on each
word `<span>`, and updates the eye icon. Both manual tapping (`revealNext` — advance one word,
wrap to 0 after the last) and audio-driven reveal (from the `setInterval` in
`wireAudioHandlers`) funnel through this one function, so there's a single code path for "how
many words are shown."

### 6.6 Continuous recitation (Read mode)

`startContinuous()` begins playing the first ayah of the current page with `cont=true`.
`playAyah`'s `cont` parameter distinguishes "part of an auto-advancing sequence" from "a
direct tap" — a direct tap always cancels continuous mode. On `audio.onended`,
`advanceContinuous()` finds the next ayah; if it's on a different mushaf page, it flips the
page (`refreshReadArea()`) before playing it, and scrolls it into view.

### 6.7 Bookmark ("stopped here")

Distinct from `hifz:last` (which just remembers the last surah *opened*, for a lightweight
"Continue" shortcut). The bookmark is an **explicit** action (tapping the ribbon icon) that
captures the exact page + first ayah on that page. The home screen prefers showing the
bookmark CTA over the generic "last visited" one when both exist. `openBookmark()` forces Read
mode, reopens the surah, jumps to the saved page, and pulses (`.bookmark-pulse` CSS animation)
the saved ayah for ~4 seconds so the user can immediately spot where they left off.

### 6.8 Rendering helpers worth knowing

- `esc(s)` — HTML-escapes user-facing/API-facing text before interpolating into
  `innerHTML`, since all rendering is done via string templates (no auto-escaping DOM APIs).
- `refreshReadArea()` — re-renders *only* the `#read-area` div (not the whole surah view),
  used when flipping pages or toggling a bookmark, to avoid a full page rebuild/scroll jump.
- Icons (`playIconSVG`, `pauseIconSVG`, `bookmarkIconSVG`, `eyeSVG`) are inline SVG strings
  rather than emoji or icon fonts — chosen because emoji glyphs render inconsistently
  (sometimes invisible) across platforms/fonts, while inline SVG is always crisp and
  themeable via `currentColor`.

## 7. Design system

### 7.1 Color palette (CSS custom properties in `:root`)

| Variable | Value | Use |
|---|---|---|
| `--bg` | `#faf7f1` | Page background (warm off-white) |
| `--card` | `#ffffff` | Card/surface background |
| `--ink` | `#1e293b` | Primary text |
| `--muted` | `#64748b` | Secondary text |
| `--primary` | `#0e6b5c` | Brand green (buttons, active states, links) |
| `--primary-soft` | `#e3f0ed` | Light green (badges, memorized-ayah highlight) |
| `--gold` | `#c9a227` | Accent gold (bookmarks, decorative elements) |
| `--gold-soft` | `#f7efd8` | Light gold (badges) |
| `--border` | `#e8e2d6` | Default border color |
| `--radius` | `16px` | Default corner radius |
| `--shadow` | soft dual box-shadow | Default card elevation |

### 7.2 Typography

- **Amiri Quran** (serif) — all Quran Arabic text, the app's Arabic name/bismala, and Arabic
  surah names. Chosen for its Uthmani-script authenticity.
- **Outfit** (sans-serif) — all UI chrome (buttons, labels, English text).
- Numerals switch between Western (`0123...`) and Arabic-Indic (`٠١٢٣...`) based on the
  active language via `toDigits()`.

### 7.3 RTL / LTR handling

Arabic is the default and primary-supported direction. `document.documentElement.dir` is set
globally, and most layout is direction-agnostic by using CSS logical properties
(`inset-inline-start`, `margin-inline-start`) rather than hardcoded `left`/`right`. A handful
of elements are intentionally direction-**independent** (e.g. the read-mode mushaf header
always shows the surah name physically on the right and page/juz info on the left, matching
real mushaf convention, regardless of UI language) — these use `direction: rtl` explicitly
rather than relying on the document direction.

### 7.4 Read-mode ("mushaf") visual design

Deliberately kept **minimal and modern** (not an ornate gold-leaf facsimile) per product
decision: plain white page, center-aligned Arabic text lines, and a delicate ayah-end
ornament — a thin inked ring with a `repeating-conic-gradient` dot-halo around it, evoking the
traditional Quranic ayah-stop mark (۝) without needing a custom icon font or image asset.
The currently-playing ayah highlights in a soft blue (`#dcf1f4`); a memorized ayah highlights
in the app's green (`--primary-soft`).

### 7.5 Hero banner decorative elements

- A quatrefoil (4-overlapping-circles) rosette pattern tiles subtly across the banner
  background — chosen deliberately as a **non-star** Islamic geometric motif.
- A small 3D-animated crescent-moon ornament (`.crescent3d`, built from 3 parallax SVG layers
  using CSS `transform-style: preserve-3d` and `translateZ`) sits in the banner's top corner,
  opposite the language toggle — sized and positioned specifically so it never overlaps the
  centered title text.
- Both were chosen over an earlier 8-point-star motif at the user's explicit request to avoid
  star imagery.

## 8. Setup & infrastructure

### 8.1 Hosting stack

| Layer | Provider | Detail |
|---|---|---|
| Source control | GitHub | [github.com/AhmedAbdelaziz5581/hifz](https://github.com/AhmedAbdelaziz5581/hifz), branch `master` |
| Static hosting | Cloudflare Pages | Project name `hifz`, default subdomain `hifz-bnb.pages.dev` |
| DNS + domain | Cloudflare (nameservers) | Domain `hifz-quran.com` registered at GoDaddy, DNS delegated to Cloudflare via nameserver change (`adi.ns.cloudflare.com` / `hugh.ns.cloudflare.com`) |
| SSL | Cloudflare-managed (Google CA) | Auto-issued once DNS verification completes |
| CI/CD | GitHub Actions | `.github/workflows/deploy.yml` — deploys on every push to `master`. **Live and confirmed working** (see §8.3). |

### 8.2 How the pieces connect

```
git push origin master
        │
        ▼
GitHub Actions runs .github/workflows/deploy.yml
  - actions/checkout@v4
  - cloudflare/wrangler-action@v3
      command: "pages deploy . --project-name=hifz --commit-dirty=true"
      apiToken: secrets.CLOUDFLARE_API_TOKEN
      accountId: 43d312b4fd4274f7618ece924241a464
        │
        ▼
Cloudflare Pages project "hifz" gets a new deployment
        │
        ▼
Custom domain hifz-quran.com (attached to the Pages project, DNS CNAME →
hifz-bnb.pages.dev, proxied through Cloudflare) serves the new version
```

### 8.3 One-time setup steps already performed

1. `gh repo create hifz --public --source=. --push` — created the GitHub repo and pushed
   the initial commit (`git init`, local `user.name`/`user.email` set repo-scoped only, not
   globally).
2. `wrangler login` (OAuth device flow) — authenticated the Cloudflare CLI.
3. `wrangler pages project create hifz --production-branch=master` — created the Pages
   project (required the Cloudflare account's email to be verified first).
4. `wrangler pages deploy .` — first manual deploy (direct upload, not yet Git-connected).
5. `POST /accounts/{id}/pages/projects/hifz/domains` (Cloudflare API) — attached
   `hifz-quran.com` as a custom domain to the Pages project.
6. Domain's nameservers changed at GoDaddy to Cloudflare's, activating a Cloudflare DNS zone
   for `hifz-quran.com`.
7. Stale GoDaddy "parked domain" `A` records removed; a `CNAME` record
   (`hifz-quran.com` → `hifz-bnb.pages.dev`, proxied) added — done via the Cloudflare
   dashboard, since the CLI's OAuth token only grants `zone:read`, not DNS write access.
8. `.github/workflows/deploy.yml` added for push-to-deploy automation, requiring a
   `CLOUDFLARE_API_TOKEN` repo secret with **Account → Cloudflare Pages → Edit** permission.
   The token was created manually via the Cloudflare dashboard (token creation isn't
   permitted via an OAuth-derived CLI session) and stored as a GitHub Actions secret via the
   dashboard's **Settings → Secrets and variables → Actions** page.
9. **Auto-deploy verified end-to-end** (2026-08-11): confirmed the secret is present
   (`gh secret list`), pushed a test commit, and watched GitHub Actions run
   `wrangler pages deploy` successfully (`gh run list` / `gh run view --log`) and publish a
   new deployment that `hifz-quran.com` correctly served. From this point on, **every
   `git push` to `master` auto-deploys** — no manual `wrangler pages deploy` is needed.

### 8.4 GitHub repo secret

| Secret name | Scope needed | Status |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Account → Cloudflare Pages → Edit | ✅ Set and confirmed working |

To rotate it later: create a new token at dash.cloudflare.com → My Profile → API Tokens,
then update the secret with `gh secret set CLOUDFLARE_API_TOKEN --repo AhmedAbdelaziz5581/hifz`
(paste the new value when prompted), or via the GitHub repo's
**Settings → Secrets and variables → Actions** page.

## 9. Local development

No dependencies, no `npm install`. Two ways to run it:

```bash
# Option A — the bundled tiny static server
node server.js
# → http://localhost:8321

# Option B — any static file server
npx http-server . -p 8321
```

`server.js` is a ~20-line vanilla Node `http` server: it maps a request path to a file under
the project root (defaulting `/` to `index.html`), guards against path traversal outside the
root, and serves it with a basic MIME-type lookup. It is **not** used in production —
Cloudflare Pages serves `index.html` directly as a static asset.

Since it's a single static HTML file, editing `index.html` and refreshing the browser is the
entire development loop — no build/watch step exists or is needed.

## 10. User guide

### 10.1 Home screen

- **Progress ring** — percentage of the whole Quran (6,236 ayahs) marked memorized.
- **Continue button** — jumps back to your bookmark (if set) or your last-opened surah.
- **Search bar** — filter the surah list by name or number.
- **Quick index** — horizontally scrollable strip of all 114 surahs by number; surahs you've
  fully memorized are highlighted gold.
- **Surah list** — tap any surah to open it. A mini progress bar shows partial memorization
  progress.
- **EN / ع button** (top-right of the banner) — switches the whole UI between Arabic and
  English.

### 10.2 Inside a surah — shared controls

- **Read / Memorize switch** — toggles the two modes described below.
- **Reciter** — choose from 8 reciters (Alafasy, Husary, AbdulBaset, Minshawi, Sudais,
  Shatri, Rifai, Shuraym). Switching mid-playback restarts the current ayah with the new
  reciter.
- **Repeat** — 1× to 10×; how many times an ayah's audio loops before stopping (or advancing,
  in continuous mode).
- **Speed** — 0.5× to 2×. Word-sync stays accurate at any speed.

### 10.3 Memorize mode

1. Open a surah — it defaults to Memorize mode.
2. Each ayah's words start blurred, with an ayah-count badge and a "mark memorized" button.
3. **Tap the ayah text** to reveal it one word at a time (tapping past the last word hides it
   again, for repeated self-testing).
4. **Tap the eye icon** to instantly reveal/hide the whole ayah.
5. **Tap ▶** to hear the recitation — words un-blur automatically in sync with the audio.
6. **Tap "تم الحفظ" / "Mark memorized"** once you've got it — it turns gold-highlighted and
   counts toward your home-screen progress.

### 10.4 Read mode

1. Switch to Read via the toolbar.
2. The surah is shown **one real mushaf page at a time** (matching actual printed Quran page
   numbers), with **‹ ›** navigation and a page-position indicator.
3. Tap any ayah to hear just that ayah.
4. Tap **"تلاوة متتابعة" / "Play page"** to auto-play the page start-to-finish, automatically
   advancing ayah-to-ayah and flipping to the next mushaf page when needed. Tap it again (now
   labeled "إيقاف" / "Stop") to stop.
5. Tap the **ribbon/bookmark icon** to save "I stopped here" — the exact page and ayah. It
   shows a gold "🔖 توقفت هنا / You stopped here" chip when you're viewing the bookmarked page.
6. In English mode, each page's translation is shown below the Arabic text.

### 10.5 Returning to where you left off

From the home screen, the **Continue** button (top banner) always prefers your explicit
bookmark over the generic "last opened" shortcut. Tapping it reopens the exact page in Read
mode and briefly pulses the bookmarked ayah so you can spot it immediately.

## 11. Known limitations

- **No account / no cross-device sync** — progress is per-browser, local-only.
- **No offline mode** — Quran text and audio are fetched from live APIs on first use (though
  cached afterward in `localStorage` for repeat visits of the same surah/ayah/reciter).
- **DNS/CI write access boundary** — the Cloudflare CLI session used to configure hosting only
  has `zone:read`, not DNS-write or API-token-creation permissions; those specific steps (DNS
  record edits, API token creation) must be done via the Cloudflare dashboard, not automated
  end-to-end.
- **Reciter audio licensing** — recitations are sourced from the Quran.com/Quran Foundation
  library, which documents usage terms for religious/educational use; there is no
  royalty-free guarantee for commercial use. See project notes for details if monetizing.
