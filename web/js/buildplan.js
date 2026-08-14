// Aufbauplan: zerlegt das Modell Lage fuer Lage in nachvollziehbare Bauschritte.
// Bewusst ohne Three.js/DOM, damit es testbar und Backend-tauglich bleibt.
//
// Logik: Man baut von unten nach oben. Pro Hoehen-Ebene entsteht zuerst der
// waagerechte Rahmen (Kupplungen + Rohre + Platten), danach die senkrechten
// Stuetzen zur naechsten Ebene. Die Kupplungstypen werden aus dem FERTIGEN
// Modell abgeleitet (man greift beim Bau die endgueltige Kupplung).

import { inferConnectorType, connectorsForNode } from "./bom.js";
import { getTube, getConnector, getPanel, colorName, partName } from "./catalog.js";
import { getLang, t } from "./i18n.js";

const Y_EPS = 0.6; // cm: Knoten innerhalb dieser Hoehe gelten als gleiche Ebene

// Kurzes, gut lesbares Label fuer die 3D-Beschriftung am Knoten.
const SHORT_LABEL_DE = {
  end: "Ende", straight: "Gerade", elbow: "Winkel",
  t: "T", cross: "Kreuz",
  "3way": "3-Wege", "4way": "4-Wege", "5way": "5-Wege", "6way": "6-Wege",
  diagonal: "45°",
};
const SHORT_LABEL_EN = {
  end: "End", straight: "Straight", elbow: "Elbow",
  t: "T", cross: "Cross",
  "3way": "3-way", "4way": "4-way", "5way": "5-way", "6way": "6-way",
  diagonal: "45°",
};
function shortLabel(type) {
  const map = getLang() === "en" ? SHORT_LABEL_EN : SHORT_LABEL_DE;
  return map[type] || type;
}

// Kategorien fuer die farbliche Hervorhebung der Beschriftung im Aufbaumodus.
const FLAECHE_TYPES = new Set(["t", "cross"]);   // planare Flaechenkupplungen
const RAUM_TYPES = new Set(["3way", "4way", "5way", "6way"]); // raeumliche Kupplungen

// Beschriftungstext fuer einen Knoten: Kurzname + Katalog-Code (z. B. "3-Wege CS3").
export function connectorLabel(model, node) {
  const info = connectorLabelInfo(model, node);
  return info ? info.text : null;
}

// Wie connectorLabel, liefert zusaetzlich die Kategorie ("flaeche" | "raum" | null)
// fuer die farbliche Hervorhebung.
export function connectorLabelInfo(model, node) {
  const type = inferConnectorType(model, node);
  if (!type) return null;
  const def = getConnector(type);
  const short = shortLabel(type);
  const text = def && def.code ? `${short} ${def.code}` : short;
  let category = null;
  if (FLAECHE_TYPES.has(type)) category = "flaeche";
  else if (RAUM_TYPES.has(type)) category = "raum";
  return { text, type, category };
}

// Aufbaurichtungen: Achse + Vorzeichen. "y+" = von unten nach oben (Standard),
// "x+" = von links nach rechts, "x-" = von rechts nach links, "z+"/"z-" analog
// fuer vorne/hinten. Je nach Modell und Platz im Raum ist eine andere Reihenfolge
// praktischer -- gebaut wird immer Scheibe fuer Scheibe entlang dieser Achse.
export const BUILD_ORDERS = ["y+", "x+", "x-", "z+", "z-"];

// Liefert die Koordinatenfunktion fuer eine Aufbaurichtung: der Wert waechst
// immer in Baureihenfolge, damit die uebrige Logik unveraendert bleibt.
export function orderCoord(order) {
  const axis = (order || "y+")[0];
  const sign = (order || "y+")[1] === "-" ? -1 : 1;
  return (o) => (o ? o[axis] * sign : 0);
}

// Sortierte, eindeutige Ebenen (cm) des Modells in Aufbaureihenfolge.
export function levelsOf(model, order = "y+") {
  const coord = orderCoord(order);
  const ys = [...model.nodes.values()].map((n) => coord(n)).sort((a, b) => a - b);
  const levels = [];
  for (const y of ys) {
    if (levels.length === 0 || Math.abs(y - levels[levels.length - 1]) > Y_EPS) {
      levels.push(y);
    }
  }
  return levels;
}

function levelIndex(levels, y) {
  for (let i = 0; i < levels.length; i++) {
    if (Math.abs(y - levels[i]) <= Y_EPS) return i;
  }
  // Zwischenwert (z. B. der Einhaengepunkt einer Rutsche, der bewusst etwas
  // ueber der Kupplung sitzt): die NAECHSTGELEGENE Ebene nehmen. Frueher fiel
  // das auf die letzte Ebene zurueck -- solche Teile rutschten dadurch ans
  // Ende des Bauplans.
  let best = 0, bestD = Infinity;
  for (let i = 0; i < levels.length; i++) {
    const d = Math.abs(y - levels[i]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

// --- Zaehl-Helfer -------------------------------------------------------
function countConnectors(model, nodes) {
  const map = new Map(); // type -> count
  let openEnds = 0;
  for (const n of nodes) {
    const types = connectorsForNode(model, n);
    if (types.length === 0) {
      if (model.degree(n.id) >= 1) openEnds++;
      continue;
    }
    for (const type of types) map.set(type, (map.get(type) || 0) + 1);
  }
  const rows = [...map.entries()].map(([type, count]) => {
    const def = getConnector(type) || { name: type, code: "", price: 0 };
    return { type, code: def.code, name: partName(def), count,
             label: shortLabel(type), price: def.price || 0 };
  }).sort((a, b) => b.count - a.count);
  return { rows, openEnds };
}

function countTubes(tubes) {
  const map = new Map(); // tubeId|color -> {tubeId,color,count}
  for (const t of tubes) {
    const key = t.tubeId + "|" + t.color;
    if (!map.has(key)) map.set(key, { tubeId: t.tubeId, color: t.color, count: 0 });
    map.get(key).count++;
  }
  return [...map.values()].map((r) => {
    const def = getTube(r.tubeId) || { name: r.tubeId, length_cm: null, price: 0 };
    return { tubeId: r.tubeId, color: r.color, name: partName(def),
             colorName: colorName(r.color), length: def.length_cm,
             count: r.count, price: def.price || 0 };
  }).sort((a, b) => (a.length || 0) - (b.length || 0));
}

function countPanels(panels) {
  const map = new Map(); // panelId|color -> {panelId,color,count}
  for (const p of panels) {
    const key = p.panelId + "|" + p.color;
    if (!map.has(key)) map.set(key, { panelId: p.panelId, color: p.color, count: 0 });
    map.get(key).count++;
  }
  return [...map.values()].map((r) => {
    const def = getPanel(r.panelId) || { name: r.panelId, price: 0 };
    return { panelId: r.panelId, color: r.color, name: partName(def),
             colorName: colorName(r.color), count: r.count, price: def.price || 0 };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

// Erzeugt den Aufbauplan: ein Array von Schritten.
// Jeder Schritt: { kind, title, level, y, connectors, openEnds, tubes, panels,
//                  nodeIds, tubeIds, panelIds }
export function computeBuildPlan(model, order = "y+") {
  const coord = orderCoord(order);
  const levels = levelsOf(model, order);
  const steps = [];
  if (levels.length === 0) return { levels, steps };

  // Knoten je Ebene
  const nodeLevel = new Map(); // nodeId -> levelIndex
  const nodesByLevel = levels.map(() => []);
  for (const n of model.nodes.values()) {
    const li = levelIndex(levels, coord(n));
    nodeLevel.set(n.id, li);
    nodesByLevel[li].push(n);
  }

  // Rohre einordnen: waagerecht (gleiche Ebene) vs. Stuetze (Ebene -> hoeher)
  const horizByLevel = levels.map(() => []);
  const risersByLevel = levels.map(() => []); // von der UNTEREN Ebene aus
  for (const t of model.tubes.values()) {
    const a = model.nodes.get(t.a), b = model.nodes.get(t.b);
    if (!a || !b) continue;
    const la = nodeLevel.get(a.id), lb = nodeLevel.get(b.id);
    if (la === lb) horizByLevel[la].push(t);
    else risersByLevel[Math.min(la, lb)].push(t);
  }

  // Platten: dem Schritt der hoechsten beteiligten Ebene zuordnen
  // Platten haengen an zwei Rohren -- die Ebene ergibt sich aus deren Knoten.
  const railNodeIds = (p) => {
    const out = [];
    for (const tid of [p.a, p.b]) {
      const t = model.tubes.get(tid);
      if (t) out.push(t.a, t.b);
    }
    return out;
  };
  const panelsByLevel = levels.map(() => []);
  for (const p of model.panels.values()) {
    let maxLi = 0;
    for (const id of railNodeIds(p)) maxLi = Math.max(maxLi, nodeLevel.get(id) ?? 0);
    panelsByLevel[maxLi].push(p);
  }

  // Netze/Stoffe wie Platten (hoechste beteiligte Ebene); Rutschen/Daecher nach Hoehe.
  const textilesByLevel = levels.map(() => []);
  for (const tx of (model.textiles ? model.textiles.values() : [])) {
    let maxLi = 0;
    for (const id of railNodeIds(tx)) maxLi = Math.max(maxLi, nodeLevel.get(id) ?? 0);
    textilesByLevel[maxLi].push(tx);
  }
  // Anbauteile haengen an einem Punkt -- sie kommen in die Ebene, auf der sie
  // sitzen.
  const fittingsByLevel = levels.map(() => []);
  for (const f of (model.fittings ? model.fittings.values() : [])) {
    fittingsByLevel[levelIndex(levels, coord(f))].push(f);
  }
  const slidesByLevel = levels.map(() => []);
  for (const sl of (model.slides ? model.slides.values() : [])) {
    // Eine Rutsche wird eingebaut, sobald ihr OBERER Anschluss steht -- nicht
    // erst auf Hoehe ihres Auslaufs (sonst faellt sie ans Ende des Plans).
    // hook ist der Einhaengepunkt am senkrechten Rohrpaar; importierte Rutschen
    // ohne hook bleiben bei ihrer eigenen Position.
    const anchor = sl.hook ? { x: sl.hook[0], y: sl.hook[1], z: sl.hook[2] } : sl;
    slidesByLevel[levelIndex(levels, coord(anchor))].push(sl);
  }

  for (let i = 0; i < levels.length; i++) {
    const nodes = nodesByLevel[i];
    const horiz = horizByLevel[i];
    const pans = panelsByLevel[i];
    const txs = textilesByLevel[i];
    const sls = slidesByLevel[i];
    const fts = fittingsByLevel[i];

    // Rahmen-Schritt (nur, wenn er etwas Neues bringt)
    if (nodes.length || horiz.length || pans.length || txs.length || sls.length || fts.length) {
      const conn = countConnectors(model, nodes);
      const title = i === 0
        ? t("buildplan_ground_frame", round1(levels[i]))
        : t("buildplan_level_frame", i + 1, round1(levels[i]));
      steps.push({
        kind: "frame", title, level: i, y: levels[i],
        connectors: conn.rows, openEnds: conn.openEnds,
        tubes: countTubes(horiz), panels: countPanels(pans),
        nodeIds: nodes.map((n) => n.id),
        tubeIds: horiz.map((t) => t.id),
        panelIds: pans.map((p) => p.id),
        textileIds: txs.map((tx) => tx.id),
        slideIds: sls.map((sl) => sl.id),
        fittingIds: fts.map((f) => f.id),
      });
    }

    // Stuetzen-Schritt zur naechsten Ebene
    const risers = risersByLevel[i];
    if (risers.length) {
      steps.push({
        kind: "risers",
        title: t("buildplan_risers", i + 1, i + 2),
        level: i, y: levels[i],
        connectors: [], openEnds: 0,
        tubes: countTubes(risers), panels: [],
        nodeIds: [],
        tubeIds: risers.map((t) => t.id),
        panelIds: [],
        textileIds: [],
        slideIds: [],
        fittingIds: [],
      });
    }
  }

  return { levels, steps };
}
