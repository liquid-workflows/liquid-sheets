# Liquid Sheets Public - Master Plan

Status: ACTIVE. Phases 0 through 3 COMPLETE (2026-08-18). Phase 4 feature-parity pass with the V56 predecessor landed 2026-08-25 (app at V15): plan/envelope layer, TEAMS grid, flow strip, flagged players, collapsible columns, run selector, named bets, dark theme, under-the-hood explainer, and the self-hosted AI companion. Public repo: https://github.com/liquid-workflows/liquid-sheets (transferred from the personal LeviZ account to the liquid-workflows org 2026-08-29). Scope in PRODUCT-SCOPE.md; data-in in DATA-IN-SPEC.md; upstream workflow in docs/UPSTREAM.md; engine ported and golden-master verified (engine/, verify/). Next: Phase 4B (Liquid Workflows brand pass) and the M5 acceptance gauntlet, then a post-Sept harvest sweep of any V57+ predecessor additions.
Created: 2026-08-17. This is the high-level roadmap only. Each phase gets its own dedicated execution plan written at the moment we enter that phase, never earlier, because each phase produces learnings that reshape the next one.

## What we are building

A public, static, browser-only version of Liquid Sheets: the auction draft tool built in `claude-projects/fantasy-football/levi-sheet/`. All computation runs client-side. Users bring their own data. No backend, no accounts, no server-held projections. Hosted as a static site (working assumption: Cloudflare Pages), installable as a PWA so it survives dead draft-room wifi.

The personal tool in `levi-sheet/` is NOT modified by this workstream. It remains Levi's draft-day tool for 2026 and the reference implementation this product is derived from.

## Non-negotiable constraints (carry into every phase)

1. **No data redistribution.** We never ship, host, or proxy projections, rankings, or market values. Users paste or upload their own. This is the constraint that killed the tools before us; it is architectural, not legal fine print.
2. **Client-side everything.** No server component in v1. If a feature requires a backend, it is cut or deferred, not accommodated.
3. **Parsimony doctrine survives.** The public tool inherits the levi-sheet philosophy: every number traces to an inspectable calculation, adjustments are off-by-default toggles, evidence beside numbers never inside them. See `claude-projects/fantasy-football/levi-sheet/DATA-MODEL.md` rules R1-R4.
4. **Offline-first is the differentiator.** "Works when the ballroom wifi dies" is the identity, not a nice-to-have.
5. **AI text never enters value math.** Same rule as the personal tool.

## The calendar reality

> Update (2026-08-30): the public launch was pulled forward and the app is LIVE now at https://liquid-sheets.pages.dev/. The 2026-vs-2027 reasoning below is the original plan, kept for the record and superseded by the live launch.

Fantasy draft season runs late August to early September. Today is 2026-08-17. There is no responsible path to a public launch for the 2026 season.

- **Target: public beta by July 2027, launch for the 2027 draft season.**
- Levi's own 2026 draft (early Sept, using the personal tool) becomes the final dogfood of the underlying model before the public work begins in earnest.
- The long runway is an asset: the offseason is when the design decisions (Phase 1) can be made without deadline pressure, and spring mock-draft season provides real test users before the stakes are real.

## Phases

Each phase ends with two things: its named deliverables, and a short LEARNINGS section appended to this file. The next phase's execution plan is written only after those learnings land.

### Phase 0: Charter and repo setup (small)

Goal: make the workstream real and scoped before any design happens.

- Decide the working name and check availability (is "Liquid Sheets" free as a domain / not trademarked / not already a product?).
- Decide open-source posture and license (the public app repo: MIT? source-available? closed but free?).
- Decide which GitHub account hosts it (personal, per the account rules) and create the repo skeleton.
- Write down the success definition: what does "this was worth doing" look like in Sept 2027? (e.g., N real drafts run on it, not revenue.)

Exit gate: name chosen, repo exists, success definition written.

### Phase 1: Audience and feature triage (THE BIG LIFT)

Goal: decide exactly who this is for, and let that decision execute the feature list. This is the phase Levi already identified as the heavy one, and everything downstream depends on it.

Key questions to settle, in rough order:

- **Who is the target user?** Candidate framings to choose between: (a) auction drafters only, any platform; (b) the ex-BeerSheets crowd who want a sheet-like board with modern values; (c) power users willing to paste their own projections vs. casuals who won't. Each framing kills different features.
- **Auction only, or snake too?** The personal tool is auction-native (Tremblay dollars, envelopes, ledger). Snake support is a large surface expansion. Strong prior: auction-only for v1, but decide it explicitly.
- **Which platforms' leagues do we support?** Yahoo-specific features (the deal column needs pasted Yahoo values, Yahoo position colors, the paste parsers) vs. platform-agnostic design.
- **Feature-by-feature triage** of the full levi-sheet inventory into four buckets: SURVIVES AS-IS / SURVIVES GENERALIZED / CUT FOR V1 / DEFERRED. The inventory to triage includes at minimum: the board and TEAMS tabs, The Call verdicts, plan envelopes and stars-and-scrubs logic, my_calls named bets, the deal column, availability prior, flagged players, mock simulator, themes, the AI co-pilot (likely BYO-API-key or cut; decided here, built later if it survives).
- **What does the setup experience demand?** The personal tool has league_2026.json hand-written; the public tool needs a league setup wizard. Its scope (scoring rules supported, roster shapes supported) is set by the audience decision.

Deliverables: a PRODUCT-SCOPE.md in the public repo; a feature decision table with a one-line rationale per cut; ADRs for the irreversible calls (audience, auction-only, platform posture), following the same ADR practice as `claude-projects/fantasy-football/levi-sheet/docs/adr/`.

Exit gate: every feature in the inventory has a bucket and a rationale. No "we'll see" entries.

### Phase 2: Data-in design

Goal: design how a stranger's league data gets into the app, which is the make-or-break usability problem and the place licensing gets concrete.

- Which sources can users realistically bring, and in what form (CSV export, copy-paste, manual entry)? The levi-sheet paste parsers are the seed material.
- What can legitimately be fetched client-side from the user's own browser (e.g., Sleeper's public API, CORS permitting) vs. what must be pasted?
- Graceful degradation: what does the tool look like with ONE projection source and no market values? It must still be useful at the floor.
- League settings wizard design, scoped by Phase 1's audience decision.

Deliverables: data-in spec, supported-sources matrix with licensing posture per source, wizard flow design.

Exit gate: a named person outside the project could, on paper, get their league from zero to a populated board following the spec.

### Phase 3: Engine port and verification

Goal: port the valuation engine (`claude-projects/fantasy-football/levi-sheet/engine/valuation.py`) to client-side JavaScript with proof it produces identical numbers.

- Golden-master test harness: run the Python engine and the JS port on identical inputs, diff to the dollar. The port is not done until the diff is zero.
- Storage decision: IndexedDB vs. sql.js vs. plain JS structures with localStorage persistence. The runs-are-immutable model (R1) must survive the translation.
- Scope only what Phase 1 kept. Cut features do not get ported.

Deliverables: JS engine module, golden-master suite passing, storage layer.

Exit gate: byte-level agreement with the Python engine on the 2026 dataset.

### Phase 4: Draft room generalization

Goal: adapt the UI (`claude-projects/fantasy-football/levi-sheet/draftroom/app.html`) from Levi's league to any league that Phase 1 scoped in.

- De-Levi-fication: owner names, league constants, envelope defaults, hardcoded 12-team/$200 assumptions all become configuration.
- PWA packaging: service worker, install prompt, full offline verification (airplane-mode test is the acceptance test).
- Iteration loop with screenshots, same as the original build process.

Deliverables: the working app, offline-verified, driven entirely by wizard-produced config.

Exit gate: two fictional leagues with different sizes, budgets, and scoring run correct side-by-side drafts.

### Phase 4B: Liquid Workflows brand pass (added 2026-08-19)

Goal: the public app adopts the Liquid Workflows brand identity, distinct from the personal tool's paper-ledger look. Inputs: the brand kit at `claude-projects/liquid-workflows/projects/personal-brand/assets/color-type/` (tokens.css, brand-theme-kit.html, tailwind.config.js, logos/icons). Runs AFTER Phase 4's token-architecture port so the brand maps onto tokens rather than hardcoded colors. Execution plan written when entered. Scope sketch and sequencing rationale: [phase-plans/UI-CARRYOVER.md](phase-plans/UI-CARRYOVER.md).

Exit gate: the app, landing surface, and favicon read as one Liquid Workflows product in every theme.

### Phase 5: Packaging and launch surface

Goal: everything around the app.

- Hosting setup (Cloudflare Pages or equivalent), custom domain.
- Landing page, in-app onboarding, and docs (the "under the hood" explainer tradition carries forward; epistemic honesty about what the numbers are is part of the brand).
- Privacy-respecting usage measurement decision (or none at all).
- Feedback channel (GitHub issues if open-source).

Exit gate: a stranger can find it, understand it, and start a draft without talking to us.

### Phase 6: Beta and 2027 launch

Goal: real users, real mock drafts, then the real season.

- Recruit beta users during 2027 mock-draft season (spring/summer).
- Structured feedback capture; fix cycle.
- Launch decision gate before the 2027 draft window opens.

Exit gate: the 2027 season happens on it.

## Standing risks (revisit at every phase boundary)

- **Data licensing drift**: a source we design around changes its terms or export format. Mitigation: the Phase 2 floor requirement (useful with one generic source).
- **Scope creep vs. parsimony**: the public audience will ask for everything BeerSheets ever had. The Phase 1 decision table is the shield; additions require the same toggle-with-a-test discipline as the personal tool.
- **Single maintainer**: this is a nights-and-weekends product. Phase gates exist so the project can pause cleanly at any boundary without leaving a half-built phase.
- **Name risk**: unresolved until Phase 0 completes.

## Learnings log

Appended at each phase exit.

### Phase 0 (closed 2026-08-18)

- Name is clean: no software product or fantasy tool called "Liquid Sheets" exists (web-checked; no formal trademark search, residual risk accepted for a free tool). Nearest neighbor in the space is Grateful Sheets, an Excel tool, which is useful competitive awareness for Phase 1.
- Levi decided: never monetize, portfolio piece first. This resolved license (MIT), hosting identity (subdomain of his Liquid Workflows domain, not liquidsheets.com, which was available but deliberately not purchased), and open-source posture (public from day one, planning docs included) all in one stroke. Lesson for later phases: the portfolio framing is a decision-making shortcut; when torn, choose the option that shows the work.
- The repo is `liquid-sheets-public/` itself, git-initialized locally. GitHub push deferred pending Levi's account confirmation (his own global rule about GitHub accounts, plus a new public repo is outward-facing).
- Implication for Phase 1: with no revenue pressure, the audience decision can optimize purely for "who will genuinely use and appreciate this," not market size. That likely tilts toward the serious-hobbyist auction drafter rather than the broadest casual audience, but that is Phase 1's call to make, not Phase 0's.

### Phase 1 (closed 2026-08-18)

- The three framing calls came fast and confident (serious hobbyists, auction-only stated proudly, Yahoo+ESPN first-class): ADRs 0001-0003. The predicted tilt from Phase 0 held exactly.
- Full triage ratified in PRODUCT-SCOPE.md on the first review pass with only two amendments, both in the direction of a LEANER v1: my_calls went from generalized to deferred, and the co-pilot question resolved into "one app plus a post-launch power kit" (ADR-0004) rather than a second app version. Lesson: when Levi amends, he cuts; propose lean and let him add.
- The power kit pattern is the durable invention of this phase: the app never ships AI content or scrapers, but the repo can publish the prompts and personal-use scripts as a post-launch encore, with an import hook in v1 so kit output flows in. It converts a liability (shipped AI takes) into portfolio material (published prompts).
- Handed to Phase 2: the per-source licensing review now covers three things: data-in paths for the app, the shipped availability-prior aggregate, and which power-kit scripts (public-API pulls vs. scrapers) may be published. Also inherited: the wizard scope list at the bottom of PRODUCT-SCOPE.md, the one-source floor requirement, and the opinions/tags import format as a real deliverable, not an afterthought.

### Phase 2 (closed 2026-08-18)

- The phase's biggest fact came from a two-second curl, not from reasoning: Sleeper's API sends `access-control-allow-origin: *`, so the browser fetches directly and the product floor upgraded from "paste a CSV" to "one click." Lesson: empirically test the cheap-to-test assumptions before designing around their absence.
- The column mapper became the load-bearing design decision: one universal import preview with platform presets in front. It converts annual format drift (a certainty) from "app broken in August" to "user confirms two dropdowns." For a static app with no hotfix channel, this is survival, not polish.
- The licensing question largely dissolved once stated correctly: a static app means data never transits us, so paste paths are personal use by construction. Remaining calls were made cleanly: ESPN kona script publishes in the kit (public precedent), CBS scraper does not, availability prior ships as an attributed aggregate of openly licensed data.
- Ratification pattern held from Phase 1: all four proposals confirmed without amendment. Propose-lean continues to work.
- Handed to Phase 3: the engine port scope now explicitly includes the rank-implied converter and the availability prior as a shipped artifact; the wizard's step-7 config JSON is the engine's input shape; the golden-master harness compares against the private tool's runs 14-20 dataset.

### Phase 3 (closed 2026-08-18)

- The port passed the golden master at zero diff on all six recorded 2026 runs on the first substantive iteration; the engine really was ~150 lines of portable math. The phase's entire difficulty concentrated in rounding semantics: Python rounds the exact binary value with ties-to-even, JS does neither by default, and real data produced actual exact .25 ties that a "vanishingly unlikely" assumption had waved off. Lesson: the golden master is the argument-settler; write the harness before the port, and never accept a probabilistic claim about numerics when an exhaustive check is this cheap.
- Fixtures embed licensed data, so the harness is public but its inputs are generated locally and gitignored. This split (public method, private data) is the same pattern as the whole product and will recur in the power kit.
- Storage decided (ADR-0005): plain structures over IndexedDB with a one-file JSON export/import as the recovery ritual; sql.js and localStorage rejected. Doctrine survives structurally (append-only runs and journal), not by database enforcement.
- Handed to Phase 4: the engine module's exact API (blendProjections, valueBoard, config shape) is now fixed and verified; the UI build consumes it as-is. Phase 4 also owns the ADR-0005 acceptance tests (tab-kill reopen; delete-data then import-file) and the airplane-mode PWA test.

### Phase 4 parity pass (2026-08-25)

- The predecessor had run away from the port: it went from V36 (audited in UI-CARRYOVER.md) to V56 and grew a Python server. Levi asked to "incorporate everything" from it into the public app in one continuous build. This pass closed the gap; details and disposition in [phase-plans/UI-CARRYOVER.md](phase-plans/UI-CARRYOVER.md).
- The AI question resolved in the opposite direction from where it was headed: Levi ruled out an in-app BYO-key path ("if we require users to bring an API key, I would rather get rid of the feature entirely"). The hosted app now ships zero AI; the copilot is an optional self-hosted companion server ([ADR-0006](docs/adr/0006-ai-copilot-self-hosted-companion-not-in-app.md)). This strengthens rather than bends the "nothing leaves your browser" identity. Lesson: the offline/privacy identity is load-bearing enough that Levi will drop a differentiating feature to protect it.
- Doctrine held cleanly: the app ships mechanisms and generic editable templates (plan envelopes derived from the run's own chalk values, an empty named-bets panel, an empty tags sink), never Levi's personal envelopes/calls/opinions. The named-bets nudge lives in a client-side revaluation that leaves engine.js byte-identical, so the golden master stayed zero-diff (fixtures 24-29) through the whole pass.
- Deliberately left for later, so nothing crept: Phase 4B brand pass (a different project's identity; tokens landed here so it can map on), the pre-draft knapsack optimizer (plan_optimizer.py), and the SQLite calibration tooling (stays in the personal tool).
- Still open before "done": the M5 acceptance gauntlet (airplane-mode, tab-kill, delete+import, two differently-shaped leagues) needs a human at a browser; a basic offline service worker shipped this pass. A post-Sept harvest sweep will pick up any V57+ predecessor additions once it freezes.

### v1.0 scope freeze + theme freeze + gauntlet (2026-08-27)

- Started a miniature SDLC discipline for the public app: instead of jumping from prototype to deploy, added a release-scope freeze and an executed acceptance gauntlet as the two steps between "prototype that works" and "thing strangers can trust." New doc `V1-SCOPE-FREEZE.md` draws the v1.0 line (in / deferred / cut) and makes the gauntlet's pass/fail criteria concrete. It is a release-scope doc, distinct from the feature-triage `PRODUCT-SCOPE.md`.
- **Theme freeze:** Levi ruled the V33 state (commit `1669bc2`, printed-sheet light + neutral-slate dark) the final theme set for v1.0. Amended the PRODUCT-SCOPE themes row from "light/focus/dark/inverted AS-IS" to "light + dark, frozen at `1669bc2`" (focus/inverted were retired upstream at V55). This is the required MASTER-PLAN note for that ratified-doc amendment.
- **Gauntlet executed for real, not just static-checked:** a Python Playwright + headless Chromium (chromium-1223) was available locally, so the offline, persistence, and recovery tests ran against the live dev server driving the app's own ES modules (`storage.js`, `engine.js`) rather than mocks. Results and the reproducible harness are in `GAUNTLET-v1.md`. The one test that still wants a human is "two differently-shaped leagues built end-to-end through the wizard UI" (engine correctness across shapes is already golden-master-covered; the UI wizard flow is the unautomated remainder).

### Live deployment (2026-08-29)

- **The app is live** at https://liquid-sheets.pages.dev/app/ (Cloudflare Pages, git-connected to `main`, auto-deploy on push, no build step). The bare `*.pages.dev` root 302-redirects into `/app/` via the `_redirects` file. Custom Liquid Workflows subdomain still to be wired in the CF Pages project.
- **Repo moved to the org:** transferred from the personal `LeviZ` account to `github.com/liquid-workflows/liquid-sheets` before connecting Cloudflare. Push auth from Levi's machine needs the `LeviZ` token because the default git identity is the WCK account; this and the whole ops flow are now written down in `RUNBOOK.md`.
- **CI is guarding `main`** (`.github/workflows/ci.yml`): static checks + the browser gauntlet on every push and PR; first run green. Golden master stays a local gate (gitignored fixtures).
- **Production smoke test passed:** the gauntlet harness (now `GAUNTLET_BASE`-parameterizable) ran against the live Cloudflare URL, 15/15 - AI-absent, offline over HTTPS from the edge, tab-kill persistence, and delete+import recovery all confirmed on the real deployment, not just localhost.
- **Still open:** the human wizard pass (two league shapes) is now done on the live site rather than locally, per Levi's "get it live and test there" call; and the CF custom-domain wiring.

### Session handoff (2026-09-01)

**State: LAUNCHED and live.** V53, public at https://sheets.liquidworkflows.com/ (and the backup https://liquid-sheets.pages.dev/), git-connected to Cloudflare Pages so a push to `main` auto-deploys. Repo: github.com/liquid-workflows/liquid-sheets (org owned by Levi). Everything is committed and pushed (local == origin).

**Where a new session should start:** `RUNBOOK.md` is the operational bible (local dev `./dev.sh` on 8013, the hard rules, verification gates, deploy, rollback, the two-account push gotcha). Decisions: `docs/adr/` (0001-0009). History + learnings: this file above. Scope: `V1-SCOPE-FREEZE.md` / `PRODUCT-SCOPE.md`. Multi-league design: `docs/plans/MULTI-LEAGUE-PLAN.md`. Prior method: `verify/prior/README.md`.

**Critical operational facts:**
- Push: the machine's default git identity is the WCK account and 403s on this org repo. Push as Levi's personal token: `git push "https://LeviZ:$(gh auth token --user LeviZ)@github.com/liquid-workflows/liquid-sheets.git" main`.
- Version discipline: any change to a shell file (`app/*`, `engine/*`) bumps BOTH the masthead (`app/index.html` `<span class="ver">`) AND the SW cache (`app/sw.js` `CACHE`). Currently V53 / liquid-sheets-v53.
- Verify before push: `node --check` all JS; no em/en dashes or non-ASCII (`grep -rlP '[\x{2014}\x{2013}]|[^\x00-\x7F]'`); golden master (`node verify/run_golden.mjs verify/fixtures_29`, local only, fixtures gitignored); gauntlet (`/Library/Developer/CommandLineTools/usr/bin/python3 verify/gauntlet/run_gauntlet.py` with dev.sh up, or `GAUNTLET_BASE=https://sheets.liquidworkflows.com/app/` for prod). Gauntlet is 20/20.
- Two Python interpreters on this machine: `/usr/bin/python3` has pandas/numpy (the `verify/prior/` scripts); `/Library/Developer/CommandLineTools/usr/bin/python3` owns Playwright/Chromium (the gauntlet and all headless browser work and screenshots). No matplotlib; charts are Chromium screenshots of inline SVG/HTML.

**What this session shipped (V33 -> V53):** scope/theme freeze + acceptance gauntlet; deploy to Cloudflare Pages + custom domain; repo transfer to the org; removed the landing page (bare domain -> /app/); multi-league ("a league is a doc", ADR-0007); wizard rework (6 steps, stepper, fixed card size, drag-and-touch team reorder with a chosen "me", a League-settings editor); My$/Bid$ separation (ADR-0009); Save-to-file + storage-visibility + private-window notice; "Under the hood" rewrite (How To / What is My$?); brand mark and favicon; availability fade toggle then regularization (ADR-0008); CI (static checks + gauntlet); ADRs 0007-0009 and the reproducible prior method in `verify/prior/`.

**The availability-stats context (behind the Reddit drafts):** the RB/WR games-missed analysis drew public pushback. Honest finding: the position-level effect (RBs miss more than WRs) is robust and replicated; the slot gradient is underpowered (RB1-3 vs RB5-10 is ~2 games but p~0.13). Response: regularized the shipped prior (ADR-0008, shrink the gradient 50%) and built a season-resample bootstrap (`verify/prior/bootstrap_availability.py`). Reddit artifacts: `docs/launch/reddit-post-draft.md` (tool post), `docs/launch/reddit-data-post-draft.md` (data post), and `../levi-sheet/research/reddit-data-addon.md` (the "underpowered, here is the bootstrap" edit). None posted.

**Open / offered but not built:**
- Reddit posts drafted, NOT posted. Levi decides where/when (plan: r/fantasyfootball data post first; check sub self-promo rules).
- Deferred nice-to-haves: apple-touch-icon (iOS home-screen); a "deals" board screenshot using Levi's real Yahoo/ESPN values.
- Offered follow-ups: a commit-safe mock backup with Sleeper sources stripped; a mock regenerated with market values so the Bid$/+/- columns populate; a lagged prior-season-workload injury analysis (a commenter's ask).
- `mock-draft-1-3.json` sits in the repo root but is GITIGNORED (embeds Sleeper projections, must not be committed per constraint #1). It is a ~1/3-through 12-team auction backup Levi imports to explore a mid-draft board.

**Do not modify:** `../levi-sheet/` is the private predecessor and Levi's personal tool, and the home of the raw availability data. The public repo is self-contained; raw licensed data stays gitignored (golden master and `verify/prior/` follow "public method, private data").

### ESPN one-click import (2026-09-03)

An ESPN-league user could not get ESPN data in. Two findings. First, the ESPN
paste parser was never built: only a Yahoo pre-parser exists, and "ESPN" in
the import UI was a label on the generic mapper. Second, the assumption behind
the spec's paste-only ESPN posture was wrong: ESPN's `lm-api-reads` kona
endpoint serves the default-league pool unauthenticated, reflects any origin
in `access-control-allow-origin`, and passes the CORS preflight for the
`x-fantasy-filter` header. So ESPN can be a one-click fetch like Sleeper.
Built as `app/espn.js` (ports `levi-sheet/ingest/pull_espn.py`), a chooser
that honors ADR-0009 (values -> Bid$, projections -> My$ source "espn"), name
matching onto the Sleeper-established board with unmatched names reported.
Amends DATA-IN-SPEC (recorded there and in ADR-0012). Lesson: verify CORS with
a real preflight before ruling an API out; the paste preset stays on the
roadmap as the fallback and needs a real ESPN paste sample to build.

### Markets per platform; Bid$ follows the league platform (2026-09-03)

The ESPN button exposed a trap: `doc.market` was one object and every values
import overwrote it, so Yahoo then ESPN silently lost Yahoo. Fixed by keeping
every market under its label (`doc.markets`, schema 4 with a migration) and
letting the league's Platform setting choose which one drives Bid$ (Levi: no
picker, link it to the platform). Two things surfaced while doing it: the
Platform setting from the spec's wizard step 1 had never been built (every
league was silently "yahoo"), and the ESPN auction-variant check read the
wrong scoring path and always chose STANDARD. Both fixed. ADR-0013.

### League settings save no longer resets the budget plan (2026-09-03)

Found while answering "can an existing league just switch its Platform to
ESPN, or must it be recreated?" (it can just switch). finishWizard rebuilt
doc.league as a fresh object with no plan field, so every League-settings
save (a rename, a team reorder, a platform change) dropped the budget plan
and the auto-seed silently reset it to the default, wiping envelope edits
and saved variants. Pre-existing since the editor was built. Fix: when
editing, the existing plan is carried forward as long as the roster shape is
unchanged (envelopes are roster-shaped; a changed roster re-seeds from the
run). Verified through the real UI path: platform switched to ESPN, plan
edit kept, journal and markets intact. V62.
