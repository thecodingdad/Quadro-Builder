// Abgleich mit dem optionalen Backend (server.py).
//
// Grundsatz: es gibt nur EINEN Datenbestand. Die Oberfläche liest und schreibt
// immer die IndexedDB (docs.js/storage.js) -- auch mit Server. Dieses Modul
// hält diese Kopie mit dem Server im Gleichklang:
//
//   * beim Verbinden ein vollständiger Abgleich (`reconcile`)
//   * nach jeder lokalen Änderung ein Nachschub der offenen Sätze (`nudge`)
//   * bei jedem Ereignis vom Server derselbe Abgleich für die eine Datei
//
// Ist der Server weg, läuft alles mit dem gecachten Bestand weiter; Änderungen
// bleiben als `dirty` liegen und gehen beim nächsten Verbinden hoch. Gefragt
// wird nur bei echten Konflikten -- wenn beide Seiten dieselbe Datei geändert
// haben.
//
// Kein DOM, kein Three.js: die Oberfläche hängt sich über `configure()` mit
// Rückrufen an.

import * as docs from "./docs.js";
import * as storage from "./storage.js";

const CLIENT_KEY = "quadro.clientId.v1";
const PROBE_MS = 1500;
const RETRY_MIN = 1000;
const RETRY_MAX = 30000;

/** Server nicht erreichbar -- der Aufrufer soll das melden, nicht behelfen. */
export class OfflineError extends Error {
  constructor() { super("backend offline"); this.name = "OfflineError"; }
}

/** Der Server hat eine neuere Fassung; `current` ist sein voller Datensatz. */
class ConflictError extends Error {
  constructor(current) { super("conflict"); this.name = "ConflictError"; this.current = current; }
}

let active = false;          // Backend gefunden und eingeschaltet
let connState = "off";       // "off" | "connecting" | "online" | "offline"
let socket = null;
let retry = RETRY_MIN;
let retryTimer = null;
let nudgeTimer = null;
let running = null;          // laufender Abgleich (Promise), verhindert Überholen
let again = false;           // während des Abgleichs kam schon die nächste Änderung
let lastSyncAt = 0;
let pendingCount = 0;

const hooks = {
  onStatus: () => {},              // (connState, {pending, lastSyncAt})
  onDocUpdated: () => {},          // (record) -- Serverstand übernommen
  onDocRemoved: () => {},          // (docId)
  onLibChanged: () => {},
  onInventoryUpdated: () => {},    // (data) -- Bestand vom Server übernommen
  // ({kind, local, server}) -> "server" | "local" | "later"
  onConflict: async () => "later",
};

export function configure(next) { Object.assign(hooks, next); }

export function enabled() { return active; }
export function state() { return connState; }
export function status() {
  return { state: connState, pending: pendingCount, lastSyncAt };
}

export const clientId = (() => {
  let existing = localStorage.getItem(CLIENT_KEY);
  if (!existing) {
    existing = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    localStorage.setItem(CLIENT_KEY, existing);
  }
  return existing;
})();

/** Basis der API -- die App liegt unter /web/, die API daneben unter /api/. */
function apiBase() { return new URL("../api/", document.baseURI); }

function setState(next) {
  if (connState === next) return;
  connState = next;
  reportStatus();
}

function reportStatus() {
  hooks.onStatus(connState, { pending: pendingCount, lastSyncAt: lastSyncAt });
}

// --- HTTP ---------------------------------------------------------------

async function api(method, path, body, { signal } = {}) {
  let res;
  try {
    res = await fetch(new URL(path, apiBase()), {
      method,
      signal,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch (e) {
    if (active) goOffline();
    throw new OfflineError();
  }
  if (res.status === 409) {
    const payload = await res.json().catch(() => ({}));
    throw new ConflictError(payload.current || null);
  }
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
  if (res.status === 204) return null;
  return res.json();
}

// --- Start --------------------------------------------------------------

/**
 * Gibt es hier ein Backend? Kurzer Anruf mit Zeitgrenze -- ohne Antwort bleibt
 * alles wie ohne Server. Mit `?nobackend` in der Adresse bleibt es aus.
 */
export async function probe() {
  if (location.search.includes("nobackend")) {
    setState("off");
    reportStatus();
    return false;
  }
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), PROBE_MS);
  try {
    const reply = await api("GET", "health", null, { signal: abort.signal });
    if (!reply || !reply.ok) throw new Error("kein Backend");
  } catch {
    setState("off");
    reportStatus();
    return false;
  } finally {
    clearTimeout(timer);
  }
  active = true;
  docs.setSyncMode(true);
  storage.setSyncMode(true);
  setState("connecting");
  connect();
  await reconcile();
  return true;
}

// --- Ereignis-Kanal -----------------------------------------------------

function connect() {
  if (!active || socket) return;
  const url = new URL("ws", apiBase());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  let ws;
  try {
    ws = new WebSocket(url);
  } catch {
    scheduleReconnect();
    return;
  }
  socket = ws;
  ws.addEventListener("open", () => {
    retry = RETRY_MIN;
    setState("online");
    // Beim Wiederverbinden kann etwas verpasst worden sein.
    reconcile();
  });
  ws.addEventListener("message", (e) => {
    let event = null;
    try { event = JSON.parse(e.data); } catch { return; }
    if (!event || event.by === clientId) return;   // eigenes Echo
    handleEvent(event);
  });
  ws.addEventListener("close", () => { socket = null; goOffline(); });
  ws.addEventListener("error", () => { try { ws.close(); } catch { /* egal */ } });
}

function goOffline() {
  if (!active) return;
  setState("offline");
  scheduleReconnect();
}

function scheduleReconnect() {
  if (!active || retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connect();
    // Auch ohne WebSocket wieder herantasten: der Abgleich merkt selbst, ob der
    // Server antwortet, und setzt den Zustand entsprechend.
    reconcile().catch(() => {});
  }, retry);
  retry = Math.min(RETRY_MAX, retry * 2);
}

async function handleEvent(event) {
  try {
    if (event.type === "doc-saved") await syncOneDoc(event.id);
    else if (event.type === "doc-deleted") await handleRemoteDelete(event.id);
    else if (event.type === "lib-changed") await syncLibrary();
    else if (event.type === "inv-changed") { await syncInventory(); await countPending(); }
  } catch (e) {
    if (!(e instanceof OfflineError)) console.warn("Sync-Ereignis:", e);
  }
}

// --- Abgleich -----------------------------------------------------------

/**
 * Nach lokalen Änderungen: abgleichen (entprellt). Bewusst der volle Abgleich
 * -- nur er kennt den Stand des Servers, und ohne den ließe sich nicht sagen,
 * ob ein Hochladen durchgeht oder auf einen Konflikt trifft.
 */
export function nudge() {
  if (!active) return;
  // Der Zähler der offenen Änderungen zählt lokal -- er soll auch stimmen,
  // wenn gerade kein Server antwortet.
  countPending();
  clearTimeout(nudgeTimer);
  nudgeTimer = setTimeout(() => { reconcile(); }, 200);
}

/** Vollständiger Abgleich in beide Richtungen. */
export function reconcile() {
  if (!active) return Promise.resolve();
  // Während ein Abgleich läuft, kann schon die nächste Änderung eintreffen --
  // die käme sonst nie hoch. Sie bekommt einen Durchgang hinterher.
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      await syncDocs();
      await syncInventory();
      await syncLibrary();
      lastSyncAt = Date.now();
      setState("online");
      await countPending();
    } catch (e) {
      if (e instanceof OfflineError) { goOffline(); await countPending(); }
      else console.warn("Abgleich:", e);
    } finally {
      running = null;
    }
    if (again) { again = false; await reconcile(); }
  })();
  return running;
}

async function countPending() {
  const [docRows, libRows] = await Promise.all([docs.allRecords(), storage.libAllRecords()]);
  pendingCount = docRows.filter((d) => d.dirty || d.deletedAt).length
    + libRows.filter((e) => e.dirty || e.deletedAt).length
    + (storage.inventoryMeta().dirty ? 1 : 0);
  reportStatus();
}

async function syncDocs() {
  const remoteList = await api("GET", "docs");
  const remoteById = new Map((remoteList || []).map((d) => [d.id, d]));
  const locals = await docs.allRecords();
  const known = new Set();

  for (const local of locals) {
    known.add(local.id);
    await settleDoc(local, remoteById.get(local.id) || null);
  }
  // Nur auf dem Server: herunterladen.
  for (const remote of remoteList || []) {
    if (known.has(remote.id)) continue;
    await pull(remote.id);
  }
}

/**
 * Ein Dokument in Einklang bringen. `remote` ist der Kurzeintrag des Servers
 * (oder null = dort unbekannt).
 */
async function settleDoc(local, remote) {
  if (local.deletedAt) {
    if (!remote) { await docs.dropDoc(local.id); return; }
    if (remote.rev === local.rev) {
      await api("DELETE", `docs/${encodeURIComponent(local.id)}?rev=${local.rev}&clientId=${clientId}`);
      await docs.dropDoc(local.id);
      return;
    }
    // Anderswo geändert, hier gelöscht: das muss der Mensch entscheiden.
    const choice = await hooks.onConflict({ kind: "deleted-local", local: local, server: remote });
    if (choice === "local") {
      await api("DELETE", `docs/${encodeURIComponent(local.id)}?force=1&clientId=${clientId}`);
      await docs.dropDoc(local.id);
    } else if (choice === "server") {
      await pull(local.id);
    }
    return;
  }

  if (!remote) {
    if (!local.rev) { await push(local); return; }       // dem Server unbekannt
    if (local.dirty) {
      const choice = await hooks.onConflict({ kind: "deleted-remote", local: local, server: null });
      if (choice === "local") await push(local, true);
      else if (choice === "server") { await docs.dropDoc(local.id); hooks.onDocRemoved(local.id); }
      return;
    }
    // Anderswo gelöscht, hier unverändert: mitgehen.
    await docs.dropDoc(local.id);
    hooks.onDocRemoved(local.id);
    return;
  }

  if (local.dirty) {
    if ((local.rev || 0) === remote.rev) { await push(local); return; }
    const choice = await hooks.onConflict({ kind: "both", local: local, server: remote });
    if (choice === "local") await push(local, true);
    else if (choice === "server") await pull(local.id);
    return;
  }

  if (remote.rev > (local.rev || 0)) await pull(local.id);
}

/** Eine einzelne Datei nachziehen (nach einem Ereignis vom Server). */
async function syncOneDoc(docId) {
  let remote = null;
  try {
    remote = await api("GET", `docs/${encodeURIComponent(docId)}`);
  } catch (e) {
    if (e instanceof OfflineError) throw e;
    remote = null;                                  // dort inzwischen weg
  }
  const all = await docs.allRecords();
  const local = all.find((d) => d.id === docId) || null;
  if (!local) {
    if (remote) {
      const doc = await docs.putRemoteDoc(remote);
      hooks.onDocUpdated(doc);
    }
    await countPending();
    return;
  }
  await settleDoc(local, remote);
  await countPending();
}

async function handleRemoteDelete(docId) {
  const all = await docs.allRecords();
  const local = all.find((d) => d.id === docId);
  if (!local) return;
  await settleDoc(local, null);
  await countPending();
}

async function pull(docId) {
  const record = await api("GET", `docs/${encodeURIComponent(docId)}`).catch((e) => {
    if (e instanceof OfflineError) throw e;
    return null;
  });
  if (!record) return null;
  const doc = await docs.putRemoteDoc(record);
  hooks.onDocUpdated(doc);
  return doc;
}

async function push(local, force = false) {
  const stamp = local.updatedAt;
  try {
    const reply = await api("PUT", `docs/${encodeURIComponent(local.id)}`, {
      name: local.name, data: local.data, baseRev: local.rev || 0, force, clientId,
    });
    await docs.markDocSynced(local.id, reply.rev, stamp);
    return reply;
  } catch (e) {
    if (e instanceof ConflictError) {
      const choice = await hooks.onConflict({ kind: "both", local: local, server: e.current });
      if (choice === "local") return push(local, true);
      if (choice === "server" && e.current) {
        const doc = await docs.putRemoteDoc(e.current);
        hooks.onDocUpdated(doc);
      }
      return null;
    }
    throw e;
  }
}

// --- Bestand ------------------------------------------------------------
// Ein einziger Datensatz, also auch nur ein Vergleich: hat ihn nur eine Seite
// angefasst, gewinnt sie; haben es beide getan, wird gefragt.

async function syncInventory() {
  if (!active) return;
  let remote;
  try {
    remote = await api("GET", "inventory");
  } catch (e) {
    // Ein älterer Server kennt den Bestand noch nicht -- dann bleibt er lokal,
    // statt den ganzen Abgleich scheitern zu lassen.
    if (e instanceof OfflineError) throw e;
    return;
  }
  const meta = storage.inventoryMeta();
  const local = storage.loadInventory();
  const remoteRev = (remote && remote.rev) || 0;

  if (!meta.dirty) {
    if (remoteRev > meta.rev) {
      storage.putRemoteInventory(remote);
      hooks.onInventoryUpdated(remote.data || {});
    }
    return;
  }
  if (remoteRev !== meta.rev) {
    const choice = await hooks.onConflict({ kind: "inventory", local: null, server: null });
    if (choice === "server") {
      storage.putRemoteInventory(remote);
      hooks.onInventoryUpdated(remote.data || {});
      return;
    }
    if (choice !== "local") return;
    await pushInventory(local, meta, true);
    return;
  }
  await pushInventory(local, meta, false);
}

async function pushInventory(data, meta, force) {
  try {
    const reply = await api("PUT", "inventory", { data: data || {}, baseRev: meta.rev, force, clientId });
    storage.markInventorySynced(reply.rev, meta.updatedAt);
  } catch (e) {
    if (!(e instanceof ConflictError)) throw e;
    const choice = await hooks.onConflict({ kind: "inventory", local: null, server: null });
    if (choice === "local") await pushInventory(data, meta, true);
    else if (choice === "server" && e.current) {
      storage.putRemoteInventory(e.current);
      hooks.onInventoryUpdated(e.current.data || {});
    }
  }
}

// --- Bibliothek ---------------------------------------------------------

async function syncLibrary() {
  if (!active) return;
  const remoteList = await api("GET", "library");
  const remoteById = new Map((remoteList || []).map((e) => [e.id, e]));
  const locals = await storage.libAllRecords();
  const known = new Set();
  const uploads = [];
  let changed = false;

  for (const local of locals) {
    known.add(local.id);
    const remote = remoteById.get(local.id) || null;
    if (local.deletedAt) {
      if (remote) await api("DELETE", `library/${encodeURIComponent(local.id)}?clientId=${clientId}`);
      await storage.libDrop(local.id);
      changed = true;
    } else if (local.dirty) {
      uploads.push(local);
    } else if (!remote) {
      // Anderswo aus der Sammlung geworfen.
      await storage.libDrop(local.id);
      changed = true;
    }
  }

  if (uploads.length) {
    const reply = await api("POST", "library", {
      clientId,
      entries: uploads.map((e) => ({ id: e.id, name: e.name, file: e.file, qdf: e.qdf, meta: e.meta })),
    });
    for (const id of (reply && reply.added) || []) await storage.libMarkSynced(id);
    changed = true;
  }

  for (const remote of remoteList || []) {
    if (known.has(remote.id)) continue;
    // Nur die Kennzahlen -- der QDF-Text kommt beim Öffnen.
    await storage.libPutRemote({ ...remote, qdf: null });
    changed = true;
  }
  if (changed) hooks.onLibChanged();
}

/**
 * QDF-Text eines Sammlungs-Eintrags. Liegt er im Cache, kommt er von dort;
 * sonst vom Server. Ohne Server wirft das `OfflineError` -- ein Eintrag, von
 * dem nur die Kennzahlen da sind, lässt sich dann eben nicht öffnen.
 */
export async function libQdf(entry) {
  if (entry && entry.qdf) return entry.qdf;
  if (!active) throw new OfflineError();
  const full = await api("GET", `library/${encodeURIComponent(entry.id)}`);
  if (!full || !full.qdf) throw new OfflineError();
  await storage.libSetQdf(entry.id, full.qdf, full.rev);
  return full.qdf;
}
