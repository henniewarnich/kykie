# kykie.net Hockey Stats PWA — Handoff Document
**Version: 7.24.3 | Date: 14 May 2026**

## Project Overview
A Progressive Web App for live school hockey match stats, commentary, and analytics.
- **URL**: https://kykie.net (GitHub Pages, Afrihost DNS)
- **Repo**: github.com/henniewarnich/kykie (renamed from hockey-stats)
- **Stack**: React 18 + Vite, Supabase (env-switched), hash routing
- **Build**: `npm run build` → outputs to `docs/` folder
- **Dev**: `npm run dev` → localhost:5173 against staging DB
- **Email**: Resend (transactional) via `no-reply@kykie.net`, Afrihost for `info@kykie.net`
- **Local folder**: `C:\@@Data\@@VibeProjects\Kykie`

## Supabase Projects
- **Production**: belveuygzinoipiwanwb.supabase.co (renamed to "kykie")
- **Staging**: gswvccchwrkcwepufvdq.supabase.co (kykie-staging, eu-central-2)
- Switching via `.env.production` / `.env.development` (Vite auto-selects)
- `.env.development` is gitignored
- Staging test users: `admin@kykie.test`, `coach@kykie.test`, `commentator@kykie.test`, `supporter@kykie.test` (profile rows seeded via `upgrade-scripts/v7.20.0/seed-staging-test-users.sql`)
- Staging seeder: `node --env-file=.env.staging-import scripts/seed-staging.js` (reuses prod data; service-role keys live in gitignored `.env.staging-import`, template at `.env.staging-import.example`)
- Schema differ: `node --env-file=.env.staging-import scripts/diff-schemas.js` — flags column drift between prod and staging

## Critical Build Rules
- **NEVER build unless explicitly instructed** — always ask first
- **Always bump** `APP_VERSION` in `src/utils/constants.js` AND `version` in `package.json`
- **Run `npm run build`** so `docs/` folder is updated
- Deploy: `git add -A && git commit -m "v7.x.x — description" && git push`
- Logo PNGs in `public/` — Vite auto-copies to `docs/` on build
- CNAME file in `public/` must be preserved

## Architecture

### Roles & Routes
| Role | Route | Access |
|------|-------|--------|
| Public | `#/team/{slug}` | Score, commentary, emoji reactions via team URL |
| Supporter | `#/submit` | Submit results, upcoming matches, suggest teams |
| Commentator | `#/record` | Dashboard with assigned matches, Live + Live Pro recording |
| Coach | `#/coach` | Dashboard → team pages with Overall/Matches/Trends/Live Stats |
| Admin | `#/admin` | Full access: all admin screens |

### Key Features
- **Live Pro recording**: Full field recorder with 90-degree rotation (0→90→180→270) and team colour picker
- **Match Reports**: `match_reports` table, auth-gated viewer at `#/report/{id}`, teaser/full split (supporters see stats + verdict + DNA, coaches see tactical analysis), share button, admin "Notify Coaches" button
- **Feature gating**: Free = own stats, VS OPP + Benchmark blurred. Free Plus = avg ≥ 20 credits/match. Premium = R5,000/yr
- **Email notifications**: pg_net + Resend from database triggers. Registration auto-notifies admin. Report notification via RPC.
- **Coach-only CSS**: `<div class="coach-only">` gates tactical content in reports

### Admin Navigation
- `AdminBackBar` component on all 12 admin sub-screens

### Key Patterns
- **Multi-role**: `role` = active, `roles[]` = all assigned. RoleSwitcher uses sessionStorage
- **Teams query**: Always `.or('status.eq.active,status.is.null')`
- **Supabase SQL editor**: Use `$fn$` not `$$`
- **Ball movement**: D Entry + Ball in play = implicit forward movement (not just "Ball forward")
- **Zone perspective**: Labels stored from home team perspective; invert for away
- **Opponent season avg**: `oppSeasonAvg` computed from `matchDetailRecords`, not H2H only
- **seasonAvgForTeam**: Skips matches team didn't play in, correct divisor

## Email Setup
- **Transactional**: Resend via `no-reply@kykie.net`. API key in `site_settings` table. `send_email()` Postgres fn uses pg_net.
- **Personal**: `info@kykie.net` via Afrihost mailbox, forwarded to Gmail. Gmail "Send mail as" configured.
- **Registration trigger**: `on_profile_created_notify` → emails hennie.warnich@gmail.com
- **Report notification**: `notify_coaches_of_report(p_report_id)` RPC → emails coaches of both teams
- **Gmail signature**: kykie-icon-dark.png + name + kykie.net

## Session Summary (11 May 2026)

### Code Changes (v7.24.2 → v7.24.3)
- **TOP 10 benchmark now peer-scoped** — the Coach view's TOP 10 benchmark (per-match averages, aggregated stats, etc.) was previously the global top-10 ranked teams regardless of gender/age. Now restricted to teams sharing the same `gender`, `age_group` and `sport` as the team being viewed. So Paarl Girls 1st is benchmarked against the top 10 Girls 1st teams only; Paarl Boys 1st against the top 10 Boys 1st teams; etc.
- Logic: take all ranked teams, filter to peer group (same gender + age_group + sport), then pick the top 10 by rank. Falls back to the original global top-10 if any of the team's metadata fields are missing.
- **Column header updated** in `CoachOverall` from "Benchmark / TOP 10" to "Benchmark / TOP 10 · {Gender} {AgeGroup}" (e.g. "TOP 10 · Girls 1st") so the peer scope is visible to the user.

### Code Changes (v7.24.1 → v7.24.2)
- **Game History share button — more visible.** Was a tiny 8px text "share" link. Now a proper purple-tinted button (10px text, share icon, padded with a coloured border), in line with the other share buttons in the app.
- **GameReviewScreen polish:**
  - **Fixed rogue "0"** appearing on the screen when a match had no recording. Cause: `hasRecording = events.length > 0 || (G.duration && G.duration > 0)` evaluated to `0` when duration was 0 (`false || 0` is `0`), and `{isAdmin && hasRecording && (...)}` rendered the literal `0`. Now strictly a boolean: `events.length > 0 || (G.duration || 0) > 0`.
  - **Start Video Recording for admin too.** The button is now shown to any admin or commentator when the match has no recording yet (was commentator-only).
  - **Share button on the screen itself.** Admin and commentator can now share the review link directly from the Game Review screen — same `#/review/{id}` URL as the Game History share.

### Code Changes (v7.24.0 → v7.24.1)
- **Role-switching restricted to admins** — only users with `admin` in their `roles[]` array can switch between roles via the RoleSwitcher. Everyone else now sees a static role pill (no dropdown).
- **Highest-role default for non-admins** — if a non-admin user has multiple roles assigned, the active role on login/session restore is now forced to the highest one. Hierarchy (auth.js `ROLE_PRIORITY`): admin (4) > coach (3) > commentator (2) > supporter (1). Saved active-role state in sessionStorage is ignored for non-admins.
- New helpers in `auth.js`: `ROLE_PRIORITY`, `highestRole(roles)`.

### Code Changes (v7.23.9 → v7.24.0)
- **Shareable match-review URL** — new route `#/review/{matchId}` opens a standalone Game Review screen with auth gating. Designed for admins to share a completed match with a commentator so the commentator can record video stats from a single tap.
  - New `ReviewWrapper` component in App.jsx fetches the match + events, builds the game object, and renders `GameReviewScreen` with an `onStartVideoReview` callback that locks the match and switches to the live recorder in place.
  - Game History 📤 Share button now targets `#/review/{matchId}` (was `#/match/{matchId}` which sent fans to the team page).
- **GameReviewScreen role-aware actions** — admin-only actions (📦 JSON, ✏️ Edit, 🗑 Delete Match) are now hidden from commentators. Commentators viewing the screen see:
  - 📹 Start Video Recording (only when the match has no recording yet) — triggers the same flow as the existing Video Stats button in History
  - ⚠️ Report Issue (always) — links to the existing `#/issues` page so they can flag score problems back to admin
  - 📺 Public / 🔒 Coach views remain available when the match has events to display
- Per-event delete buttons remain admin-only (unchanged).

### Code Changes (v7.23.8 → v7.23.9)
- **Team page upcoming match cards: Share button** — each upcoming match card on the team page (supporter and coach views) now has a small "📤 Share" button in the top-right alongside the countdown. Same shareMatchLink helper as everywhere else.
- **Team page tab order** — swapped to Results | Upcoming (was Upcoming | Results). Default landing tab unchanged.

### Code Changes (v7.23.7 → v7.23.8)
- **Share button on landing-page upcoming matches** — when a logged-in or logged-out visitor expands an upcoming match on kykie.net's Upcoming tab, the expanded panel now starts with a "📤 Share match" button (top-right). Generates the canonical `#/match/{uuid}` link via the existing `shareMatchLink` helper. Toast confirms the clipboard copy.

### Code Changes (v7.23.6 → v7.23.7)
- **Quick-score match detail view** — opening a match that was only recorded via quick score (no Live Pro events, `duration = 0`) previously showed a useless "Match Stats" panel of zeros plus a misleading "Clinical" insight (e.g. "4 goals from 0 shots on target"). TeamPage's selected-match view now detects this case and shows:
  - A small banner explaining the match was recorded by quick score only
  - Season-form scout cards for both teams (P / W / D / L / GF / GA / GD with rank badges)
  - A full Kykie Predicts panel (same one LandingPage uses for upcoming matches): win-probability bar, top-level winner prediction, and the bullet-point reasons (GD per game, GS/GA averages, ranking differential, etc.)
  - When both teams have fewer than 3 recorded matches, shows a friendly "needs more data" message instead of the predicts panel
- Live Pro matches (any match with at least one zone event recorded) are unaffected — they still render the CoachLiveScreen embedded view with full stats and visuals.

### Code Changes (v7.23.5 → v7.23.6)
- **Shared upcoming-match links now land on the Upcoming tab** — TeamPage's `initialMatchId` handler only checked `ended` matches and ignored upcoming/live ones, so a shared link for an upcoming match opened the default Overall tab. Now: ended → match detail; upcoming → Upcoming tab; live → Live tab.
- **Standard share icon** — replaced the 📋 emoji on all four share buttons with the canonical iOS-style share glyph (square box with upward arrow). Added a `share` entry to `Icons.jsx` so it's reusable. Toast copy simplified from "🔗 Link copied" to "Link copied".
- **Landing page upcoming-match prompt** — the "Log in to predict" strip under each upcoming match looked detached. Removed the full border, kept a single hairline divider, made the whole strip clickable, bumped font 9 → 10 and brightened the colour. Wording: "**Log in** to predict the outcome of this match".

### Code Changes (v7.23.4 → v7.23.5)
- **Fixed Turnover Won zone bug** — `LiveMatchScreen.handleBallTap` was logging every Turnover Won with `zone='Centre'` due to a ternary that returned "Centre" in both branches. Now reads the actual ball zone (`${zone.label} (${pos})`), mirroring Poss Conceded. Single writer affected; covers both home→away and away→home directions.
- **Backfill SQL — smart approach** `upgrade-scripts/v7.23.5/backfill-turnover-zones-smart.sql` — for each Turnover Won @ Centre, copies the zone from the most recent zone-bearing event in the same match (by `seq`). **Production run on 2026-05-11 recovered 2,433 of 2,440 rows (99.7%).** The 7 remaining "Centre" rows are first-turnover-of-the-match cases where no prior zone event existed yet.
  - Superseded earlier `backfill-turnover-zones.sql` (pair-based — only ~0.1% recovery because Turnover Won and Poss Conceded are alternate workflows in the recorder, not paired writes). Marked SUPERSEDED on disk.
  - Companion preview-only script `preview-turnover-backfill-smart.sql` runs the analysis on one match at a time without touching data — useful for sanity-checking new matches before the next bulk pass.
- **⚠ Supabase SQL editor gotcha** — explicit `BEGIN; … COMMIT;` blocks are unreliable in the Studio SQL editor because their connection pooler (PgBouncer in transaction mode) can release the connection between statements. The first prod attempt of the smart backfill silently rolled back even after switching ROLLBACK→COMMIT. Workaround: just run each statement standalone and rely on PostgreSQL auto-commit. The smart-backfill SQL has been restructured into discrete steps; the gotcha is documented in its header.
- **Share match link** — new `#/match/{id}` route resolves to the team page via `MatchRedirect`. Helper `shareMatchLink(matchId)` uses `navigator.share` on mobile (WhatsApp/Messages picker) with a clipboard fallback + green toast on desktop. New 📋 Share buttons added to:
  - Match Schedule list (admin/coach/commentator action row)
  - Game History cards (next to abandon/restore)
  - Team page selected-match detail header
  - Team page live-match scoreboard header
- **Live recorder field-side clarity**:
  - **Coloured backline** — top and bottom backlines now tinted with the defending team's colour (33% alpha) plus a 3px solid stripe; team short_name jumped from 9px to 12px bold white with a coloured drop-shadow. Always visible during play, updates automatically when the field rotates.
  - **Pre-match team splash** — large team short_names appear faintly across each half before kickoff (when the recorder is idle), so the commentator can confirm orientation before tapping "Start". Disappears as soon as the match goes live or pauses.

## Session Summary (7 May 2026 — afternoon)

### Code Changes (v7.23.3 → v7.23.4)
- **Admin can edit Supporting Institutions on any user** — Edit User screen now has a search/chip picker for `supporting_institution_ids` (mirrors the Coach Teams picker UX)
- **Self-edit profile screen at `#/profile`** — any logged-in user can now edit their own First/Last name, Nickname, Mobile Number, Home Town, DOB, Gender, Sport Interest, Supporting Institutions and Notification Preferences. Email, username and role stay read-only (admin-managed)
- **Entry point** — clicking your own first name in the page header (visible from Home, Coach Dashboard, Supporter Dashboard etc.) routes to `#/profile`
- **No DB changes** — uses the existing "Users update own profile" RLS policy (`auth.uid() = id`) from baseline migration

### Code Changes (v7.23.2 → v7.23.3)
- **Added `mobile_number` field on profiles**
  - New optional column on `profiles` (TEXT, nullable) and updated `register_crowd_profile` RPC
  - Self-registration form now collects "Mobile Number" alongside Home Town
  - **Run** `upgrade-scripts/v7.23.3/migration-mobile-number.sql` in Supabase SQL editor (production AND staging)
- **Admin User Management — full Profile Details on Edit screen**
  - Edit User now shows a read-only "Profile details" panel: Email, Date of birth, Gender, Home town, Sport interest, Supporting institutions (resolved to names), Notification preferences, Terms-accepted timestamp, Last seen, Joined
  - Mobile number is **editable** by admin (the only field admins can fill in for existing users without that data)

### Code Changes (v7.23.1 → v7.23.2)
- **Coach commentator picker → search instead of button grid** — when a coach schedules a match, the "Assign Commentators" picker now shows a search input that only surfaces commentators whose registration `supporting_institution_ids` overlaps with the institutions of the coach's assigned teams (derived from `coach_teams`)
  - Selected commentators show as removable chips above the search; admins/commentators scheduling matches still see the original button grid
- **Commentator self-reservation** — on the Match Schedule list, a commentator can now reserve any unassigned upcoming match where the home or away team's institution is in their `supporting_institution_ids`
  - "🎙 Reserve this match" button appears only when no other commentator is yet assigned (first-come-first-served); once reserved they see "✕ Cancel reservation"
  - Uses the existing `match_commentators` self-insert RLS policy from v7.16.28 — **no schema or RLS changes**

### Code Changes (v7.23.0 → v7.23.1)
- **Coach Dashboard** — `#/coach` no longer redirects straight to a team page; it now shows a tile-based dashboard
  - Tiles: Team Stats (top, jumps to first coached team page — existing dropdown handles multi-team), Training, Try Demo Match, Match Schedule, New Match, Game History
  - Coaches keep `role = 'coach'` — no role changes; the `#/admin` route gate now also accepts `coach` so they can land on Match Schedule, New Match and Game History
  - "Back" from any of those screens routes coaches back to `#/coach` (the new dashboard) via the existing `getHomeHash` logic
  - Training screen now renders coach-appropriate copy (no "Commentator trainee" badge, no benchmark test step, no "After qualifying" credits list) when opened by a coach
  - **Open by design:** coaches can schedule, record and quick-score *any* match, not just their team's — same scope as commentators

### Code Changes (v7.22.4 → v7.23.0)
- **Removed Commentator Admin role** — simplification; the role had no users assigned, so this is a behaviour-neutral cleanup
  - Frontend: dropped from RoleSwitcher dropdown, User Management role list, System Health legend; collapsed all `['admin', 'commentator_admin']` gating checks down to plain admin checks across ~17 files
  - Edge function: `supabase/functions/reset-password` now only accepts `admin` callers
  - DB schema **untouched** — `profiles.role` still technically allows `commentator_admin` as a value, but the UI no longer offers it. Cleanup deferred (see TODO below)

## TODO (deferred)
- **Drop `commentator_admin` from RLS policies + audit RPC** — write a migration that rewrites every policy currently using `role IN ('admin', 'commentator_admin', ...)` to drop the role, and updates the `audit_log` RPC's `commentator_admin` branch. Touched migrations to revisit: `baseline/migration-users.sql`, `baseline/migration-phase2-rls.sql`, `baseline/migration-audit.sql`, `v7.9.0/migration-crowd-submissions.sql`, `v7.9.28/migration-issues.sql`, `v7.9.34/migration-contributors.sql`, `v7.9.35/migration-site-settings.sql`, `v7.14.0/migration-user-devices.sql`, `v7.16.27/migration-vouchers.sql`, `v7.16.28/migration-commentator-tracking.sql`, `v7.17.0/migration-team-credits.sql`, `v7.19.0/migration-match-reports.sql`, `v7.21.0/migration-communication-log.sql`. Schedule for a calm week (not before a weekend of matches).

## Session Summary (7 May 2026 — morning)

### Code Changes (v7.22.3 → v7.22.4)
- **Live Pro rotated field fills available width again** — v7.22.3's clamp was too aggressive on wide screens (field appeared squashed); reverted to the original scale (`fieldW / FIELD_H`)

### Code Changes (v7.22.2 → v7.22.3) — superseded
- Tried clamping the rotation scale so the rotated field never grew beyond its natural proportions; squashed it on wide screens. Reverted in v7.22.4.

## Session Summary (4 May 2026)

### Code Changes (v7.22.1 → v7.22.2)
- **Live Pro field rotation** — fix 270° (4th rotation) to put the previously-top team on the left instead of right; full clockwise cycle now works at every 90° step
- **Coach digest email** — when a match was decided by penalties, the digest line now shows e.g. "Oranje won 3–1 on penalties" under the regulation score (DB function update — run `upgrade-scripts/v7.22.2/migration-coach-digest-pens.sql` in Supabase SQL editor)

### Code Changes (v7.22.0 → v7.22.1)
- **System Health → Export All Data (JSON)** now includes 7 previously-missing tables: `match_reports`, `app_settings`, `communication_log`, `login_attempts`, `team_credits`, `team_tiers`, `user_devices`, `vouchers`

### Code Changes (v7.21.1 → v7.22.0)
- **Live Penalty Shoot-out flow** — kick-by-kick recording for both Live Pro and Live Lite recorders
  - At full-time when scores are level, "⚽ Decide by Penalty Shoot-out" replaces the old typed-in pen score
  - Recorder picks first kicker, then taps GOAL or MISS for each kick; running pen tally + round indicator
  - Open-ended sudden-death rounds beyond 5 (slot dots get added as kicks come in)
  - Undo Last Kick (with confirmation) reverses the kick + pen score in DB and on supporters' feed
  - Cancel Shoot-out (with confirmation) wipes all kick events and returns to tied full-time state
  - Complete Match writes `home_penalty_score` / `away_penalty_score` and ends the match
  - Each kick stored as a `match_events` row (`event='Penalty Kick'`, `detail='Goal'|'Miss'`); no schema changes
- **Public live view (TeamPage live tab + PublicLiveScreen)** — supporters now see the shoot-out as it happens
  - Scoreboard shows running pen score under each team and a "⚽ PEN SHOOT-OUT" badge
  - Live commentary feed picks up each kick (green-styled GOAL / red-styled SAVED) plus the "Penalty shoot-out begins" marker
- **Game History "+ pen" dialog fixes** — full team names in the popup, error surfacing on save failure, Clear button race condition fixed

### Code Changes (v7.21.0 → v7.21.1)
- **Notify Coaches digest workflow** — new admin screen, batched per-coach digest emails of new match reports
  - "Notify Coaches" tile on admin home; coach-first grouping with per-coach select-all
  - Default-tick excludes coaches already notified for that report and pending coaches (greyed out)
  - "Reports since" date filter (filters on `match_reports.generated_at`, default 30 days)
  - Test mode toggle (staging-only, auto-hidden in prod) routes all sends to a fixed gmail and skips audit log
- **Game History REPORT badge** (admin-only) — orange badge on matches with a report; click jumps to report; `kykie-report-return` sessionStorage drives Back to admin
- **Per-report Notify button removed** from `ReportScreen` — replaced by the batched flow above
- **Report Back button** now falls back to user's role home when no return token AND no browser history (fixes Back doing nothing when opened from an email link)
- **Game History dashboard tile** counts played matches from cloud (not localStorage) — was showing 0 on fresh devices
- **Local match cache prune** — `kykie-games` only persists unsynced games; synced re-hydrate from cloud on load. Self-heals on first load after deploy. Fixes `QuotaExceededError` on accounts with many synced matches.

### Database (v7.21.0)
- `communication_log` — generic outbound comms audit table (reusable beyond reports)
- `notify_coach_digest(p_coach_id, p_report_ids[], p_override_email)` RPC — builds digest HTML, sends via Resend, logs the send. Test-mode override email skips the log.
- Dropped older `notify_coaches_of_report(UUID)` — replaced by the digest flow

### Code Changes (v7.18.20 → v7.20.0, merged build)
- Rename hockey-stats → kykie (package.json, IndexedDB, localStorage keys)
- Environment switching (supabase.js reads env vars, .env.production + .env.development)
- Per-match averages bug fix (seasonAvgForTeam skips irrelevant matches)
- Opponent full-season averages (oppSeasonAvg state)
- Role pill fix on TeamPage (sessionStorage role override)
- Event deletion in GameReviewScreen (admin, with score recalculation for goals)
- Match Reports feature (ReportScreen, route, badges, teaser/full, share, notify)
- Email notifications (send_email fn, registration trigger, coach notify RPC)
- CLAUDE.md + .gitignore

### Reports Generated
1. PG vs Oranje (18 Apr) — 1-2, corrected ball movement
2. PG vs Affies (29 Apr) — 1-1, Affies 5-4 pens
3. PG vs Affies two-match comparison (28-29 Apr) — tactical swap
4. PG vs Bloemhof (30 Apr) — 1-3
5. Kykie for Coaches PowerPoint (9 slides)
6. PG vs Oranje PDF export
7. 29 batch reports regenerated with corrected ball movement

### Infrastructure
- GitHub repo renamed to kykie
- Staging Supabase created + full schema migrated
- Local dev environment working (Node.js, npm run dev against staging)
- Gmail send/receive as info@kykie.net
- Email signature configured

### TOP 10 Benchmarks (18 Apr, 31 appearances)
DE: 15.5 | SoG: 3.4 | TW: 28.3 | PL: 34.9 | OppDE: 10.7

## Known Issues
- Score flip: Team page shows home-away order, not viewed-team-first
- Commentator timer resume: After refresh, timer starts from 0
- FK cascade: team_credits needs CASCADE fix for match deletion
