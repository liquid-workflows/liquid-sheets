/* Stars-and-scrubs plan layer, ported from the personal tool's myPlanState /
 * planFit (levi-sheet/draftroom/app.html V56, lines ~810-910). Pure functions:
 * app.js assembles a context from the local doc and calls these, so the math
 * stays testable against a hand trace.
 *
 * Two generalizations from the personal tool, which hardcoded one 12-team
 * roster:
 *  - envelope keys are derived from the roster shape (single-of-a-position ->
 *    "QB"; multiples -> "RB1","RB2"), matching plan_2026.json's key scheme.
 *  - a slot is a "starter" when its label is QB/RB/WR/TE/FLX; K, DEF and BN
 *    share the single PURSE bucket (same split the personal tool used, where
 *    its first seven slots happened to be exactly the non-K/DEF/BN ones).
 *
 * The envelopes ship as a GENERIC, editable template (defaultPlan), never the
 * author's numbers. Constraint #5 holds: this shapes budget guidance only, it
 * never touches the value math. */

const STARTER_LABS = ["QB", "RB", "WR", "TE", "FLX"];
const isStarter = (lab) => STARTER_LABS.includes(lab);
const FITS = { QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"], K: ["K"],
  DEF: ["DEF"] };

/* slotLabels e.g. ["QB","RB","RB","WR","WR","TE","FLX","DEF","K","BN","BN",...]
 * -> envelope keys ["QB","RB1","RB2","WR1","WR2","TE","FLX","DEF","K","BN",...] */
export function planKeys(slotLabels) {
  const total = {};
  slotLabels.forEach((l) => { total[l] = (total[l] || 0) + 1; });
  const seen = {};
  return slotLabels.map((l) => {
    if (l === "BN") return "BN";
    if (total[l] === 1) return l;
    seen[l] = (seen[l] || 0) + 1;
    return l + seen[l];
  });
}

/* ctx: { env, purseCfg, floatTarget, budget, mine, slotLabels, unsoldByPos }
 *  env         plan.envelopes, or null for no plan
 *  purseCfg    plan.purse (may be null -> derived from the float midpoint)
 *  floatTarget plan.float_target [lo, hi]
 *  budget      my team's auction budget
 *  mine        [{pos, price, name?}] of my won players, in acquisition order
 *  slotLabels  the roster's slot-label array (see planKeys)
 *  unsoldByPos { QB:[usd...], RB:[...], ... } sorted DESC, unsold only, ints */
export function myPlanState(ctx) {
  const { env, purseCfg, floatTarget, budget, mine, slotLabels,
    unsoldByPos } = ctx;
  const keys = planKeys(slotLabels);
  const slots = slotLabels.map((l, i) => ({
    lab: l, planned: env ? (env[keys[i]] || 1) : null,
    who: null, price: null, starter: isStarter(l),
  }));
  mine.forEach((p) => {
    const slot = slots.find((s) => !s.who && (FITS[p.pos] || []).includes(s.lab))
      || (["RB", "WR", "TE"].includes(p.pos)
        ? slots.find((s) => !s.who && s.lab === "FLX") : null)
      || slots.find((s) => !s.who && s.lab === "BN");
    if (slot) { slot.who = p; slot.price = p.price; }
  });
  const spent = mine.reduce((a, p) => a + p.price, 0);
  const left = budget - spent;

  /* the PURSE: one bucket for the bench spots + K + DEF (not skill starters).
   * skill starters water-fill from what is left after holding it. */
  const purseSlots = slots.filter((s) => !s.starter);
  const openKdef = purseSlots.filter((s) => !s.who && s.lab !== "BN").length;
  const benchOpen = purseSlots.filter((s) => !s.who && s.lab === "BN").length;
  const openStarters = slots.filter((s) => s.starter && !s.who);
  const band = floatTarget || [4, 10];
  const purseTarget = env
    ? (purseCfg != null ? purseCfg
      : Math.round((band[0] + band[1]) / 2) + 6)
    : 0;

  let projLeft = null, scale = 1, benchPer = 0, purseLeft = purseTarget;
  if (env) {
    /* rank-aware ceilings: the k-th open slot of a position gets the k-th best
     * unsold value (two open RB slots cannot both bank on the same player);
     * FLX gets the best value no direct slot already consumed. */
    const vals = {}, used = {};
    ["QB", "RB", "WR", "TE", "K", "DEF"].forEach((P) => {
      vals[P] = (unsoldByPos[P] || []).slice(); used[P] = 0;
    });
    openStarters.forEach((s) => {
      if (s.lab === "FLX") {
        s.ceil = Math.max(1, ...["RB", "WR", "TE"].map((P) =>
          vals[P][used[P]] || 0));
      } else {
        s.ceil = Math.max(1, (vals[s.lab] || [])[used[s.lab]] || 0);
        used[s.lab]++;
      }
    });
    /* water-fill: scale active envelopes to the budget, freeze any that hit
     * their market ceiling, redistribute what they could not absorb. Envelopes
     * flex both ways; growth capped at 1.75x so one cheap star does not turn
     * the plan into a blank check. */
    let B = Math.max(left - purseTarget, 0);
    let active = openStarters.slice();
    for (let pass = 0; pass <= openStarters.length; pass++) {
      const sumP = active.reduce((a, s) => a + s.planned, 0);
      scale = sumP > 0 ? Math.min(Math.max(B / sumP, 0), 1.75) : 1;
      const capped = active.filter((s) =>
        Math.max(1, Math.round(s.planned * scale)) >= s.ceil);
      if (!capped.length) break;
      capped.forEach((s) => { s.eff = Math.max(1, s.ceil); B -= s.eff; });
      active = active.filter((s) => !capped.includes(s));
    }
    active.forEach((s) => { s.eff = Math.max(1, Math.round(s.planned * scale)); });
    /* the purse is whatever remains once open skill starters are covered at
     * their (flexed) envelopes: banked deals grow it, pricey starters shrink it */
    purseLeft = Math.max(left - openStarters.reduce((a, s) => a + s.eff, 0), 0);
    projLeft = purseLeft;
    /* spread the purse across its open spots so the per-spot column sums to the
     * purse exactly, in spend priority: DEF first (up to $3), then K, then
     * bench front-loaded. Every open purse spot gets a $1 floor first. */
    const rankP = { DEF: 0, K: 1, BN: 2 };
    const openP = purseSlots.filter((s) => !s.who)
      .sort((a, b) => rankP[a.lab] - rankP[b.lab]);
    openP.forEach((s) => { s.eff = 1; });
    let pool = purseLeft - openP.length;
    const def = openP.find((s) => s.lab === "DEF");
    if (def && pool > 0) { const g = Math.min(2, pool); def.eff += g; pool -= g; }
    const restP = openP.filter((s) => s !== def);
    for (let i = 0; pool > 0 && restP.length; i = (i + 1) % restP.length) {
      restP[i].eff++; pool--;
    }
    benchPer = benchOpen > 0
      ? Math.max(1, Math.floor(Math.max(purseLeft - openKdef, benchOpen)
        / benchOpen)) : 0;
  }
  return { slots, spent, left, projLeft, scale, openStarters, benchOpen,
    benchPer, purseLeft, purseTarget, band, hasPlan: !!env };
}

export function planFit(p, ps) {
  if (!ps.hasPlan) return null;
  const direct = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", K: "K",
    DEF: "DEF" }[p.pos];
  const elig = ps.openStarters.filter((s) => s.lab === direct
    || (s.lab === "FLX" && ["RB", "WR", "TE"].includes(p.pos)));
  if (!elig.length) return { bench: true };
  return { bench: false, max: Math.max(...elig.map((s) => s.eff)) + ps.projLeft };
}

/* A GENERIC, neutral default template derived from the run's own values: each
 * starter slot is seeded with the model dollar value of the chalk player who
 * would fill it ("draft the board at value"). Users reshape it into whatever
 * stars-and-scrubs curve they want; the water-fill and ceilings do the rest. */
export function defaultEnvelopes(runPlayers, slotLabels, starterPool = null) {
  const keys = planKeys(slotLabels);
  const byPos = {};
  ["QB", "RB", "WR", "TE"].forEach((P) => {
    byPos[P] = runPlayers.filter((p) => p.pos === P && p.dollar != null)
      .map((p) => Math.max(1, Math.round(p.dollar))).sort((a, b) => b - a);
  });
  const used = { QB: 0, RB: 0, WR: 0, TE: 0 };
  const env = {};
  slotLabels.forEach((lab, i) => {
    const key = keys[i];
    if (!isStarter(lab)) { env[key] = 1; return; }
    if (lab === "FLX") {
      let best = 1, bestPos = null;
      for (const P of ["RB", "WR", "TE"]) {
        const v = byPos[P][used[P]] || 0;
        if (v > best) { best = v; bestPos = P; }
      }
      env[key] = Math.max(1, best);
      if (bestPos) used[bestPos]++;
    } else {
      env[key] = Math.max(1, byPos[lab][used[lab]] || 1);
      used[lab]++;
    }
  });
  /* Normalize the starter shape to the money actually available for
   * starters (budget less the reserve). The chalk players' raw values add to
   * far more than any budget (you cannot afford the #1 player at every slot),
   * so left unscaled the template reads as impossible dollars in the editor
   * while the roster sidebar shows the water-filled version. Scaling here
   * keeps the stars-and-scrubs ratios and makes "what you plan to spend per
   * starting slot" literally true. The water-fill still flexes it live. */
  if (starterPool != null) {
    const sKeys = slotLabels.map((l, i) => (isStarter(l) ? keys[i] : null))
      .filter(Boolean);
    const sum = sKeys.reduce((a, k) => a + env[k], 0);
    if (sum > 0) {
      const target = Math.max(starterPool, sKeys.length);
      const raw = sKeys.map((k) => env[k] * (target / sum));
      const out = raw.map((v) => Math.max(1, Math.floor(v)));
      /* hand the rounding remainder to the slots with the largest fractional
       * parts so the starters add to the pool exactly, never a dollar over */
      let left = target - out.reduce((a, v) => a + v, 0);
      const order = raw.map((v, i) => [v - Math.floor(v), i])
        .sort((a, b) => b[0] - a[0]).map((x) => x[1]);
      for (let j = 0; left > 0 && j < order.length; j++, left--) out[order[j]]++;
      sKeys.forEach((k, i) => { env[k] = out[i]; });
    }
  }
  return env;
}

export function defaultPlan(runPlayers, slotLabels, budget) {
  const float_target = [Math.max(1, Math.round(budget * 0.02)),
    Math.max(2, Math.round(budget * 0.05))];
  /* the reserve the water-fill will hold; mirrors myPlanState's purseTarget
   * so the seeded starters plus the reserve add up to the budget */
  const purse = Math.round((float_target[0] + float_target[1]) / 2) + 6;
  return {
    variant: "default",
    float_target,
    purse: null,
    envelopes: defaultEnvelopes(runPlayers, slotLabels, budget - purse),
  };
}
