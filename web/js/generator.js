// Modell-Generator: baut aus dem eigenen Teile-Bestand ein vollstaendiges,
// standfestes und bespielbares Modell.
//
// Bewusst ohne Three.js und DOM -- wie model.js/bom.js/buildplan.js damit in
// Node testbar. Die Mengenrechnung wird NICHT nachgebaut: geprueft wird gegen
// computeBOM/compareInventory, also gegen genau die Funktionen, die auch das
// Bestandspanel benutzt.
//
// Ablauf in vier Phasen:
//   A  Massing   -- Grundriss aus ueberlappenden Rechtecken + Hoehenkarte
//   B  Skelett   -- Rahmen je Ebene, Stuetzen bis zum Boden, Podestplatten
//   C  Features  -- (folgt) Hoehle, Terrasse, Kletterwand, Rutsche
//   D  Zuschnitt -- Groesse an den Bestand anpassen, faerben, pruefen

import { BuildModel } from "./model.js";
import { C45_SLEEVE_LEN, C45_ARM_LEN, DIR_ALIGN_TOL } from "./config.js";
import { gridSpacing, geometry, tubeColors, defaultPanel } from "./catalog.js";
import { computeBOM, compareInventory, infeasibleConnectors } from "./bom.js";

export const THEMES = ["burg", "hoehle", "turm", "spielhaus"];
export const SIZES = ["auto", "s", "m", "l", "xl"];

// Welche Bauteile darf der Generator verwenden? 35er-Rohre und Kupplungen sind
// immer dabei -- ohne sie steht nichts.
export const DEFAULT_ALLOW = {
  panels: true, diagonals: true, bows: false, slide: false,
  t15: false, reinforce: false,
  // Kein Schalter im Dialog: die Hoehlenwaende haengen an den Platten und
  // fallen im Bestands-Modus als Erstes weg, wenn die Platten knapp werden.
  cave: true,
};

// Groessenleiter: Grundriss in Zellen + Anzahl Ebenen. Kalibriert an den
// Referenzmodellen (bis 7x10 Zellen, 6 Ebenen) und den Original-Entwuerfen
// (Median 41 Kupplungen -- die kleinen Stufen decken den Normalfall ab).
const SIZE_LADDER = [
  { nx: 2, nz: 2, levels: 1 },
  { nx: 3, nz: 2, levels: 2 },
  { nx: 3, nz: 3, levels: 2 },
  { nx: 4, nz: 3, levels: 3 },
  { nx: 4, nz: 4, levels: 3 },
  { nx: 5, nz: 4, levels: 4 },
  { nx: 6, nz: 5, levels: 5 },
  { nx: 7, nz: 6, levels: 6 },
  { nx: 7, nz: 10, levels: 6 },
];

// Benannte Groessen -> Stufe auf der Leiter.
const SIZE_INDEX = { s: 2, m: 4, l: 6, xl: 8 };

const PANEL_EXTRA_COLOR = "black"; // Platten gibt es zusaetzlich in Schwarz

// Sparstufen fuer den Bestands-Modus: der Reihe nach fallen die Zutaten weg,
// die am ehesten an einzelnen Teilen scheitern -- zuerst das Dach, zuletzt die
// Hoehlenwaende. Die Podestplatten bleiben, sie sind der Sinn des Modells.
const ALLOW_REDUCTIONS = [
  (a) => a,
  (a) => ({ ...a, bows: false }),
  (a) => ({ ...a, bows: false, diagonals: false }),
  (a) => ({ ...a, bows: false, diagonals: false, t15: false }),
  (a) => ({ ...a, bows: false, diagonals: false, t15: false, reinforce: false }),
  (a) => ({ ...a, bows: false, diagonals: false, t15: false, reinforce: false, cave: false }),
];

// Letzter Ausweg: das nackte Geruest aus 35er-Rohren und Kupplungen.
const BARE_ALLOW = {
  panels: false, diagonals: false, bows: false, slide: false,
  t15: false, reinforce: false, cave: false,
};

// --- Zufall ---------------------------------------------------------------
// Kleiner deterministischer Generator (mulberry32): gleicher Seed -> gleiches
// Modell. Noetig fuer reproduzierbare Tests und ein spaeteres "nochmal dieses".
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  constructor(seed) { this._r = mulberry32(seed >>> 0); }
  next() { return this._r(); }
  int(lo, hi) { return lo + Math.floor(this._r() * (hi - lo + 1)); }
  pick(arr) { return arr[Math.floor(this._r() * arr.length)]; }
  chance(p) { return this._r() < p; }
}

// --- Phase A: Massing -----------------------------------------------------

const key = (i, k) => i + "," + k;

// Form je Thema: Anzahl der Bloecke und Kantenlaenge des Kerns (in Zellen).
// Ein Turm ist ein schlanker Block, eine Burg ein Verbund aus mehreren.
// cover = angestrebter Anteil der belegten Flaeche an der Grundriss-Flaeche.
const THEME_SHAPE = {
  burg:      { blocks: [2, 5], core: [2, 3], cover: 0.60 },
  hoehle:    { blocks: [1, 3], core: [3, 4], cover: 0.75 },
  turm:      { blocks: [1, 2], core: [2, 2], cover: 0.30 },
  spielhaus: { blocks: [1, 4], core: [2, 3], cover: 0.50 },
};

// Ein Block darf nicht beliebig duenn und hoch sein: hoechstens seine kleinste
// Grundkante plus drei Ebenen. Ein 2x2-Block (80x80 cm) kommt damit auf 5
// Ebenen -- die Referenzmodelle enden mit 2x2 bis 3x3 Zellen auf 200 cm.
const SLENDERNESS = 3;

/**
 * Grundriss + Hoehenkarte.
 *
 * Der Grundriss ist die Vereinigung mehrerer Bloecke, jeder mit EIGENER Hoehe;
 * die Hoehe einer Zelle ist das Maximum der Bloecke, die sie ueberdecken. Aus
 * dem Verbund entsteht die gestufte, verwinkelte Form der Referenzmodelle --
 * ein Hoehenabfall nach aussen allein ergaebe nur eine Pyramide.
 *
 * Jeder Block ueberdeckt mindestens eine schon belegte Zelle; damit haengt der
 * Grundriss immer zusammen.
 *
 * Liefert { cells: Map "i,k" -> { i, k, h }, levels, nx, nz }.
 */
function makeMassing(rng, size, theme, ridgeWidth = 0) {
  const { nx, nz, levels } = size;
  const shape = THEME_SHAPE[theme] || THEME_SHAPE.spielhaus;
  const cells = new Map();

  const heightFor = (w, d, full) => {
    const cap = Math.min(levels, Math.min(w, d) + SLENDERNESS);
    return full ? cap : Math.max(1, Math.min(cap, rng.int(1, Math.max(1, levels - 1))));
  };
  const place = (i0, k0, w, d, h) => {
    for (let i = i0; i < i0 + w; i++) {
      for (let k = k0; k < k0 + d; k++) {
        const kk = key(i, k);
        const c = cells.get(kk);
        if (c) c.h = Math.max(c.h, h);
        else cells.set(kk, { i, k, h });
      }
    }
  };

  // Ein Giebeldach braucht einen First, also einen Streifen von genau einer
  // Zelle Breite ganz oben -- zufaellig entsteht der so gut wie nie. Ist ein
  // Dach erwuenscht, bleibt der Kern eine Ebene tiefer und der First kommt
  // anschliessend als eigener Block darauf.
  const ridge = ridgeWidth > 0 && levels >= 3
    && Math.min(nx, nz) >= ridgeWidth + 1 && rng.chance(0.45);

  // Kern: traegt die volle Hoehe. Bei grossen Grundrissen waechst er mit, sonst
  // deckelt die Schlankheitsregel die Hoehe eines 2x2-Kerns zu frueh.
  const grow = Math.floor(Math.min(nx, nz) / 4);
  const side = () => Math.max(1, rng.int(shape.core[0], shape.core[1]) + grow);
  const cw = Math.min(nx, side()), cd = Math.min(nz, side());
  const coreH = heightFor(cw, cd, true) - (ridge ? 1 : 0);
  const core = { i0: rng.int(0, nx - cw), k0: rng.int(0, nz - cd), w: cw, d: cd };
  place(core.i0, core.k0, cw, cd, Math.max(1, coreH));

  // Anbauten: jeder greift eine vorhandene Zelle auf, damit alles zusammenhaengt.
  // Gebaut wird, bis die angestrebte Flaechendeckung erreicht ist.
  const maxBlocks = rng.int(shape.blocks[0], shape.blocks[1]);
  const target = nx * nz * shape.cover;
  for (let b = 1; b < maxBlocks && cells.size < target; b++) {
    const w = Math.max(1, Math.min(nx, rng.int(1, Math.round(nx * 0.7))));
    const d = Math.max(1, Math.min(nz, rng.int(1, Math.round(nz * 0.7))));
    const anchor = rng.pick([...cells.values()]);
    const i0 = Math.max(0, Math.min(nx - w, anchor.i - rng.int(0, w - 1)));
    const k0 = Math.max(0, Math.min(nz - d, anchor.k - rng.int(0, d - 1)));
    place(i0, k0, w, d, heightFor(w, d, false));
  }

  // First: ein Zelle breiter Streifen laengs des Kerns, eine Ebene ueber ALLEM
  // anderen -- nur dann findet der Dachbau spaeter einen freien Streifen und
  // die Sparren stossen an nichts. Er darf die Groessenstufe um eine Ebene
  // ueberschreiten; als aufgesetzter First ist er von unten voll abgestuetzt.
  let usedLevels = levels;
  if (ridge) {
    let maxH = 0;
    for (const c of cells.values()) maxH = Math.max(maxH, c.h);
    const alongX = core.w >= core.d;
    const len = Math.max(2, alongX ? core.w : core.d);
    const i0 = alongX ? core.i0 : core.i0 + Math.floor((core.w - ridgeWidth) / 2);
    const k0 = alongX ? core.k0 + Math.floor((core.d - ridgeWidth) / 2) : core.k0;
    usedLevels = maxH + 1;
    place(i0, k0, alongX ? len : ridgeWidth, alongX ? ridgeWidth : len, usedLevels);
  }
  return { cells, levels: usedLevels, nx, nz };
}

// --- Phase B: Skelett -----------------------------------------------------

// Kanten einer Zelle. "x" laeuft in i-Richtung, "z" in k-Richtung; der
// Schluessel benennt immer den kleineren Endknoten.
function cellEdges(i, k) {
  return [
    { a: "x", i, k }, { a: "x", i, k: k + 1 },
    { a: "z", i, k }, { a: "z", i: i + 1, k },
  ];
}
const edgeKey = (e) => e.a + ":" + e.i + "," + e.k;
const edgeNodes = (e) => (e.a === "x"
  ? [{ i: e.i, k: e.k }, { i: e.i + 1, k: e.k }]
  : [{ i: e.i, k: e.k }, { i: e.i, k: e.k + 1 }]);

/**
 * Welche Rahmen-Kanten und welche Platten gehoeren zu welcher Ebene?
 *
 * Rahmen: die AUSSENKANTEN der auf dieser Ebene noch vorhandenen Zellen
 * (Kanten, die nur zu einer Zelle gehoeren). Innenkanten bleiben frei -- so
 * entsteht ein begehbarer Raum statt eines vollen Gitters. Die Referenzmodelle
 * liegen genau in dieser Groessenordnung (66 waagerechte Rohre auf 63 Knoten).
 *
 * Platten liegen auf der obersten Ebene einer Zellsaeule: dort steht man. Die
 * vier Randrohre dieser Zelle werden dafuer zusaetzlich gebaut.
 */
function planLevels(mass, allow) {
  const levels = [];
  for (let j = 0; j < mass.levels; j++) {
    const active = [...mass.cells.values()].filter((c) => c.h > j);
    if (!active.length) break;
    const count = new Map();
    for (const c of active) {
      for (const e of cellEdges(c.i, c.k)) {
        const kk = edgeKey(e);
        count.set(kk, (count.get(kk) || 0) + 1);
      }
    }
    const edges = new Map();
    for (const c of active) {
      for (const e of cellEdges(c.i, c.k)) {
        if (count.get(edgeKey(e)) === 1) edges.set(edgeKey(e), e);
      }
    }
    // Podeste: Zellen, deren Saeule hier endet.
    const decks = allow.panels ? active.filter((c) => c.h === j + 1) : [];
    for (const c of decks) {
      for (const e of cellEdges(c.i, c.k)) edges.set(edgeKey(e), e);
    }
    levels.push({ j, active, edges: [...edges.values()], decks });
  }
  return levels;
}

/** Baut Rahmen, Stuetzen und Platten in ein leeres Modell. */
function buildSkeleton(model, mass, rng, allow) {
  const ctx = makeCtx(model, mass, rng, allow);
  const { node, tubeColor, panelColors } = ctx;

  const plan = planLevels(mass, allow);
  const top = new Map(); // Knoten "i,k" -> hoechste Ebene, auf der er gebraucht wird

  // Waagerechte Rahmen
  for (const lvl of plan) {
    for (const e of lvl.edges) {
      const [p, q] = edgeNodes(e);
      const a = node(p.i, lvl.j, p.k), b = node(q.i, lvl.j, q.k);
      model.addTube(a.id, b.id, "T35", tubeColor(), 35);
      for (const n of [p, q]) {
        const kk = key(n.i, n.k);
        if (!top.has(kk) || top.get(kk) < lvl.j) top.set(kk, lvl.j);
      }
    }
  }

  // Stuetzen: unter jedem benutzten Knoten durchgehend bis zum Boden. Damit
  // steht jede Rahmenecke auf dem Boden -- keine Kragarme.
  for (const [kk, jTop] of top) {
    const [i, k] = kk.split(",").map(Number);
    for (let j = 1; j <= jTop; j++) {
      const a = node(i, j - 1, k), b = node(i, j, k);
      model.addTube(a.id, b.id, "T35", tubeColor(), 35);
    }
  }

  // Platten auf den Podest-Feldern
  const panelId = defaultPanel();
  for (const lvl of plan) {
    for (const c of lvl.decks) {
      const ids = [
        node(c.i, lvl.j, c.k).id, node(c.i + 1, lvl.j, c.k).id,
        node(c.i + 1, lvl.j, c.k + 1).id, node(c.i, lvl.j, c.k + 1).id,
      ];
      model.addPanel(ids, panelId, rng.pick(panelColors));
    }
  }
  ctx.plan = plan;
  ctx.top = top;
  return ctx;
}

// --- Phase C: Features ----------------------------------------------------

/** Gemeinsamer Zustand der Bau-Helfer (Raster, Farben, Modellzugriff). */
function makeCtx(model, mass, rng, allow) {
  const STEP = gridSpacing();
  const y0 = geometry().connectorSize / 2;
  const colors = tubeColors().map((c) => c.id);
  return {
    model, mass, rng, allow, STEP, y0, colors,
    // Kupplungen, an denen ein Dach ansetzt -- dort darf nichts mehr hoch.
    roofNodes: new Set(),
    panelColors: colors.concat(PANEL_EXTRA_COLOR),
    tubeColor: () => rng.pick(colors),
    node: (i, j, k) => model.addNode(i * STEP, y0 + j * STEP, k * STEP),
    // Nur nachschlagen, nicht anlegen -- Features duerfen kein Raster erfinden.
    find: (i, j, k) => model.findNodeNear(i * STEP, y0 + j * STEP, k * STEP),
  };
}

/**
 * Waende der Hoehle: die untersten Aussenkanten werden mit stehenden Platten
 * geschlossen. Ein Stueck bleibt als Eingang offen -- eine rundum zugemachte
 * Hoehle waere keine.
 */
function addCaveWalls(ctx, levels) {
  const { model, plan, top, rng, panelColors } = ctx;
  const panelId = defaultPanel();
  let added = 0;
  for (let j = 0; j < Math.min(levels, plan.length - 1); j++) {
    const usable = plan[j].edges.filter((e) => edgeNodes(e)
      .every((n) => (top.get(key(n.i, n.k)) || 0) >= j + 1));
    if (usable.length < 4) continue;
    // Eingang: zwei zusammenhaengende Kanten der untersten Ebene bleiben frei.
    const skip = j === 0 ? rng.int(0, usable.length - 1) : -1;
    for (let idx = 0; idx < usable.length; idx++) {
      if (skip >= 0 && (idx === skip || idx === (skip + 1) % usable.length)) continue;
      const [p, q] = edgeNodes(usable[idx]);
      const ids = [
        ctx.find(p.i, j, p.k), ctx.find(q.i, j, q.k),
        ctx.find(q.i, j + 1, q.k), ctx.find(p.i, j + 1, p.k),
      ];
      if (ids.some((n) => !n)) continue;
      if (model.addPanel(ids.map((n) => n.id), panelId, rng.pick(panelColors))) added++;
    }
  }
  return added;
}

/**
 * Gelaender rings um die Podeste: ueber jeder Aussenkante einer endenden
 * Zellsaeule eine weitere Ebene aus Pfosten und Riegel. Eine Kante bleibt als
 * Zugang frei.
 */
function addRailings(ctx) {
  const { model, mass, plan, rng, node, tubeColor } = ctx;
  let added = 0;
  for (const lvl of plan) {
    const deckAt = new Set(lvl.decks.map((c) => key(c.i, c.k)));
    if (!deckAt.size) continue;
    // Aussenkanten, an denen ein hier endendes Podest liegt.
    const rails = lvl.edges.filter((e) => {
      const cells = e.a === "x"
        ? [{ i: e.i, k: e.k }, { i: e.i, k: e.k - 1 }]
        : [{ i: e.i, k: e.k }, { i: e.i - 1, k: e.k }];
      return cells.some((c) => deckAt.has(key(c.i, c.k)));
    });
    if (rails.length < 3) continue;
    const skip = rng.int(0, rails.length - 1); // Zugang
    for (let idx = 0; idx < rails.length; idx++) {
      if (idx === skip) continue;
      const [p, q] = edgeNodes(rails[idx]);
      // Wo ein Dach ansetzt, gibt es kein Gelaender: Pfosten und Riegel
      // besetzten den Stutzen, auf dem die Winkelkupplung sitzt. Geprueft
      // werden beide Ebenen -- der Riegel liegt eine Ebene ueber der Kante,
      // und genau dort steht oft die Kupplung eines hoeheren Nachbarn.
      // (Das Kennzeichen c45 traegt der Adapterkoerper, nicht die Kupplung
      // darunter -- deshalb die eigene Liste aus dem Dachbau.)
      const carriers = [
        ctx.find(p.i, lvl.j, p.k), ctx.find(q.i, lvl.j, q.k),
        ctx.find(p.i, lvl.j + 1, p.k), ctx.find(q.i, lvl.j + 1, q.k),
      ];
      if (carriers.some((n) => n && ctx.roofNodes.has(n.id))) continue;
      // Steht hier schon etwas Hoeheres, waere das kein Gelaender, sondern ein
      // Doppelrohr -- solche Kanten ueberspringen.
      const cells = [{ i: p.i, k: p.k }, { i: p.i - 1, k: p.k }, { i: p.i, k: p.k - 1 }, { i: p.i - 1, k: p.k - 1 }];
      if (cells.some((c) => (mass.cells.get(key(c.i, c.k))?.h ?? 0) > lvl.j + 1)) continue;
      const a0 = node(p.i, lvl.j, p.k), a1 = node(p.i, lvl.j + 1, p.k);
      const b0 = node(q.i, lvl.j, q.k), b1 = node(q.i, lvl.j + 1, q.k);
      model.addTube(a0.id, a1.id, "T35", tubeColor(), 35);
      model.addTube(b0.id, b1.id, "T35", tubeColor(), 35);
      if (model.addTube(a1.id, b1.id, "T35", tubeColor(), 35)) added++;
    }
  }
  return added;
}

/**
 * Kletterwand: an einer Aussenkante werden die Pfosten in zwei 15er geteilt und
 * auf halber Hoehe Sprossen eingezogen -- so kommt man ohne Leiter hoch.
 */
function addClimbingWall(ctx) {
  const { model, plan, top, rng, node, tubeColor, y0, STEP } = ctx;
  const cand = plan[0].edges.filter((e) => {
    const [p, q] = edgeNodes(e);
    if (!edgeNodes(e).every((n) => (top.get(key(n.i, n.k)) || 0) >= 2)) return false;
    // Nicht dort klettern, wo eine Wandplatte haengt: das Teilen der Pfosten
    // nimmt ihr die Auflage.
    const ids = [ctx.find(p.i, 0, p.k), ctx.find(q.i, 0, q.k),
                 ctx.find(q.i, 1, q.k), ctx.find(p.i, 1, p.k)];
    if (ids.some((n) => !n)) return false;
    return !model.panelOnCell(ids.map((n) => n.id));
  });
  if (!cand.length) return 0;
  const e = rng.pick(cand);
  const [p, q] = edgeNodes(e);
  const height = Math.min(
    top.get(key(p.i, p.k)), top.get(key(q.i, q.k)), 3,
  );
  let rungs = 0;
  for (let j = 0; j < height; j++) {
    const mids = [];
    for (const n of [p, q]) {
      const lo = ctx.find(n.i, j, n.k), hi = ctx.find(n.i, j + 1, n.k);
      if (!lo || !hi) return rungs;
      const post = model.tubeBetween(lo.id, hi.id);
      // Eine Stelle ohne durchgehenden Pfosten (z. B. schon geteilt) auslassen.
      if (!post || post.tubeId !== "T35") return rungs;
      model.removeTube(post.id);
      const mid = model.addNode(n.i * STEP, y0 + j * STEP + STEP / 2, n.k * STEP);
      model.addTube(lo.id, mid.id, "T15", post.color, 15);
      model.addTube(mid.id, hi.id, "T15", post.color, 15);
      mids.push(mid);
    }
    if (model.addTube(mids[0].id, mids[1].id, "T35", tubeColor(), 35)) rungs++;
  }
  return rungs;
}

/**
 * Hangelstrecke: auf einem hoch gelegenen Podest bleibt eine Reihe von Feldern
 * ohne Platten. Die Querrohre zwischen den Feldern sind die Sprossen, unter
 * ihnen ist Luft.
 */
function addMonkeyBars(ctx) {
  const { model, plan, rng } = ctx;
  // Podeste weit oben, an denen mindestens zwei Felder in einer Reihe liegen.
  for (const lvl of [...plan].reverse()) {
    if (lvl.j < 2 || lvl.decks.length < 2) continue;
    const at = new Set(lvl.decks.map((c) => key(c.i, c.k)));
    for (const c of lvl.decks) {
      for (const step of [{ di: 1, dk: 0 }, { di: 0, dk: 1 }]) {
        const run = [c];
        while (run.length < 3) {
          const nxt = { i: run[run.length - 1].i + step.di, k: run[run.length - 1].k + step.dk };
          if (!at.has(key(nxt.i, nxt.k))) break;
          run.push(nxt);
        }
        if (run.length < 2) continue;
        let removed = 0;
        for (const cell of run) {
          const ids = [
            ctx.find(cell.i, lvl.j, cell.k), ctx.find(cell.i + 1, lvl.j, cell.k),
            ctx.find(cell.i + 1, lvl.j, cell.k + 1), ctx.find(cell.i, lvl.j, cell.k + 1),
          ];
          if (ids.some((n) => !n)) continue;
          const pan = model.panelOnCell(ids.map((n) => n.id));
          if (pan) { model.removePanel(pan.id); removed++; }
        }
        if (removed >= 2) return removed;
      }
    }
    if (rng.chance(0.5)) break; // nicht jedes Modell braucht eine Hangelstrecke
  }
  return 0;
}

// --- Daecher --------------------------------------------------------------

/**
 * Streifen fuer ein Dach suchen: eine Reihe von Zellen, die auf ihrer obersten
 * Ebene liegen und quer zur Reihe genau `width` Zellen breit sind. Nur ueber so
 * einem Streifen treffen sich die Sparren bzw. Boegen wieder in einem Punkt.
 *
 * Liefert { j, dir ("x"|"z"), i0, k0, len } oder null.
 */
function findRoofStrip(mass, width) {
  const active = (i, k, j) => (mass.cells.get(key(i, k))?.h ?? 0) > j;
  const best = { len: 0 };
  for (const c of mass.cells.values()) {
    const j = c.h - 1;
    // quer zur Reihe genau `width` breit und beidseitig nichts daneben
    for (const dir of ["x", "z"]) {
      const across = dir === "x" ? { di: 1, dk: 0 } : { di: 0, dk: 1 };
      const along = dir === "x" ? { di: 0, dk: 1 } : { di: 1, dk: 0 };
      // Anfang der Querreihe?
      if (active(c.i - across.di, c.k - across.dk, j)) continue;
      let w = 0;
      while (active(c.i + across.di * w, c.k + across.dk * w, j)
             && (mass.cells.get(key(c.i + across.di * w, c.k + across.dk * w))?.h ?? 0) === c.h) w++;
      if (w !== width) continue;
      // Nebenan darf nichts HOEHER stehen: dessen Pfosten und Riegel laegen
      // sonst genau im Weg der Sparren.
      if (active(c.i + across.di * w, c.k + across.dk * w, j)) continue;
      // Anfang der Laengsreihe?
      if (active(c.i - along.di, c.k - along.dk, j)) continue;
      let len = 0;
      while (true) {
        const i = c.i + along.di * len, k = c.k + along.dk * len;
        let full = true;
        for (let s = 0; s < width; s++) {
          const cc = mass.cells.get(key(i + across.di * s, k + across.dk * s));
          if (!cc || cc.h !== c.h) { full = false; break; }
        }
        if (!full) break;
        len++;
      }
      // Ein Dach gehoert nach oben -- auf der Bodenebene waere es ein Tor --,
      // und ein einzelnes Sparrenpaar ist kein Dach, sondern ein Dreieck:
      // hoechster, dann laengster Streifen gewinnt.
      if (len < 2 || j < 1) continue;
      if (!best.len || j > best.j || (j === best.j && len > best.len)) {
        Object.assign(best, { j, dir, i0: c.i, k0: c.k, len, h: c.h });
      }
    }
  }
  return best.len ? best : null;
}

/** Steckt am Knoten schon etwas in Richtung `axis`? Dann ist dort kein Platz
 *  fuer die Huelse einer Winkelkupplung. */
function armFree(model, node, axis) {
  for (const t of model.tubes.values()) {
    if (t.link) continue;
    let nb = null;
    if (t.a === node.id) nb = model.nodes.get(t.b);
    else if (t.b === node.id) nb = model.nodes.get(t.a);
    if (!nb) continue;
    const dx = nb.x - node.x, dy = nb.y - node.y, dz = nb.z - node.z;
    const L = Math.hypot(dx, dy, dz) || 1;
    if ((dx / L) * axis[0] + (dy / L) * axis[1] + (dz / L) * axis[2] > DIR_ALIGN_TOL) return false;
  }
  return true;
}

/**
 * Giebeldach ueber einem ein Zelle breiten Streifen: je Rasterlinie zwei
 * Sparren ueber 45-Grad-Winkelkupplungen, die sich ueber der Mitte treffen.
 * Breitere Streifen bekommen keins -- ein 35er-Rohr im 45-Grad-Raster reicht
 * genau ueber eine halbe Zelle, ueber zwei Zellen traefen sich die Sparren nie.
 */
function addGableRoof(ctx) {
  const { model, mass, rng, tubeColor } = ctx;
  const strip = findRoofStrip(mass, 1);
  if (!strip) return 0;
  const S = Math.SQRT1_2;
  const across = strip.dir === "x" ? [1, 0, 0] : [0, 0, 1];
  const j = strip.j;
  let built = 0;
  for (let n = 0; n <= strip.len; n++) {
    const along = strip.dir === "x" ? { di: 0, dk: n } : { di: n, dk: 0 };
    const lo = { i: strip.i0 + along.di, k: strip.k0 + along.dk };
    const hi = { i: lo.i + across[0], k: lo.k + across[2] };
    const a = ctx.find(lo.i, j, lo.k), b = ctx.find(hi.i, j, hi.k);
    if (!a || !b) continue;
    const dirA = [across[0] * S, S, across[2] * S];
    const dirB = [-across[0] * S, S, -across[2] * S];
    const axisA = [-across[0], 0, -across[2]];
    const axisB = [across[0], 0, across[2]];
    if (!armFree(model, a, axisA) || !armFree(model, b, axisB)) continue;
    const color = tubeColor();
    const r1 = model.extendC45Diagonal(a.id, dirA, axisA, "T35", color, 35,
      gridSpacing(), C45_SLEEVE_LEN, C45_ARM_LEN);
    if (!r1 || !r1.tube) continue;
    ctx.roofNodes.add(a.id);
    const r2 = model.extendC45Diagonal(b.id, dirB, axisB, "T35", color, 35,
      gridSpacing(), C45_SLEEVE_LEN, C45_ARM_LEN);
    if (r2 && r2.tube) { ctx.roofNodes.add(b.id); built++; }
  }
  if (built) rng.next();  // Farbfolge bleibt unabhaengig von der Sparrenzahl
  return built;
}

/**
 * Rundbogendach ueber einem zwei Zellen breiten Streifen: je Rasterlinie zwei
 * Viertelkreise, die sich ueber der Mitte treffen.
 */
function addBowRoof(ctx) {
  const { model, mass, tubeColor } = ctx;
  const strip = findRoofStrip(mass, 2);
  if (!strip) return 0;
  const across = strip.dir === "x" ? [1, 0, 0] : [0, 0, 1];
  const R = gridSpacing();
  const j = strip.j;
  let built = 0;
  for (let n = 0; n <= strip.len; n++) {
    const along = strip.dir === "x" ? { di: 0, dk: n } : { di: n, dk: 0 };
    const lo = { i: strip.i0 + along.di, k: strip.k0 + along.dk };
    const hi = { i: lo.i + across[0] * 2, k: lo.k + across[2] * 2 };
    const a = ctx.find(lo.i, j, lo.k), b = ctx.find(hi.i, j, hi.k);
    if (!a || !b) continue;
    const color = tubeColor();
    const r1 = model.extendBow(a.id, [0, 1, 0], across, "TC1", color, R);
    if (!r1 || !r1.tube) continue;
    ctx.roofNodes.add(a.id);
    const r2 = model.extendBow(b.id, [0, 1, 0], [-across[0], 0, -across[2]], "TC1", color, R);
    if (r2 && r2.tube) { ctx.roofNodes.add(b.id); built++; }
  }
  return built;
}

/** Rutsche an das hoechste passende senkrechte Rohrpaar haengen. */
function addSlide(ctx) {
  const { model, rng, colors } = ctx;
  const mounts = model.slideMounts(gridSpacing());
  if (!mounts.length) return 0;
  let best = null;
  for (const m of mounts) if (!best || m.hook[1] > best.hook[1]) best = m;
  if (!best) return 0;
  return model.addSlide(best.hook, best.normal, "slide-new2", rng.pick(colors)) ? 1 : 0;
}

/**
 * Verstaerkungsprofile in die Rohre schieben, die das Modell selbst als
 * gefaehrdet meldet -- frei tragende Waagerechte ohne Stuetze darunter.
 */
function addReinforcements(ctx) {
  const { model } = ctx;
  let n = 0;
  for (const id of model.reinforcementSuggestions()) {
    const t = model.tubes.get(id);
    if (t && !t.arm && !t.link && !t.bow) { t.reinforced = true; n++; }
  }
  return n;
}

/** Alle Features anwenden, die Thema und erlaubte Bauteile hergeben. */
function applyFeatures(ctx, theme) {
  const { allow, rng } = ctx;
  const feats = [];
  // Dach zuerst: es belegt die Arme der obersten Kupplungen, an denen sonst ein
  // Gelaender ansetzen wuerde. Sind beide Formen erlaubt, entscheidet der
  // Wurf -- sonst gaebe es nie einen Rundbogen.
  const roofs = rng.chance(0.5) ? ["gable", "arch"] : ["arch", "gable"];
  for (const kind of roofs) {
    if (kind === "gable" && allow.diagonals && addGableRoof(ctx)) { feats.push("gable"); break; }
    if (kind === "arch" && allow.bows && addBowRoof(ctx)) { feats.push("arch"); break; }
  }
  if (allow.panels && allow.cave !== false && (theme === "hoehle" || rng.chance(0.5))) {
    if (addCaveWalls(ctx, theme === "hoehle" ? 2 : 1)) feats.push("cave");
  }
  if (addRailings(ctx)) feats.push("railing");
  if (allow.t15 && addClimbingWall(ctx)) feats.push("climb");
  if (allow.panels && addMonkeyBars(ctx)) feats.push("monkeybars");
  if (allow.slide && addSlide(ctx)) feats.push("slide");
  if (allow.reinforce && addReinforcements(ctx)) feats.push("reinforce");
  return feats;
}

// --- Phase D: Pruefung und Zuschnitt --------------------------------------

/** Haengt alles zusammen? Ein Modell in zwei Teilen waere kein Modell. */
function isConnected(model) {
  const ids = [...model.nodes.keys()];
  if (ids.length <= 1) return true;
  const adj = new Map(ids.map((id) => [id, []]));
  for (const t of model.tubes.values()) {
    if (!adj.has(t.a) || !adj.has(t.b)) continue;
    adj.get(t.a).push(t.b);
    adj.get(t.b).push(t.a);
  }
  const seen = new Set([ids[0]]);
  const stack = [ids[0]];
  while (stack.length) {
    for (const nb of adj.get(stack.pop())) {
      if (!seen.has(nb)) { seen.add(nb); stack.push(nb); }
    }
  }
  return seen.size === ids.length;
}

/** Ist das Modell baubar? Liefert null oder den Grund. */
export function validate(model) {
  for (const n of model.nodes.values()) {
    if (model.isBelowGround(n.y)) return "ground";
  }
  if (model.collisions().size) return "collision";
  if (infeasibleConnectors(model).size) return "connector";
  if (!isConnected(model)) return "split";
  return null;
}

/** Ein Modell einer Groessenstufe bauen. */
function buildAt(step, rng, theme, allow) {
  const model = new BuildModel();
  // Der First ist so breit wie das Dach, das darauf passt: eine Zelle fuer den
  // Giebel aus Schraegen, zwei fuer den Rundbogen.
  const ridgeWidth = allow.diagonals ? 1 : (allow.bows ? 2 : 0);
  const mass = makeMassing(rng, step, theme, ridgeWidth);
  const ctx = buildSkeleton(model, mass, rng, allow);
  const features = applyFeatures(ctx, theme);
  return { model, mass, features };
}

function metaOf(model, mass, theme, step, features) {
  let tubes = 0;
  for (const t of model.tubes.values()) if (!t.arm && !t.link) tubes++;
  return {
    theme,
    footprint: [step.nx, step.nz],
    levels: mass.levels,
    cells: mass.cells.size,
    nodes: model.nodes.size,
    tubes,
    panels: model.panels.size,
    price: computeBOM(model).totals.price,
    features: features || [],
  };
}

/**
 * Erzeugt ein Modell.
 *
 * opts:
 *   seed       Zahl; gleicher Seed -> gleiches Modell
 *   theme      "random" | THEMES
 *   size       "auto" | "s" | "m" | "l" | "xl" ("auto" = so gross wie der
 *              Bestand es hergibt)
 *   inventory  { tubes:{}, connectors:{}, panels:{}, reinforcements:{} } oder
 *              null. Gesetzt = das Modell muss vollstaendig daraus baubar sein.
 *   allow      erlaubte Bauteile (siehe DEFAULT_ALLOW)
 *
 * Liefert { ok, reason, json, meta, missing }.
 */
export function generateModel(opts = {}) {
  const seed = opts.seed != null ? opts.seed : (Math.random() * 4294967296) >>> 0;
  const allow = { ...DEFAULT_ALLOW, ...(opts.allow || {}) };
  const inv = opts.inventory || null;
  const theme = (!opts.theme || opts.theme === "random")
    ? new Rng(seed ^ 0x9e3779b9).pick(THEMES) : opts.theme;

  // Ohne Platten im Bestand hat eine Plattenoption keinen Sinn.
  if (inv && allow.panels && !hasAny(inv.panels)) allow.panels = false;

  // Eine Groessenstufe mit dem reichsten Zutatensatz bauen, der noch passt.
  const attempt = (idx, sets) => {
    let last = { ok: false, reason: "failed", missing: [] };
    for (const a of sets) {
      const res = attemptWith(idx, a);
      if (res.ok) return res;
      last = res;
    }
    return last;
  };

  const attemptWith = (idx, a) => {
    const step = SIZE_LADDER[idx];
    // Der Seed haengt an der Stufe: sonst wuerde jede Stufe dasselbe Massing
    // mit anderer Groesse liefern und die Suche saehe immer gleich aus.
    const { model, mass, features } = buildAt(step, new Rng(seed + idx * 7919), theme, a);
    const bad = validate(model);
    if (bad) return { ok: false, reason: bad, missing: [] };
    const cmp = inv ? compareInventory(computeBOM(model), inv) : null;
    if (!cmp || cmp.feasible) return { ok: true, model, mass, step, features, missing: [] };
    return {
      ok: false, reason: "inventory", model, mass, step, features,
      missing: cmp.rows.filter((r) => !r.ok),
    };
  };

  // Groesste Stufe suchen, die noch passt: binaer ueber die Leiter.
  // Groesste Stufe suchen, die noch passt: binaer ueber die Leiter. Die Suche
  // endet immer bei Stufe 0, bevor sie aufgibt -- die kleinste Stufe wird also
  // nie uebersprungen.
  const search = (sets) => {
    let found = null, last = null;
    let lo = 0, hi = SIZE_LADDER.length - 1;
    if (opts.size && SIZE_INDEX[opts.size] != null) hi = Math.min(hi, SIZE_INDEX[opts.size]);
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const res = attempt(mid, sets);
      last = res;
      if (res.ok) { found = res; lo = mid + 1; }
      else hi = mid - 1;
    }
    return { found, last };
  };

  // Reicht der Bestand nicht, liegt das oft an einem einzelnen Zusatz (vier
  // Bogenrohre fuers Dach), nicht an der Groesse: erst die Zutaten kuerzen,
  // die Groesse nur so weit wie noetig. Das nackte Geruest kommt zuletzt.
  const sets = inv ? ALLOW_REDUCTIONS.map((r) => r(allow)) : [allow];
  let { found: best, last: lastFail } = search(sets);
  if (!best && inv) ({ found: best, last: lastFail } = search([BARE_ALLOW]));

  if (!best || !best.ok) {
    return { ok: false, reason: (best && best.reason) || "failed", missing: (best && best.missing) || [] };
  }
  return {
    ok: true,
    json: best.model.toJSON(),
    meta: metaOf(best.model, best.mass, theme, best.step, best.features),
    missing: best.missing || [],
  };
}

function hasAny(bucket) {
  if (!bucket) return false;
  for (const v of Object.values(bucket)) if (v > 0) return true;
  return false;
}
