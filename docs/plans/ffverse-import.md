# ffverse / ffanalytics projections import

Status: **PLANNED 2026-09-01**. Design record, not yet built. Prompted by a
public request (a r/fantasyfootball commenter asked whether the tool could pull
ffverse projections "like the Sleeper button," specifically Mike Clay's ESPN
projections via ffanalytics). This plan scopes what that actually takes against
the current code.

## What was asked

"Can you tap into ffverse the way you tap into Sleeper? ffanalytics gives you
Mike Clay's ESPN projections plus a handful of others. Is there an API we can
use like Sleeper?"

## The short answer that shapes the plan

**No, ffverse has no live JSON API like Sleeper, and it does not need one here.**

- Sleeper is a live REST endpoint with permissive CORS (`access-control-allow-origin: *`),
  which is why one browser `fetch()` works (`app/sleeper.js:28`, documented in
  `DATA-IN-SPEC.md` line 14).
- ffverse projections come from **`ffanalytics`, an R package the user runs
  locally**. It scrapes ESPN (Mike Clay), CBS, FantasyPros, NFL, etc. on demand.
  There is no hosted URL a browser can call, and scraping ESPN from the browser
  would hit CORS walls and ESPN's proprietary-data terms.
- `ffscrapr` is for league-platform APIs (Sleeper/ESPN/MFL rosters), not
  projections. `nflverse-data` ships static CSV/parquet on GitHub releases
  (browser-fetchable) but not a clean projections file.

So there is nothing to "wire" like Sleeper. The correct vehicle is the tool's
existing **import** path: the user runs ffanalytics, exports a CSV, and imports
it. This keeps licensing clean (the user brings their own data; the app never
hosts or redistributes ESPN/Clay projections), which is exactly the posture in
`DATA-IN-SPEC.md` (the source/licensing matrix, lines 68-80) and the app's whole
"your data, your sources, nothing leaves the browser" identity.

## What already exists (so this is smaller than it sounds)

Generic CSV projections import (DATA-IN-SPEC Path C) is **already built**. An
ffanalytics CSV of raw stat lines can be imported today with no code change:

- UI flow: `renderImport()` (`app/app.js:649`) -> target split My$ vs Bid$
  (ADR-0009, `app/app.js:658-673`) -> paste or `.csv/.tsv/.txt` file read via
  `.text()` -> `parsePaste()` (`app/importers.js:151`) -> `detectKind()`
  (`app/importers.js:57`) -> `guessMapping()` (`app/importers.js:195`) ->
  `renderMapper()` column-confirm UI (`app/app.js:738`) -> `toEntries()`
  (`app/importers.js:233`) -> `matchEntries()` (`app/importers.js:259`) ->
  `renderUnmatched()` hand-match (`app/app.js:840`) -> `finishImport()`
  (`app/app.js:892`).
- A projections import writes `doc.sources[label] = { as_of, players:[{player_id,
  pos, team, stats}] }` and calls `makeRun()` (`app/app.js:904-911`).
- `makeRun()` (`app/app.js:596`) blends all sources via `blendProjections()`
  (`engine/engine.js:101`) and prices them via `valueBoard()`
  (`engine/engine.js:140`).

**Player matching is by normalized name+position, not by ID** (`matchEntries`,
`app/importers.js:259-277`; `norm()` at `app/importers.js:13`). The canonical
player id is `sl:<sleeperId>` (minted in `app/sleeper.js:37`). Imported rows
carry only `{name, pos, team}` and are bound to an existing `sl:` pid at import
time by name. There is no ID crosswalk anywhere in the repo today, and the spec
deliberately joins on name+pos (`DATA-IN-SPEC.md` lines 43-45).

Consequence: an ffanalytics import **adds values for the Sleeper-established
player set**; it cannot introduce players Sleeper did not load (`boardRoster()`
= pids in `doc.sources` + `doc.kdef`, `app/app.js:631-647`). That is fine for
the use case (better projections on draftable players); it is not a way to
expand the pool.

## The one real gap: points vs stat lines

A projections source must carry **stat lines** (`stats: {pass_yds, rush_yds,
receptions, ...}`); the blend averages those stats and the engine scores them
under the user's rules (`blendProjections` collects `p.stats` and averages,
`engine/engine.js:107-123`; `valueBoard` scores `p.stats`, `engine/engine.js:145`).

But ffanalytics' natural, easy export (`projections_table()`) is **pre-scored
fantasy points**, not stats. Today a points column can only enter as a
**rankings** source (order by points -> `rankImpliedStats()` synthesizes stat
lines from the current blend curve, `app/importers.js:285`), which discards
magnitude. This gap affects every points-based source (FantasyPros points
exports, etc.), not just ffverse.

Two honest paths for the user:
- **Export raw stats** from ffanalytics (`scrape_data()` yields per-source stat
  projections; the user can pull ESPN/Clay stat lines) -> works today as a
  Projections import.
- **Export points** (`projections_table()`) -> needs the new "points" kind
  below to be magnitude-preserving.

## The plan, in tiers

### Tier 0 - works today, zero code
Document (here and in a Reddit reply) that an ffanalytics **raw-stat** CSV
imports now via the Projections target. Verify with one real sample.

### Tier 1 - small: make the ffanalytics stat export auto-map
- Add ffanalytics/ffverse column-name patterns to `HEADER_HINTS`
  (`app/importers.js:179-193`). Their stat headers (`pass_yds`, `pass_tds`,
  `rush_yds`, `rec`, `rec_yds`, etc.) likely already hit most hints; fill the
  gaps against a real export.
- Optional: a named "ffverse / ffanalytics" preset on the import screen (like
  the Yahoo `parseYahooPhoto` preset, `app/importers.js:97`) that prefills the
  mapping so it is a one-drag import with no manual column confirm.
- Verify against a real ffanalytics CSV; confirm the unmatched-rows report is
  clean (name normalization between ffanalytics and Sleeper names).
- Cost: an afternoon. No engine change, so golden master is untouched.
- This is the piece that directly answers the community request.

### Tier 2 - medium: a "points" projection kind (the real unlock)
- New `KINDS.points` in `app/importers.js:31` (fields: `name, pos, team,
  points`), with `detectKind` recognizing a lone points/proj column.
- Additive engine path: let a source player optionally carry `pts` directly;
  `blendProjections` and `valueBoard` use `pts` when present instead of scoring
  `stats`. Because it is additive, existing stat-line runs stay byte-identical,
  so the golden master stays zero-diff.
- `finishImport()` grows a `kind === "points"` branch that stores
  `doc.sources[label] = { as_of, players:[{player_id, pos, team, pts}] }`.
- Makes ffanalytics' easy points table (and any points source) a first-class,
  magnitude-preserving source.
- Cost: a couple of sessions; touches the engine, so it needs a golden-master
  guard, likely a new fixture for a points source, and its own ADR.

### Tier 3 - optional, deferred: ID crosswalk as robustness
Only if name-matching proves lossy (team defenses, rookies, "Jr." variants).
nflverse publishes `load_ff_playerids` / DynastyProcess `dp_playerids` as a
static CSV/parquet with `sleeper_id` + `name` + `espn_id` + `gsis_id` columns,
CORS-open, no key. It would slot in as an alternative to `matchEntries` when the
imported CSV carries an ffverse/gsis/espn id column, mapping directly to `sl:`
pids.

Offline caveat: the service worker bypasses cross-origin fetches and never
caches them (`app/sw.js:44`), so a remotely-fetched crosswalk would not be
offline-available (violates constraint #4, offline-first). It would have to be
bundled into the shell (`SHELL` in `app/sw.js:13`) or persisted into the doc.
This is a second reason Tier 3 stays deferred; Tiers 1-2 are pure local import
with no network and no offline concern.

## Verification (any tier)
- Golden master zero-diff on stat-line runs (`verify/`), especially after the
  Tier 2 engine change.
- Acceptance gauntlet 20/20 (`verify/gauntlet/run_gauntlet.py`).
- A real ffanalytics CSV round-trip: import, confirm the source appears in the
  blend, confirm a clean unmatched-rows report, confirm My$ moves sensibly.
- `node --check` on changed JS; no dashes / non-ASCII on touched files; version
  and SW-cache bump per the hard rules.

## Open decisions
1. Build Tier 2 (the points kind), or ship Tier 1 only and tell users to export
   raw stats? Tier 2 is the general unlock but is the only part touching the
   engine.
2. Ship a named ffverse preset button, or rely on the generic mapper with better
   `HEADER_HINTS`? A preset is friendlier but is one more thing to maintain as
   ffanalytics columns drift.

## Reddit-relay summary
"Not an API like Sleeper (ffverse is an R package, no hosted endpoint), but
export your ffanalytics projections to CSV and import them. I am adding a preset
so it is a one-drag import, and looking at supporting a pre-scored points column
so the points table works directly." Honest, keeps the requester engaged, and
turns the ask into a concrete feature.
