# Architecture Decision Records

Decision records for Liquid Sheets (public). These record the *why* and the alternatives rejected. The first ADRs land in Phase 1 (audience and feature triage).

The private predecessor's ADRs are not copied here, but the practice is inherited from it.

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [ADR-0001](./0001-serious-hobbyist-auction-drafter-audience.md) | Build for the serious-hobbyist auction drafter, not the casual mass market | Accepted | 2026-08-18 |
| [ADR-0002](./0002-auction-only-no-snake.md) | Auction drafts only, stated proudly; snake drafts are explicitly out of scope | Accepted | 2026-08-18 |
| [ADR-0003](./0003-first-class-yahoo-and-espn.md) | Platform-agnostic core with first-class Yahoo and ESPN support | Accepted | 2026-08-18 |
| [ADR-0004](./0004-one-app-plus-post-launch-power-kit.md) | One app for everyone; the AI-savvy path ships as a post-launch power kit, not a second version | Accepted | 2026-08-18 |
| [ADR-0005](./0005-plain-structures-indexeddb-storage.md) | Store state as plain JS structures persisted to IndexedDB; no in-browser SQL | Accepted | 2026-08-18 |
| [ADR-0006](./0006-ai-copilot-self-hosted-companion-not-in-app.md) | The AI live read ships as an optional self-hosted companion server, not in the hosted app | Accepted | 2026-08-25 |
| [ADR-0007](./0007-a-league-is-a-doc.md) | Multiple leagues: a league is a document, stored under its own IndexedDB key | Accepted | 2026-08-30 |
| [ADR-0008](./0008-regularize-availability-prior.md) | Regularize the availability prior: shrink the underpowered slot gradient | Accepted | 2026-08-31 |
| [ADR-0009](./0009-my-dollar-and-bid-dollar-are-separate-inputs.md) | My$ and Bid$ are separate inputs; market values never enter the My$ blend | Accepted | 2026-08-30 |
| [ADR-0010](./0010-roster-aware-verdict-scarcity.md) | The verdict is roster-aware: position scarcity does not force LAST CHANCE for a slot you no longer need | Accepted | 2026-09-01 |
| [ADR-0011](./0011-verdict-carries-no-hardcoded-strategy.md) | The verdict carries no hardcoded strategy: K/DEF spend is set by the budget plan | Accepted | 2026-09-01 |
| [ADR-0012](./0012-one-click-espn-import.md) | One-click ESPN import in the hosted app: ESPN's public API sends CORS | Accepted | 2026-09-03 |

## Status Legend

| Status | Meaning |
|--------|---------|
| Proposed | Under review, not yet approved |
| Accepted | Approved and active |
| Rejected | Considered and declined |
| Deprecated | No longer applicable |
| Superseded | Replaced by a newer ADR |
