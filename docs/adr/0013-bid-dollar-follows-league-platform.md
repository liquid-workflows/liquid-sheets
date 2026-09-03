---
status: accepted
date: 2026-09-03
decision-makers: Levi Zortman
consulted: []
informed: []
related: "[ADR-0009](0009-my-dollar-and-bid-dollar-are-separate-inputs.md), [ADR-0012](0012-one-click-espn-import.md), [DATA-IN-SPEC](../../DATA-IN-SPEC.md)"
---

# Every imported market is kept; Bid$ follows the league's platform setting, with no picker

## Decision

Imported market values are stored per platform label (`doc.markets = { yahoo, espn, ... }`) instead of one overwritable `doc.market`. The market whose label matches `league.platform` drives Bid$ and the +/- deal column. There is no market picker: the league's Platform setting is the selector. If the league's platform has no import yet, the most recently imported market stands in and the masthead names it, so a second opinion never leaves Bid$ blank. The Platform setting itself (Yahoo / ESPN / Other), specified as wizard step 1 in DATA-IN-SPEC but never built, is now a control on the League step and round-trips through League settings.

## Context and Problem Statement

`doc.market` was a single object, and both writers (the values paste import and the new one-click ESPN fetch, ADR-0012) replaced it wholesale. Importing Yahoo and then fetching ESPN silently destroyed the Yahoo values; the masthead showed which one had won but there was no way back. The ESPN button made this trap easy to hit. Separately, every league carried `platform: "yahoo"` because the wizard never asked: the default in the wizard state was written straight into the league and the League settings editor did not round-trip it.

Bid$ means "what my room will pay," and a room is on one platform. So the right selector is the league's platform, not a per-import choice, and averaging platforms would blur the very thing Bid$ measures.

## Decision Drivers

* Never destroy an import the user made; a second platform's values must not overwrite the first
* Bid$ is the market of the room you draft in, which is a property of the league, so the league setting should choose it (Levi: no picker, link it to the platform)
* Keep ADR-0009 intact: this touches only the market side; My$ is untouched
* Honest feedback: an import that is stored but not active must say so, or it looks like a no-op

## Considered Options

* Keep one market, last import wins (the trap)
* A Bid$ source picker like the projections mixer (an extra control for a decision the league already implies)
* Average all imported markets (blurs "my room")
* Per-platform storage with Bid$ following `league.platform`, no picker

## Decision Outcome

Chosen option: **per-platform storage, Bid$ follows the league platform.** `activeMarket()` in `app/app.js` resolves the market each render: the platform match if present, else the most recent by `imported_at`. Both writers store under their label. A schema 4 migration in `app/storage.js` folds a legacy `doc.market` into `doc.markets` under its label so nothing already imported is lost, and runs on load and on backup import. The ESPN result modal and the paste import both say when the new values were stored but Bid$ stays on the league's platform, pointing at League settings to switch. The masthead title now names the active market ("Bid$ from espn, market scale 1.08"). While here, a bug in the ESPN auction variant was fixed: it read `scoring.ppr_by_pos` instead of `scoring.rec.ppr_by_pos`, so it always chose STANDARD values; a half-PPR league now gets PPR values.

### Consequences

* Good, because a user can hold Yahoo and ESPN values at once and switch by changing one league setting
* Good, because the selector is a setting the league already needs, not a new control to learn
* Good, because the fallback keeps Bid$ populated for a league whose platform has no import yet (an ESPN fetch in a Yahoo league still lights up +/-, labelled honestly)
* Neutral, because a "Other" platform league always uses the fallback (most recent import); acceptable, and named in the masthead
* Bad, because the schema bump means older backups migrate on import; the migration is idempotent and non-destructive

### Confirmation

Verified live: a legacy backup with a single `market` migrates to `markets.yahoo`; with the league on Yahoo, an ESPN fetch stores `markets.espn` while Bid$ keeps Yahoo's values and the modal says so; switching the league's platform to ESPN flips Bid$ to ESPN's values on the board and in the masthead; the Platform control appears in League settings with the saved value. The half-PPR mock now fetches PPR auction values. Gauntlet 20/20.

## Approval Checklist

- [x] Reviewed by: Levi Zortman (working session, 2026-09-03)
- [x] Approved by: Levi Zortman
- [x] Status updated to accepted
