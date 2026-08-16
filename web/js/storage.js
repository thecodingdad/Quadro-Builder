// Speicher-Layer: Offline-Persistenz via localStorage + Datei Export/Import.
// Bewusst gekapselt: ein spaeteres Django-Backend ersetzt nur dieses Modul
// (z. B. saveNamed -> POST /api/designs, listNames -> GET /api/designs).

import { AUTOSAVE_KEY } from "./config.js";

const INDEX_KEY = "quadro.designs.index.v1";
const PREFIX = "quadro.design.v1.";

// Wird geworfen, wenn localStorage voll ist (QuotaExceededError o.ae.).
// Eigene Klasse statt der DOMException, damit Aufrufer (UI-Schicht) den Fall
// unabhaengig vom Browser sauber erkennen und uebersetzen koennen, ohne dass
// dieses Modul i18n importieren muss.
export class QuotaError extends Error {
  constructor(cause) {
    super("Storage quota exceeded");
    this.name = "QuotaError";
    this.cause = cause;
  }
}

function isQuotaError(e) {
  return e instanceof DOMException &&
    (e.code === 22 || e.code === 1014 || e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED");
}

export function autosave(data) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.warn("Autosave fehlgeschlagen:", e);
    return false;
  }
}

export function loadAutosave() {
  const raw = localStorage.getItem(AUTOSAVE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function listNames() {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveNamed(name, data) {
  name = (name || "").trim();
  if (!name) throw new Error("Bitte einen Namen angeben");
  try {
    localStorage.setItem(PREFIX + name, JSON.stringify(data));
  } catch (e) {
    if (isQuotaError(e)) throw new QuotaError(e);
    throw e;
  }
  const names = listNames();
  if (!names.includes(name)) {
    names.push(name);
    names.sort((a, b) => a.localeCompare(b, "de"));
    try {
      localStorage.setItem(INDEX_KEY, JSON.stringify(names));
    } catch (e) {
      if (isQuotaError(e)) throw new QuotaError(e);
      throw e;
    }
  }
  return true;
}

export function loadNamed(name) {
  const raw = localStorage.getItem(PREFIX + name);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function deleteNamed(name) {
  localStorage.removeItem(PREFIX + name);
  const names = listNames().filter((n) => n !== name);
  localStorage.setItem(INDEX_KEY, JSON.stringify(names));
}

// --- Modell-Bibliothek (IndexedDB) --------------------------------------
// Die Bibliothek nimmt ganze QDF-Ordner auf (die Beispielsammlung der
// Herstellersoftware sind ~235 Dateien, zusammen gut 3 MB). Das sprengt
// localStorage, das sich die 5 MB mit Autosave und Entwuerfen teilt -- deshalb
// hier IndexedDB. Gespeichert wird der QDF-Text im Original plus die beim
// Einlesen berechneten Kennzahlen; geparst wird erst beim Oeffnen.

const LIB_DB = "quadro.library.v1";
const LIB_STORE = "designs";
// Version 2 bringt zwei weitere Speicher in dieselbe Datenbank: die eigenen
// Modelle ("docs", je Datei ein Eintrag) und die offene Sitzung ("session",
// ein einziger Eintrag mit allen Tabs samt Arbeitsstand). Beides gehört nicht
// in localStorage -- dort teilen sich alle Schlüssel 5 MB, und ein großes
// Modell wiegt schon gut 150 KB.
const DOC_STORE = "docs";
const SESSION_STORE = "session";

function openLib() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(LIB_DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LIB_STORE)) db.createObjectStore(LIB_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(DOC_STORE)) db.createObjectStore(DOC_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(SESSION_STORE)) db.createObjectStore(SESSION_STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Transaktion auf einem beliebigen Speicher der Datenbank. */
export function dbTx(storeName, mode, fn) {
  return openLib().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const out = fn(tx.objectStore(storeName));
    tx.oncomplete = () => { db.close(); resolve(out && out.result !== undefined ? out.result : out); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  }));
}

export const DB_STORES = { docs: DOC_STORE, session: SESSION_STORE };

function libTx(mode, fn) {
  return dbTx(LIB_STORE, mode, fn);
}

/** Eintraege ablegen (gleiche id ueberschreibt). */
export function libPut(entries) {
  return libTx("readwrite", (store) => { for (const e of entries) store.put(e); });
}

/** Alle Eintraege, nach Namen sortiert. */
export function libAll() {
  return libTx("readonly", (store) => store.getAll())
    .then((rows) => (rows || []).sort((a, b) => a.name.localeCompare(b.name, "de")));
}

export function libGet(id) {
  return libTx("readonly", (store) => store.get(id));
}

export function libClear() {
  return libTx("readwrite", (store) => store.clear());
}

// --- Datei Export/Import (echte Offline-Sicherung) ----------------------
export function exportFile(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "quadro-entwurf.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Beliebigen Text als Datei anbieten (QDF-Export). */
export function exportText(text, filename, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function importFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try { resolve(JSON.parse(reader.result)); }
      catch (e) { reject(new Error("Datei ist kein gueltiges JSON")); }
    };
    reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden"));
    reader.readAsText(file);
  });
}
