// Laedt und kapselt den Teile-Katalog (data/parts.json).
// Einziger Ort, der das JSON kennt -> spaeter leicht durch ein Backend ersetzbar.

import { t, getLang } from "./i18n.js";

let _data = null;

export async function loadCatalog() {
  if (_data) return _data;
  const res = await fetch("../data/parts.json", { cache: "no-cache" });
  if (!res.ok) throw new Error(t("catalog_load_error", res.status));
  _data = await res.json();
  return _data;
}

export function catalog() {
  if (!_data) throw new Error(t("catalog_not_loaded"));
  return _data;
}

export function geometry() {
  return catalog().geometry;
}

export function tubeColors() {
  return catalog().colors.tube;
}

export function connectorColor() {
  return catalog().colors.connector;
}

export function buildableTubes() {
  return catalog().tubes.filter((t) => t.buildable && t.length_cm != null);
}

export function allTubes() {
  return catalog().tubes;
}

// Baubare Bogenrohre (shape "curved"). Sie haben keine length_cm und tauchen
// daher bewusst NICHT in buildableTubes() auf -- ihr Rasterschritt ist der
// Bogenradius, nicht eine gerade Laenge.
export function buildableCurvedTubes() {
  return catalog().tubes.filter((t) => t.buildable && t.shape === "curved");
}

export function isCurvedTube(id) {
  const t = getTube(id);
  return !!t && t.shape === "curved";
}

export function allConnectors() {
  return catalog().connectors;
}

export function panels() {
  return catalog().panels || [];
}

export function buildablePanels() {
  return panels().filter((p) => p.buildable);
}

export function getPanel(id) {
  return panels().find((p) => p.id === id) || null;
}

// Zubehoer (Raeder, Rollen, Kappen, Gitter ...) -- alles, was als Anbauteil
// am Geruest haengt und keine Kupplung, kein Rohr und keine Platte ist.
/** Teil nach id ueber alle Rubriken -- fuer Stueckliste und Bestand. */
export function getPartById(id) {
  const all = [...allConnectors(), ...accessories(), ...allTubes(), ...panels(), ...reinforcements()];
  return all.find((p) => p.id === id) || null;
}

export function accessories() {
  return catalog().accessories || [];
}

/**
 * Katalogteil zu einer QDF-Elementart ("multi-wheel2" ...). Die Zuordnung steht
 * als Feld `qdf` am Teil, damit Import, Stueckliste und Export dieselbe Quelle
 * nutzen. Die Lochzapfenkupplung gibt es ein- und dreiarmig -- welche, sagt die
 * Arm-Maske aus dem Entwurf.
 */
export function partForFitting(kind, mask) {
  // Die Lagerkupplung hat kein eigenes QDF-Element -- sie ist eine Klemm-
  // Kupplung, die wir selbst setzen, und wird als bearing2 geschrieben.
  if (kind === "bearing-clamp") return getConnector("bearing");
  if (kind === "hole-connector4") {
    let arms = 0;
    for (let b = 0; b < 6; b++) if ((mask || 0) & (1 << b)) arms++;
    return getConnector(arms > 1 ? "hole_t" : "hole_1");
  }
  const all = [...allConnectors(), ...accessories(), ...allTubes(), ...panels()];
  return all.find((x) => x.qdf === kind) || null;
}

// Verstaerkungen (Alu-Profile), die in Rohre geschoben werden.
export function reinforcements() {
  return catalog().reinforcements || [];
}

// Standard-Verstaerkungsprofil (erstes definiertes).
export function reinforcementPart() {
  return reinforcements()[0] || null;
}

// Name eines Verstaerkungslaufs: ersetzt die Katalog-Laenge (40 cm) durch die
// tatsaechliche Lauflange, z. B. "Verstaerkungsprofil 160 cm (Holz)".
export function reinforcementRunName(part, lenCm) {
  const base = (getLang() === 'en' ? part.name_en : null) || part.name || '';
  return base.replace(/\b40\b/, String(Math.round(lenCm)));
}

export function defaultPanel() {
  return geometry().defaultPanel || (buildablePanels()[0] && buildablePanels()[0].id);
}

export function getTube(id) {
  return catalog().tubes.find((t) => t.id === id) || null;
}

export function getConnector(id) {
  return catalog().connectors.find((c) => c.id === id) || null;
}

// Schwarz gibt es nicht als Rohrfarbe, aber als Farbe von Platten, Raedern und
// anderen Anbauteilen -- und in den Herstellerdateien als Material 1.
const EXTRA_COLORS = [{ id: "black", name: "Schwarz", name_en: "Black", hex: "#2b2b2b" }];

function colorDef(colorId) {
  return tubeColors().find((x) => x.id === colorId)
    || EXTRA_COLORS.find((x) => x.id === colorId) || null;
}

export function colorHex(colorId) {
  const c = colorDef(colorId);
  return c ? c.hex : "#888888";
}

export function colorName(colorId) {
  const c = colorDef(colorId);
  if (!c) return colorId;
  return (getLang() === "en" && c.name_en) ? c.name_en : c.name;
}

/** Gibt den Namen eines Teils in der aktuellen Sprache zurück. */
export function partName(part) {
  if (!part) return "";
  return (getLang() === "en" && part.name_en) ? part.name_en : part.name;
}

// Knoten-Abstand (Mitte zu Mitte) fuer eine gegebene Rohrlaenge.
export function spacingFor(lengthCm) {
  return lengthCm + geometry().connectorSize;
}

// Raster-Schritt (40 cm beim 35er) = Basis fuer Diagonalen.
export function gridSpacing() {
  const t = getTube(geometry().defaultTube);
  return spacingFor(t ? t.length_cm : 35);
}

// Rohr fuer schraege (45-Grad) Elemente, z. B. T52 ueber ein 40er-Feld.
export function diagonalTubeId() {
  return geometry().diagonalTube || "T52";
}

// Rutschen/Dach-Art -> i18n-Schluessel. Einziger Ort, der die QDF-"kind"-Werte
// kennt (slide2, slide-new2, ...) -> spaeter leicht erweiterbar.
const SLIDE_KIND_KEYS = {
  "slide2": "slide_slide",            // Modularrutschen-Koerper
  "slide-new2": "slide_integral",     // Integralrutsche, steht fuer sich
  "slide-end2": "slide_end",          // Rutschenauslauf, schliesst eine Kette ab
  "curved-slide2": "slide_curved",    // Bogenrutschen-Koerper
  "roof2": "slide_roof",
};

// Anzeigename einer Rutsche/eines Dachs (BOM/Stueckliste): unbekannte Arten
// fallen auf "Rutsche" zurueck.
export function slideKindName(kind) {
  return t(SLIDE_KIND_KEYS[kind] || "slide_slide");
}

// Beschriftungstext fuer die 3D-Ansicht: liefert null bei unbekannter Art
// (dann wird keine Beschriftung angezeigt).
export function slideKindLabel(kind) {
  const key = SLIDE_KIND_KEYS[kind];
  return key ? t(key) : null;
}
