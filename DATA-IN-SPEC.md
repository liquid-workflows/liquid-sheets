# Data-In Specification

Status: **RATIFIED** (2026-08-18, by Levi; all four decision points confirmed as proposed). Changes now require a note in the MASTER-PLAN.md learnings log.
Parent: [MASTER-PLAN.md](MASTER-PLAN.md) Phase 2. Scope authority: [PRODUCT-SCOPE.md](PRODUCT-SCOPE.md).

## The premise that makes everything legal

The app is static. Every byte of league data lives and dies in the user's browser (their storage, their paste buffer, their fetches). We distribute *parsers and math*, never data. Even first-class platform support means "we understand the format of what you copied," not "we have the data." This single fact is why the paste paths below are clean personal use rather than redistribution.

## Ingestion paths (priority order)

### Path A: One-click Sleeper fetch (the floor)

**Verified 2026-08-18**: Sleeper's public API sends `access-control-allow-origin: *` on both the season projections endpoint (`api.sleeper.com/projections/nfl/{season}?season_type=regular&position[]=...`) and the players endpoint (`api.sleeper.app/v1/players/nfl`). The browser can fetch directly. No backend, no key, no paste.

One click yields: raw stat-line projections for QB/RB/WR/TE (the engine scores them under the user's rules), half-PPR ADP, injury status, rookie flags. The proven stat mapping lives in the predecessor (`levi-sheet/ingest/pull_sleeper_projections.py`) and ports as-is. Responses are cached in browser storage with an as-of date; a visible "fetched 3 days ago, refresh?" nudge replaces any automatic polling. If Sleeper ever drops the CORS header, this path degrades to Path C with a message, not a broken app.

### Path B: Platform values paste (Yahoo, ESPN)

The user copies their platform's player list (which shows auction values) and pastes into the app. This feeds the deal column and the opponent-anchor logic.

* **Yahoo**: the predecessor's parser (`levi-sheet/ingest/load_manual.py`) already survives Yahoo's two paste layouts by anchoring on the `%Drafted` field in 7-line records. That anchor strategy ports as a preset.
* **ESPN**: AMENDED 2026-09-03 by [ADR-0012](docs/adr/0012-one-click-espn-import.md). ESPN's public read API turned out to send CORS headers (preflight included), so the app now has a one-click "Import ESPN values" fetch, the same posture as Path A, feeding Bid$ and/or a My$ source at the user's choice. Paste remains the fallback for when that unofficial API changes; the ESPN paste preset is still to be built from a real 2026 page sample.

### Path C: Generic CSV import (the universal door)

Any projections or values source the user can export or assemble: FantasyPros CSV exports (formats known from the predecessor), CBS, RotoWire, a homemade sheet. Column mapper handles the rest (see below).

### Path D: Rankings-only import

A pasted or uploaded ordered list (rank, name, position) with no stat lines. The engine converts ranks to rank-implied stat lines via the blend curve, the predecessor's proven technique for the Chris Dell source. This lets a user fold in any analyst's Top-200 without projections.

### Path E: Opinions/tags import (the power-kit hook)

JSON (canonical) or CSV: `{name, pos, tags[], note, opinion}` per player. Tags surface in Flagged Players and player popups. This is the socket the post-launch power kit plugs into ([ADR-0004](docs/adr/0004-one-app-plus-post-launch-power-kit.md)); it is equally usable by hand.

## The column mapper (how we survive format drift)

Every import (paste or file, Paths B through E) lands in the same preview screen: the app shows the parsed columns against the first few rows, guesses the mapping (name, position, team, the stat columns, dollar value, rank), and asks the user to confirm or fix. Platform presets (Yahoo, ESPN, FantasyPros) are just prefilled mappings with format-specific pre-parsers in front.

The point: when a platform silently changes its layout (they all do, annually), the failure mode is "confirm two dropdowns," never "the tool is broken until a code fix ships." For a static app with no telemetry and no hotfix channel to a user mid-August, this is the difference between surviving September and not.

## Name matching across sources

All joins use normalized `(name, position)`: lowercase, suffixes stripped (Jr/Sr/II/III/IV/V), punctuation removed (the predecessor's `norm()`). After any import, an unmatched-rows report is shown explicitly with one-tap "match by hand" resolution. Silent drops are forbidden; the predecessor's 40-duplicate incident is the cautionary tale.

## The one-source floor

With only Path A completed (one click), the user has a fully working board: projections scored under their rules, VBD baselines, Tremblay dollars, tiers, The Call, ledger, inflation. What is absent degrades visibly and honestly:

* No platform values pasted: the deal column is hidden entirely (not shown as zeros), and opponent-anchor language does not appear.
* One source only: no source-spread indicator; the under-the-hood explainer states the board is single-source and what adding sources would change.

Floor rule: absence of optional data removes features cleanly; it never shows degraded numbers.

## Setup wizard flow

1. **Platform**: Yahoo / ESPN / other (drives paste presets and position colors).
2. **League shape**: team count, budget.
3. **Roster**: starter slots per position, flex definitions, bench size.
4. **Scoring**: presets (standard, half PPR, full PPR) then an "adjust" panel exposing exactly the knobs the engine's scorer uses (per-yard points, TDs, INTs, receptions, two-point).
5. **Teams**: team/owner names (prefilled Team 1..N, editable later).
6. **Data**: guided: "Fetch projections (one click)" then optional "Paste your platform's values" with live preview.
7. **Board.** Config is saved as one JSON object (exportable/importable, the same mechanism as draft-state backup).

Everything else the engine needs has a sensible default and lives behind "advanced," per the wizard-scope rule in [PRODUCT-SCOPE.md](PRODUCT-SCOPE.md).

## Source and licensing matrix

| Source | App data-in | Shipped with app | Power-kit script |
|---|---|---|---|
| Sleeper | One-click fetch (public unauthenticated API, permissive CORS, wide public-tool precedent) | Nothing | Yes: the fetch script |
| nflverse | Not direct | Availability-prior aggregate (openly licensed data; ship with attribution) | Yes: prior-builder script |
| FFC ADP | Not direct | Inside the availability-prior aggregate (documented public API) | Yes: prior-builder script |
| Yahoo | User pastes their own pages (personal use, client-side only) | Nothing | None needed: paste is the path |
| ESPN | One-click fetch of the public default-league pool (unauthenticated API, permissive CORS, same precedent as Sleeper: espn-api, ESPN_Extractor); paste is the fallback. Amended by ADR-0012. | Nothing | Superseded by the in-app fetch |
| FantasyPros | User's own CSV export via Path C | Nothing; no FP-derived samples ship | None: manual export is the path |
| CBS | Generic CSV via Path C | Nothing | PROPOSED no: pure page-scraper, low value over Path C |

Availability prior detail: the shipped artifact is slot-level aggregates (expected missed games per draft-slot position), a derived statistical summary of openly licensed nflverse data crossed with FFC ADP. No player projection or ranking from any restricted source is embedded. Posture: green with attribution in the under-the-hood explainer.

## Walkthrough: zero to board (exit-gate test)

Jordan is in a 10-team, $300 ESPN auction league, half PPR, and has never heard of us.

1. Opens the site. Reads "auction drafts only" and feels seen. Clicks Start.
2. Wizard: ESPN; 10 teams, $300; default roster edited to 2 RB / 3 WR; half-PPR preset; types in the 10 team names.
3. Data step: clicks "Fetch projections." Two seconds later: 150+ players, as-of today.
4. Optional step: opens their ESPN league's projections page in another tab, selects the table, copies, pastes. The mapper shows its guess (name, pos, auction value); Jordan confirms. Deal column comes alive. Three names show in the unmatched report; Jordan hand-matches two, ignores a kicker.
5. Board. The Call works. Prints the backup sheet. Closes the laptop; reopens at the draft venue with no wifi: everything is there.

Every step above is covered by a section of this spec; nothing relies on unbuilt magic beyond the app itself.

## Decision points (all ratified by Levi, 2026-08-18)

1. **ESPN kona script in the power kit**: YES, on public precedent, personal-use framing.
2. **CBS scraper in the power kit**: NO. Path C covers CBS users.
3. **Column-mapper-first philosophy**: YES. Presets are conveniences in front of one universal mapper.
4. **Deal column hidden (not zeroed) without pasted values**: YES. Honest-absence behavior confirmed.
