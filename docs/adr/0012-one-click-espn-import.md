---
status: accepted
date: 2026-09-03
decision-makers: Levi Zortman
consulted: ["an ESPN-league user who reported being unable to get ESPN data in"]
informed: []
related: "[ADR-0009](0009-my-dollar-and-bid-dollar-are-separate-inputs.md), [ADR-0003](0003-first-class-yahoo-and-espn.md), [DATA-IN-SPEC](../../DATA-IN-SPEC.md), app/espn.js"
---

# One-click ESPN import in the hosted app: ESPN's public API sends CORS

## Decision

The hosted app gains an "Import ESPN values" button that fetches ESPN's public default-league player pool directly from the browser, the same way the Sleeper button does. One fetch can feed either or both targets, chosen by the user up front per ADR-0009: ESPN auction values become Bid$ (the deal column), and ESPN season projections join the My$ blend as a source named "espn". Rows match the board by normalized name + position (the app's one join rule); unmatched names are reported, never dropped. This amends the ratified DATA-IN-SPEC, which had set ESPN as paste-only in-app. The ESPN paste preset remains planned as the fallback for when the API changes.

## Context and Problem Statement

A user in an ESPN league reported being unable to get ESPN data into the tool. The cause: the app never had an ESPN paste parser (only a Yahoo pre-parser exists; "ESPN" in the import UI was a label on the generic mapper), and the predecessor's ESPN path was a server-side Python script (`levi-sheet/ingest/pull_espn.py`) hitting ESPN's read API, which a static browser app was assumed unable to replicate because of CORS. The spec therefore chose paste for ESPN and only proposed the API script for the power kit, "personal-use framed".

That assumption was wrong, and it was checked live on 2026-09-03 from the production origin: ESPN's `lm-api-reads.fantasy.espn.com` kona endpoint returns HTTP 200 JSON for the default-league player pool with no authentication, reflects the requesting origin in `access-control-allow-origin`, and answers the CORS preflight with `access-control-allow-headers: x-fantasy-filter`, the custom header the endpoint needs. It returns real auction values (PPR and STANDARD variants) and full season projection stat lines for 2026. That is the same situation that makes the Sleeper button possible.

## Decision Drivers

* The predecessor's parser is proven (`pull_espn.py`: endpoint, filter, position map, ESPN stat id map) and ports to the browser the way `sleeper.js` did
* One click gets an ESPN-league user to a Bid$ column and a second projection source; paste needs a preset that does not exist yet and a sample to build it from
* First-class ESPN support (ADR-0003) is a stated product commitment
* The licensing posture is the one already accepted for Sleeper: a public unauthenticated API with wide public-tool precedent (espn-api, ESPN_Extractor); the app never hosts or redistributes the data, the user fetches it into their own browser
* My$ and Bid$ must never mix (ADR-0009), so the user picks the target(s) before the fetch

## Considered Options

* Keep ESPN paste-only per the ratified spec and build the paste preset (needs a sample; slower for the user)
* Ship the API fetch only as a power-kit script the user runs locally (the spec's proposed path; a static app cannot depend on it)
* In-app one-click fetch, both targets user-chosen, paste as fallback

## Decision Outcome

Chosen option: **in-app one-click fetch with user-chosen targets.** `app/espn.js` mirrors `app/sleeper.js`: it hits the `leaguedefaults/3` kona endpoint with a 400-player draft-rank filter and returns `{name, pos, stats, value}` rows. `doFetchEspn()` matches them onto the Sleeper-established board with `matchEntries`, writes `doc.market` (label "espn") when values are chosen and `doc.sources.espn` plus a new run when projections are chosen, and returns counts plus every unmatched name, which the chooser modal shows before closing. The auction variant is picked from the league's reception scoring (any PPR points -> "PPR", else "STANDARD"). Values are on by default and projections are opt-in: ESPN prices its own projections, so feeding both makes Bid$ and My$ share an upstream input and softens the deal signal (a model difference rather than an information difference); the chooser says so in one line. ESPN is offered in the gear menu and as the primary card on the wizard's Market step, with the Yahoo/ESPN paste card beside it.

### Consequences

* Good, because an ESPN-league user gets Bid$ and a second projection source in one click, with no parser to maintain against page-layout drift
* Good, because it reuses the existing join rule and market/source shapes; no new player-id namespace, no engine change
* Neutral, because ESPN adds to a board that already exists; the player pool still comes from Sleeper (or an import), so the button asks for that first if the board is empty
* Neutral, because these are ESPN's default-league auction values, not a private league's custom values (those need cookies and are out of scope); the app rescales them to the league's money supply anyway, which is what "ESPN values" means to nearly everyone
* Bad, because ESPN's API is unofficial and undocumented and can change or add restrictions without notice; the spec's fallback rule applies (degrade to paste with a message), so the paste preset stays on the roadmap and needs a real ESPN paste sample to build
* Bad, because this amends a ratified spec; recorded here and in the MASTER-PLAN learnings log per the spec's own rule

### Confirmation

Verified live from the production origin and the local dev origin: CORS (including preflight for `x-fantasy-filter`), unauthenticated 2026 data, auction values (e.g. Gibbs $57, Bijan $56, Chase $56) and projection stat lines. End-to-end in the app against the real API: the fetch populates `doc.market` and `doc.sources.espn`, a new blended run is built, Bid$ and +/- light up on the board, and the unmatched names are listed. Acceptance gauntlet 20/20, including the no-cross-origin-requests-on-load check (the fetch is click-only) and the offline shell with `espn.js` precached.

## Approval Checklist

- [x] Reviewed by: Levi Zortman (working session, 2026-09-03)
- [x] Approved by: Levi Zortman
- [x] Status updated to accepted
