# Archer's Planner

A Canvas-integrated deadline and grade dashboard for DLSU students. Courses,
deadlines and files from AnimoSpace land in one editorial-style dashboard, with
a weighted grade calculator built on the breakdown pulled out of each syllabus.

Two pieces:

| Piece | Where it runs | What it does |
| --- | --- | --- |
| Next.js app (repo root) | Vercel + Supabase | Dashboard, timeline, grade calculator, syllabus parsing, sync tokens |
| `extension/` | Chrome / Brave, Manifest V3 | Reads your own AnimoSpace data and posts it to the app |

The extension exists because DLSU's Canvas admin does not issue API tokens to
students. Canvas's internal REST API answers to the session cookie, so a content
script on `dlsu.instructure.com` can read your own enrolments where a server
cannot.

---

## Screens

- **Dashboard** (`/`) — four running counters, a "next up" hero with a live
  countdown, the queue of what's open, a seven-day density strip, per-course
  grade standing, and recent files.
- **Timeline** (`/timeline`) — the week grid: deadlines placed on an hour rail,
  diagonal hatch for free time.
- **Grades** (`/grades`) — weights, scores, running total, and "what do I need
  on the rest" projections against a target.
- **Settings** (`/settings`) — sync token, extension setup, syllabus upload.
- **Preview** (`/preview`) — the whole dashboard against fixture data, no
  account needed. Useful for working on the design.

## Design

Heavy grotesk course codes in caps, hairline rules, no shadows, no rounded
corners, diagonal hatch for empty periods. Colour carries exactly one meaning —
`--accent` (`#00703c`) marks **due today** and nothing else. Every other state
is carried by fill:

| State | Treatment |
| --- | --- |
| Upcoming | White, heavy black left edge |
| Due today | Accent left edge, accent time-until label |
| Overdue | Solid black, reversed out |
| Done | Hairline edge, struck-through code |

Motion is a short rise on entry, a stagger down each section, and width/height
grows on the meters and density bars — all CSS, and all disabled under
`prefers-reduced-motion`.

---

## Setup

### 1. Supabase

Run [`supabase/schema.sql`](supabase/schema.sql) in the SQL editor. It creates
every table, turns on row-level security scoped to `user_id`, creates the
private `course-files` bucket, and installs the `ingest_sync` function.

Under **Authentication → Providers**, leave email/password on.

### 2. Environment

```bash
cp .env.example .env.local
```

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Project Settings → API. Both have committed defaults in `lib/config.ts`, so you only need these to point a clone at your own project. |
| `GEMINI_API_KEY` | Server only, from [AI Studio](https://aistudio.google.com/apikey). Used by `/api/parse-syllabus`; without it that one route returns a clear error and nothing else is affected. |
| `GEMINI_MODEL` | Optional. Defaults to `gemini-3.8-flash`; drop to `gemini-3.5-flash-lite` to cut cost further. |
| `NEXT_PUBLIC_CANVAS_ORIGIN` | `https://dlsu.instructure.com`. Also the origin the sync endpoint accepts cross-origin posts from. |

**There is no service-role key.** The extension's writes go through
`ingest_sync`, a `security definer` Postgres function gated on the sync token,
so no high-privilege secret is deployed anywhere. The Supabase URL and
publishable key are committed in `lib/config.ts` on purpose: a publishable key
is designed to sit in the browser bundle, RLS is what protects rows, and it can
be rotated on its own without signing anybody out.

### 3. Run

```bash
npm install && npm run dev
```

### 4. Extension

1. Sign in → **Settings** → *Generate token* (copy it; only a hash is stored).
2. `chrome://extensions` (or `brave://extensions`) → Developer mode → **Load unpacked** → pick `extension/`.
3. Open the extension's Options, paste the planner URL and the token, save.
4. Open AnimoSpace. It syncs on page load and every 15 minutes while the tab is open.

---

## How it fits together

```
AnimoSpace tab ──content.js──▶ POST /api/sync ──rpc ingest_sync──▶ Supabase
   (session cookie)             (bearer sync token)   (security definer)  │
                                                                          ▼
                       browser ◀── anon key + RLS ─────────── dashboard / grades
                          │
                          └── localStorage snapshot ── offline reads
```

- **`/api/sync`** validates and length-caps every field, then hands the payload
  to `ingest_sync`. The token decides whose rows these are; nothing in the body
  can name a user.
- **Everything else** reads through the anon key with the signed-in session, so
  RLS is what isolates one student's rows from another's.
- **`/api/parse-syllabus`** downloads the file from the student's own storage
  prefix, sends it to Gemini once with a response schema, validates the JSON that
  comes back anyway, and
  writes `grade_components`. It refuses to re-run for a course that already has
  extracted components unless `force: true`, so a syllabus costs one API call.

## Tests

```bash
npm test
```

Covers the parts with real logic: week bounds, lane packing for overlapping
deadlines, hour-rail range, countdown units, the seven-day pulse buckets,
weighted grade totals, and the "what do I need on the rest" projection.

## Known limits

- Offline data is one `localStorage` blob, not IndexedDB. Fine for a term.
- "Sync" opens AnimoSpace and lets the content script do the work, rather than
  messaging the extension directly — no extension ID to configure.
- Live gradebook scraping (`grades.source = 'scraped'`) is modelled but not
  wired; scores are entered by hand on the Grades page today.
