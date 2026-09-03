/* One-click ESPN fetch (ADR-0012). ESPN's fantasy read API serves the
 * default-league player pool publicly and unauthenticated, and it sends CORS
 * headers for any origin, including allowing the x-fantasy-filter header
 * (verified 2026-09-03, preflight included). One call yields both things
 * ESPN is good for: auction values (Bid$, the deal column) and season
 * projections (a My$ source). The stat mapping ports the predecessor's
 * proven pull_espn.py. The API is unofficial: if ESPN ever drops CORS the
 * caller degrades to paste (DATA-IN-SPEC), never a broken app. Rows carry no
 * pid; they match the board by normalized name + position, the app's one
 * join rule, and unmatched names are reported, never dropped. */

const POS_BY_ID = { 1: "QB", 2: "RB", 3: "WR", 4: "TE" };

/* ESPN stat ids -> the engine's stat names (ported from pull_espn.py) */
const STAT_MAP = {
  3: "pass_yds", 4: "pass_tds", 20: "ints",
  24: "rush_yds", 25: "rush_tds",
  53: "receptions", 42: "rec_yds", 43: "rec_tds", 72: "fumbles_lost",
};
const TWO_PT_IDS = [19, 26, 44];   /* pass, rush, rec two-point conversions */

export function espnUrl(season) {
  return "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/"
    + `${season}/segments/0/leaguedefaults/3?view=kona_player_info`;
}

/* variant is one of ESPN's auction rank types, "PPR" or "STANDARD". Returns
 * {as_of, variant, entries:[{name, pos, team, stats, value}]}. stats is null
 * when ESPN has no season projection for the player; value is null when it
 * has no auction value. Throws on network failure; the caller owns the
 * offline and degrade-to-paste messaging. */
export async function fetchEspn(season, variant = "PPR", limit = 400) {
  const filter = { players: { limit, sortDraftRanks:
    { sortPriority: 100, sortAsc: true, value: variant } } };
  const resp = await fetch(espnUrl(season), {
    headers: { "x-fantasy-filter": JSON.stringify(filter) },
  });
  if (!resp.ok) throw new Error(`ESPN responded ${resp.status}`);
  const data = await resp.json();
  const entries = [];
  for (const pl of data.players ?? []) {
    const p = pl.player ?? {};
    const pos = POS_BY_ID[p.defaultPositionId];
    if (!pos || !p.fullName) continue;
    const proj = (p.stats ?? []).find((s) => s.seasonId === season
      && s.statSourceId === 1 && s.scoringPeriodId === 0);
    const raw = (proj && proj.stats) || {};
    const stats = {};
    for (const [theirs, ours] of Object.entries(STAT_MAP)) {
      if (raw[theirs] != null) stats[ours] = raw[theirs];
    }
    const hasProj = Object.keys(stats).length > 0;
    if (hasProj) {
      stats.two_pt = TWO_PT_IDS.reduce((a, id) => a + (raw[id] ?? 0), 0);
    }
    const ranks = p.draftRanksByRankType ?? {};
    const value = (ranks[variant] ?? ranks.PPR ?? {}).auctionValue;
    entries.push({ name: p.fullName, pos, team: null,
      stats: hasProj ? stats : null,
      value: typeof value === "number" ? value : null });
  }
  return { as_of: new Date().toISOString().slice(0, 10), variant, entries };
}
