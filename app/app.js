/* Liquid Sheets app shell, M1: wizard -> fetch -> engine -> board -> persist.
 * Draft room features arrive in M3/M4; this milestone proves the full pipe. */

import { blendProjections, valueBoard, scoreStatLine, baselines, POSITIONS }
  from "../engine/engine.js";
import { KINDS, parsePaste, guessMapping, toEntries, matchEntries,
  rankImpliedStats, marketScale, detectKind } from "./importers.js";
import { activeSales, appendSale, appendUnsale, ownerStates,
  inflationFactor, theCall, totalRosterSpots as rosterSpots }
  from "./draft.js";
import { PRIOR, PRIOR_SEASON } from "./prior_2026.js";
import { loadDoc, saveDoc, wipeDoc, newDoc, exportDoc, importDocFile,
  onSaved, requestPersist, storageLooksTemporary, canSaveToFile,
  linkedFileName, saveToFile, listLeagues, setActive, deleteLeague }
  from "./storage.js";
import { fetchSleeper } from "./sleeper.js";
import { myPlanState, planFit, defaultPlan } from "./plan.js";
import { AI_ENABLED, AI_ENDPOINT } from "./config.js";

let doc = null;
const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

/* ------------------------------------------------------------- scoring */

const PRESETS = {
  standard: 0, half: 0.5, full: 1,
};

function buildScoring(pprPerRec, knobs) {
  return {
    pass: { yd: knobs.pass_yd, td: knobs.pass_td, int: knobs.int },
    rush: { yd: knobs.rush_rec_yd, td: knobs.rush_rec_td },
    rec: {
      yd: knobs.rush_rec_yd, td: knobs.rush_rec_td,
      ppr_by_pos: { QB: pprPerRec, RB: pprPerRec, WR: pprPerRec, TE: pprPerRec },
    },
    misc: { fumble_lost: knobs.fumble_lost, two_pt: knobs.two_pt },
  };
}

const DEFAULT_KNOBS = {
  pass_yd: 0.04, pass_td: 4, int: -2,
  rush_rec_yd: 0.1, rush_rec_td: 6, fumble_lost: -2, two_pt: 2,
};

/* -------------------------------------------------------------- wizard */

const wizardState = {
  step: 0,
  editing: false,   // true when reopened from the gear to edit doc.league
  name: "",
  platform: "yahoo",
  teams: 12, budget: 200,
  roster: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 5 },
  preset: "half",
  knobs: { ...DEFAULT_KNOBS },
  teamNames: [], teamOrig: [], me: 0, resumeAt: null,
};

/* Platform selection was removed from the wizard (V3): it had no effect at
 * setup time. The paste-import flow asks for the format at the moment it
 * actually matters. */
const STEPS = ["League", "Roster", "Scoring", "Teams", "Projections", "Market"];

function resetWizardState() {
  Object.assign(wizardState, {
    step: 0, editing: false, name: "", teams: 12, budget: 200,
    roster: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 5 },
    preset: "half", knobs: { ...DEFAULT_KNOBS }, teamNames: [],
    teamOrig: [], me: 0, resumeAt: null,
  });
}

/* ---------------- leagues ----------------
 * A league is a doc (see storage.js). Switching flushes the current doc,
 * activates another, reloads, resets everything derived from the old doc,
 * and takes the same path as boot: board if set up, else the wizard. */
let pendingNewFrom = null;   // league to return to if a new league's wizard is cancelled

function resetDerivedState() {
  curRun = null; curSales = []; importState = null; wizardState.editing = false;
  try { resetSale(); } catch (e) { /* no sale form on this screen */ }
  if (cp && cp.cancel) { try { cp.cancel(); } catch (e) { /* ignore */ } }
}

async function switchLeague(id) {
  if (doc && doc.id != null) await saveDoc(doc);
  await setActive(id);
  doc = await loadDoc();
  pendingNewFrom = null;
  resetDerivedState(); applyTheme();
  if (doc && doc.league) renderBoardScreen(); else renderWizard();
}

async function addLeague() {
  if (doc && doc.id != null) await saveDoc(doc);
  pendingNewFrom = doc ? doc.id : null;
  const theme = doc ? doc.ui.theme : "dark";
  const chosen = doc ? doc.ui.themeChosen : false;
  const shared = doc ? { sources: doc.sources, names: doc.names,
    player_meta: doc.player_meta } : null;
  doc = newDoc();
  doc.ui.theme = theme; doc.ui.themeChosen = chosen;
  if (shared) Object.assign(doc, shared);   // sources are app-wide
  resetDerivedState(); resetWizardState(); renderWizard();
}

async function cancelNewLeague() {
  const back = pendingNewFrom; pendingNewFrom = null;
  if (back != null) await switchLeague(back);
}

async function deleteCurrentLeague() {
  const gone = doc.league ? doc.league.name : "league";
  await deleteLeague(doc.id);
  doc = null;                 // never let switchLeague flush the deleted doc back
  const rest = await listLeagues();
  resetDerivedState();
  if (rest.length) {
    await switchLeague(rest[0].id);
    stampShow("DELETED", gone);
  } else {
    doc = newDoc(); resetWizardState(); renderWizard();
  }
}

const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* The masthead picker: every league by name, plus "Add new league". */
async function renderLeaguePicker() {
  const sel = $("#leaguesel");
  if (!sel) return;
  const leagues = await listLeagues();
  const dup = {};
  leagues.forEach((l) => { dup[l.name] = (dup[l.name] || 0) + 1; });
  let html = "";
  for (const l of leagues) {
    const lab = dup[l.name] > 1 ? `${l.name} (${l.teams}x$${l.budget})` : l.name;
    html += `<option value="${l.id}"${doc && doc.id === l.id ? " selected" : ""}>${escHtml(lab)}</option>`;
  }
  if (doc && doc.id == null) html += `<option value="__pending" selected>New league...</option>`;
  html += `<option disabled>------------</option><option value="__new">+ Add new league</option>`;
  sel.innerHTML = html;
  sel.onchange = () => {
    const v = sel.value;
    if (v === "__new") {
      sel.value = doc && doc.id != null ? String(doc.id) : "__pending";
      addLeague();
    } else if (v !== "__pending") switchLeague(+v);
  };
}

/* Reopen the wizard prefilled from the saved league so any setup decision
 * can be revisited. Edit mode drops the Data step (sources are kept) and ends
 * in "Save settings", which rewrites doc.league and recomputes values. */
function openLeagueEditor() {
  const L = doc.league;
  const w = wizardState;
  w.editing = true; w.step = 0;
  w.name = L.name || "";
  w.teams = L.teams; w.budget = L.budget;
  w.roster = { ...L.full_roster };
  w.teamNames = [...L.team_names];
  w.teamOrig = L.team_names.map((_, i) => i);   // original line of each row
  w.me = L.me ?? 0;
  const ppr = L.scoring.rec.ppr_by_pos.RB;
  w.preset = Object.keys(PRESETS).find((k) => PRESETS[k] === ppr) ?? "half";
  w.knobs = {
    pass_yd: L.scoring.pass.yd, pass_td: L.scoring.pass.td,
    int: L.scoring.pass.int, rush_rec_yd: L.scoring.rush.yd,
    rush_rec_td: L.scoring.rush.td, fumble_lost: L.scoring.misc.fumble_lost,
    two_pt: L.scoring.misc.two_pt,
  };
  renderWizard();
}

function wizardSteps() {
  return wizardState.editing ? STEPS.slice(0, 4) : STEPS;
}

function renderWizard() {
  const root = $("#main");
  root.innerHTML = "";
  ["#hleft", "#hcenter", "#flow"].forEach((s) => {   // header is board-only
    const n = $(s); if (n) n.innerHTML = "";
  });
  const box = el("div", "wizard");
  /* Stepper: sets the expectation up front (how many steps, where you are)
   * so setup reads as a short, finite procedure rather than a form. */
  const cur = wizardState.step;
  const S = wizardSteps();
  const stepper = el("div", "stepper");
  const meta = el("div", "stepmeta");
  meta.innerHTML = `<b>Step ${cur + 1} of ${S.length}</b>` +
    `<span>${S[cur]}</span>`;
  stepper.appendChild(meta);
  const bar = el("div", "stepbar");
  const fill = el("div", "stepfill");
  fill.style.width = `${((cur + 1) / S.length) * 100}%`;
  bar.appendChild(fill);
  stepper.appendChild(bar);
  const labels = el("div", "steps");
  S.forEach((s, i) => {
    const cls = i < cur ? "step done" : i === cur ? "step on" : "step";
    labels.appendChild(el("span", cls, s));
  });
  stepper.appendChild(labels);
  box.appendChild(stepper);
  if (cur === 0) {
    box.appendChild(el("p", "wizintro", wizardState.editing
      ? "Editing league settings. Your sources, sales, calls and favorites " +
        "are kept; values are recomputed when you save."
      : "Build the board for your league."));
  }
  const body = el("div", "wizbody");
  box.appendChild(body);
  const nav = el("div", "wiznav");
  box.appendChild(nav);
  root.appendChild(box);

  const steps = [stepLeague, stepRoster, stepScoring, stepTeams, stepData, stepMarket];
  steps[wizardState.step](body, nav);
  renderLeaguePicker();
  /* Focus the step's first control so Enter always has somewhere to land;
   * on the card steps that is the primary card, which Enter clicks natively. */
  const first = body.querySelector(
    "input:not([type=radio]):not([disabled]), textarea, .optcard.primary");
  if (first) first.focus();
  /* Enter advances on the primary action (blur first so a number field's
   * pending change commits before Next reads it). */
  box.onkeydown = (e) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    const tag = e.target.tagName;
    if (tag === "TEXTAREA" || tag === "BUTTON") return;
    const n = nav.querySelector("button.primary");
    if (!n) return;
    e.preventDefault(); e.target.blur(); n.click();
  };
}

function navButtons(nav, { back = true, next = "Next", onNext }) {
  const left = el("div", "wizleft");
  if (back && wizardState.step > 0) {
    const b = el("button", "ghost", "Back");
    b.onclick = () => { wizardState.step--; renderWizard(); };
    left.appendChild(b);
  }
  if (wizardState.editing) {
    const c = el("button", "ghost", "Cancel");
    c.onclick = () => { wizardState.editing = false; renderBoardScreen(); };
    left.appendChild(c);
  } else if (pendingNewFrom != null) {
    const c = el("button", "ghost", "Cancel");
    c.onclick = () => cancelNewLeague();
    left.appendChild(c);
  }
  nav.appendChild(left);
  const n = el("button", "primary", next);
  n.onclick = onNext;
  nav.appendChild(n);
}

function numInput(labelText, value, min, max, onchange, { locked = "" } = {}) {
  const wrap = el("label", "field");
  wrap.appendChild(el("span", null, labelText));
  const inp = el("input");
  inp.type = "number"; inp.value = value; inp.min = min; inp.max = max;
  inp.onchange = () => onchange(Number(inp.value));
  if (locked) { inp.disabled = true; inp.title = locked; }
  wrap.appendChild(inp);
  if (locked) wrap.appendChild(el("small", "locknote", locked));
  return wrap;
}

function stepLeague(body, nav) {
  body.appendChild(el("h2", null, "League shape"));
  const nameWrap = el("label", "field");
  nameWrap.appendChild(el("span", null, "League name"));
  const nameInp = el("input");
  nameInp.type = "text"; nameInp.maxLength = 40; nameInp.className = "wide";
  nameInp.placeholder = "e.g. Sunday Night Degenerates";
  nameInp.value = wizardState.name;
  nameInp.oninput = () => { wizardState.name = nameInp.value; };
  nameWrap.appendChild(nameInp);
  body.appendChild(nameWrap);
  /* Team count is locked once sales exist: sales reference team slots, so
   * shrinking the league would orphan them. Everything else stays editable. */
  const salesExist = wizardState.editing && doc
    && activeSales(doc.journal).length > 0;
  body.appendChild(numInput("Teams", wizardState.teams, 4, 20,
    (v) => { wizardState.teams = v; }, {
      locked: salesExist
        ? "Locked while sales exist (reset the board to change it)" : "" }));
  if (wizardState.editing) {
    /* Delete lives with the other league-level decisions. Armed like Reset. */
    const wrap = el("div", "delwrap");
    const b = el("button", "ghost danger tiny", "Delete this league");
    let armed = 0;
    b.onclick = async () => {
      if (Date.now() - armed > 5000) {
        armed = Date.now(); b.textContent = "Click again to CONFIRM delete";
        setTimeout(() => { b.textContent = "Delete this league"; armed = 0; }, 5000);
        return;
      }
      await deleteCurrentLeague();
    };
    wrap.appendChild(b);
    body.appendChild(wrap);
  }
  body.appendChild(numInput("Auction budget per team ($)", wizardState.budget,
    50, 1000, (v) => { wizardState.budget = v; }));
  navButtons(nav, { onNext: () => { wizardState.step++; renderWizard(); } });
}

function stepRoster(body, nav) {
  body.appendChild(el("h2", null, "Roster"));
  body.appendChild(el("p", "hint", "Roster size."));
  const grid = el("div", "grid4");
  for (const slot of ["QB", "RB", "WR", "TE", "FLEX", "K", "DEF", "BN"]) {
    grid.appendChild(numInput(slot, wizardState.roster[slot], 0, 12,
      (v) => { wizardState.roster[slot] = v; }));
  }
  body.appendChild(grid);
  navButtons(nav, { onNext: () => { wizardState.step++; renderWizard(); } });
}

function stepScoring(body, nav) {
  body.appendChild(el("h2", null, "Scoring"));
  const row = el("div", "choices");
  for (const [name] of Object.entries(PRESETS)) {
    const label = name === "half" ? "Half PPR"
      : name === "full" ? "Full PPR" : "Standard";
    const b = el("button",
      wizardState.preset === name ? "choice on" : "choice", label);
    b.onclick = () => { wizardState.preset = name; renderWizard(); };
    row.appendChild(b);
  }
  body.appendChild(row);
  body.appendChild(el("p", "hint", "Enter your league's scoring settings"));
  const form = el("div", "form");
  const knobDefs = [
    ["pass_yd", "Points per passing yard"], ["pass_td", "Passing TD"],
    ["int", "Interception"], ["rush_rec_yd", "Points per rush/rec yard"],
    ["rush_rec_td", "Rush/rec TD"], ["fumble_lost", "Fumble lost"],
    ["two_pt", "Two-point conversion"],
  ];
  for (const [k, label] of knobDefs) {
    const r = el("label", "formrow");
    r.appendChild(el("span", null, label));
    const inp = el("input");
    inp.type = "number"; inp.step = "0.01"; inp.value = wizardState.knobs[k];
    inp.onchange = () => { wizardState.knobs[k] = Number(inp.value); };
    r.appendChild(inp);
    form.appendChild(r);
  }
  body.appendChild(form);
  navButtons(nav, { onNext: () => { wizardState.step++; renderWizard(); } });
}

/* Teams: a reorderable list (drag the grip, mouse or touch) with a "me"
 * marker. Order can change any time, even mid-draft, because each row
 * remembers its original line (teamOrig) and saveLeagueEdit remaps the sale
 * journal by that permutation. So the list can be put into the platform's
 * draft order the moment it is revealed. */
function stepTeams(body, nav) {
  const w = wizardState;
  body.appendChild(el("h2", null, "Teams"));
  body.appendChild(el("p", "hint",
    "Name the teams and mark which one is you. Drag to reorder, any time, even " +
    "mid-draft, to match your platform's order once it is revealed."));
  while (w.teamNames.length < w.teams) {
    w.teamNames.push(`Team ${w.teamNames.length + 1}`); w.teamOrig.push(null);
  }
  w.teamNames.length = w.teams; w.teamOrig.length = w.teams;
  if (w.me >= w.teams) w.me = 0;

  const list = el("div", "teamlist");
  const head = el("div", "trow thead");
  ["", "Team", "Me"].forEach((t) => head.appendChild(el("span", null, t)));
  list.appendChild(head);
  let dragFrom = null;
  const move = (from, to) => {
    if (to < 0 || to >= w.teams || from === to) return;
    const [n] = w.teamNames.splice(from, 1); w.teamNames.splice(to, 0, n);
    const [o] = w.teamOrig.splice(from, 1); w.teamOrig.splice(to, 0, o);
    if (w.me === from) w.me = to;
    else if (from < w.me && to >= w.me) w.me--;
    else if (from > w.me && to <= w.me) w.me++;
    renderWizard();
  };
  w.teamNames.forEach((name, i) => {
    const row = el("div", `trow${w.me === i ? " isme" : ""}`);
    row.dataset.idx = i;
    /* Pointer-based drag so it works with a mouse AND touch. HTML5 DnD is not
     * synthesized from a touch gesture on phones, so the grip uses pointer
     * events and elementFromPoint to find the drop target. */
    const grip = el("span", "grip", "::"); grip.title = "drag to reorder";
    grip.style.touchAction = "none";   // stop the browser from scrolling the list mid-drag
    grip.onpointerdown = (e) => {
      e.preventDefault();
      /* Capture the pointer to the grip so every move/up fires here even once
       * the finger (or cursor) leaves the handle. Works for mouse and touch;
       * touch-action:none above keeps a touch-drag from turning into a scroll. */
      try { grip.setPointerCapture(e.pointerId); } catch (_) { /* ok */ }
      dragFrom = i; row.classList.add("drag");
      let overIdx = null;
      grip.onpointermove = (ev) => {
        const hit = document.elementFromPoint(ev.clientX, ev.clientY);
        const tr = hit && hit.closest(".trow:not(.thead)");
        list.querySelectorAll(".trow.over").forEach((n) => n.classList.remove("over"));
        if (tr && tr.dataset.idx != null) { tr.classList.add("over"); overIdx = +tr.dataset.idx; }
      };
      const done = () => {
        grip.onpointermove = null; grip.onpointerup = null; grip.onpointercancel = null;
        list.querySelectorAll(".trow.over").forEach((n) => n.classList.remove("over"));
        row.classList.remove("drag");
        if (overIdx != null && overIdx !== dragFrom) move(dragFrom, overIdx);
        dragFrom = null;
      };
      grip.onpointerup = done;
      grip.onpointercancel = done;
    };
    row.appendChild(grip);
    const inp = el("input"); inp.type = "text"; inp.value = name; inp.maxLength = 30;
    inp.oninput = () => { w.teamNames[i] = inp.value; };
    inp.onkeydown = (e) => { if (e.key === "Enter") e.preventDefault(); };
    row.appendChild(inp);
    const me = el("label", "melab");
    const r = el("input"); r.type = "radio"; r.name = "meteam"; r.checked = w.me === i;
    r.onchange = () => { w.me = i; renderWizard(); };
    me.appendChild(r); me.title = "this is my team";
    row.appendChild(me);
    list.appendChild(row);
  });
  body.appendChild(list);
  navButtons(nav, {
    onNext: async () => {
      w.teamNames = w.teamNames.map((s, i) => s.trim() || `Team ${i + 1}`);
      if (w.editing) { await saveLeagueEdit(); return; }
      w.step++; renderWizard();
    },
    next: w.editing ? "Save settings" : "Next",
  });
}

/* Edit-mode finish: rewrite doc.league from the wizard, keep everything else
 * (sources, journal, calls, favorites), and recompute values as a new
 * append-only run so the values-from chip shows the change. */
async function saveLeagueEdit() {
  /* Reorder is a permutation: each row knows its original line, so every
   * sale's owner index is rewritten to the row's new position. Lossless. */
  const w = wizardState;
  const newIndexOfOrig = new Map();
  w.teamOrig.forEach((orig, i) => { if (orig != null) newIndexOfOrig.set(orig, i); });
  let moved = false;
  for (const e of doc.journal) {
    if (e.type === "sale" && newIndexOfOrig.has(e.owner)) {
      const ni = newIndexOfOrig.get(e.owner);
      if (ni !== e.owner) { e.owner = ni; moved = true; }
    }
  }
  await finishWizard();
  if (moved) stampShow("REORDERED", "sales follow their teams");
  wizardState.editing = false;
  if (Object.keys(doc.sources).length) {
    await makeRun();
    await saveDoc(doc);
  }
  renderBoardScreen();
  stampShow("SAVED", "league settings updated");
}

/* The two ways to get projections in. Sleeper first: it is the one-click
 * path that gets a stranger to a board. Used by the wizard and by the empty
 * board. afterSleeper / resumeAt say where each path lands. */
function projectionCards({ afterSleeper, resumeAt }) {
  const cards = el("div", "optcards");
  const msg = el("p", "msg");
  const sleeper = el("button", "optcard primary");
  const title = "Import today's Sleeper public projections";
  sleeper.innerHTML = `<b>${title}</b><small>See the board now; add more sources later.</small>`;
  sleeper.onclick = async () => {
    sleeper.disabled = true; sleeper.querySelector("b").textContent = "Fetching...";
    try {
      if (!doc || !doc.league) await finishWizard();
      await doFetchSleeper();
      afterSleeper();
    } catch (e) {
      msg.textContent = `Fetch failed (${e.message}). If you are offline, ` +
        "reconnect and try again; your settings are saved.";
      sleeper.disabled = false; sleeper.querySelector("b").textContent = title;
    }
  };
  const mine = el("button", "optcard");
  mine.innerHTML = `<b>Import my projections</b><small>FantasyPros, CBS, a spreadsheet, any rankings list. Paste or upload; you confirm the column mapping.</small>`;
  mine.onclick = async () => {
    if (!doc || !doc.league) await finishWizard();
    wizardState.resumeAt = resumeAt ?? null;
    importState = { target: "my" };
    renderImport();
  };
  cards.appendChild(sleeper); cards.appendChild(mine);
  const wrap = el("div");
  wrap.appendChild(cards); wrap.appendChild(msg);
  return wrap;
}

function stepData(body, nav) {
  body.appendChild(el("h2", null, "Your Projections (My$)"));
  body.appendChild(el("p", "hint",
    "Your board is made with your data. Start with Sleeper's Player " +
    "Projections to see the board now, or bring your own; with more than one " +
    "source the board averages them."));
  body.appendChild(projectionCards({
    afterSleeper: async () => {
      await finishWizard(); wizardState.step++; renderWizard();
    },
    resumeAt: 5,
  }));
  navButtons(nav, { next: "Next", onNext: () => {} });
  nav.querySelector("button.primary").hidden = true;   // the cards are the actions
}

function stepMarket(body, nav) {
  body.appendChild(el("h2", null, "Market values (Bid$)"));
  body.appendChild(el("p", "hint",
    "Import today's Yahoo or ESPN auction values. They are rescaled to your " +
    "league's money as Bid$. Bid$ is the estimate of what your room will pay."));
  const cards = el("div", "optcards");
  const imp = el("button", "optcard primary");
  imp.innerHTML = `<b>Import Yahoo or ESPN values</b><small>Copy the values page or upload the CSV; you confirm the column mapping.</small>`;
  imp.onclick = async () => {
    await finishWizard();
    wizardState.resumeAt = null;
    importState = { target: "market", kind: "values" };
    renderImport();
  };
  cards.appendChild(imp);
  body.appendChild(cards);
  navButtons(nav, {
    next: "Skip for now",
    onNext: async () => { await finishWizard(); renderBoardScreen(); },
  });
}

function totalRosterSpots(roster) {
  return Object.values(roster).reduce((a, b) => a + b, 0);
}

async function finishWizard() {
  if (!doc) doc = newDoc();
  pendingNewFrom = null;      // a finished wizard is a real league now
  const w = wizardState;
  doc.league = {
    name: w.name.trim() || `${w.teams}-team league`,
    platform: w.platform, season: PRIOR_SEASON,
    teams: w.teams, budget: w.budget, weeks: 17,
    roster_slots: { QB: w.roster.QB, RB: w.roster.RB, WR: w.roster.WR,
      TE: w.roster.TE, FLEX: w.roster.FLEX },
    full_roster: { ...w.roster },
    scoring: buildScoring(PRESETS[w.preset], w.knobs),
    model_params: {
      baseline_bench_share: 0.15, vols_blend_alpha: 0,
      tier_gap_theta: 0.2,
      dollar_slots_per_team: totalRosterSpots(w.roster),
    },
    team_names: [...w.teamNames],
    me: w.me ?? 0,
  };
  await saveDoc(doc);
}

/* ---------------------------------------------------------------- runs */

async function doFetchSleeper() {
  const { as_of, players, kdef, names, meta } =
    await fetchSleeper(doc.league.season);
  if (!players.length) {
    throw new Error("Sleeper returned no projections right now. Try again in a moment, or import your own.");
  }
  doc.sources.sleeper = { as_of, players };
  doc.kdef = { as_of, players: kdef };
  Object.assign(doc.names, names);
  Object.assign(doc.player_meta, meta);
  await makeRun();
}

/* Build (synchronously) a run from a chosen subset of sources - the mixer (V56).
 * Every mix is a real run in doc.runs (traceable by its #), reused when the same
 * sources at the same as-of dates already have one. Returns the run. */
function buildRun(sources) {
  const cfg = doc.league;
  const all = Object.keys(doc.sources);
  const use = (sources && sources.length ? sources : all).filter((s) => all.includes(s)).sort();
  if (!use.length) return null;
  const isAll = use.length === all.length;
  let asOf, players;
  if (use.length > 1) {
    ({ asOf, players } = blendProjections(doc.sources, cfg.scoring,
      all.filter((s) => !use.includes(s))));
  } else {
    const s = doc.sources[use[0]];
    asOf = `${use[0]}@${s.as_of}`;
    players = s.players;
  }
  const label = isAll && use.length > 1 ? "blend" : use.join("+");
  const existing = doc.runs.find((r) => r.source_label === label && r.as_of === asOf);
  if (existing) return existing;
  const result = valueBoard(cfg, players,
    doc.ui.availFade === false ? [] : PRIOR);   // fade toggle: empty prior = no fade
  const run = {
    run_id: doc.runs.length + 1,
    created_at: new Date().toISOString(),
    source_label: label, as_of: asOf, sources: use,
    meta: result.meta,
    players: result.players,
  };
  doc.runs.push(run);
  return run;
}

async function makeRun() {
  if (!Object.keys(doc.sources).length) return;
  buildRun(null);                 // the full blend, as before
  await saveDoc(doc);
}

/* the mixer's state: which sources are in the average + whether My Calls are
 * layered on. null sources = every source (a new import joins automatically). */
function mixState() {
  const all = Object.keys(doc.sources);
  const m = doc.ui?.mix || {};
  const on = (m.sources || all).filter((s) => all.includes(s));
  return { on: on.length ? on : all, calls: m.calls !== false && (doc.calls || []).length > 0 };
}

/* -------------------------------------------------------------- import */

let importState = null;

/* Per-position expansion of the below-FREE section. Module-level, never on
 * DOM nodes: re-renders destroy nodes (the predecessor's dead-expander
 * lesson). Collapsed by default. */
const freeExpanded = {};

function boardRoster() {
  const roster = [];
  for (const src of Object.values(doc.sources)) {
    for (const p of src.players) {
      roster.push({ pid: p.player_id, name: doc.names[p.player_id] ?? "",
        pos: p.pos });
    }
  }
  if (doc.kdef) {
    for (const p of doc.kdef.players) {
      roster.push({ pid: p.player_id, name: doc.names[p.player_id] ?? "",
        pos: p.pos });
    }
  }
  const seen = new Set();
  return roster.filter((r) => !seen.has(r.pid) && seen.add(r.pid));
}

function renderImport() {
  const root = $("#main");
  root.innerHTML = "";
  ["#hleft", "#hcenter", "#flow"].forEach((s) => {   // header is board-only
    const n = $(s); if (n) n.innerHTML = "";
  });
  const panel = el("div", "bigpanel");
  root.appendChild(panel);
  panel.appendChild(el("h2", null, "Add data"));
  /* Two distinct things can be added, and they never mix: projections feed
   * My$; market values become Bid$. The user picks which, up front. */
  importState.target = importState.target
    ?? (importState.kind === "values" ? "market" : "my");
  const pick = el("div", "optcards two");
  const mk = (t, title, sub) => {
    const b = el("button", `optcard${importState.target === t ? " primary" : ""}`);
    b.innerHTML = `<b>${title}</b><small>${sub}</small>`;
    b.onclick = () => { importState.target = t; renderImport(); };
    return b;
  };
  pick.appendChild(mk("my", "My$ projections",
    "A projections export or a rankings list (FantasyPros, CBS, a spreadsheet). Joins the blend behind My$."));
  pick.appendChild(mk("market", "Market values (Bid$)",
    "Today's Yahoo or ESPN auction values. Never touch My$; they become Bid$ and light up +/-."));
  panel.appendChild(pick);
  panel.appendChild(el("p", "hint", importState.target === "market"
    ? "Copy the values page from Yahoo or ESPN and paste it, or upload the CSV. " +
      "You confirm the column mapping next."
    : "Paste the export or upload the CSV. Stat-line projections and plain " +
      "rankings lists both work; you confirm the column mapping next."));

  const ta = el("textarea");
  ta.rows = 10;
  ta.placeholder = "Paste here (or choose a file below)";
  ta.value = importState.text ?? "";
  ta.oninput = () => { importState.text = ta.value; };
  panel.appendChild(ta);

  const fileRow = el("div", "choices");
  const fileInp = el("input");
  fileInp.type = "file"; fileInp.accept = ".csv,.tsv,.txt";
  fileInp.onchange = async () => {
    if (fileInp.files.length) {
      importState.text = await fileInp.files[0].text();
      ta.value = importState.text;
    }
  };
  fileRow.appendChild(fileInp);
  panel.appendChild(fileRow);

  const msg = el("p", "msg");
  panel.appendChild(msg);
  const nav = el("div", "wiznav");
  const cancel = el("button", "ghost", "Cancel");
  cancel.onclick = () => afterImport();
  nav.appendChild(cancel);
  const prev = el("button", "primary", "Preview");
  prev.onclick = () => {
    const parsed = parsePaste(importState.text ?? "");
    if (!parsed.rows.length) { msg.textContent = "Nothing parseable found."; return; }
    importState.parsed = parsed;
    if (importState.target === "market") importState.kind = "values";
    else { const k = detectKind(parsed); importState.kind = k === "values" ? "rankings" : k; }
    setMapping();
    renderMapper();
  };
  nav.appendChild(prev);
  panel.appendChild(nav);
}

/* Where an import lands when it finishes or is cancelled: back into the
 * wizard if the wizard launched it, otherwise the board. */
function afterImport() {
  importState = null;
  if (wizardState.resumeAt != null) {
    wizardState.step = wizardState.resumeAt; wizardState.resumeAt = null;
    renderWizard();
  } else renderBoardScreen();
}

function setMapping() {
  const { parsed, kind } = importState;
  if (parsed.preset === "yahoo" && kind === "values") {
    importState.mapping = ["name", "pos", "team", "ignore", "value", "ignore"];
  } else {
    importState.mapping = guessMapping(parsed.headers, parsed.rows, kind);
  }
}

function renderMapper() {
  const root = $("#main");
  root.innerHTML = "";
  const panel = el("div", "bigpanel wide");
  root.appendChild(panel);
  const { parsed, mapping, kind } = importState;
  panel.appendChild(el("h2", null,
    `Confirm the columns (${parsed.rows.length} rows` +
    (parsed.preset === "yahoo" ? ", Yahoo format detected" : "") + ")"));
  const kindRow = el("div", "choices");
  kindRow.appendChild(el("span", "hint", "Looks like:"));
  for (const [k, def] of Object.entries(KINDS)) {
    const b = el("button", kind === k ? "choice on" : "choice", def.label);
    b.onclick = () => { importState.kind = k; setMapping(); renderMapper(); };
    kindRow.appendChild(b);
  }
  panel.appendChild(kindRow);
  if (kind === "values") {
    const radios = el("div", "choices radios");
    radios.appendChild(el("span", "hint", "These values are from:"));
    for (const p of ["yahoo", "espn"]) {
      const lab = el("label", "radio");
      const r = el("input");
      r.type = "radio"; r.name = "platform"; r.value = p;
      const current = importState.platform ??
        (parsed.preset === "yahoo" ? "yahoo" : "yahoo");
      importState.platform = current;
      r.checked = current === p;
      r.onchange = () => { importState.platform = p; };
      lab.appendChild(r);
      lab.appendChild(el("span", null, p === "espn" ? "ESPN" : "Yahoo"));
      radios.appendChild(lab);
    }
    panel.appendChild(radios);
  } else {
    const labelRow = el("label", "field");
    labelRow.appendChild(el("span", null, "Source name"));
    const labelInp = el("input");
    labelInp.value = importState.label ?? kind;
    importState.label = importState.label ?? kind;
    labelInp.onchange = () => { importState.label = labelInp.value.trim(); };
    labelRow.appendChild(labelInp);
    panel.appendChild(labelRow);
  }
  panel.appendChild(el("p", "hint",
    "The app guessed what each column is. Fix any dropdown that is wrong; " +
    "set columns you do not want to \"ignore\"."));
  const fields = ["ignore", ...KINDS[kind].fields];
  const tbl = el("table", "maptable");
  const selRow = el("tr");
  mapping.forEach((f, i) => {
    const td = el("th");
    const sel = el("select");
    for (const opt of fields) {
      const o = el("option", null, opt);
      o.value = opt;
      if (opt === f) o.selected = true;
      sel.appendChild(o);
    }
    sel.onchange = () => { importState.mapping[i] = sel.value; };
    td.appendChild(sel);
    selRow.appendChild(td);
  });
  tbl.appendChild(selRow);
  if (parsed.headers) {
    const hr = el("tr", "hdr");
    parsed.headers.forEach((h) => hr.appendChild(el("td", null, h)));
    tbl.appendChild(hr);
  }
  for (const r of parsed.rows.slice(0, 6)) {
    const tr = el("tr");
    r.forEach((c) => tr.appendChild(el("td", null, c)));
    tbl.appendChild(tr);
  }
  const wrap = el("div", "tblwrap");
  wrap.appendChild(tbl);
  panel.appendChild(wrap);
  const msg = el("p", "msg");
  panel.appendChild(msg);
  const nav = el("div", "wiznav");
  const back = el("button", "ghost", "Back");
  back.onclick = renderImport;
  nav.appendChild(back);
  const imp = el("button", "primary", "Import");
  imp.onclick = () => {
    if (!importState.mapping.includes("name")) {
      msg.textContent = "One column must be mapped to \"name\"."; return;
    }
    if (kind === "rankings" && !importState.mapping.includes("rank")) {
      msg.textContent = "Rankings need a \"rank\" column."; return;
    }
    const entries = toEntries(parsed.rows, importState.mapping);
    const { matched, unmatched } = matchEntries(entries, boardRoster());
    importState.matched = matched;
    importState.unmatched = unmatched;
    if (unmatched.length) renderUnmatched();
    else finishImport();
  };
  nav.appendChild(imp);
  panel.appendChild(nav);
}

function renderUnmatched() {
  const root = $("#main");
  root.innerHTML = "";
  const panel = el("div", "bigpanel");
  root.appendChild(panel);
  panel.appendChild(el("h2", null,
    `${importState.unmatched.length} rows did not match a player`));
  panel.appendChild(el("p", "hint",
    "Nothing is dropped silently. Match each row by hand or skip it."));
  const run = doc.runs[doc.runs.length - 1];
  const dollars = new Map(
    (run?.players ?? []).map((p) => [p.player_id, p.dollar]));
  const roster = boardRoster()
    .sort((a, b) => (dollars.get(b.pid) ?? 0) - (dollars.get(a.pid) ?? 0));
  importState.resolutions = importState.unmatched.map(() => null);
  const list = el("div", "form");
  importState.unmatched.forEach((e, i) => {
    const r = el("label", "formrow");
    r.appendChild(el("span", null,
      `${e.name}${e.pos ? ` (${e.pos})` : ""}`));
    const sel = el("select");
    sel.appendChild(el("option", null, "skip"));
    const cands = e.pos ? roster.filter((p) => p.pos === e.pos) : roster;
    for (const c of cands.slice(0, 80)) {
      const o = el("option", null, `${c.name} (${c.pos})`);
      o.value = c.pid;
      sel.appendChild(o);
    }
    sel.onchange = () => {
      importState.resolutions[i] = sel.value === "skip" ? null : sel.value;
    };
    r.appendChild(sel);
    list.appendChild(r);
  });
  panel.appendChild(list);
  const nav = el("div", "wiznav");
  const back = el("button", "ghost", "Back");
  back.onclick = renderMapper;
  nav.appendChild(back);
  const fin = el("button", "primary", "Finish import");
  fin.onclick = () => {
    importState.unmatched.forEach((e, i) => {
      if (importState.resolutions[i]) {
        importState.matched.push({ entry: e, pid: importState.resolutions[i] });
      }
    });
    finishImport();
  };
  nav.appendChild(fin);
  panel.appendChild(nav);
}

async function finishImport() {
  const { kind, matched } = importState;
  const label = kind === "values" ? (importState.platform ?? "yahoo")
    : (importState.label ?? kind).trim() || kind;
  const as_of = new Date().toISOString().slice(0, 10);
  const posOf = new Map(boardRoster().map((r) => [r.pid, r.pos]));
  if (kind === "values") {
    const values = {};
    for (const m of matched) {
      if (m.entry.value != null) values[m.pid] = m.entry.value;
    }
    doc.market = { label, as_of, values };
  } else if (kind === "projections") {
    doc.sources[label] = {
      as_of,
      players: matched.filter((m) => posOf.get(m.pid))
        .map((m) => ({ player_id: m.pid, pos: posOf.get(m.pid),
          team: m.entry.team ?? null, stats: m.entry.stats })),
    };
    await makeRun();
  } else if (kind === "rankings") {
    const srcNames = Object.keys(doc.sources);
    let reference;
    if (srcNames.length > 1) {
      reference = blendProjections(doc.sources, doc.league.scoring).players;
    } else if (srcNames.length === 1) {
      reference = doc.sources[srcNames[0]].players;
    } else {
      alert("Fetch or import projections first; rankings need a curve to map onto.");
      afterImport(); return;
    }
    const withPos = matched.map((m) => ({ ...m, pos: posOf.get(m.pid) }))
      .filter((m) => m.pos);
    const players = rankImpliedStats(withPos, reference,
      (p) => scoreStatLine(p.pos, p.stats, doc.league.scoring));
    doc.sources[label] = { as_of, players };
    await makeRun();
  }
  await saveDoc(doc);
  afterImport();
}

/* --------------------------------------------------------------- board */

/* ------------------------------------------------------------ the room
 * Ported from the original (levi-sheet/draftroom/app.html V36): same DOM
 * shape, same CSS, same interaction grammar. Data access adapted from its
 * server state to our local doc; everything else moves faithfully. */

let P = [], byId = {}, soldSet = new Set(), soldBy = {};
let hitList = [], hitSel = 0, picked = null, selOwner = null;
let stagedId = null, rosterView = null, showTeams = false;
let kdefView = localStorage.getItem("ls-kdef") || "DEF";
let sortBy = localStorage.getItem("ls-sort") || "usd";
let mScale = 1;
let curRun = null, curSales = [];
/* any board column can collapse to a slim strip; persisted (ported) */
let colMin = JSON.parse(localStorage.getItem("ls-colmin") || "{}");
if (!("KDEF" in colMin)) colMin.KDEF = true;  // K/DEF collapsed until toggled
let ownerFilter = "";                          // type-to-filter the owner grid
let boardTab = localStorage.getItem("ls-tab") || "board";
let notesExpanded = false;
let flaggedOpen = localStorage.getItem("ls-fav") === "open";
let lastEsc = 0;                               // double-tap Escape timer
let cp = null;   // copilot handle, non-null only when config.AI_ENDPOINT is set

const fmt$ = (v) => v == null ? "" : "$" + Math.round(v);
const posClass = (l) => ({ QB: "pQB", RB: "pRB", WR: "pWR", TE: "pTE",
  FLX: "pFLX", K: "pK", DEF: "pDEF" }[l] || "");
const isFav = (pid) => (doc.favorites || []).includes(pid);
async function toggleFav(pid) {
  doc.favorites = doc.favorites || [];
  doc.favorites = isFav(pid)
    ? doc.favorites.filter((x) => x !== pid)
    : [...doc.favorites, pid];
  await saveDoc(doc);
}

function applyTheme() {
  /* dark is the default; light removes the attribute, any dark* theme sets it */
  const t = doc?.ui?.theme || "dark";
  if (t === "light") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = "dark";
}
const ME = () => doc.league.me ?? 0;   // which line is "you" (reorderable)
const owners = () => doc.league.team_names.map((name, i) =>
  ({ id: i, name, is_me: i === ME() }));
const short = (o) => o.is_me ? "ME"
  : o.name.split(" ")[0].slice(0, 4).toUpperCase();

window.onerror = (m, src, l) => { const e = $("#errbar");
  e.style.display = "block";
  e.textContent = "Something went wrong. Try reloading; your data is saved.";
  console.error("UI error:", m, "@" + src + ":" + l); };
window.onunhandledrejection = (ev) => { const e = $("#errbar");
  e.style.display = "block";
  e.textContent = "Something went wrong. Try reloading; your data is saved.";
  console.error("Unhandled rejection:", ev.reason); };

function slotOrder() {
  const r = doc.league.full_roster;
  const out = [];
  for (const pos of ["QB", "RB", "WR", "TE"]) {
    for (let i = 0; i < (r[pos] ?? 0); i++) out.push(pos);
  }
  for (let i = 0; i < (r.FLEX ?? 0); i++) out.push("FLX");
  for (const pos of ["K", "DEF"]) {
    for (let i = 0; i < (r[pos] ?? 0); i++) out.push(pos);
  }
  for (let i = 0; i < (r.BN ?? 0); i++) out.push("BN");
  return out;
}

/* My Calls: a personal dollar nudge on a player's board value. Stored per player
 * in doc.calls as {pid, delta}; set from the player popup. */
function callOf(pid) {
  const c = (doc.calls || []).find((x) => x.pid === pid);
  return c ? (c.delta || 0) : 0;
}

/* the base (un-nudged) our$ for a player, from the latest real run */
function baseValueOf(pid) {
  const base = Object.keys(doc.sources).length ? buildRun(mixState().on) : doc.runs[doc.runs.length - 1];
  const bp = base?.players.find((x) => x.player_id === pid);
  return bp ? Math.max(1, Math.round(bp.dollar)) : null;
}

/* set (or clear) a player's call to an absolute dollar delta */
async function setCall(pid, delta) {
  doc.calls = (doc.calls || []).filter((x) => x.pid !== pid);
  if (delta !== 0) doc.calls.push({ pid, delta });
  doc.ui.mix = { ...(doc.ui.mix || {}), calls: doc.calls.length > 0 };
  await saveDoc(doc);
  refreshRoom();
  openModal(pid);
}

/* derive the "blend + My Calls" run on the fly from the latest base run
 * (never persisted; regenerates whenever a call changes). The nudge is a direct
 * dollar delta on our$; the base blend is never touched. */
function deriveCallsRun(base) {
  const delta = {};
  for (const c of (doc.calls || [])) if (c.pid) delta[c.pid] = c.delta || 0;
  const players = base.players.map((p) => {
    const d = delta[p.player_id] || 0;
    return d
      ? { ...p, dollar: Math.max(1, Math.round((p.dollar + d) * 10) / 10) }
      : p;
  });
  return { run_id: "calls", source_label: base.source_label + "+calls",
    as_of: base.as_of, meta: base.meta, players };
}

function buildModel() {
  /* the mixer (V56): the board is the run for the lit sources; My Calls layer on
   * top when lit. Missing mixes are built here, synchronously, and saved. */
  let baseReal = null;
  if (Object.keys(doc.sources).length) {
    const mx = mixState();
    const before = doc.runs.length;
    baseReal = buildRun(mx.on);
    if (doc.runs.length !== before) saveDoc(doc);
    curRun = (mx.calls && baseReal) ? deriveCallsRun(baseReal) : baseReal;
  } else {
    curRun = doc.runs[doc.runs.length - 1] ?? null;
  }
  /* attach a generic, editable plan the first time a run exists (never the
   * author's numbers; derived from the run's own chalk values). */
  if (curRun && doc.league && !doc.league.plan) {
    doc.league.plan = defaultPlan(curRun.players, slotOrder(),
      doc.league.budget);
    saveDoc(doc);
  }
  curSales = activeSales(doc.journal);
  soldSet = new Set(curSales.map((s) => s.pid));
  soldBy = {}; curSales.forEach((s) => { soldBy[s.pid] = s; });
  const mv = doc.market?.values ?? null;
  P = [];
  if (curRun) {
    for (const p of curRun.players) {
      const meta = doc.player_meta[p.player_id] ?? {};
      P.push({ id: p.player_id, name: doc.names[p.player_id] ?? p.player_id,
        pos: p.pos, team: p.team, pts: p.proj_pts, usd: p.dollar,
        tier: p.tier, inj: meta.injury_status, rookie: meta.is_rookie,
        y_avg: mv ? mv[p.player_id] ?? null : null });
    }
    mScale = mv ? marketScale(curRun.players, mv,
      doc.league.teams * doc.league.model_params.dollar_slots_per_team) : 1;
  }
  if (doc.kdef) {
    for (const p of doc.kdef.players) {
      P.push({ id: p.player_id, name: doc.names[p.player_id] ?? p.player_id,
        pos: p.pos, team: p.team, pts: p.pts, usd: null, tier: null,
        y_avg: mv ? mv[p.player_id] ?? null : null, kd: true });
    }
  }
  byId = {}; P.forEach((p) => { byId[p.id] = p; });
}

const dealOf = (p) => (doc.market && p.usd != null && p.y_avg != null)
  ? p.usd - p.y_avg * mScale : null;

/* ledger states in the original's field names */
function oStates() {
  return ownerStates(doc.league, curSales).map((o) => ({
    id: o.idx, name: o.name, is_me: o.idx === ME(), spent: o.spent,
    left: o.remaining, open: o.spotsLeft, max: o.maxBid }));
}

/* inflation, ported: money over owners with open spots, value over the
 * top spotsLeft unsold players */
function inflation() {
  const os = oStates();
  const money = os.reduce((a, o) => a + (o.open > 0 ? o.left : 0), 0);
  const spotsLeft = os.reduce((a, o) => a + Math.max(o.open, 0), 0);
  const vals = P.filter((p) => !soldSet.has(p.id))
    .map((p) => Math.max(p.usd || 1, 1)).sort((a, b) => b - a)
    .slice(0, spotsLeft);
  const value = vals.reduce((a, b) => a + b, 0);
  return { money, value, ratio: value > 0 ? money / value : 1 };
}

function ownerNeedMap() {
  const r = doc.league.full_roster;
  const base = { QB: r.QB ?? 0, RB: r.RB ?? 0, WR: r.WR ?? 0, TE: r.TE ?? 0,
    FLX: r.FLEX ?? 0, K: r.K ?? 0, DEF: r.DEF ?? 0, BN: r.BN ?? 0 };
  const map = {};
  owners().forEach((o) => { map[o.id] = { ...base }; });
  curSales.forEach((s) => {
    const p = byId[s.pid]; if (!p) return;
    const n = map[s.owner]; if (!n) return;
    if (n[p.pos] > 0) n[p.pos]--;
    else if (["RB", "WR", "TE"].includes(p.pos) && n.FLX > 0) n.FLX--;
    else n.BN--;
  });
  return map;
}

/* unsold auction values per position, sorted high to low (plan ceilings) */
function unsoldByPos() {
  const out = { QB: [], RB: [], WR: [], TE: [], K: [], DEF: [] };
  for (const p of P) {
    if (soldSet.has(p.id) || p.usd == null) continue;
    if (out[p.pos]) out[p.pos].push(Math.max(1, Math.round(p.usd)));
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => b - a);
  return out;
}

/* my live plan state (envelopes water-filled to remaining budget). Owner 0 is
 * always "me" (team_names[0]); ported from the personal tool's is_me model. */
function planState() {
  const mine = curSales.filter((s) => s.owner === 0)
    .map((s) => ({ pos: (byId[s.pid] || {}).pos || s.pos, price: s.price,
      name: s.name }));
  const plan = doc.league.plan || null;
  return myPlanState({
    env: plan ? plan.envelopes : null,
    purseCfg: plan ? plan.purse : null,
    floatTarget: plan ? plan.float_target : null,
    budget: doc.league.budget,
    mine, slotLabels: slotOrder(), unsoldByPos: unsoldByPos(),
  });
}

/* BeerSheets-style surplus shading (ported, incl. sqrt scale) */
function surplusBg(ourVal, price) {
  const d = (ourVal == null ? 1 : ourVal) - price;
  if (Math.abs(d) < 0.5) return "";
  const t = Math.sqrt(Math.min(Math.abs(d), 20) / 20);
  const dark = (document.documentElement.dataset.theme || "").startsWith("dark");
  const a = (dark ? 0.08 : 0.05) + t * (dark ? 0.40 : 0.36);
  return d > 0
    ? (dark ? `rgba(102,189,143,${a.toFixed(2)})` : `rgba(13,107,70,${a.toFixed(2)})`)
    : (dark ? `rgba(224,133,99,${a.toFixed(2)})` : `rgba(166,58,48,${a.toFixed(2)})`);
}

function stampShow(big, small) {
  const s = $("#stamp");
  s.innerHTML = `${big}<small>${small}</small>`;
  s.classList.remove("show"); void s.offsetWidth; s.classList.add("show");
  clearTimeout(s._t); s._t = setTimeout(() => s.classList.remove("show"), 1600);
}

/* ---------------- board columns (ported) ---------------- */

function addRow(p, target, kdef) {
  const sold = soldSet.has(p.id), sale = soldBy[p.id];
  const winner = sale && owners()[sale.owner];
  const mine = winner && winner.is_me;
  const edge = dealOf(p);
  const row = el("div", "row " + (kdef ? "grid-kdef" : "grid-skill")
    + (sold ? (mine ? " sold mine" : " sold") : "")
    + (p.id === stagedId && !sold ? " staged" : ""));
  row.dataset.id = p.id;
  if (sold) row.style.background = surplusBg(kdef ? 1 : p.usd, sale.price);
  if (kdef) {
    /* K/DEF sold rows show the price + buyer (there is no our$ to keep) */
    row.innerHTML = `<span class="nm">${p.name}</span>`
      + (sold ? `<span class="mkt">${fmt$(sale.price)} ${short(winner)}</span>`
        : `<span class="mkt">${p.y_avg != null ? fmt$(p.y_avg) : "$1"}</span>`);
  } else {
    /* skill rows always show bid$ / +/- / my$; a sold row keeps my value
     * (struck through + surplus tint), the buyer shows in the popup (V53) */
    const bid = p.y_avg != null ? "$" + Math.round(p.y_avg * mScale) : "";
    const cd = callOf(p.id);
    row.innerHTML =
      `<span class="tier">${p.tier ?? ""}</span>`
      + `<span class="nm">${p.name}<span class="tm">${p.team || ""}</span>`
      + (p.inj ? `<span class="inj" title="${p.inj}">+</span>` : "")
      + (p.rookie ? `<span class="rk" title="rookie">R</span>` : "")
      + (isFav(p.id) ? `<span class="favm" title="favorite">&#9733;</span>` : "")
      + (cd ? `<span class="callm ${cd > 0 ? "up" : "dn"}" title="your call: ${cd > 0 ? "+" : ""}${cd}">${cd > 0 ? "+" : ""}${cd}</span>` : "") + `</span>`
      + `<span class="pts" title="estimated bid the room pays: your market source's average x the money-supply scale (x${mScale.toFixed(2)})">${bid}</span>`
      + `<span class="edge ${edge == null ? "" : Math.round(edge) > 0 ? "up" : Math.round(edge) < 0 ? "dn" : ""}" title="${edge == null ? "" : edge > 0 ? "a $" + Math.round(edge) + " deal vs the expected bid" : "$" + Math.round(-edge) + " over my value"}">${edge == null ? "" : (Math.round(edge) > 0 ? "+" : "") + Math.round(edge)}</span>`
      + `<span class="usd">${fmt$(p.usd)}</span>`;
  }
  /* single click = popup; double click = nominate (ported timing trick) */
  row.onclick = () => {
    if (sold) { openModal(p.id); return; }
    clearTimeout(row._t);
    row._t = setTimeout(() => openModal(p.id), 260);
  };
  row.ondblclick = () => { if (!sold) { clearTimeout(row._t); pick(p.id); } };
  target.appendChild(row);
}

/* any column can collapse to a slim vertical strip (persisted, ported) */
function toggleCol(key) {
  colMin[key] = !colMin[key];
  localStorage.setItem("ls-colmin", JSON.stringify(colMin));
  renderBoard();
}
function minCol(key, labelHtml, sub) {
  const col = el("div", "poscol min");
  col.title = "expand column";
  col.innerHTML = `<span class="minlab">${labelHtml}${sub ? ` <small>${sub}</small>` : ""}</span>`;
  col.onclick = () => toggleCol(key);
  return col;
}

function skillCol(pos) {
  if (colMin[pos]) {
    const left = P.filter((p) => p.pos === pos && !soldSet.has(p.id)
      && (p.usd || 0) >= 2).length;
    return minCol(pos, `<b class="${posClass(pos)}">${pos}</b>`, `${left} left`);
  }
  const col = el("div", "poscol");
  const base = curRun.meta.baselines[pos] ?? "";
  col.innerHTML =
    `<div class="colhead"><div class="t1"><span class="${posClass(pos)}" title="Position column. Values are computed against replacement baseline ${pos}${base}: the best player assumed freely available.">${pos}</span><button class="colbtn" title="collapse this column to a slim strip">&#171;</button></div>
     <div class="t2 grid-skill"><span title="tier: players whose values sit within noise of each other. A tier ends once value has fallen 20% below that tier's own top - one rule that catches both hard cliffs and slow slides. The horizontal rule marks each break.">T</span><span>player</span>
       <span class="pts sortable${sortBy === "bid" ? " on" : ""}" data-sort="bid" title="estimated bid the room pays: your market source's average salary, rescaled to your league's money supply. Blank until you add market values. CLICK to sort by bid.">Bid$</span>
       <span class="edge sortable${sortBy === "deal" ? " on" : ""}" data-sort="deal" title="my$ minus bid$. GREEN (+) a deal: worth more to me than the room pays. RED (-) the room pays past my value. Blank without market values. CLICK to sort by deal.">+/-</span>
       <span class="r sortable${sortBy === "usd" ? " on" : ""}" data-sort="usd" title="my auction value for this league: the most you should be willing to pay. CLICK to sort by value.">My$</span></div></div>`;
  col.querySelector(".colbtn").onclick = (e) => {
    e.stopPropagation(); toggleCol(pos);
  };
  col.querySelectorAll(".sortable").forEach((s) => {
    s.onclick = (e) => { e.stopPropagation(); sortBy = s.dataset.sort;
      localStorage.setItem("ls-sort", sortBy); renderBoard(); };
  });
  const wrap = el("div", "rows");
  let group = P.filter((p) => p.pos === pos && p.usd != null);
  group.sort((a, b) => b.usd - a.usd);
  if (sortBy === "deal") {
    group = [...group].sort((a, b) =>
      ((dealOf(b) ?? -999) - (dealOf(a) ?? -999)));
  }
  if (sortBy === "bid") {                 // bid = my$ minus the deal, so no market field needed
    const bid = (p) => (dealOf(p) == null ? -1 : p.usd - dealOf(p));
    group = [...group].sort((a, b) => bid(b) - bid(a));
  }
  const above = group.filter((p) => (p.usd || 0) >= 2);
  const free = group.filter((p) => (p.usd || 0) < 2);
  let lastTier = null;
  const rowWithTier = (p, target) => {
    addRow(p, target, false);
    if (sortBy !== "deal" && sortBy !== "bid" && p.tier !== lastTier && lastTier !== null) {
      target.lastChild.classList.add("t-open");
    }
    lastTier = p.tier;
  };
  above.forEach((p) => rowWithTier(p, wrap));
  col.appendChild(wrap);
  if (free.length) {
    const bar = el("div", "freebar");
    bar.title = "the replacement line: everyone below prices at $1 - never bid $2";
    bar.innerHTML = `<span></span>&#9660; FREE &#9660;<span></span>`;
    col.appendChild(bar);
    if (freeExpanded[pos]) {
      const tail = el("div", "rows");
      free.forEach((p) => rowWithTier(p, tail));
      col.appendChild(tail);
    }
    const more = el("button", "more",
      freeExpanded[pos] ? "- collapse" : `+ ${free.length} more..`);
    more.onclick = (e) => { e.stopPropagation();
      freeExpanded[pos] = !freeExpanded[pos]; renderBoard(); };
    col.appendChild(more);
  }
  return col;
}

function kdefCol() {
  if (colMin.KDEF) {
    return minCol("KDEF", `<b class="pK">K</b>/<b class="pDEF">DEF</b>`, "$1");
  }
  const col = el("div", "poscol");
  col.innerHTML =
    `<div class="colhead"><div class="t1">
       <span class="kd pK${kdefView === "K" ? " on" : ""}" data-kd="K" title="show kickers">K</span> /
       <span class="kd pDEF${kdefView === "DEF" ? " on" : ""}" data-kd="DEF" title="show defenses">DEF</span>
       <small title="the model prices every K and DEF at $1">$1 rule</small>
       <button class="colbtn" title="collapse this column to a slim strip">&#171;</button></div>
     <div class="t2 grid-kdef"><span>player</span><span class="r" title="market average salary, when you have pasted values">Mkt$</span></div></div>`;
  col.querySelector(".colbtn").onclick = (e) => {
    e.stopPropagation(); toggleCol("KDEF");
  };
  col.querySelectorAll(".kd").forEach((s) => {
    s.onclick = (e) => { e.stopPropagation(); kdefView = s.dataset.kd;
      localStorage.setItem("ls-kdef", kdefView); renderBoard(); };
  });
  const wrap = el("div", "rows");
  P.filter((p) => p.pos === kdefView)
    .sort((a, b) => (b.y_avg || b.pts || 0) - (a.y_avg || a.pts || 0))
    .slice(0, 34)
    .forEach((p) => addRow(p, wrap, true));
  col.appendChild(wrap);
  return col;
}

function renderBoard() {
  const board = $("#board");
  if (!board) return;
  board.innerHTML = "";
  const hasKdef = doc.kdef && doc.kdef.players.length;
  const weights = { QB: "1fr", RB: "1.05fr", WR: "1.05fr", TE: "1fr",
    KDEF: ".55fr" };
  const keys = hasKdef ? [...POSITIONS, "KDEF"] : [...POSITIONS];
  board.style.gridTemplateColumns =
    keys.map((k) => colMin[k] ? "30px" : weights[k]).join(" ");
  POSITIONS.forEach((pos) => board.appendChild(skillCol(pos)));
  if (hasKdef) board.appendChild(kdefCol());
}

/* ---------------- rail renders (ported) ---------------- */

function renderOwners() {
  const os = [...oStates()].sort((a, b) => b.left - a.left);
  $("#ownerbody").innerHTML = os.map((o) =>
    `<div class="orow${o.is_me ? " me" : ""}${o.max <= 1 ? " out" : ""}">
      <span>${o.name}</span>
      <span class="m g">$${o.left}</span>
      <span class="m">$${Math.max(o.max, 0)}</span>
      <span class="sp">${o.open}</span></div>`).join("");
  renderOwnerGrid();
}

function renderOwnerGrid() {
  const grid = $("#ogrid");
  if (!grid) return;
  const os = oStates();
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "="];
  grid.innerHTML = os.map((o, i) => {
    const fcls = ownerFilter
      ? (o.name.toLowerCase().startsWith(ownerFilter) ? " hit" : " dim") : "";
    return `<button class="obtn${o.is_me ? " me" : ""}${o.max <= 1 ? " out" : ""}${selOwner === o.id ? " selected" : ""}${fcls}"
      data-oid="${o.id}" title="${o.name}: $${o.left} bank, max bid $${o.max} (key: ${keys[i] ?? ""})">${o.name}</button>`;
  }).join("")
    + (ownerFilter ? `<div id="ofilter">${ownerFilter}</div>` : "");
  grid.querySelectorAll(".obtn").forEach((b) =>
    b.onclick = () => selectOwner(+b.dataset.oid));
}

function ownerSlots(oid) {
  const theirs = curSales.filter((s) => s.owner === oid)
    .map((s) => ({ ...(byId[s.pid] ?? { name: s.name, pos: s.pos }),
      price: s.price }));
  const slots = slotOrder().map((l) => ({ lab: l, who: null, price: null }));
  const fits = { QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"], K: ["K"],
    DEF: ["DEF"] };
  theirs.forEach((p) => {
    const s = slots.find((x) => !x.who && (fits[p.pos] || []).includes(x.lab))
      || (["RB", "WR", "TE"].includes(p.pos)
        ? slots.find((x) => !x.who && x.lab === "FLX") : null)
      || slots.find((x) => !x.who && x.lab === "BN");
    if (s) { s.who = p; s.price = p.price; }
  });
  return { slots, spent: theirs.reduce((a, p) => a + p.price, 0) };
}

function renderRoster() {
  const viewId = rosterView ?? 0;
  const sel = $("#rostersel");
  if (document.activeElement !== sel) {
    sel.innerHTML = owners().map((o) =>
      `<option value="${o.id}">${o.is_me ? "My Roster" : o.name}</option>`)
      .join("");
    sel.value = String(viewId);
  }
  /* another team's roster: filled slots + money left, no plan projections */
  if (viewId !== 0) {
    const os = ownerSlots(viewId);
    const oleft = doc.league.budget - os.spent;
    $("#roster").innerHTML = os.slots.map((s) =>
      `<div class="slot${s.who ? " filled" : ""}"><span class="lab ${posClass(s.lab)}">${s.lab}</span>
        <span class="who">${s.who ? s.who.name : ""}</span>
        <span class="pr">${s.who ? fmt$(s.price) : ""}</span></div>`).join("")
      + `<div class="slot"><span class="lab"></span><span class="who">left</span>
         <span class="pr" title="spent $${os.spent} of $${doc.league.budget}">${fmt$(oleft)}</span></div>`;
    return;
  }
  /* my roster: envelopes water-filled to remaining budget + purse row */
  const ps = planState();
  $("#roster").innerHTML = ps.slots.map((s) =>
    `<div class="slot${s.who ? " filled" : ""}"><span class="lab ${posClass(s.lab)}">${s.lab}</span>
      <span class="who">${s.who ? s.who.name : ""}</span>
      <span class="pr">${s.who ? fmt$(s.price)
      : (ps.hasPlan
        ? (s.lab === "BN"
          ? `<span class="pl" title="estimated budget left for this bench spot as the plan flexes">~${fmt$(s.eff ?? ps.benchPer)}</span>`
          : `<span class="pl ${posClass(s.lab)}" title="plan for this slot: $${s.planned}${s.eff != null && s.eff !== s.planned ? " - flexed to your remaining budget (grows when you bank deals, shrinks when you overspend)" : ""}, capped at the best remaining value for the slot">~${fmt$(s.eff ?? s.planned)}</span>`)
        : "")}</span></div>`).join("")
    + `<div class="slot"><span class="lab"></span><span class="who">left</span>
       <span class="pr" title="spent $${ps.spent} of $${doc.league.budget}">${fmt$(ps.left)}</span></div>`;
}

function renderChips() {
  const inf = inflation();
  const infEl = $("#infl");
  infEl.className = "chip"
    + (inf.ratio > 1.12 || inf.ratio < 0.88 ? " hot" : "");
  const pct = Math.max(2, Math.min(98, (inf.ratio - 0.6) / 0.8 * 100));
  infEl.innerHTML = `<span class="lab">inflation</span>
    <span class="cval"><b>${inf.ratio.toFixed(2)}</b>
    <span class="g">$${inf.money}</span><span>/ $${Math.round(inf.value)}</span></span>
    <span class="gauge" title="dot vs center tick: right of center = money-rich room (overpays coming), left = money drying up (deals coming)"><i style="left:${pct.toFixed(1)}%"></i></span>`;
  const last = curSales[curSales.length - 1];
  if (last) {
    $("#lastchip").innerHTML = `<span class="lab">last sale</span>
      <span class="cval"><b>${last.name}</b><span class="g">${fmt$(last.price)}</span><span>${short(owners()[last.owner])}</span></span>`;
  } else {
    $("#lastchip").innerHTML = `<span class="lab">last sale</span><b>none yet</b>`;
  }
  const sel = $("#leaguesel");
  if (sel) {
    const L = doc.league;
    sel.title = `${L.teams} teams x $${L.budget}` +
      (doc.market ? `; market scale ${mScale.toFixed(2)}` : "") + ". Switch or add a league.";
  }
}

/* ---------------- favorites ----------------
 * Players you starred from the research popup, listed high value first. Unsold
 * ones first, then any that have already sold (dimmed). */
function renderFavorites() {
  const box = $("#favlist");
  if (!box) return;
  const items = (doc.favorites || [])
    .map((pid) => byId[pid]).filter(Boolean)
    .sort((a, b) => (soldSet.has(a.id) - soldSet.has(b.id))
      || ((b.usd || 0) - (a.usd || 0)));
  $("#favcount").textContent = items.length ? ` (${items.length})` : "";
  $("#favcaret").style.transform = flaggedOpen ? "rotate(90deg)" : "";
  box.style.display = flaggedOpen ? "" : "none";
  if (!flaggedOpen) return;
  const shown = notesExpanded ? items : items.slice(0, 30);
  box.innerHTML = (shown.map((p) => {
    const sold = soldSet.has(p.id);
    return `<button class="favrow${sold ? " out" : ""}" data-id="${p.id}">
      <span class="star">&#9733;</span>
      <span class="n">${p.name}<span class="tm ${posClass(p.pos)}">${p.pos}</span></span>
      <span class="d">${p.usd != null ? fmt$(p.usd) : "$1"}</span></button>`;
  }).join("")
    + (items.length > 30
      ? `<button class="more" id="favmore" style="padding:6px 2px">${notesExpanded ? "- collapse" : `+ ${items.length - 30} more...`}</button>` : ""))
    || `<div style="color:var(--faint);font-size:12px">no favorites yet. Open a player and tap the star to add one.</div>`;
  box.querySelectorAll(".favrow").forEach((b) =>
    b.onclick = () => openModal(b.dataset.id));
  const nm = $("#favmore");
  if (nm) nm.onclick = () => { notesExpanded = !notesExpanded; renderFavorites(); };
}

/* ---------------- positional pressure strip (deterministic, ported) ----------
 * Per position, need/left = starter slots still unfilled league-wide vs
 * startable ($5+) players remaining. Amber = window closing, red = crunch. */
function renderFlow() {
  const flow = $("#flow");
  if (!flow) return;
  const n = curSales.length;
  const runPos = new Set();
  if (n >= 4) {
    const last6 = curSales.slice(-6).map((s) => (byId[s.pid] || {}).pos);
    const counts = {};
    last6.forEach((pp) => { counts[pp] = (counts[pp] || 0) + 1; });
    for (const [pos, c] of Object.entries(counts)) {
      if (c >= 4 && POSITIONS.includes(pos)) runPos.add(pos);
    }
  }
  const needs = ownerNeedMap();
  const cells = POSITIONS.map((pos) => {
    const demand = Object.values(needs).reduce((a, x) => a + x[pos], 0);
    const supply = P.filter((p) => p.pos === pos && !soldSet.has(p.id)
      && (p.usd || 0) >= 5).length;
    const margin = supply - demand;
    const cls = demand > supply ? " crunch" : margin <= 2 ? " tight" : "";
    const run = runPos.has(pos)
      ? `<i class="runmark" title="${pos} run: 4+ of the last 6 sales">&#9650;</i>` : "";
    const iNeed = needs[ME()][pos] > 0
      || (["RB", "WR", "TE"].includes(pos) && needs[ME()].FLX > 0);
    const dot = cls ? `<i class="mdot ${iNeed ? "exposed" : "exploit"}"></i>` : "";
    const stance = !cls ? ""
      : iNeed ? " YOU STILL NEED THIS SLOT: act before the music stops; do not nominate your own target."
        : " Your slot is filled: nominate this position to drain the needers' budgets.";
    const state = demand > supply ? " - CRUNCH: someone goes without; the last startable ones sell at a premium."
      : margin <= 2 ? " - window closing." : "";
    return `<span class="fcell${cls}" title="${pos}: ${demand} starter slots still needed league-wide vs ${supply} startable ($5+) players left${state}${stance}${runPos.has(pos) ? " RUN in progress: wait out your target or feed it a player you don't want." : ""}">`
      + `<span class="${posClass(pos)}">${pos}</span><b>${demand}/${supply}</b>${dot}${run}</span>`;
  });
  const extras = [];
  const hoard = oStates().filter((o) => !o.is_me && o.left >= 100 && o.open <= 9)
    .sort((a, b) => b.left - a.left);
  const spots = doc.league.teams * rosterSpots(doc.league.full_roster);
  if (n > spots * 0.2 && hoard.length) {
    extras.push(`<span class="fcell tight" title="cash hoarders strike late: your cheap deals will get contested by these wallets">hoard <b>${hoard.slice(0, 2).map((o) => `${o.name} $${o.left}`).join(", ")}</b></span>`);
  }
  if (n >= 20) {
    const ps = planState();
    const startersFilled = ps.slots.filter((s) => s.starter && s.who).length;
    const nStart = ps.slots.filter((s) => s.starter).length;
    const pace = n / spots;
    if (nStart > 0 && startersFilled / nStart < pace - 0.25) {
      extras.push(`<span class="fcell crunch" title="${Math.round(pace * 100)}% of the draft is sold and you hold ${startersFilled} of ${nStart} starters: discipline is becoming stranding - start winning bids">pace <b>${startersFilled}/${nStart}</b></span>`);
    }
  }
  flow.innerHTML = cells.join("") + extras.join("");
}

/* ---------------- teams grid (ported) ---------------- */
function renderTeams() {
  const box = $("#teams");
  if (!box) return;
  const os = oStates();
  box.innerHTML = `<div id="tgrid">` + owners().map((o) => {
    const st = os.find((x) => x.id === o.id);
    const tiles = curSales.filter((s) => s.owner === o.id).map((s) => {
      const p = byId[s.pid]; if (!p) return "";
      return `<div class="ttile posbg-${p.pos}" data-id="${p.id}">
        <div class="tn ${posClass(p.pos)}">${p.name}</div>
        <div class="tmeta"><span><span class="${posClass(p.pos)}">${p.pos}</span> &middot; ${p.team || ""}</span><b>$${s.price}</b></div></div>`;
    }).join("");
    return `<div class="tcol${o.is_me ? " meCol" : ""}">
      <div class="thead">${o.is_me ? "You" : o.name}<small>$${st.left} left &middot; ${st.open} open</small></div>
      ${tiles}</div>`;
  }).join("") + `</div>`;
  box.querySelectorAll(".ttile").forEach((t) =>
    t.onclick = () => openModal(t.dataset.id));
}

function applyTab() {
  const b = $("#board"), t = $("#teams");
  if (!b || !t) return;
  b.style.display = boardTab === "board" ? "grid" : "none";
  t.style.display = boardTab === "teams" ? "block" : "none";
  document.querySelectorAll(".btab").forEach((x) =>
    x.classList.toggle("on", x.dataset.tab === boardTab));
}

/* ---------------- sale flow (ported) ---------------- */

const normName = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "");

function search(qs) {
  const q = normName(qs);
  if (!q) return [];
  return P.filter((p) => !soldSet.has(p.id) && normName(p.name).includes(q))
    .sort((a, b) => ((b.usd || b.y_avg || 0) - (a.usd || a.y_avg || 0)))
    .slice(0, 8);
}

function renderHits() {
  $("#hits").innerHTML = hitList.map((p, i) =>
    `<button class="hit${i === hitSel ? " sel" : ""}" data-id="${p.id}">
      <span class="p">${p.pos}</span><span class="n">${p.name} ${p.team || ""}</span>
      <span class="d">${p.usd != null ? fmt$(p.usd) : "$1"}</span></button>`)
    .join("");
  $("#hits").querySelectorAll(".hit").forEach((b) =>
    b.onclick = () => pick(b.dataset.id));
}

function pick(pid) {
  picked = byId[pid]; selOwner = null; ownerFilter = "";
  hitList = []; renderHits(); $("#q").value = "";
  const p = picked;
  $("#picked").style.display = "block";
  $("#picked").innerHTML = `<div class="pnm">${p.name} <span class="${posClass(p.pos)}">${p.pos}</span> <span style="color:var(--faint)">${p.team || ""}</span>${p.inj ? ' <span style="color:var(--bad);font-size:12px">' + p.inj + "</span>" : ""}</div>`;
  $("#price").value = ""; $("#msg").textContent = "";
  renderCall(p);
  stageCopilot(p);
  stagedId = p.id;
  document.querySelectorAll(".row.staged").forEach((r) =>
    r.classList.remove("staged"));
  const br = document.querySelector(`.row[data-id="${p.id}"]`);
  if (br) br.classList.add("staged");
  renderOwnerGrid(); updateSummary();
  $("#price").focus();
}

/* the call: deterministic advisor (ported, now plan-aware). Synthesizes every
 * live metric plus the plan envelopes into one verdict + max price. Pure logic
 * over the same numbers on screen: traceable, instant, works offline (R1). */
function advise(p) {
  const ps = planState();
  const fit = planFit(p, ps);
  const inf = inflation();
  const deal = dealOf(p);
  const est = (doc.market && p.y_avg != null)
    ? Math.max(1, Math.round(p.y_avg * mScale * inf.ratio)) : null;
  const val = p.usd != null ? Math.max(1, Math.round(p.usd)) : 1;
  let worth = val;   /* the displayed value; K/DEF override it with the plan */
  const myMax = oStates().find((o) => o.is_me).max;
  const reasons = [];

  let comparable = null, drop = null;
  if (POSITIONS.includes(p.pos) && p.usd != null) {
    const peers = P.filter((x) => x.pos === p.pos && !soldSet.has(x.id)
      && x.id !== p.id && x.usd != null);
    comparable = peers.filter((x) => x.usd >= p.usd - 5).length;
    const below = peers.filter((x) => x.usd < p.usd - 5)
      .sort((a, b) => b.usd - a.usd)[0];
    drop = below ? Math.round(p.usd - below.usd) : null;
  }
  const needs = ownerNeedMap();
  const contest = oStates().filter((o) => !o.is_me
    && o.max > Math.max(est || 2, 2)
    && (needs[o.id][p.pos] > 0
      || (["RB", "WR", "TE"].includes(p.pos) && needs[o.id].FLX > 0))).length;

  /* envelope status rows for the eligible open slots (mirrors My Roster) */
  const elig = ["K", "DEF"].includes(p.pos) ? [] : ps.openStarters.filter((s) =>
    s.lab === p.pos
    || (s.lab === "FLX" && ["RB", "WR", "TE"].includes(p.pos)));
  /* roster-aware: his own starter slot is already filled and the only open fit
   * is your FLX, a slot an RB or WR fills just as well. His position's market
   * scarcity is not YOUR cliff, so it must not force LAST CHANCE (ADR-0010). */
  const flexOnly = elig.length > 0 && elig.every((s) => s.lab === "FLX");

  let cls, label, max, planCap, envMax = val;
  if (p.pos === "K" || p.pos === "DEF") {
    /* no hardcoded $1 rule: K/DEF spend is the owner's call, set by the budget
     * plan's own allocation for the slot (ADR-0011). No plan -> a soft $1. */
    const kslot = ps.slots.find((s) => s.lab === p.pos && !s.who);
    const envK = ps.hasPlan
      ? Math.max(1, kslot ? (kslot.eff ?? kslot.planned ?? 1) : 1) : 1;
    worth = envK; max = envK; planCap = Math.min(envK, myMax);
    cls = "value"; label = "FAIR VALUE";
    reasons.push(ps.hasPlan
      ? `your budget plan sets ~$${envK} here`
      : "late-round spot; ~$1 is typical unless your plan says otherwise");
  } else if (fit && fit.bench) {
    cls = "pass"; label = "BENCH ONLY"; max = Math.min(2, myMax);
    planCap = Math.max(1, Math.min(ps.benchPer, myMax));
    reasons.push((ps.benchOpen > 0
      ? "no starting slot open for him; bench money ~$" + ps.benchPer
        + " across " + ps.benchOpen + " spot" + (ps.benchOpen === 1 ? "" : "s")
      : "no roster spot open for him")
      + (ps.openStarters.length ? "; starters still open: "
        + ps.openStarters.map((s) => s.lab).join(" ") : ""));
  } else {
    envMax = fit ? fit.max : val;
    planCap = Math.min(envMax, myMax);
    /* the scarcity cliff only creates urgency for a slot you still need; when
     * he can only take your FLX it does not, so flexOnly suppresses it */
    const cliffPressure = !flexOnly && comparable != null && comparable <= 2
      && contest >= 2 && (drop == null || drop >= 8);
    if (deal != null && deal <= -4 && !cliffPressure) {
      cls = "pass"; label = "LET HIM GO"; max = Math.min(val, envMax);
    } else if (cliffPressure) {
      cls = "last"; label = "LAST CHANCE"; max = val;
      reasons.push(`only ${comparable} comparable ${p.pos}${comparable === 1 ? "" : "s"} left`
        + (drop != null ? ` before a $${drop} drop` : "")
        + ` and ${contest} funded owners still need one; paying full value is correct here`);
    } else if (deal != null && deal >= 2) {
      cls = "target"; label = "TARGET"; max = Math.min(val, envMax);
    } else {
      cls = "value"; label = "FAIR VALUE"; max = Math.min(val, envMax);
    }
    if (flexOnly) {
      reasons.push(`your ${p.pos} is filled; he only fits your FLX, or bench`);
    }
    if (comparable != null && !cliffPressure) {
      reasons.push(`${comparable} comparable ${p.pos}${comparable === 1 ? "" : "s"} left, `
        + `${contest} funded owner${contest === 1 ? "" : "s"} fighting for them`);
    }
  }
  if (inf.ratio > 1.1) {
    reasons.push(`money-rich room (x${inf.ratio.toFixed(2)}): expect ~${Math.round((inf.ratio - 1) * 100)}% overpays`);
  } else if (inf.ratio < 0.9) {
    reasons.push(`money drying up (x${inf.ratio.toFixed(2)}): patience is being paid`);
  }
  if (p.inj) reasons.push("injury status: " + p.inj);
  /* when the actionable ceiling sits below his value, say WHY in plain words
   * rather than a bare "capped": it is either his roster fit or your budget */
  const finalMax = Math.max(1, Math.min(max, myMax));
  let ceilWhy = "";
  if (finalMax < worth) {
    ceilWhy = myMax < max ? "the budget you have left"
      : (fit && fit.bench) ? "bench only, no starter slot open"
      : flexOnly ? "FLX and reserve money, hold your RB and WR options"
      : "your plan's room for this slot";
  }
  return { cls, label, max: finalMax, worth, ceilWhy,
    planCap, benchPer: ps.benchPer, benchOpen: ps.benchOpen, est, reasons,
    elig };
}

function renderCall(p) {
  const a = advise(p);
  const slotRows = a.elig.length
    ? `<div class="cslots">${a.elig.map((s) =>
      `<div class="srow"><span class="lab ${posClass(s.lab)}">${s.lab}</span>
       <span class="pl ${posClass(s.lab)}">~${fmt$(s.eff ?? s.planned)}</span></div>`).join("")}</div>`
    : (POSITIONS.includes(p.pos) && a.benchOpen > 0 && a.benchPer > 0
      ? `<div class="cslots"><div class="srow"><span class="lab">BN</span>
         <span class="pl">~${fmt$(a.benchPer)}</span></div></div>`
      : "");
  $("#call").style.display = "block";
  const ceilLine = a.max < a.worth
    ? `<div class="cceil">spend up to <b>$${a.max}</b> <small>${a.ceilWhy}</small></div>`
    : "";
  $("#call").innerHTML = `<span class="cverdict ${a.cls}">${a.label}</span>
    <div class="cmax" title="my value for this player: the break-even. Past this you provably overpaid.">worth <b>$${a.worth}</b></div>
    ${ceilLine}
    ${a.est ? `<div class="cest">room bids <b>~$${a.est}</b></div>` : ""}
    ${slotRows}
    <ul>${a.reasons.slice(0, 5).map((r) => `<li>${r}</li>`).join("")}</ul>`;
}

/* ---------------- AI live read (self-host only, gated) ----------------
 * The hosted app ships with config.AI_ENDPOINT null, so cp stays null and none
 * of this runs, no #liveread renders, no network call is made. A self-hoster
 * running copilot-server/ sets the endpoint; then the browser posts the same
 * numbers The Call already computed plus a plain-text brief. The read is
 * advisory text beside the numbers and never enters the value math (R1, #5). */
function copilotBrief() {
  const os = oStates();
  const inf = inflation();
  const ps = planState();
  const lines = [];
  lines.push(`${doc.league.teams}-team, $${doc.league.budget} budget. `
    + `${curSales.length} of ${doc.league.teams * rosterSpots(doc.league.full_roster)} sold. `
    + `inflation x${inf.ratio.toFixed(2)} ($${inf.money} chasing $${Math.round(inf.value)}).`);
  lines.push("owners (money / max bid / open): " + os.map((o) =>
    `${o.is_me ? "ME>" : o.name} $${o.left}/$${Math.max(o.max, 0)}/${o.open}`).join("; "));
  const recent = curSales.slice(-6).map((s) =>
    `${s.name} $${s.price} ${short(owners()[s.owner])}`);
  if (recent.length) lines.push("recent sales: " + recent.join(", ") + ".");
  lines.push(`my plan: spent $${ps.spent}, $${ps.left} left, reserve $${ps.purseLeft}/$${ps.purseTarget}, `
    + `open starters ${ps.openStarters.map((s) => s.lab).join(" ") || "none"}.`);
  return lines.join("\n");
}

function rosterFitLine(p) {
  const ps = planState();
  const fit = planFit(p, ps);
  if (!fit) return "";
  if (fit.bench) {
    return `MY ROSTER FIT: bench only for ${p.name} (${p.pos}); `
      + `no open starter slot; bench money ~$${ps.benchPer}.`;
  }
  return `MY ROSTER FIT: ${p.name} (${p.pos}) fits an open starter slot; `
    + `plan allows up to $${Math.round(fit.max)}.`;
}

function stageCopilot(p) {
  if (!cp) return;
  const a = advise(p);
  cp.stage({
    player: { name: p.name, pos: p.pos, our_value: a.worth,
      proj_pts: p.pts, est_bid: a.est },
    call: { verdict: a.label, worth: a.worth, plan_cap: a.planCap,
      room_bids: a.est, reasons: a.reasons.slice(0, 5),
      slots: a.elig.map((s) => ({ slot: s.lab,
        plan: Math.round(s.eff ?? s.planned) })),
      bench_per: a.benchPer, bench_open: a.benchOpen, tags: [] },
    brief: copilotBrief(),
    roster_fit: rosterFitLine(p),
  });
}

function selectOwner(oid) {
  selOwner = oid; ownerFilter = "";
  renderOwnerGrid(); updateSummary();
  $("#sold").focus();
}

function updateSummary() {
  const ready = picked && selOwner != null
    && parseInt($("#price").value, 10) >= 1;
  $("#sold").disabled = !ready;
  if (picked && selOwner != null) {
    const o = owners()[selOwner];
    const pr = parseInt($("#price").value, 10);
    let warn = "";
    if (o.is_me) {
      const ps = planState();
      const fit = planFit(picked, ps);
      if (fit && fit.bench && !["K", "DEF"].includes(picked.pos)
        && ps.openStarters.length) {
        warn = `<br><span style="color:var(--warn);font-weight:700">! bench buy while starters open: ${ps.openStarters.map((s) => s.lab).join(" ")}</span>`;
      } else if (fit && !fit.bench && pr > fit.max) {
        warn = `<br><span style="color:var(--warn);font-weight:700">! $${pr} exceeds plan fit of ${fmt$(fit.max)}</span>`;
      }
    }
    $("#summary").style.display = "block";
    $("#summary").innerHTML = `<b>${picked.name}</b> to <b>${o.name}</b> for <span class="g">${pr >= 1 ? fmt$(pr) : "$?"}</span>${warn}`;
  } else {
    $("#summary").style.display = "none";
  }
}

function resetSale() {
  picked = null; selOwner = null; hitList = []; hitSel = 0; ownerFilter = "";
  stagedId = null;
  if (cp) cp.clear();
  document.querySelectorAll(".row.staged").forEach((r) =>
    r.classList.remove("staged"));
  const ids = ["#picked", "#call", "#summary"];
  ids.forEach((i) => { const n = $(i); if (n) n.style.display = "none"; });
  if ($("#hits")) $("#hits").innerHTML = "";
  if ($("#q")) { $("#q").value = ""; $("#q").focus(); }
  if ($("#msg")) $("#msg").textContent = "";
}

async function commit() {
  if (!picked || selOwner == null) return;
  const price = parseInt($("#price").value, 10);
  if (!price || price < 1) {
    $("#msg").textContent = "enter a price of $1 or more";
    $("#price").focus(); return;
  }
  const p = picked, ow = selOwner;
  appendSale(doc, { pid: p.id, name: p.name, pos: p.pos, owner: ow, price });
  if (!p.kd && (p.usd || 0) < 2) freeExpanded[p.pos] = true;
  await saveDoc(doc);
  stampShow("SOLD", `${p.name} ${fmt$(price)} to ${owners()[ow].name}`);
  resetSale();
  refreshRoom();
  $("#q").focus();
}

/* Reopen the last sale for edits (button, and double-tap Escape while idle).
 * Pops the most recent sale and re-nominates that player with the old price and
 * owner pre-filled, so a wrong price or owner is a quick fix. Replaces the old
 * UNDO LAST: a mis-entry now reopens instead of just vanishing. */
async function reopenLastSale() {
  const last = curSales[curSales.length - 1];
  if (!last) return;
  const pid = last.pid, oldPrice = last.price, oldOwner = last.owner;
  appendUnsale(doc, last.seq);
  await saveDoc(doc);
  refreshRoom();
  if (!byId[pid]) return;
  pick(pid);
  $("#price").value = oldPrice;
  selectOwner(oldOwner);
  $("#price").focus(); $("#price").select();
  stampShow("REOPENED", `${byId[pid].name} back for edits`);
}

/* ---------------- player research popup ---------------- */

function openModal(pid) {
  const p = byId[pid], sale = soldBy[pid];
  /* research popup: only what the board does NOT already show survives here */
  const rows = [["tier", p.tier != null ? p.tier : "-"]];
  if (!sale && p.usd != null) rows.push(["my$", fmt$(Math.round(p.usd))]);
  if (p.y_avg != null) {
    rows.push(["avg auction", fmt$(Math.round(p.y_avg))]);
    rows.push(["est. league bid",
      `${fmt$(Math.round(p.y_avg * mScale))} (x${mScale.toFixed(2)})`]);
    const dl = dealOf(p);
    if (dl != null) {
      const r = Math.round(dl);
      rows.push(["deal", (r >= 0 ? "+" : "-") + "$" + Math.abs(r),
        r >= 0 ? "pos" : "neg"]);
    }
  }
  rows.push(["status", (p.inj || "healthy") + (p.rookie ? " / rookie" : "")]);
  if (sale) {
    rows.unshift(["SOLD",
      fmt$(sale.price) + " to " + owners()[sale.owner].name, "g"]);
    if (p.usd != null) {
      const v = Math.round(p.usd), diff = sale.price - v;
      rows.splice(1, 0, ["my$", fmt$(v)
        + (diff > 0 ? ` (paid +$${diff} over)` : diff < 0 ? ` (-$${-diff} under)` : ""),
        sale.price <= v ? "g" : ""]);
    }
  }
  /* My Call: set your own value for this player, then "Set to $X". Only for
   * skill players and only while unsold. Base value comes from the un-nudged
   * run; the pending value lives in the input until you save. */
  const base = baseValueOf(pid);
  const cd = callOf(pid);
  const calls = (!sale && POSITIONS.includes(p.pos) && base != null)
    ? `<div id="mcalls"><b>MY CALL</b>
        <div class="callset">
          <button class="cstep" id="cdec" title="down $1">-</button>
          <div class="cval"><span class="cd">$</span><input id="callval" type="number" min="1" step="1" value="${base + cd}"></div>
          <button class="cstep" id="cinc" title="up $1">+</button>
        </div>
        <div class="callbtns">
          <button class="ghost" id="callclear" title="clear this call and revert to the model's value">Reset to $${base}</button>
          <button class="primary" id="callsave">Set to $${base + cd}</button>
        </div>
        <div class="chint">Fine tune your value with a fading/boosting override. It is a layer you can switch on or off in the values-from menu, so the base numbers are never touched.</div></div>`
    : "";
  const fav = isFav(pid);
  $("#modal").innerHTML = `<div class="mhead"><div class="mhl">
        <button id="mfav" class="${fav ? "on" : ""}" title="${fav ? "remove from favorites" : "add to favorites"}">&#9733;</button>
        <div class="mhname"><h3>${p.name}</h3>
          <div class="sub">${p.pos} &middot; ${p.team || ""}</div></div></div>
      <button id="mclose" title="close">&times;</button></div>
    <table id="mtable">${rows.map((r) => `<tr><td>${r[0]}</td><td class="${r[2] || ""}">${r[1]}</td></tr>`).join("")}</table>
    ${calls}
    ${!sale ? `<button id="msell">RECORD SALE</button>`
    : `<button id="mrev">REVERSE THIS SALE</button>`}`;
  $("#ovl").style.display = "flex";
  $("#mclose").onclick = () => closeModal();
  $("#mfav").onclick = async () => {
    await toggleFav(pid);
    openModal(pid);        // re-render the star
    renderFavorites();     // update the panel live
  };
  if (calls) {
    const inp = $("#callval");
    const val = () => Math.max(1, Math.round(+inp.value || base));
    const upd = () => {
      $("#callsave").textContent = `Set to $${val()}`;
      $("#callclear").disabled = val() === base;   // nothing to reset at base
    };
    upd();
    $("#cdec").onclick = () => {
      inp.value = Math.max(1, (Math.round(+inp.value) || base) - 1); upd();
    };
    $("#cinc").onclick = () => {
      inp.value = (Math.round(+inp.value) || base) + 1; upd();
    };
    inp.oninput = upd;
    inp.onkeydown = (e) => { if (e.key === "Enter") $("#callsave").click(); };
    $("#callsave").onclick = () => setCall(pid, val() - base);
    $("#callclear").onclick = () => setCall(pid, 0);
  }
  const ms = $("#msell");
  if (ms) ms.onclick = () => { closeModal(); pick(p.id); };
  const mr = $("#mrev");
  if (mr) {
    mr.onclick = async () => {
      appendUnsale(doc, sale.seq);
      await saveDoc(doc);
      closeModal();
      stampShow("REVERSED", `${p.name} back on the board`);
      refreshRoom();
    };
  }
}

function closeModal() {
  $("#ovl").style.display = "none";
  $("#modal").classList.remove("wide");
  if (!picked && $("#q")) $("#q").focus();
}

/* ---------------- plan editor (edit envelopes / variants) ---------------- */

function openPlanEditor() {
  if (!doc.league || !doc.league.plan) {
    alert("Fetch or import projections first; the plan needs a valued board.");
    return;
  }
  const plan = doc.league.plan;
  plan.variants = plan.variants || {};
  /* only the skill-starter envelopes are editable; K/DEF/BN are the purse */
  const keys = Object.keys(plan.envelopes)
    .filter((k) => !["K", "DEF", "BN"].includes(k));
  const rows = keys.map((k) =>
    `<tr><td>${k}</td><td><input class="penv" data-k="${k}" type="number" min="1" step="1" value="${plan.envelopes[k]}" style="width:80px;text-align:right"></td></tr>`)
    .join("");
  const purseVal = plan.purse != null ? plan.purse
    : Math.round((plan.float_target[0] + plan.float_target[1]) / 2) + 6;
  const varOpts = Object.keys(plan.variants).map((v) =>
    `<option value="${v}">${v}</option>`).join("");
  $("#modal").innerHTML = `<h3>Budget plan</h3>
    <div class="sub">stars-and-scrubs envelopes: what you plan to spend per starting slot. These shape The Call's plan-fit and your roster projections; they never touch the value math. The live water-fill flexes them as the draft unfolds.</div>
    ${varOpts ? `<div class="field"><span>Load a saved variant</span><select id="pvar"><option value="">(pick one)</option>${varOpts}</select></div>` : ""}
    <div class="field"><span>Reserve held for bench + K + DEF</span><input id="ppurse" type="number" min="0" step="1" value="${purseVal}" style="width:80px;text-align:right"></div>
    <table id="mtable">${rows}</table>
    <div class="wiznav" style="margin-top:14px;gap:8px;flex-wrap:wrap">
      <button class="ghost tiny" id="planDefault">reset to value default</button>
      <button class="ghost tiny" id="planSaveAs">save as variant...</button>
      <button class="primary" id="planSave">Save plan</button>
    </div>`;
  $("#ovl").style.display = "flex";
  const readInputs = () => {
    document.querySelectorAll(".penv").forEach((inp) => {
      plan.envelopes[inp.dataset.k] = Math.max(1, parseInt(inp.value, 10) || 1);
    });
    const pv = parseInt($("#ppurse").value, 10);
    plan.purse = Number.isFinite(pv) ? pv : null;
  };
  $("#planSave").onclick = async () => {
    readInputs(); await saveDoc(doc); closeModal(); refreshRoom();
  };
  $("#planDefault").onclick = async () => {
    doc.league.plan = { ...defaultPlan(curRun.players, slotOrder(),
      doc.league.budget), variants: plan.variants };
    await saveDoc(doc); closeModal(); openPlanEditor();
  };
  $("#planSaveAs").onclick = async () => {
    const name = (prompt("Name this plan variant:") || "").trim();
    if (!name) return;
    readInputs();
    plan.variants[name] = { envelopes: { ...plan.envelopes },
      purse: plan.purse, float_target: [...plan.float_target] };
    await saveDoc(doc); openPlanEditor();
  };
  const pvar = $("#pvar");
  if (pvar) {
    pvar.onchange = async () => {
      const v = plan.variants[pvar.value];
      if (!v) return;
      plan.envelopes = { ...v.envelopes };
      plan.purse = v.purse;
      plan.float_target = [...v.float_target];
      plan.variant = pvar.value;
      await saveDoc(doc); openPlanEditor();
    };
  }
}

/* ---------------- the room shell ---------------- */

/* ---------------- the mixer (V56, ported from levi-sheet V73) ----------------
 * The chip reads like a select (a mono summary + caret); the menu is the gear
 * menu's rows and switches: one per source, then "+ My Calls" as a layer. */
const SRC_LABEL = { sleeper: "sleeper", fantasypros: "fpros", espn: "espn", cbs: "cbs" };
function renderMixer() {
  const btn = $("#mixbtn"); if (!btn || !curRun) return;
  const all = Object.keys(doc.sources);
  const mx = mixState();
  const on = new Set(mx.on);
  const isAll = all.every((s) => on.has(s));
  const base = (curRun.run_id === "calls") ? buildRun(mx.on) : curRun;
  const runNo = base ? `#${base.run_id}` : "";
  $("#mixsum").innerHTML = (isAll && all.length > 1 ? "blend" : all.filter((s) => on.has(s)).map((s) => SRC_LABEL[s] || s).join(" + "))
    + (mx.calls ? `<span class="calls"> + calls</span>` : "")
    + `<span class="n">${runNo}</span>`;
  $("#mixsrc").innerHTML = all.map((s) =>
    `<button class="gtoggle${on.has(s) ? " on" : ""}" data-src="${s}"><span>${SRC_LABEL[s] || s}</span><span class="sw"><span class="knob"></span></span></button>`).join("");
  const hasCalls = (doc.calls || []).length > 0;
  $("#mixcalls").classList.toggle("on", mx.calls);
  $("#mixcalls").disabled = !hasCalls;
  $("#mixcalls").title = hasCalls ? "your My Calls overrides, applied on top of the average"
    : "no calls yet - single-click a player and set one";
  $("#mixrun").textContent = runNo;
  const menu = $("#mixmenu");
  btn.onclick = (ev) => { ev.stopPropagation(); menu.hidden = !menu.hidden; $("#gearmenu").hidden = true; };
  document.addEventListener("click", (ev) => {
    if (!menu.hidden && !menu.contains(ev.target) && ev.target !== btn && !btn.contains(ev.target)) menu.hidden = true;
  }, { once: true });
  $("#mixsrc").querySelectorAll(".gtoggle").forEach((b) => b.onclick = async (ev) => {
    ev.stopPropagation();
    const next = new Set(mixState().on);
    if (next.has(b.dataset.src)) {
      if (next.size === 1) { stampShow("KEEP ONE", "at least one source stays in the average"); return; }
      next.delete(b.dataset.src);
    } else next.add(b.dataset.src);
    doc.ui.mix = { ...(doc.ui.mix || {}), sources: [...next] };
    await saveDoc(doc); refreshRoom(); $("#mixmenu").hidden = false;
  });
  $("#mixcalls").onclick = async (ev) => {
    ev.stopPropagation();
    if (!hasCalls) return;
    doc.ui.mix = { ...(doc.ui.mix || {}), calls: !mx.calls };
    await saveDoc(doc); refreshRoom(); $("#mixmenu").hidden = false;
  };
  $("#mixadd").onclick = (ev) => { ev.stopPropagation(); menu.hidden = true; importState = { target: "my" }; renderImport(); };
}

function renderBoardScreen() {
  const root = $("#main");
  root.innerHTML = "";
  buildModel();
  renderLeaguePicker();   // league picker under the wordmark, run or no run

  /* masthead line, mirroring the predecessor: run selector + last sale on the
   * left, inflation centered, flow strip on the right (built with the rail) */
  const hl = $("#hleft"), hc = $("#hcenter");
  hl.innerHTML = curRun ? `
    <div class="chip mixchip"><span class="lab">values from</span><button id="mixbtn" title="which projection sources are averaged into every number on the board, plus My Calls as a layer. Click to change."><span id="mixsum">-</span><span class="caret">&#9662;</span></button>
      <div id="mixmenu" class="gearmenu mixmenu" hidden>
        <div class="glab">sources in the average</div>
        <div id="mixsrc"></div>
        <div class="gdiv"></div>
        <div class="glab">layer</div>
        <button class="gtoggle" id="mixcalls" title="your My Calls overrides, applied on top of the average"><span>+ My Calls</span><span class="sw"><span class="knob"></span></span></button>
        <div class="gdiv"></div>
        <button id="mixadd">Add a source...</button>
        <div class="gfoot"><span id="mixrun"></span><span>every mix is a saved run</span></div>
      </div></div>
    <div class="chip" id="lastchip"></div>` : "";
  hc.innerHTML = curRun ? `<div class="chip" id="infl"></div>` : "";
  const hf = $("#flow"); if (hf) hf.innerHTML = "";

  if (!curRun) {
    const empty = el("div", "empty");
    empty.appendChild(el("p", null, "No projections yet. The board needs them."));
    empty.appendChild(projectionCards({ afterSleeper: () => renderBoardScreen() }));
    root.appendChild(empty);
    return;
  }

  const layout = el("div", "layout");
  const boardcol = el("div", "boardcol");
  boardcol.innerHTML = `
    <div id="btabs">
      <button class="btab on" data-tab="board">BOARD</button>
      <button class="btab" data-tab="teams">TEAMS</button>
    </div>
    <div class="boardscroll">
      <div class="cols" id="board"></div>
      <div id="teams" style="display:none"></div>
    </div>`;
  layout.appendChild(boardcol);

  const rail = el("div"); rail.id = "rail";
  rail.innerHTML = `
    <div class="panel">
      <input id="q" placeholder="/Player" autocomplete="off">
      <div id="hits"></div>
      <div id="picked"></div>
      <div id="call"></div>
      ${AI_ENABLED ? '<div id="liveread"></div>' : ""}
      <div id="saleform">
        <div class="steplab">price</div>
        <span style="font-family:var(--mono);color:var(--gold);font-size:17px;font-weight:700">$</span>
        <input id="price" type="number" min="1" step="1" placeholder="0">
        <div id="salegrid">
          <div><h2><select id="rostersel" title="view any team's roster"></select></h2><div id="roster"></div></div>
          <div><div class="steplab">owner</div><div id="ogrid"></div></div>
        </div>
        <div id="summary"></div>
        <button id="sold" disabled>DRAFT</button>
        <div id="msg"></div>
      </div>
    </div>
    <div class="panel">
      <h2 id="ledgerhead" style="cursor:pointer" title="click to collapse/expand">Owner ledger <span id="ledgerarrow">&#9662;</span></h2>
      <div id="ledgerbody">
        <div class="ohead"><span>team</span><span>left</span><span>max bid</span><span>open</span></div>
        <div id="ownerbody"></div>
      </div>
    </div>
    <div class="panel">
      <h2 id="favhd" style="cursor:pointer;user-select:none" title="players you starred from the research popup. Click to expand/collapse."><span id="favcaret" style="display:inline-block;transition:transform .18s;color:var(--faint)">&rsaquo;</span> Favorites<span id="favcount" style="color:var(--faint);font-weight:400;font-size:12px"></span></h2>
      <div id="favlist"></div>
    </div>`;
  layout.appendChild(rail);
  root.appendChild(layout);

  renderMixer();
  document.querySelectorAll(".btab").forEach((b) => {
    b.onclick = () => {
      boardTab = b.dataset.tab; localStorage.setItem("ls-tab", boardTab);
      applyTab();
    };
  });
  $("#favhd").onclick = () => {
    flaggedOpen = !flaggedOpen;
    localStorage.setItem("ls-fav", flaggedOpen ? "open" : "closed");
    renderFavorites();
  };

  $("#q").addEventListener("input", () => {
    hitList = search($("#q").value); hitSel = 0; renderHits();
  });
  $("#q").addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { hitSel = Math.min(hitSel + 1,
      hitList.length - 1); renderHits(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { hitSel = Math.max(hitSel - 1, 0);
      renderHits(); e.preventDefault(); }
    else if (e.key === "Enter" && hitList[hitSel]) {
      pick(hitList[hitSel].id); e.preventDefault(); }
  });
  $("#price").addEventListener("input", updateSummary);
  $("#price").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!$("#sold").disabled) { commit(); return; }
      const b = document.querySelector(".obtn"); if (b) b.focus();
    }
  });
  $("#sold").onclick = commit;
  $("#rostersel").onchange = () => {
    rosterView = parseInt($("#rostersel").value, 10); renderRoster();
  };
  $("#ledgerhead").onclick = () => {
    const open = $("#ledgerbody").style.display !== "none";
    $("#ledgerbody").style.display = open ? "none" : "block";
    $("#ledgerarrow").innerHTML = open ? "&#9656;" : "&#9662;";
  };

  renderBoard(); renderTeams(); renderOwners(); renderRoster();
  renderChips(); renderFavorites(); renderFlow(); applyTab();
}

/* re-render everything after a state change, preserving staged state */
function refreshRoom() {
  const keepPicked = picked, keepOwner = selOwner;
  renderBoardScreen();
  if (keepPicked && !soldSet.has(keepPicked.id)) {
    pick(keepPicked.id);
    if (keepOwner != null) selectOwner(keepOwner);
  }
}


/* ---------------- keys (ported) ---------------- */

const OKEYS = { "1": 0, "2": 1, "3": 2, "4": 3, "5": 4, "6": 5, "7": 6,
  "8": 7, "9": 8, "0": 9, "-": 10, "=": 11 };

document.addEventListener("keydown", (e) => {
  if (!doc || !doc.league || !curRun || !$("#q")) return;
  const a = document.activeElement;
  const inInput = a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA"
    || a.tagName === "SELECT");
  const modalUp = $("#ovl").style.display === "flex";
  if (e.key === "/" && !inInput) { $("#q").focus(); e.preventDefault(); return; }
  if (e.key === "Escape") {
    /* idle + a recent sale exists: double-tap within 500ms reopens it for a
     * price/owner edit. A single idle tap does nothing. */
    if (!picked && !modalUp && curSales.length) {
      const now = performance.now();
      if (now - lastEsc < 500) { lastEsc = 0; reopenLastSale(); return; }
      lastEsc = now; return;
    }
    resetSale(); closeModal(); return;
  }
  if (!inInput && !picked && e.key.length === 1 && /[a-z]/i.test(e.key)
    && !e.metaKey && !e.ctrlKey && !e.altKey) { $("#q").focus(); return; }
  if (picked && !inInput && e.key in OKEYS) {
    const btns = document.querySelectorAll(".obtn");
    const b = btns[OKEYS[e.key]];
    if (b) { selectOwner(+b.dataset.oid); e.preventDefault(); return; }
  }
  /* type-to-filter the owner grid while staged (digit hotkeys take precedence,
   * inert while the modal is up). Enter takes the first match. */
  if (picked && !inInput && !modalUp) {
    if (e.key === "Enter" && ownerFilter) {
      const hit = owners().find((o) =>
        o.name.toLowerCase().startsWith(ownerFilter));
      ownerFilter = "";
      if (hit) selectOwner(hit.id); else renderOwnerGrid();
      e.preventDefault(); return;
    }
    if (e.key === "Backspace" && ownerFilter) {
      ownerFilter = ownerFilter.slice(0, -1);
      renderOwnerGrid(); e.preventDefault(); return;
    }
    if (e.key.length === 1
      && (/[a-z'.]/i.test(e.key) || (e.key === " " && ownerFilter))
      && !e.metaKey && !e.ctrlKey && !e.altKey) {
      ownerFilter += e.key.toLowerCase();
      renderOwnerGrid(); e.preventDefault(); return;
    }
  }
  if (picked && !inInput && e.key === "Enter" && !$("#sold").disabled
    && !(a && a.className && String(a.className).includes("obtn"))) {
    commit(); e.preventDefault(); return;
  }
  if (a && a.className && String(a.className).includes("obtn")) {
    const btns = [...document.querySelectorAll(".obtn")];
    const i = btns.indexOf(a);
    const moves = { ArrowDown: 2, ArrowUp: -2, ArrowRight: 1, ArrowLeft: -1 };
    if (e.key in moves && btns[i + moves[e.key]]) {
      btns[i + moves[e.key]].focus(); e.preventDefault();
    }
  }
});
$("#ovl").onclick = (e) => { if (e.target.id === "ovl") closeModal(); };

/* ---------------- under the hood ----------------
 * Two tabs. "How To" is the room in the order you use it, each element shown
 * as a preview built from the room's own styles. "What is My$?" is the value
 * pipeline, one layer per computation, stated plainly with the source and the
 * formula so a wary reader can decide whether they agree. Examples use the
 * user's league. */

const hstep = (n, title, body, pv) => `<section class="hstep">
    <span class="hn">${n}</span>
    <div class="hbody"><h4>${title}</h4>${body}${pv ? `<div class="hpv">${pv}</div>` : ""}</div>
  </section>`;
const hsub = (body, pv) => `<div class="hsub"><div class="hpv"><p class="hcap">${body}</p>${pv}</div></div>`;
const GEAR = `<span class="hgear" aria-label="gear">&#9881;</span>`;

function helpValue() {
  const L = doc.league;
  const T = L.teams, B = L.budget;
  const spots = L.model_params.dollar_slots_per_team;
  const pool = B * T - spots * T;
  const base = baselines(L);
  const fade = doc.ui.availFade !== false;
  return `<p class="hlead">My$ is the most you should pay for a player in this league. It is built
    from data you brought, with the following layers on top.</p>
  <div class="hpipe">
  ${hstep(1, "Your projections set the baseline.",
    `<p>One click pulls Sleeper's public projections; paste or import more
     (FantasyPros, CBS, any rankings list). With more than one source the board
     averages them into a <b>blend</b>; the <b>values from</b> menu lets you switch
     any source in or out of that average and the board recomputes.</p>
     <p><b>What is Bid$?</b> Yahoo or ESPN values get imported as <b>Mkt$</b> and
     rescaled as <b>Bid$</b> according to your league's budget and roster.
     <b>+/-</b> shows where you might get a deal.</p>`,
    `<div class="hrow hhead"><span>player</span><span>Bid$</span><span>+/-</span><span>My$</span></div>
     <div class="hrow"><span>J. Gibbs <small>DET</small></span><span>$54</span><span class="up">+7</span><span class="usd">$61</span></div>
     <div class="hrow"><span>C. Lamb <small>DAL</small></span><span>$48</span><span class="dn">-6</span><span class="usd">$42</span></div>`)}
  ${hstep(2, "Your league's scoring settings (the BeerSheets layer).",
    `<p>A player's projected points are calculated from his projected stats
     using your league's scoring settings, so My$ is specific to this league
     and moves when a rule changes.</p>`)}
  ${hstep(3, "Availability fade.",
    `<p><b>Source:</b> nflverse injury and games data crossed with
     FantasyFootballCalculator ADP, seasons 2015 to 2025, aggregated to expected
     games missed per position and draft slot. It is by slot, not by player;
     no one's medical history is in it. The table ships in the app
     (<code>app/prior_2026.js</code>).</p>
     <p><b>Formula:</b> points x (17 - expected missed) / 17. After
     regularizing (below), the RB1 slot expects ~3.8 games missed and the QB1
     slot ~2.1, so top RBs are faded about 22% and top QBs about 12%.</p>
     <p><b>How much to trust it:</b> RBs missing more games than WRs is a solid,
     position-level pattern. The slot-by-slot gradient (which RB is riskiest) is
     underpowered on ~11 seasons, so the per-slot curve is shrunk halfway toward
     each position's average. That keeps the part the data supports and damps
     the part it does not. It is still a toggle if you would rather not use it.</p>`,
    `<button class="gtoggle htog ${fade ? "on" : ""}" id="availtog"><span>Apply the availability fade</span><span class="sw"><span class="knob"></span></span></button>
     <small class="hnote2">${fade ? "On: values include the fade." : "Off: raw projected points, no fade."} Flipping it recomputes the board as a new run.</small>`)}
  ${hstep(4, "Points above a free player.",
    `<p>At each position the baseline is the player who will still be free on
     waivers when the draft ends: the number your league starts there (flex
     counted by share) plus 15% for bench. In this league that is the
     <b>${base.RB}th RB</b>, the ${base.WR}th WR, the ${base.QB}th QB, the
     ${base.TE}th TE.</p>
     <p>A player's value is his points <b>above</b> that baseline player; points
     the free player would also score are worth $0. This drops the undraftable
     tail out of the money and concentrates the budget on the players who will
     actually be bought. It also makes positions comparable: a QB and an RB are
     both measured against their own replacement. Tiers mark value cliffs (a
     tier ends when the next value falls 20%).</p>`)}
  ${hstep(5, "Points become dollars.",
    `<p>Your room holds ${T} x $${B} = <b>$${(T * B).toLocaleString()}</b>. Every
     roster spot costs at least $1, so $${(spots * T).toLocaleString()} is
     reserved for minimum bids and <b>$${pool.toLocaleString()}</b> is the
     pool that buys value.</p>
     <p><b>My$ = $1 + (his value above baseline / everyone's value above
     baseline) x pool.</b> The values sum back to exactly your room's money:
     if one player is priced high, someone else is priced low.</p>`)}
  ${hstep("+", "My Calls.",
    `<p>Your own dollar override on a player, for when you have a hunch. Adjust
     by single clicking on the player. Calls are a <b>layer</b> you switch on in
     the <b>values from</b> menu, applied on top of whatever sources you have lit,
     so the base numbers are never touched.</p>`,
    `<div class="hmc"><b>MY CALL</b>
     <div class="callset"><button class="cstep">-</button><div class="cval"><span class="cd">$</span><span class="hcv">61</span></div><button class="cstep">+</button></div>
     <div class="callbtns"><button class="ghost">Reset to 58</button><button class="primary">Set to 61</button></div></div>`)}
  </div>`;
}

function helpRoom() {
  return `<p class="hlead">How to use this tool as your draft weapon.</p>
  <div class="hpipe">
  ${hstep(1, "The board.",
    `<ul class="hlist">
     <li><b>My$</b>: your projected value (see <i>What is My$?</i>)</li>
     <li><b>Bid$</b>: what your league is likely to bid</li>
     <li><b>+/-</b>: the difference between the two. Green = a deal</li></ul>`,
    `<div class="hrow hhead"><span class="pRB">RB</span><span>Bid$</span><span>+/-</span><span>My$</span></div>
     <div class="hrow"><span><i class="ht">1</i> B. Robinson</span><span>$58</span><span class="up">+3</span><span class="usd">$61</span></div>
     <div class="hrow htier"><span><i class="ht">2</i> J. Jacobs</span><span>$41</span><span class="dn">-4</span><span class="usd">$37</span></div>`)}
  ${hstep(2, "Stage the nominated player.",
    `<p>Just start typing his name, no need to click anywhere. Press Enter. You
     can also double-click his name on the board.</p>`,
    `<div class="hsearch"><span class="hq">/love</span><span class="hhit">Jeremiyah Love <b class="pRB">RB</b> <small>ARI</small> <kbd>Enter</kbd></span></div>`)}
  ${hstep(3, "The Call.",
    `<p>Fires instantly with a verdict:</p>
     <ul class="hlist">
     <li><b>TARGET</b>: the room is likely to pay $2 or more under My$.</li>
     <li><b>FAIR VALUE</b>: Bid$ and My$ are within a couple of dollars.</li>
     <li><b>LAST CHANCE</b>: two or fewer comparable players left at his position, with funded owners still chasing them.</li>
     <li><b>LET HIM GO</b>: the room is likely to pay $4 or more over My$.</li></ul>`,
    `<div class="hcall"><span class="hvp fair">FAIR VALUE</span>
     <div class="cmax">worth <b>$29</b></div>
     <div class="cest">room bids <b>~$27</b></div>
     <div class="cslots"><div class="srow"><span class="lab pRB">RB</span><span class="pl pRB">~$28</span></div>
     <div class="srow"><span class="lab pFLX">FLX</span><span class="pl pFLX">~$25</span></div></div></div>`)}
  ${hstep(4, "Your Budget Plan.",
    `<p>Target spend per starting slot, set under ${GEAR} <i>Budget plan</i>. As
     you spend, they water-fill to your remaining money: bank a deal and the
     others grow, overpay and they shrink. Each target also re-calcs as players
     come off the board, so it can never be higher than the most expensive
     player still available at that position.</p>`,
    `<div class="cslots"><div class="srow"><span class="lab pRB">RB1</span><span class="pl pRB">~$58</span></div>
     <div class="srow"><span class="lab pWR">WR1</span><span class="pl pWR">~$44</span></div>
     <div class="srow"><span class="lab pFLX">FLEX</span><span class="pl pFLX">~$19</span></div></div>`)}
  ${hstep(5, "Log the sale.",
    ``,
    null)}
  ${hsub("Type the price. Enter.",
    `<div class="hprice"><span class="hlab">price</span><span class="hpin">34</span></div>`)}
  ${hsub("Select the winning team. Enter.",
    `<div class="hown"><span class="hlab">owner</span><span class="obtn">Team 1</span><span class="obtn">Team 2</span><span class="obtn selected">Team 3</span></div>`)}
  ${hsub("Enter logs the sale. Double-tap Escape reopens the last sale to fix it.",
    `<div class="hsumm"><b>Jeremiyah Love</b> to <b>Team 3</b> for <span class="g">$34</span></div><span class="hdraft">DRAFT</span>`)}
  </div>
  <h4 class="hh">Also on screen</h4>
  <section class="hnote">
    <h4>The pressure strip.</h4>
    <div class="hpv"><span class="fcell">QB <b>9/14</b></span>
     <span class="fcell tight">RB <b>11/8</b> <i class="mdot exposed"></i></span>
     <span class="fcell crunch">TE <b>6/2</b> <i class="mdot exploit"></i> <i class="runmark">&#9650;</i></span></div>
    <p>Shows position scarcity as the draft plays out. <b>QB 12/10</b> means 12
     starting QB slots are still open across the league and only 10 players
     worth $5 or more are left at QB. That is a crunch: someone goes without.
     Amber, the window is closing; red, crunch. A triangle marks a run (4 of the
     last 6 sales at that position).</p>
    <p>Dots: <i class="mdot exposed"></i> red, you still need this position and
     it is tightening. <i class="mdot exploit"></i> green, you are already set
     here, so nominate it and make the room spend where you do not need to.</p>
  </section>
  <section class="hnote">
    <h4>It keeps working.</h4>
    <p>Every action saves to this device automatically. You can safely close
     your browser window without losing data.</p>
  </section>`;
}

function openHelp(tab = "r") {
  const m = $("#modal");
  m.classList.add("wide");
  m.innerHTML = `<h3>Under the hood</h3>
    <div id="mtabs">
      <button class="mtab ${tab === "r" ? "on" : ""}" data-m="r">How To</button>
      <button class="mtab ${tab === "v" ? "on" : ""}" data-m="v">What is My$?</button>
    </div>
    <div id="mtabc">${tab === "r" ? helpRoom() : helpValue()}</div>`;
  const wire = () => {
    const t = $("#availtog");
    if (t) t.onclick = async () => {
      doc.ui.availFade = doc.ui.availFade === false;   // flip
      await saveDoc(doc);
      if (Object.keys(doc.sources).length) {
        await makeRun(); await saveDoc(doc);
        renderBoardScreen();
      }
      $("#mtabc").innerHTML = helpValue(); wire();
    };
  };
  document.querySelectorAll(".mtab").forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll(".mtab").forEach((x) =>
        x.classList.toggle("on", x === b));
      $("#mtabc").innerHTML = b.dataset.m === "v" ? helpValue() : helpRoom();
      m.scrollTop = 0; wire();
    };
  });
  wire();
  $("#ovl").style.display = "flex";
}

/* ---------------- boot ---------------- */

/* ---------------- where the data lives ----------------
 * Every action is already saved to this browser (IndexedDB). These make that
 * visible in the gear menu, ask the browser to protect the storage, offer a
 * file the user owns (silent re-save on Chrome/Edge), and warn only in the
 * one case where closing really does lose data: a private window. */
let persisted = null, autosaveTimer = null;

function ago(iso) {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 8) return "just now";
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

async function refreshSaveStatus() {
  const big = $("#gsaved"), sub = $("#gsub"), auto = $("#menuAutosave");
  if (!big) return;
  const file = await linkedFileName();
  big.textContent = doc && doc.saved_at ? "Auto-saved" : "Nothing saved yet";
  const bits = [];
  if (doc && doc.saved_at) bits.push(ago(doc.saved_at));
  bits.push(persisted ? "protected storage" : "browser storage");
  if (file) bits.push(`file: ${file}${doc?.ui?.autosaveFile ? " (auto)" : ""}`);
  sub.textContent = bits.join(" \u00b7 ");
  auto.hidden = !(file && canSaveToFile);
  auto.classList.toggle("on", !!(doc && doc.ui && doc.ui.autosaveFile));
}

function autosaveToFile() {
  if (!doc || !doc.ui || !doc.ui.autosaveFile || !canSaveToFile) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(async () => {
    try {
      const r = await saveToFile(doc, { silent: true });
      if (r.mode === "needs-click") {
        $("#gsub").textContent = `file needs a click: gear > Save to file`;
      }
    } catch (e) { console.warn("file auto-save failed", e); }
  }, 800);
}

function showNotice(html) {
  const n = $("#notice");
  n.innerHTML = `<span>${html}</span><button class="ghost tiny" id="noticeSave">Save to file</button><button class="ghost tiny" id="noticeX" title="dismiss">&times;</button>`;
  n.classList.add("show");
  $("#noticeX").onclick = () => n.classList.remove("show");
  $("#noticeSave").onclick = () => $("#menuSave").click();
}

async function boot() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  doc = await loadDoc();
  applyTheme();
  onSaved(() => { refreshSaveStatus(); autosaveToFile(); });
  requestPersist().then((ok) => { persisted = ok; refreshSaveStatus(); });
  storageLooksTemporary().then((tmp) => {
    if (tmp) showNotice("This looks like a private window: the browser may " +
      "forget everything here when it closes. Keep a file you own.");
  });
  refreshSaveStatus();
  /* the logo is always the way home */
  $("#mast .mark").onclick = () => {
    if (!doc || !doc.league) return;
    importState = null; wizardState.editing = false; wizardState.resumeAt = null;
    renderBoardScreen();
  };
  const importInput = $("#importfile");
  importInput.onchange = async () => {
    if (!importInput.files.length) return;
    try {
      doc = await importDocFile(importInput.files[0]);
      applyTheme();
      doc.league ? renderBoardScreen() : renderWizard();
    } catch (e) { alert(e.message); }
  };
  const menu = $("#gearmenu");
  $("#gearbtn").onclick = (ev) => {
    ev.stopPropagation();
    menu.hidden = !menu.hidden;
  };
  document.addEventListener("click", (ev) => {
    if (!menu.hidden && !menu.contains(ev.target)) menu.hidden = true;
  });
  const themeBtn = $("#menuTheme");
  themeBtn.classList.toggle("on", (doc?.ui?.theme || "dark") !== "light");
  themeBtn.onclick = async () => {
    if (!doc) return;
    doc.ui.theme = doc.ui.theme === "light" ? "dark" : "light";
    doc.ui.themeChosen = true;
    applyTheme(); await saveDoc(doc);
    themeBtn.classList.toggle("on", doc.ui.theme !== "light");
    if (doc.league && curRun) refreshRoom();
  };
  $("#menuPlan").onclick = () => {
    menu.hidden = true;
    if (!doc || !doc.league) { alert("Finish setup first."); return; }
    openPlanEditor();
  };
  $("#menuLeague").onclick = () => {
    menu.hidden = true;
    if (!doc || !doc.league) { alert("Finish setup first."); return; }
    openLeagueEditor();
  };
  let resetArmed = 0;
  const resetBtn = $("#menuReset");
  resetBtn.onclick = async (ev) => {
    ev.stopPropagation();
    if (!doc || !doc.league) { alert("Nothing to reset yet."); return; }
    if (Date.now() - resetArmed > 5000) {
      resetArmed = Date.now();
      resetBtn.textContent = "Click again to CONFIRM reset";
      setTimeout(() => {
        resetBtn.textContent = "Clear all sales"; resetArmed = 0;
      }, 5000);
      return;
    }
    resetBtn.textContent = "Clear all sales";
    resetArmed = 0; menu.hidden = true;
    const n = activeSales(doc.journal).length;
    doc.journal = [];                 // deliberate draft reset; league is kept
    await saveDoc(doc);
    resetSale();
    stampShow("RESET", `${n} sales cleared`);
    refreshRoom();
  };
  $("#menuHelp").onclick = () => { menu.hidden = true; openHelp(); };
  $("#menuImport").onclick = () => { menu.hidden = true; importInput.click(); };
  $("#menuSave").onclick = async () => {
    menu.hidden = true;
    if (!doc) { alert("Nothing to save yet."); return; }
    try {
      const r = await saveToFile(doc);
      if (r.mode === "file") stampShow("SAVED", `to ${r.name}`);
      else if (r.mode === "download") stampShow("SAVED", "backup downloaded");
      refreshSaveStatus();
    } catch (e) {
      if (e && e.name !== "AbortError") alert(`Save failed: ${e.message}`);
    }
  };
  $("#menuAutosave").onclick = async (ev) => {
    ev.stopPropagation();
    if (!doc) return;
    doc.ui.autosaveFile = !doc.ui.autosaveFile;
    await saveDoc(doc);          // triggers the status refresh and first auto-save
  };
  $("#menuSleeper").onclick = async () => {
    menu.hidden = true;
    if (!doc || !doc.league) { alert("Finish setup first."); return; }
    try { await doFetchSleeper(); renderBoardScreen(); }
    catch (e) { alert(`Fetch failed (${e.message}). Are you offline?`); }
  };
  $("#ovl").onclick = (e) => { if (e.target.id === "ovl") closeModal(); };

  /* AI live read: wired ONLY when a self-hoster set config.AI_ENDPOINT. The
   * hosted build has AI_ENABLED false, so nothing here runs and no AI UI or
   * network call exists. */
  if (AI_ENABLED) {
    try {
      const mod = await import("./copilot.js");
      cp = mod.makeCopilot(AI_ENDPOINT);
      const btn = document.createElement("button");
      btn.id = "menuCopilot"; btn.className = "";
      const setLabel = () => { btn.textContent = "AI live read: " + cp.mode(); };
      setLabel();
      btn.onclick = () => {
        const modes = ["synthesize", "complement", "off"];
        const next = modes[(modes.indexOf(cp.mode()) + 1) % modes.length];
        cp.setMode(next); setLabel();
        if (next === "off") cp.clear();
        else if (picked) stageCopilot(picked);
      };
      menu.insertBefore(btn, $("#menuHelp"));
    } catch (e) { console.warn("copilot unavailable", e); }
  }

  if (doc && doc.league) renderBoardScreen();
  else renderWizard();
}

boot();
