# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Internal financial admin portal for **Summit Management** (hedge fund, ~$60M AUM). Manages revenue, payroll, office expenses, and FX rates across multiple years. Desktop only. Two users: **San** (founder, full access) and **Deborah** (operations, office expenses only).

> Full specification — UI patterns, database schema, page-by-page behavior, data layer patterns, seed data — is in [`CLAUDE_CODE_HANDOFF.md`](./CLAUDE_CODE_HANDOFF.md). Read it before making any changes.

## Running locally

```bash
cp env.example.js env.js   # fill in SUPABASE_URL and SUPABASE_ANON_KEY
npx http-server -p 3000    # or any static server
```

No build step. Open `index.html` or `login.html` in browser.

## Architecture

**Vanilla HTML/CSS/JS + Supabase + Netlify.** No framework, no bundler.

- `index.html` — app shell with sidebar + page containers (SPA-style via show/hide)
- `login.html` — magic-link entry, separate page
- `js/supabase-client.js` — single Supabase client, reads from `window.ENV`
- `js/auth.js` — magic-link + TOTP MFA, role-based page gating
- `js/nav.js` — page switching and auto-scroll behavior
- `js/fx.js` — USD/MXN rate cache and editor
- `js/overview.js`, `js/revenue.js`, `js/payroll.js`, `js/office.js` — one module per page
- `js/projection.js` — shared projection logic for revenue and office
- `js/utils.js` — `fmtUsd`, `fmtMxn`, `fmtPct`, date helpers

**Each page module** loads all its data on entry (parallel Supabase fetches), builds an in-memory data shape matching the prototype's render functions, then calls render. On edit: optimistic UI update first, then write to Supabase, roll back on error.

**Auth**: magic-link only → TOTP MFA on every session. Roles enforced by RLS on all tables; frontend gating is UX only.

## Key constraints

- **No npm/framework** — CDN imports only (Supabase SDK, Chart.js, SheetJS via `<script>` tags).
- **UI/CSS is frozen** — the prototype HTML (`summit-admin-prototype.html`) is the visual source of truth. Match it exactly; do not redesign.
- `scripts/sync-fees.js` is a Node.js script (uses `@neondatabase/serverless`) for syncing fee data — run with `npm run sync-fees`.
- Environment variables live in `env.js` (gitignored). Never hardcode credentials.
