/* Persistence per ADR-0005: plain structures in IndexedDB, append-only runs
 * and journal, one-file JSON export/import as the recovery ritual.
 *
 * Multi-league layout (docs/plans/MULTI-LEAGUE-PLAN.md): a league IS a doc.
 * The app works on one `doc` at a time in exactly the pre-multi-league shape;
 * this module decomposes it on save and reassembles it on load:
 *   meta            {active, order, next, theme, themeChosen}   app-wide
 *   shared          {sources, names, player_meta}               app-wide
 *   league:<id>     the league record (league, runs, journal, calls, ...)
 * Projection sources are shared so one import serves every league; the
 * theme is a preference of the person, not the league. Both are attached
 * onto the loaded doc so app code never has to know. */

const DB_NAME = "liquidsheets";
const STORE = "docs";
const META = "meta";
const SHARED = "shared";
const LEGACY = "main";           // pre-multi-league single-doc key
const HANDLE_KEY = "filehandle";
export const SCHEMA_VERSION = 4;

const lkey = (id) => `league:${id}`;
const isLeagueKey = (k) => typeof k === "string" && k.startsWith("league:");

function openDB() {
  return new Promise((res, rej) => {
    const rq = indexedDB.open(DB_NAME, 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore(STORE);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
async function get(key) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const rq = db.transaction(STORE).objectStore(STORE).get(key);
    rq.onsuccess = () => res(rq.result ?? null);
    rq.onerror = () => rej(rq.error);
  });
}
async function put(key, val) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    if (val === null) tx.objectStore(STORE).delete(key);
    else tx.objectStore(STORE).put(val, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function allKeys() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const rq = db.transaction(STORE).objectStore(STORE).getAllKeys();
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}

/* ---- meta and shared ---- */
const freshMeta = () => ({ active: null, order: [], next: 1,
  theme: "dark", themeChosen: false });
const freshShared = () => ({ sources: {}, names: {}, player_meta: {} });

export async function loadMeta() { return (await get(META)) ?? freshMeta(); }
async function saveMeta(m) { await put(META, m); }
async function loadShared() { return (await get(SHARED)) ?? freshShared(); }

/* One-time move of the old single "main" doc into league 1. Idempotent. */
async function migrateLegacy() {
  const old = await get(LEGACY);
  if (!old) return;
  const m = await loadMeta();
  if (!m.order.length) {
    migrate(old);
    old.id = 1;
    const shared = { sources: old.sources ?? {}, names: old.names ?? {},
      player_meta: old.player_meta ?? {} };
    m.theme = old.ui.theme; m.themeChosen = !!old.ui.themeChosen;
    m.active = 1; m.order = [1]; m.next = 2;
    await put(lkey(1), strip(old));
    await put(SHARED, shared);
    await saveMeta(m);
  }
  await put(LEGACY, null);
}

/* The league record never carries the shared parts. */
function strip(doc) {
  const rec = { ...doc };
  delete rec.sources; delete rec.names; delete rec.player_meta;
  return rec;
}
/* Theme is remembered per league (Levi, 2026-08-30): the doc keeps its own
 * ui.theme; meta.theme only seeds a brand-new league with the last choice. */
function attach(doc, shared) {
  doc.sources = shared.sources; doc.names = shared.names;
  doc.player_meta = shared.player_meta;
  return doc;
}

/* Forward-fill fields added in later schema versions so an older stored doc
 * (or an imported older backup) keeps loading. Idempotent and non-destructive:
 * only fills what is missing; never rewrites recorded runs or the journal. */
export function migrate(doc) {
  if (!doc.calls) doc.calls = [];        // My Calls: [{pid, delta}]; empty
  if (!doc.favorites) doc.favorites = []; // favorited player ids
  if (!doc.ui) doc.ui = {};
  /* dark is the default color scheme. themeChosen distinguishes a real user
   * choice from the old hardcoded default, so pre-theme docs flip to dark while
   * an explicit light choice persists. */
  if (doc.ui.themeChosen === undefined) doc.ui.themeChosen = false;
  if (!doc.ui.themeChosen) doc.ui.theme = "dark";
  else if (!doc.ui.theme) doc.ui.theme = "dark";
  if (!("run" in doc.ui)) doc.ui.run = null;        // selected run id
  if (!doc.ui.planVariant) doc.ui.planVariant = "default";
  if (!("availFade" in doc.ui)) doc.ui.availFade = true;   // availability fade on
  if (!("id" in doc)) doc.id = null;
  /* schema 4: markets keyed by platform label; Bid$ follows league.platform
   * (no picker). Fold the old single doc.market, which "last import wins"
   * used to overwrite, into the map so nothing already imported is lost. */
  if (!doc.markets) doc.markets = {};
  if (doc.market) {
    const k = doc.market.label || "yahoo";
    if (!doc.markets[k]) doc.markets[k] = { ...doc.market, label: k };
    delete doc.market;
  }
  doc.schema_version = SCHEMA_VERSION;
  return doc;
}

/* ---- the active league, in the shape the app expects ---- */
export async function loadDoc() {
  await migrateLegacy();
  const m = await loadMeta();
  if (m.active == null) return null;
  const rec = await get(lkey(m.active));
  if (!rec) return null;
  return attach(migrate(rec), await loadShared());
}

/* Listeners run after every successful save (status line, file auto-save). */
const savedListeners = [];
export function onSaved(fn) { savedListeners.push(fn); }

export async function saveDoc(doc) {
  doc.saved_at = new Date().toISOString();
  const m = await loadMeta();
  if (doc.id == null) doc.id = m.next++;
  if (!m.order.includes(doc.id)) m.order.push(doc.id);
  m.active = doc.id;                       // the app only ever saves the active league
  m.theme = doc.ui.theme; m.themeChosen = !!doc.ui.themeChosen;
  await put(lkey(doc.id), strip(doc));
  await put(SHARED, { sources: doc.sources ?? {}, names: doc.names ?? {},
    player_meta: doc.player_meta ?? {} });
  await saveMeta(m);
  for (const fn of savedListeners) { try { fn(doc); } catch (e) { console.warn(e); } }
}

export function newDoc() {
  return {
    schema_version: SCHEMA_VERSION,
    id: null,              // assigned on first save
    created_at: new Date().toISOString(),
    league: null,          // wizard output; null means wizard not finished
    names: {},             // player_id -> display name (shared across leagues)
    player_meta: {},       // player_id -> {adp, injury_status, is_rookie} (shared)
    sources: {},           // source name -> {as_of, players: [...]} (shared)
    runs: [],              // append-only; never mutate a recorded run
    journal: [],           // append-only sale journal (M3)
    calls: [],             // My Calls: [{pid, delta}]; empty
    favorites: [],         // favorited player ids
    markets: {},           // platform label -> {label, as_of, imported_at, values}
    ui: { theme: "dark", themeChosen: false, run: null,
      planVariant: "default", availFade: true },
  };
}

/* ---- league management ---- */
export async function listLeagues() {
  const m = await loadMeta();
  const out = [];
  for (const id of m.order) {
    const rec = await get(lkey(id));
    if (!rec) continue;
    out.push({ id, name: rec.league ? rec.league.name : "New league",
      teams: rec.league?.teams, budget: rec.league?.budget,
      setup: !!rec.league, active: id === m.active });
  }
  return out;
}

export async function setActive(id) {
  const m = await loadMeta();
  if (!m.order.includes(id)) throw new Error("no such league");
  m.active = id; await saveMeta(m);
}

export async function deleteLeague(id) {
  if (id == null) return;
  const m = await loadMeta();
  await put(lkey(id), null);
  m.order = m.order.filter((x) => x !== id);
  if (m.active === id) m.active = m.order[0] ?? null;
  await saveMeta(m);
}

/* Delete the active league (the harness's "delete site data" step). */
export async function wipeDoc() {
  const m = await loadMeta();
  if (m.active != null) await deleteLeague(m.active);
}

/* ---- one-file backup of the whole app ---- */
export async function buildBundle() {
  const m = await loadMeta();
  const leagues = [];
  for (const id of m.order) { const r = await get(lkey(id)); if (r) leagues.push(r); }
  return { schema_version: SCHEMA_VERSION, bundle: true,
    exported_at: new Date().toISOString(),
    meta: m, shared: await loadShared(), leagues };
}

async function clearApp() {
  for (const k of await allKeys()) {
    if (k === META || k === SHARED || k === LEGACY || isLeagueKey(k)) await put(k, null);
  }
}

/* file name carries the active league's name: liquid-sheets-<league>-<date>.json */
function backupName(doc) {
  const raw = doc && doc.league && doc.league.name ? doc.league.name : "";
  const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `liquid-sheets-${slug ? slug + "-" : ""}${new Date().toISOString().slice(0, 10)}.json`;
}

export async function exportDoc(doc) {
  const blob = new Blob([JSON.stringify(await buildBundle(), null, 1)],
    { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = backupName(doc);
  a.click();
  URL.revokeObjectURL(a.href);
}

/* Import replaces the whole app. Accepts a bundle (schema 3) or a single
 * league doc from an older backup, which becomes league 1. */
export async function importDocFile(file) {
  const obj = JSON.parse(await file.text());
  if (typeof obj !== "object" || obj === null || !("schema_version" in obj)) {
    throw new Error("Not a Liquid Sheets backup file.");
  }
  if (obj.schema_version > SCHEMA_VERSION) {
    throw new Error("Backup is from a newer app version; refresh the app first.");
  }
  await clearApp();
  if (obj.bundle) {
    for (const rec of obj.leagues ?? []) await put(lkey(rec.id), migrate(rec));
    await put(SHARED, obj.shared ?? freshShared());
    const m = { ...freshMeta(), ...(obj.meta ?? {}) };
    m.order = (obj.leagues ?? []).map((r) => r.id);
    if (!m.order.includes(m.active)) m.active = m.order[0] ?? null;
    await saveMeta(m);
  } else {
    migrate(obj);
    obj.id = 1;
    await put(SHARED, { sources: obj.sources ?? {}, names: obj.names ?? {},
      player_meta: obj.player_meta ?? {} });
    await put(lkey(1), strip(obj));
    await saveMeta({ active: 1, order: [1], next: 2,
      theme: obj.ui.theme, themeChosen: !!obj.ui.themeChosen });
  }
  return loadDoc();
}

/* ---- where the data lives, made visible ----
 * Ask the browser to mark this origin's storage persistent (not evicted under
 * disk pressure). Returns true/false, or null if the API is missing. */
export async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      return await navigator.storage.persist();
    }
  } catch (e) { /* ignore */ }
  return null;
}

/* Heuristic for a private/incognito window, where storage is discarded on
 * close. Browsers hand such windows a much smaller quota; there is no direct
 * API, so this is a best-effort hint, worded as one in the UI. */
export async function storageLooksTemporary() {
  try {
    const est = navigator.storage && navigator.storage.estimate
      ? await navigator.storage.estimate() : null;
    if (est && est.quota && est.quota < 250 * 1024 * 1024) return true;
  } catch (e) { /* ignore */ }
  return false;
}

/* ---- save to a file the user owns ----
 * Chrome/Edge expose the File System Access API: pick a file once, then every
 * later save writes to the same file silently. The handle is kept in the same
 * IndexedDB store. Other browsers fall back to a download (exportDoc). The
 * file always holds the whole app (every league), same as the download. */
export const canSaveToFile = typeof window !== "undefined"
  && "showSaveFilePicker" in window;

export async function linkedFileName() {
  const h = await get(HANDLE_KEY);
  return h ? h.name : null;
}

export async function unlinkFile() { await put(HANDLE_KEY, null); }

/* pick: force the picker even if a file is linked. silent: never prompt
 * (used by auto-save); returns {mode:"needs-click"} if permission lapsed. */
export async function saveToFile(doc, { pick = false, silent = false } = {}) {
  if (!canSaveToFile) { await exportDoc(doc); return { mode: "download" }; }
  let h = pick ? null : await get(HANDLE_KEY);
  if (h) {
    const opts = { mode: "readwrite" };
    let p = await h.queryPermission(opts);
    if (p !== "granted") {
      if (silent) return { mode: "needs-click", name: h.name };
      p = await h.requestPermission(opts);
      if (p !== "granted") h = null;
    }
  }
  if (!h) {
    if (silent) return { mode: "none" };
    h = await window.showSaveFilePicker({
      suggestedName: backupName(doc),
      types: [{ description: "Liquid Sheets backup",
        accept: { "application/json": [".json"] } }],
    });
    await put(HANDLE_KEY, h);
  }
  const w = await h.createWritable();
  await w.write(JSON.stringify(await buildBundle(), null, 1));
  await w.close();
  return { mode: "file", name: h.name };
}
