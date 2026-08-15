// Datenmodell des Bauwerks: Graph aus Knoten (Kupplungen) und Kanten (Rohren).
// Bewusst ohne Three.js-Abhaengigkeit, damit es testbar und Backend-tauglich bleibt.

import { MERGE_EPS, FORMAT_VERSION, DIAGONAL_SNAP_TOL } from "./config.js";
import { round2 as round, quatFromXAxis, quatFromBasis } from "./util.js";

// Wohin ein Anbauteil gehoert, gemessen an den 799 Vorkommen in den Dateien des
// Herstellers: `at` ist der Anker (Kupplung oder Rohr), `offset` der Abstand in
// cm entlang der gewaehlten Achse. Die Achse ist immer die lokale +X des Teils.
const FITTING_MOUNTS = {
  "bearing2":        { at: "node", offset: 0 },   // Radlager: 5-cm-Stueck an der Kupplung
  "casters2":        { at: "node", offset: 0 },   // Laufrolle; der Adapter kommt mit
  "open-connector2": { at: "node", offset: 0 },
  "hole-connector4": { at: "node", offset: 5 },   // 50 mm neben der Kupplung
  "bag2":            { at: "tube", offset: 20 },  // 200 mm vom Rohrende
};

/**
 * Teile, die auf einem ROHR sitzen statt an einer Kupplung -- sie werden durch
 * einen Klick auf das Rohr gesetzt, nicht ueber einen Ankerpunkt.
 *   "anywhere" = an der angeklickten Stelle, Achse = Rohrachse
 *   "end"      = am naeheren Rohrende, Achse nach aussen
 * Gemessen am Truck (My first Q+Mobil): die Raeder sitzen mitten auf einem
 * 15-cm-Rohr, die Nabenkappe an dessen Ende.
 */
export const TUBE_FITTINGS = {
  "multi-wheel2":    "anywhere",   // Multirad: auf einem Rohr ODER auf einem Radlager
  "floating-wheel2": "anywhere",   // Schwimmrad, knapp 15 cm dick
  "hub-cap2":        "end",        // Radkappe: am Rohrende ANSTELLE der Kupplung
};

// Welche Anbauteile sich setzen lassen: die an einer Kupplung (FITTING_MOUNTS),
// die auf einem Rohr (TUBE_FITTINGS) und die mit eigenem Ablauf (Radarretierung,
// Gitter, Rundabdeckung, grosses Dach).
// Doppelte fallen raus: manche Teile stehen in zwei Tabellen, weil sie zwei
// Wege kennen (Radkappe: Ankerpunkt an der Kupplung UND Klick aufs Rohrende).
export const PLACEABLE_FITTINGS = [...new Set([
  ...Object.keys(FITTING_MOUNTS),
  ...Object.keys(TUBE_FITTINGS),
  "steering-lock2", "hub-cap2",   // in der Radmitte bzw. am Rohrende
  "bearing-clamp",                // Lagerkupplung: klemmt um ein Rohr (kein eigenes QDF-Element)
  "lattice2", "textil-round2", "roof-large2",
])];


// Abstand der beiden Bogenrohre, ueber die eine Rundabdeckung gespannt wird:
// in allen 52 Vorkommen 800 mm.
const ROUND_COVER_SPAN = 80;

// Gitter: im Ball Cage spannt es 160 x 80 cm von Rohrmitte zu Rohrmitte. Da die
// Datei die Masse mitfuehrt, ist es nicht auf dieses eine Format festgelegt:
// erlaubt sind alle Rasterabstaende bis 160 cm, die Laenge ergibt sich aus der
// Ueberdeckung der beiden Rohre.
const LATTICE_GAPS = [40, 80, 120, 160];
const LATTICE_STEP = 40;
const LATTICE_MAX = 160;

const CARDINALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// Laenge des Radlagers (Feld 50. in allen 125 bearing2-Zeilen des Bestands).
const BEARING_LEN = 5;

// Die lokale +X-Achse eines Anbauteils in Weltkoordinaten (quat: Three x,y,z,w).
function rotateX(q) {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y + z * w),
    2 * (x * z - y * w),
  ];
}

/**
 * Abstand der Klemm-Kupplung von der Rohrachse, in Kupplungslaengen.
 * Die Lochzapfenkupplung nimmt an ihrer Muendung direkt ein Rohr auf -- eine
 * Laenge reicht. Die Lagerkupplung traegt dort eine ganze Kupplung, die noch
 * einmal eine Laenge weiter aussen sitzt.
 */
export function clampOffset(part, cs = 5) {
  return part === "bearing" ? cs * 2 : cs;
}

// Anbauteile, die sich per Klick weiterdrehen lassen: sie sitzen an einer
// Kupplung und haben eine Achse, fuer die es mehrere Richtungen gibt.
const ROTATABLE_FITTINGS = new Set([
  "bearing2", "casters2", "open-connector2",
]);

const norm3 = (v) => { const L = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / L, v[1] / L, v[2] / L]; };
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// Name der naechsten Achsrichtung -- reicht, um belegte Arme zu erkennen.
function cardinalName(v) {
  const ax = Math.abs(v[0]), ay = Math.abs(v[1]), az = Math.abs(v[2]);
  if (ax >= ay && ax >= az) return v[0] > 0 ? "+x" : "-x";
  if (ay >= az) return v[1] > 0 ? "+y" : "-y";
  return v[2] > 0 ? "+z" : "-z";
}

// Rutsche: Einhaengepunkt sitzt knapp ueber den unteren Kupplungen des
// senkrechten Rohrpaars.
const SLIDE_HOOK_LIFT = 5;                 // cm ueber der unteren Kupplung
// Die Rutsche ist ein Fertigteil fester Groesse: im 40-cm-Raster zwei Ebenen
// hoch und drei Felder lang -- Fall 80 cm ab der Kupplung, Auslauf 120 cm. In
// den Herstellerdateien steht genau das: Fall 85 cm ab Einhaengepunkt (der
// Haken sitzt 5 cm ueber der Kupplung), Auslauf 120 cm, Neigung 35,3 Grad.
// Der Fuss muss nicht auf dem Boden landen -- er darf auch auf dem Geruest
// aufliegen; nur unter den Boden darf er nicht.
const SLIDE_DROP = 80;                     // cm, von der Kupplung bis zum Boden
const SLIDE_RUN = 120;                     // cm waagerechter Auslauf
// Freiraum, den die Bahn braucht: naeher als das darf keine Kupplung stehen.
const SLIDE_CLEARANCE = 18;
// So nah muss eine Kupplung am Auslauf liegen, damit er getragen wird.
const SLIDE_SUPPORT = 30;

// Zwei Platten gelten als in derselben Ebene, wenn ihre Mitten quer dazu weniger
// als so weit auseinanderliegen (oben/unten am selben Rohrpaar sind es 3,3 cm).
const PANEL_PLANE_EPS = 6;
// Erst ab dieser Ueberdeckung zaehlt es als Ueberlappung -- Kante an Kante nicht.
const PANEL_OVERLAP_EPS = 1;

// Boden. Unter der Nullebene wird nicht gebaut: die Kupplungen der untersten
// Lage sitzen genau darauf (y = 0), erst ein negativer Wert liegt darunter. Die
// Toleranz faengt Rundungsreste aus round2 ab.
const GROUND_TOL = 0.01;

function dist2(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export class BuildModel {
  constructor() {
    this.nodes = new Map();  // id -> { id, x, y, z }
    this.tubes = new Map();  // id -> { id, a, b, tubeId, color, length }
    this.panels = new Map(); // id -> { id, nodes:[4 ids], panelId, color }
    this.clamps = new Map(); // id -> { id, x, y, z, connectorId } (Doppelrohrverbinder/Klemme)
    this.textiles = new Map(); // id -> { id, nodes:[4 ids], w, h, color } (Netz/Stoff, textil2)
    this.slides = new Map();   // id -> { id, x, y, z, dir, kind } (Rutsche, slide*/roof2, dekorativ)
    // Anbauteile: alles, was mit Punkt und Ausrichtung am Geruest haengt --
    // Raeder, Radkappen, Laufrollen, Lager, Lochzapfen- und offene Kupplungen,
    // Rundwaende, grosse Daecher, Gitter, Saecke.
    // id -> { id, kind, x, y, z, quat, color, w?, h?, mask? }
    this.fittings = new Map();
    this._seq = 1;
  }

  _id(prefix) {
    return prefix + this._seq++;
  }

  // --- Knoten -------------------------------------------------------------
  findNodeNear(x, y, z) {
    const p = { x, y, z };
    const eps2 = MERGE_EPS * MERGE_EPS;
    for (const n of this.nodes.values()) {
      if (dist2(n, p) <= eps2) return n;
    }
    return null;
  }

  /**
   * Hoehe der untersten Kupplungslage. Im Editor gebaute Modelle sitzen auf
   * y = connectorSize/2, importierte auf y = 0 -- die Rutsche endet auf der
   * Ebene, die das jeweilige Modell als Boden benutzt.
   */
  _groundLevel() {
    let min = Infinity;
    for (const n of this.nodes.values()) if (n.y < min) min = n.y;
    return Number.isFinite(min) ? min : 0;
  }

  /** Liegt diese Hoehe unter dem Boden (Nullebene)? */
  isBelowGround(y) {
    return y < -GROUND_TOL;
  }

  addNode(x, y, z) {
    const existing = this.findNodeNear(x, y, z);
    if (existing) return existing;
    const node = { id: this._id("n"), x, y, z };
    this.nodes.set(node.id, node);
    return node;
  }

  removeNode(id) {
    if (!this.nodes.has(id)) return;
    for (const t of [...this.tubes.values()]) {
      if (t.a === id || t.b === id) this.tubes.delete(t.id);
    }
    this.nodes.delete(id);
    this._prunePanels();
    this._pruneClamps();
  }

  degree(nodeId) {
    let d = 0;
    for (const t of this.tubes.values()) {
      if (t.a === nodeId || t.b === nodeId) d++;
    }
    return d;
  }

  neighbors(nodeId) {
    const out = [];
    for (const t of this.tubes.values()) {
      if (t.a === nodeId) out.push(this.nodes.get(t.b));
      else if (t.b === nodeId) out.push(this.nodes.get(t.a));
    }
    return out;
  }

  // --- Rohre --------------------------------------------------------------
  tubeBetween(aId, bId) {
    for (const t of this.tubes.values()) {
      if ((t.a === aId && t.b === bId) || (t.a === bId && t.b === aId)) return t;
    }
    return null;
  }

  addTube(aId, bId, tubeId, color, length, reinforced = false) {
    if (aId === bId) return null;
    if (this.tubeBetween(aId, bId)) return null; // schon vorhanden
    const tube = { id: this._id("t"), a: aId, b: bId, tubeId, color, length, reinforced: !!reinforced };
    this.tubes.set(tube.id, tube);
    return tube;
  }

  // C45-Adapter-Arm (kurze Huelse Eck-Kupplung <-> Adapter-Koerper). Kein Rohr:
  // zaehlt nicht in der Stueckliste und wird als Adapter-Huelse gezeichnet.
  addArm(aId, bId) {
    if (aId === bId) return null;
    if (this.tubeBetween(aId, bId)) return null;
    const arm = { id: this._id("m"), a: aId, b: bId, arm: true, tubeId: null, color: "blue", length: null, reinforced: false };
    this.tubes.set(arm.id, arm);
    return arm;
  }

  // Doppelrohr-Verbindung (kein Rohr): haelt zwei parallele Tubes als Paar
  // zusammen. Zaehlt nicht in der Stueckliste, wird als "8"-Klemme gezeichnet.
  addLink(aId, bId) {
    if (aId === bId) return null;
    if (this.tubeBetween(aId, bId)) return null;
    const link = { id: this._id("l"), a: aId, b: bId, link: true, tubeId: null, color: "blue", length: null, reinforced: false };
    this.tubes.set(link.id, link);
    return link;
  }

  // Verstaerkung (Alu-Profil im Rohr) ein-/ausschalten. Liefert den neuen Zustand.
  toggleReinforced(id) {
    const t = this.tubes.get(id);
    if (!t) return null;
    t.reinforced = !t.reinforced;
    return t.reinforced;
  }

  // Prueft, ob ein neues Rohr von p nach q ein bestehendes Rohr ueberdeckt:
  // entweder kollineare Ueberlappung (Laenge > 0) oder eine Kreuzung/ein T-Stoss,
  // dessen Treffpunkt im Inneren mindestens eines Rohres liegt (z. B. 35er quer
  // ueber ein 75er). Beruehren an einer gemeinsamen Kupplung zaehlt nicht.
  // Liefert das kollidierende Rohr oder null.
  tubeCollision(p, q) {
    for (const t of this.tubes.values()) {
      const a = this.nodes.get(t.a), b = this.nodes.get(t.b);
      if (!a || !b) continue;
      if (segmentsOverlap(p, q, a, b)) return t;
      if (segmentsCross(p, q, a, b)) return t;
    }
    return null;
  }

  removeTube(id) {
    this.tubes.delete(id);
    this._prunePanels();
    this._pruneClamps();
    this._pruneOrphanedC45Bodies();
  }

  // Verwaiste c45body-Knoten entfernen: Adapter-Koerper ohne Diagonalrohr
  // (nur noch per Arm-Kante mit der Eck-Kupplung verbunden) werden geloescht.
  _pruneOrphanedC45Bodies() {
    for (const n of [...this.nodes.values()]) {
      if (!n.c45body) continue;
      let hasNonArmTube = false;
      for (const t of this.tubes.values()) {
        if ((t.a === n.id || t.b === n.id) && !t.arm && !t.link) { hasNonArmTube = true; break; }
      }
      if (!hasNonArmTube) {
        for (const t of [...this.tubes.values()]) {
          if (t.a === n.id || t.b === n.id) this.tubes.delete(t.id);
        }
        this.nodes.delete(n.id);
      }
    }
  }

  // --- Platten -----------------------------------------------------------
  //
  // Eine Platte haengt an ZWEI parallelen Rohren -- so wie man sie wirklich
  // einclipst und wie die Herstellersoftware es fuehrt. Gespeichert werden die
  // beiden Tragrohre, der Versatz entlang (t0) und die Laenge in Rohrrichtung
  // (len). Daraus ergeben sich die vier Ecken; sie muessen NICHT auf Kupplungen
  // liegen -- eine 40er-Platte darf mitten auf zwei 75ern sitzen.

  /** Achse eines Rohrs: Startpunkt, Einheitsrichtung, Laenge. Null bei Bogen. */
  _rail(tubeId) {
    const t = this.tubes.get(tubeId);
    if (!t || t.arm || t.link || t.bow) return null;
    const a = this.nodes.get(t.a), b = this.nodes.get(t.b);
    if (!a || !b) return null;
    const d = [b.x - a.x, b.y - a.y, b.z - a.z];
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len < 1e-6) return null;
    return { p0: [a.x, a.y, a.z], dir: [d[0] / len, d[1] / len, d[2] / len], len };
  }

  /**
   * Die vier Eckpunkte einer Platte (oder eines Netzes) in Weltkoordinaten,
   * umlaufend. Liefert null, wenn eines der Tragrohre fehlt.
   */
  panelCorners(p) {
    const ra = this._rail(p.a), rb = this._rail(p.b);
    if (!ra || !rb) return null;
    const d = ra.dir;
    // Versatz quer: der Anteil von rb.p0 - ra.p0, der senkrecht auf der Achse steht.
    const off = [rb.p0[0] - ra.p0[0], rb.p0[1] - ra.p0[1], rb.p0[2] - ra.p0[2]];
    const along = off[0] * d[0] + off[1] * d[1] + off[2] * d[2];
    const perp = [off[0] - d[0] * along, off[1] - d[1] * along, off[2] - d[2] * along];
    const at = (s) => [ra.p0[0] + d[0] * s, ra.p0[1] + d[1] * s, ra.p0[2] + d[2] * s];
    const c0 = at(p.t0), c1 = at(p.t0 + p.len);
    const add = (q) => [q[0] + perp[0], q[1] + perp[1], q[2] + perp[2]];
    return [c0, c1, add(c1), add(c0)];
  }

  /** Abstand der beiden Tragrohre (Breite der Platte). */
  panelGap(p) {
    const c = this.panelCorners(p);
    if (!c) return 0;
    return Math.hypot(c[3][0] - c[0][0], c[3][1] - c[0][1], c[3][2] - c[0][2]);
  }

  /** Liegt auf diesen beiden Rohren im Bereich [t0, t0+len] schon eine Platte? */
  /**
   * Ueberdecken sich zwei Plattenflaechen? Geprueft wird auf DERSELBEN Ebene:
   * gleiche Ausrichtung, dicht beieinander (die beiden Seiten desselben
   * Rohrpaars liegen nur gut 3 cm auseinander) und ueberlappende Flaeche.
   *
   * Die Flaechenpruefung laeuft ueber Trennachsen -- die beiden Platten koennen
   * an ganz verschiedenen Rohren haengen und trotzdem dasselbe Feld belegen
   * (Nord/Sued gegen Ost/West).
   */
  _panelsOverlap(ca, cb) {
    const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
    const cross3 = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const dot3 = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const unit3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
    const centre = (c) => [0, 1, 2].map((i) => (c[0][i] + c[1][i] + c[2][i] + c[3][i]) / 4);

    const ua = unit3(sub(ca[1], ca[0])), va = unit3(sub(ca[3], ca[0]));
    const ub = unit3(sub(cb[1], cb[0])), vb = unit3(sub(cb[3], cb[0]));
    const na = unit3(cross3(ua, va)), nb = unit3(cross3(ub, vb));
    if (Math.abs(dot3(na, nb)) < 0.99) return false;              // andere Ausrichtung
    const d = sub(centre(cb), centre(ca));
    if (Math.abs(dot3(d, na)) > PANEL_PLANE_EPS) return false;    // andere Ebene
    // Trennachsen-Test in der gemeinsamen Ebene.
    for (const axis of [ua, va, ub, vb]) {
      const proj = (c) => c.map((q) => dot3(q, axis));
      const pa = proj(ca), pb = proj(cb);
      const loA = Math.min(...pa), hiA = Math.max(...pa);
      const loB = Math.min(...pb), hiB = Math.max(...pb);
      if (Math.min(hiA, hiB) - Math.max(loA, loB) <= PANEL_OVERLAP_EPS) return false;
    }
    return true;
  }

  /**
   * Liegt an dieser Stelle schon eine Platte (oder ein Netz)? Geprueft werden
   * beide Sammlungen -- gestapelt wird nichts.
   */
  panelAt(aId, bId, t0, len) {
    const probe = this.panelCorners({ a: aId, b: bId, t0, len });
    if (!probe) return null;
    for (const map of [this.panels, this.textiles]) {
      for (const p of map.values()) {
        const c = this.panelCorners(p);
        if (c && this._panelsOverlap(c, probe)) return p;
      }
    }
    return null;
  }

  /**
   * Welche Rohre koennen mit `railId` zusammen eine Platte tragen?
   *
   * Voraussetzung: parallel, im Abstand einer Plattenkante, und die beiden
   * Rohre ueberdecken sich laengs weit genug fuer die andere Kante. Geliefert
   * wird je Kandidat der Ueberdeckungsbereich in der Achse des ERSTEN Rohrs --
   * daraus ergeben sich die moeglichen Abschnitte.
   */
  panelPartners(railId, dims, tol = 1.5) {
    const ra = this._rail(railId);
    if (!ra) return [];
    const out = [];
    for (const t of this.tubes.values()) {
      if (t.id === railId) continue;
      const rb = this._rail(t.id);
      if (!rb) continue;
      const dot = rb.dir[0] * ra.dir[0] + rb.dir[1] * ra.dir[1] + rb.dir[2] * ra.dir[2];
      if (Math.abs(dot) < 0.999) continue;                    // nicht parallel
      const off = [rb.p0[0] - ra.p0[0], rb.p0[1] - ra.p0[1], rb.p0[2] - ra.p0[2]];
      const along = off[0] * ra.dir[0] + off[1] * ra.dir[1] + off[2] * ra.dir[2];
      const perp = [off[0] - ra.dir[0] * along, off[1] - ra.dir[1] * along, off[2] - ra.dir[2] * along];
      const gap = Math.hypot(perp[0], perp[1], perp[2]);
      if (gap < 1) continue;                                  // dasselbe Rohr, doppelt
      // Welche Plattenkante passt auf den Abstand? Die andere laeuft laengs.
      let len = null;
      for (let i = 0; i < dims.length; i++) {
        if (Math.abs(dims[i] - gap) <= tol) { len = dims[1 - i] ?? dims[i]; break; }
      }
      if (len == null) continue;
      // Ueberdeckung in der Achse des ersten Rohrs
      const e = along + rb.len * dot;
      const lo = Math.max(0, Math.min(along, e));
      const hi = Math.min(ra.len, Math.max(along, e));
      if (hi - lo < len - tol) continue;
      out.push({ id: t.id, gap: round(gap), len: round(len), lo: round(lo), hi: round(hi) });
    }
    return out;
  }

  /**
   * Abschnitt waehlen: An welcher Stelle liegt die Platte, wenn man das erste
   * Rohr bei `at` angeklickt hat? Das Raster ist die Plattenlaenge selbst.
   */
  panelSection(partner, at) {
    const count = Math.max(1, Math.floor((partner.hi - partner.lo + 0.5) / partner.len));
    const k = Math.max(0, Math.min(count - 1, Math.floor((at - partner.lo) / partner.len)));
    return { t0: round(partner.lo + k * partner.len), len: partner.len, index: k, count };
  }

  /**
   * Platte auf zwei parallele Rohre setzen.
   * side: +1 = liegt oben auf den Rohren (bzw. aussen), -1 = haengt darunter.
   */
  addPanel(aId, bId, t0, len, panelId, color, side = 1) {
    if (!this._rail(aId) || !this._rail(bId)) return null;
    if (this.panelAt(aId, bId, t0, len)) return null;
    const panel = {
      id: this._id("p"), a: aId, b: bId, t0: round(t0), len: round(len),
      panelId, color, side: side < 0 ? -1 : 1,
    };
    this.panels.set(panel.id, panel);
    return panel;
  }

  /** Platte auf die andere Seite der Rohre legen. Liefert die neue Seite. */
  flipPanelSide(id) {
    const p = this.panels.get(id) || this.textiles.get(id);
    if (!p) return null;
    p.side = (p.side || 1) < 0 ? 1 : -1;
    return p.side;
  }

  removePanel(id) {
    this.panels.delete(id);
  }

  removeTextile(id) {
    this.textiles.delete(id);
  }

  removeSlide(id) {
    this.slides.delete(id);
  }

  // --- Anbauteile ---------------------------------------------------------
  /**
   * Anbauteil setzen. `kind` ist die QDF-Elementart (z. B. "multi-wheel2"),
   * damit Import, Darstellung und Export dieselbe Sprache sprechen.
   * quat in Three-Reihenfolge (x,y,z,w); w/h nur bei Flaechenteilen (Gitter).
   */
  addFitting(kind, x, y, z, opts = {}) {
    const f = {
      id: this._id("f"), kind,
      x: round(x), y: round(y), z: round(z),
      quat: opts.quat || null,
      color: opts.color || null,
    };
    if (opts.w != null) f.w = round(opts.w);
    if (opts.h != null) f.h = round(opts.h);
    if (opts.mask != null) f.mask = opts.mask;
    this.fittings.set(f.id, f);
    return f;
  }

  removeFitting(id) {
    this.fittings.delete(id);
  }

  /**
   * Anbauteil weiterdrehen: es springt auf die naechste freie Achsrichtung
   * seiner Kupplung -- so wie ein Bogenrohr per Klick weiterrueckt. Teile ohne
   * Wahlmoeglichkeit (Radarretierung in der Nabe, Flaechenteile, Teile auf einem
   * Rohr) bleiben, wo sie sind.
   */
  rotateFitting(id) {
    const f = this.fittings.get(id);
    if (!f || !ROTATABLE_FITTINGS.has(f.kind)) return false;
    let anchor = null, nd = 16;
    for (const n of this.nodes.values()) {
      const d = Math.hypot(n.x - f.x, n.y - f.y, n.z - f.z);
      if (d < nd) { nd = d; anchor = n; }
    }
    if (!anchor) return false;
    const mounts = this.fittingMounts(f.kind).filter((m) => m.nodeId === anchor.id);
    if (mounts.length < 2) return false;
    const at = (m) => Math.hypot(m.pos[0] - f.x, m.pos[1] - f.y, m.pos[2] - f.z);
    let cur = 0, best = Infinity;
    mounts.forEach((m, i) => { const d = at(m); if (d < best) { best = d; cur = i; } });
    // Belegte Stellen ueberspringen -- dort steckt schon dasselbe Teil.
    for (let k = 1; k <= mounts.length; k++) {
      const m = mounts[(cur + k) % mounts.length];
      if (at(m) < 0.01) continue;
      let taken = false;
      for (const o of this.fittings.values()) {
        if (o.id === f.id || o.kind !== f.kind) continue;
        if (Math.hypot(o.x - m.pos[0], o.y - m.pos[1], o.z - m.pos[2]) < 2) { taken = true; break; }
      }
      if (taken) continue;
      const quat = quatFromXAxis(m.dir);
      // Der Adapter unter der Laufrolle dreht mit.
      const rider = f.kind === "casters2"
        ? [...this.fittings.values()].find((o) => o.kind === "adapter2"
            && Math.hypot(o.x - f.x, o.y - f.y, o.z - f.z) < 2)
        : null;
      for (const part of [f, rider]) {
        if (!part) continue;
        part.x = round(m.pos[0]); part.y = round(m.pos[1]); part.z = round(m.pos[2]);
        part.quat = quat.slice();
      }
      return true;
    }
    return false;
  }

  /**
   * Klemm-Kupplung weiterdrehen: der offene Anschluss rueckt um 90 Grad um das
   * umschlossene Rohr weiter, alles daran Steckende dreht mit.
   */
  rotateTubeClamp(nodeId, cs = 5) {
    const node = this.nodes.get(nodeId);
    if (!node || !node.clampOn || !node.stub) return false;
    const t = this.tubes.get(node.clampOn.tubeId);
    const a = t && this.nodes.get(t.a), b = t && this.nodes.get(t.b);
    if (!a || !b) return false;
    const ab = [b.x - a.x, b.y - a.y, b.z - a.z];
    const L = Math.hypot(ab[0], ab[1], ab[2]) || 1;
    const u = [ab[0] / L, ab[1] / L, ab[2] / L];
    const off = clampOffset(node.part, cs);
    const axis = [node.x - node.stub[0] * off, node.y - node.stub[1] * off, node.z - node.stub[2] * off];
    // 45 Grad um die Rohrachse (Rodrigues). Acht Stellungen -- die Kupplungen
    // sitzen am Rohr, sie muessen sich nicht ins Achsraster fuegen.
    const co = Math.SQRT1_2, si = Math.SQRT1_2;
    const turn = (p) => {
      const r = [p[0] - axis[0], p[1] - axis[1], p[2] - axis[2]];
      const c = cross3(u, r);
      const d = dot3(u, r) * (1 - co);
      return [
        axis[0] + r[0] * co + c[0] * si + u[0] * d,
        axis[1] + r[1] * co + c[1] * si + u[1] * d,
        axis[2] + r[2] * co + c[2] * si + u[2] * d,
      ];
    };
    const branch = this._branchFrom(nodeId).map((n) => ({ n, p: turn([n.x, n.y, n.z]) }));
    if (branch.some((e) => this.isBelowGround(e.p[1]))) return false;
    for (const e of branch) { e.n.x = round(e.p[0]); e.n.y = round(e.p[1]); e.n.z = round(e.p[2]); }
    const st = node.stub;
    const c = cross3(u, st), d = dot3(u, st) * (1 - co);
    const ns = [st[0] * co + c[0] * si + u[0] * d, st[1] * co + c[1] * si + u[1] * d, st[2] * co + c[2] * si + u[2] * d];
    // Die Richtung feiner runden als Koordinaten: bei 45-Grad-Schritten summiert
    // sich der Rundungsfehler sonst ueber mehrere Drehungen sichtbar auf.
    const L2 = Math.hypot(ns[0], ns[1], ns[2]) || 1;
    const r4 = (v) => Math.round((v / L2) * 1e4) / 1e4;
    node.stub = [r4(ns[0]), r4(ns[1]), r4(ns[2])];
    return true;
  }

  /**
   * Montagestellen eines Anbauteils. Die Regeln sind an den Herstellerdateien
   * gemessen (FITTING_MOUNTS): die einen sitzen an einer Kupplung und zeigen in
   * eine freie Achsrichtung, die anderen stecken auf einem Rohr.
   * Liefert je Stelle { pos:[x,y,z], dir:[x,y,z], nodeId?, tubeId? }.
   */
  fittingMounts(kind) {
    if (kind === "multi-wheel2") return this._wheelMounts();
    if (kind === "steering-lock2") return this._wheelLockMounts("multi-wheel2");
    if (kind === "hub-cap2") return this._wheelCapMounts();
    if (kind === "textil-round2") return this._roundCoverMounts();
    if (kind === "roof-large2") return this._roofMounts();
    const spec = FITTING_MOUNTS[kind];
    if (!spec) return [];
    return spec.at === "tube" ? this._fittingTubeMounts(spec) : this._fittingNodeMounts(spec);
  }

  /**
   * Montagestelle eines Rohr-Teils aus dem Trefferpunkt: entweder genau dort
   * (Raeder) oder am naeheren Rohrende (Nabenkappe).
   */
  tubeFittingMount(tubeId, point, kind) {
    const where = TUBE_FITTINGS[kind];
    if (!where) return null;
    if (where === "end") return this.tubeEndMount(tubeId, point);
    const t = this.tubes.get(tubeId);
    const a = t && this.nodes.get(t.a), b = t && this.nodes.get(t.b);
    if (!a || !b) return null;
    const ab = [b.x - a.x, b.y - a.y, b.z - a.z];
    const L = Math.hypot(ab[0], ab[1], ab[2]) || 1;
    const u = [ab[0] / L, ab[1] / L, ab[2] / L];
    const rel = [point[0] - a.x, point[1] - a.y, point[2] - a.z];
    const s = Math.max(0, Math.min(L, rel[0] * u[0] + rel[1] * u[1] + rel[2] * u[2]));
    return { pos: [a.x + u[0] * s, a.y + u[1] * s, a.z + u[2] * s], dir: u, tubeId };
  }

  /**
   * Lagerkupplung auf ein Rohrende schieben: sie umschliesst das ENDE des
   * angeklickten Rohrs. Genommen wird das naehere der beiden Enden, die Achse
   * zeigt vom Rohr weg.
   */
  tubeEndMount(tubeId, point) {
    const t = this.tubes.get(tubeId);
    if (!t) return null;
    const a = this.nodes.get(t.a), b = this.nodes.get(t.b);
    if (!a || !b) return null;
    const da = Math.hypot(point[0] - a.x, point[1] - a.y, point[2] - a.z);
    const db = Math.hypot(point[0] - b.x, point[1] - b.y, point[2] - b.z);
    const end = da <= db ? a : b, other = da <= db ? b : a;
    const d = [end.x - other.x, end.y - other.y, end.z - other.z];
    const L = Math.hypot(d[0], d[1], d[2]) || 1;
    return { pos: [end.x, end.y, end.z], dir: [d[0] / L, d[1] / L, d[2] / L], nodeId: end.id };
  }

  /**
   * Multirad: sitzt auf dem AEUSSEREN Ende eines Radlagers -- das ist ein 5 cm
   * langes Rohrstueck an einer Kupplung. Gemessen in Basic II_Auto: Radlager auf
   * der Kupplung mit Laengenfeld 50 mm, das Rad 50 mm weiter aussen auf
   * derselben Achse.
   */
  _wheelMounts() {
    const out = [];
    for (const f of this.fittings.values()) {
      if (f.kind !== "bearing2" || !f.quat) continue;
      const ax = rotateX(f.quat);
      out.push({ pos: [round(f.x + ax[0] * BEARING_LEN), round(f.y + ax[1] * BEARING_LEN),
        round(f.z + ax[2] * BEARING_LEN)], dir: ax, quat: f.quat.slice() });
    }
    return out;
  }

  /**
   * Radkappe: sitzt auf einer EINARMIGEN Kupplung, also am Ende eines Rohrs --
   * und ersetzt sie dort. Sinn ergibt das mit einem Schwimmrad auf demselben
   * Rohr, gesetzt wird sie aber an der Kupplung.
   */
  _wheelCapMounts() {
    const out = [];
    for (const n of this.nodes.values()) {
      if (n.c45body || n.part) continue;
      const arms = [];
      for (const t of this.tubes.values()) {
        if (t.arm || t.link) continue;
        const other = t.a === n.id ? this.nodes.get(t.b) : t.b === n.id ? this.nodes.get(t.a) : null;
        if (other) arms.push(other);
      }
      if (arms.length !== 1) continue;                 // nur freie Rohrenden
      const o = arms[0];
      const d = [n.x - o.x, n.y - o.y, n.z - o.z];
      const L = Math.hypot(d[0], d[1], d[2]) || 1;
      out.push({ pos: [n.x, n.y, n.z], dir: [d[0] / L, d[1] / L, d[2] / L], nodeId: n.id });
    }
    return out;
  }

  /**
   * Sitzt an diesem Knoten eine Radkappe? Dann ersetzt sie dort die Kupplung --
   * das Rohrende steckt in der Kappe, eine Kupplung gibt es nicht mehr.
   */
  hasWheelCap(node) {
    for (const f of this.fittings.values()) {
      if (f.kind !== "hub-cap2") continue;
      if (Math.hypot(f.x - node.x, f.y - node.y, f.z - node.z) < 3) return true;
    }
    return false;
  }

  /**
   * Radarretierung und Radkappe sitzen in der MITTE eines gesetzten Rades und
   * halten es fest -- die Arretierung am schmalen Rad, die Kappe am Schwimmrad.
   * Es gibt sie also nur dort, wo das passende Rad steckt, und sie uebernehmen
   * dessen Achse.
   */
  _wheelLockMounts(wheelKind) {
    const out = [];
    for (const f of this.fittings.values()) {
      if (f.kind !== wheelKind) continue;
      out.push({ pos: [f.x, f.y, f.z], dir: [1, 0, 0], quat: f.quat ? f.quat.slice() : null });
    }
    return out;
  }

  /**
   * Rundabdeckung: braucht ZWEI gleich liegende Bogenrohre im Abstand von 80 cm
   * -- das Tuch spannt sich ueber den Tonnenbogen dazwischen. Der Ankerpunkt ist
   * die Ecke gegenueber dem Kruemmungsmittelpunkt, die lokale +Z-Achse zeigt zum
   * zweiten Bogen (so steht es in den Dateien des Herstellers).
   */
  _roundCoverMounts() {
    const bows = [];
    for (const t of this.tubes.values()) {
      if (!t.bow || !t.bowCenter) continue;
      const a = this.nodes.get(t.a), b = this.nodes.get(t.b);
      if (!a || !b) continue;
      const C = t.bowCenter;
      // Ecke gegenueber dem Mittelpunkt: dort sitzt der Bezugspunkt des Tuchs.
      bows.push({
        O: [a.x + b.x - C[0], a.y + b.y - C[1], a.z + b.z - C[2]],
        u: norm3([a.x - (a.x + b.x - C[0]), a.y - (a.y + b.y - C[1]), a.z - (a.z + b.z - C[2])]),
        v: norm3([b.x - (a.x + b.x - C[0]), b.y - (a.y + b.y - C[1]), b.z - (a.z + b.z - C[2])]),
      });
    }
    const out = [];
    for (const p of bows) {
      for (const s of bows) {
        if (s === p) continue;
        const d = [s.O[0] - p.O[0], s.O[1] - p.O[1], s.O[2] - p.O[2]];
        const dist = Math.hypot(d[0], d[1], d[2]);
        if (Math.abs(dist - ROUND_COVER_SPAN) > 1.5) continue;
        const ez = [d[0] / dist, d[1] / dist, d[2] / dist];
        // Jedes Bogenpaar nur EINMAL anbieten: sonst gaebe es zu jeder Stelle
        // zwei Ankerpunkte (einen je Bogen) und das Tuch liesse sich doppelt
        // setzen. Genommen wird die Richtung mit positiver Hauptkomponente.
        const domi = ez.map(Math.abs).indexOf(Math.max(...ez.map(Math.abs)));
        if (ez[domi] < 0) continue;
        // Nur wenn der zweite Bogen wirklich daneben liegt (gleiche Schenkel).
        if (Math.abs(dot3(p.u, ez)) > 0.02 || Math.abs(dot3(p.v, ez)) > 0.02) continue;
        // Lokales +Y und -X sind die beiden Schenkel; welcher welcher ist,
        // entscheidet die Rechtshaendigkeit gegen die Achse zum zweiten Bogen.
        let ey = p.u, ex = [-p.v[0], -p.v[1], -p.v[2]];
        if (dot3(cross3(ex, ey), ez) < 0) { ey = p.v; ex = [-p.u[0], -p.u[1], -p.u[2]]; }
        out.push({ pos: p.O, dir: ex, quat: quatFromBasis(ex, ey, ez) });
      }
    }
    return out;
  }

  /**
   * Grosses Dach: sitzt als Giebel auf einem waagerechten Rohr. Die lokale
   * X-Achse laeuft am First entlang, die beiden Schraegen fallen zu beiden
   * Seiten um 45 Grad ab. Der Bezugspunkt liegt 40 cm vor der Firstmitte --
   * so weit steht das Dach in den Cover-Entwuerfen nach hinten ueber.
   */
  _roofMounts() {
    const out = [];
    for (const t of this.tubes.values()) {
      if (t.arm || t.link || t.bow) continue;
      const a = this.nodes.get(t.a), b = this.nodes.get(t.b);
      if (!a || !b || Math.abs(a.y - b.y) > 0.5) continue;      // nur waagerechte Rohre
      const ex = norm3([b.x - a.x, b.y - a.y, b.z - a.z]);
      const s = cross3(ex, [0, 1, 0]);                          // waagerecht, quer zum First
      const ey = norm3([s[0], 1 + s[1], s[2]]);                 // Normale der einen Schraege
      const ez = cross3(ex, ey);
      const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2];
      out.push({
        pos: [mid[0] - ex[0] * 40, mid[1] - ex[1] * 40, mid[2] - ex[2] * 40],
        dir: ex, quat: quatFromBasis(ex, ey, ez), tubeId: t.id,
      });
    }
    return out;
  }

  // An der Kupplung: jede kardinale Richtung ohne Rohr, nicht unter den Boden.
  // Die Laufrolle haengt immer nach unten, sie kennt nur diese eine Stelle.
  _fittingNodeMounts(spec) {
    const out = [];
    for (const n of this.nodes.values()) {
      if (n.c45body) continue;                       // Adapterkoerper ist keine Kupplung
      const taken = new Set();
      for (const t of this.tubes.values()) {
        const other = t.a === n.id ? this.nodes.get(t.b) : t.b === n.id ? this.nodes.get(t.a) : null;
        if (!other) continue;
        const d = [other.x - n.x, other.y - n.y, other.z - n.z];
        const L = Math.hypot(d[0], d[1], d[2]) || 1;
        taken.add(cardinalName([d[0] / L, d[1] / L, d[2] / L]));
      }
      for (const dir of (spec.dirs === "down" ? [[0, -1, 0]] : CARDINALS)) {
        if (taken.has(cardinalName(dir))) continue;
        const pos = [n.x + dir[0] * spec.offset, n.y + dir[1] * spec.offset, n.z + dir[2] * spec.offset];
        if (this.isBelowGround(pos[1])) continue;
        // Der Ankerpunkt liegt weiter aussen als das Teil selbst: Teile, die
        // direkt auf der Kupplung sitzen (Abstand 0), haetten ihren Punkt sonst
        // mitten im Kupplungswuerfel -- unsichtbar und nicht anklickbar.
        const gap = Math.max(spec.offset, 7);
        out.push({ pos, dir, nodeId: n.id,
          handle: [n.x + dir[0] * gap, n.y + dir[1] * gap, n.z + dir[2] * gap] });
      }
    }
    return out;
  }

  // Auf dem Rohr: fester Abstand ab jedem Rohrende, Achse = Rohrrichtung.
  _fittingTubeMounts(spec) {
    const out = [];
    for (const t of this.tubes.values()) {
      if (t.arm || t.link || t.bow) continue;
      const a = this.nodes.get(t.a), b = this.nodes.get(t.b);
      if (!a || !b) continue;
      const d = [b.x - a.x, b.y - a.y, b.z - a.z];
      const L = Math.hypot(d[0], d[1], d[2]) || 1;
      if (L < spec.offset * 2) continue;
      const u = [d[0] / L, d[1] / L, d[2] / L];
      for (const [from, sign] of [[a, 1], [b, -1]]) {
        const pos = [from.x + u[0] * spec.offset * sign,
          from.y + u[1] * spec.offset * sign,
          from.z + u[2] * spec.offset * sign];
        if (this.isBelowGround(pos[1])) continue;
        out.push({ pos, dir: u, tubeId: t.id });
      }
    }
    return out;
  }

  // --- Klemm-Kupplungen (sitzen auf einem Rohr, nicht im Raster) -----------
  /**
   * Lochzapfenkupplung und Lagerkupplung umschliessen ein Rohr an einer
   * BELIEBIGEN Stelle und bieten quer dazu einen offenen Anschluss. Sie sind
   * deshalb Knoten (dort steckt ein Rohr) mit zwei Zusatzangaben: `clampOn`
   * haelt Rohr und Stelle darauf, `stub` die Richtung des offenen Endes.
   * Der Knoten selbst liegt an der Muendung, eine Kupplungslaenge neben der
   * Rohrachse -- dort faengt das eingesteckte Rohr an.
   *
   * `point` ist der Trefferpunkt des Klicks: er bestimmt die Stelle auf dem
   * Rohr UND (ueber die Seite, auf der er liegt) die Richtung des Anschlusses.
   */
  addTubeClamp(tubeId, point, part, cs = 5) {
    const g = this._clampGeom(tubeId, point);
    if (!g) return null;
    const off = clampOffset(part, cs);
    const pos = [g.axis[0] + g.stub[0] * off, g.axis[1] + g.stub[1] * off, g.axis[2] + g.stub[2] * off];
    if (this.isBelowGround(pos[1])) return null;
    for (const n of this.nodes.values()) {
      if (n.part === part && Math.hypot(n.x - pos[0], n.y - pos[1], n.z - pos[2]) < 2) return null;
    }
    const node = this.addNode(round(pos[0]), round(pos[1]), round(pos[2]));
    node.part = part;
    node.clampOn = { tubeId, t: round(g.t) };
    node.stub = g.stub;
    return node;
  }

  /**
   * Klemm-Kupplung entlang ihres Rohrs verschieben. Alles, was an ihr haengt
   * (eingestecktes Rohr samt allem dahinter), geht mit -- der Zweig haengt im
   * Graphen ja nur ueber sie. Das umschlossene Rohr selbst gehoert nicht dazu:
   * es beruehrt den Knoten nicht.
   */
  slideTubeClamp(nodeId, point, cs = 5) {
    const node = this.nodes.get(nodeId);
    if (!node || !node.clampOn) return false;
    const g = this._clampGeom(node.clampOn.tubeId, point, node.stub);
    if (!g) return false;
    const off = clampOffset(node.part, cs);
    const pos = [g.axis[0] + node.stub[0] * off, g.axis[1] + node.stub[1] * off, g.axis[2] + node.stub[2] * off];
    if (this.isBelowGround(pos[1])) return false;
    const d = [pos[0] - node.x, pos[1] - node.y, pos[2] - node.z];
    if (Math.hypot(d[0], d[1], d[2]) < 0.01) return false;
    for (const n of this._branchFrom(nodeId)) {
      n.x = round(n.x + d[0]); n.y = round(n.y + d[1]); n.z = round(n.z + d[2]);
    }
    node.clampOn.t = round(g.t);
    return true;
  }

  // Knoten, die nur ueber `startId` zusammenhaengen (der Zweig an der Klemme).
  _branchFrom(startId) {
    const seen = new Set([startId]);
    const stack = [startId];
    while (stack.length) {
      const id = stack.pop();
      for (const t of this.tubes.values()) {
        const other = t.a === id ? t.b : t.b === id ? t.a : null;
        if (other && !seen.has(other)) { seen.add(other); stack.push(other); }
      }
    }
    return [...seen].map((id) => this.nodes.get(id)).filter(Boolean);
  }

  // Stelle auf dem Rohr + Richtung des Anschlusses aus einem Trefferpunkt.
  _clampGeom(tubeId, point, keepStub = null) {
    const t = this.tubes.get(tubeId);
    if (!t) return null;
    const a = this.nodes.get(t.a), b = this.nodes.get(t.b);
    if (!a || !b) return null;
    const ab = [b.x - a.x, b.y - a.y, b.z - a.z];
    const L = Math.hypot(ab[0], ab[1], ab[2]) || 1;
    const u = [ab[0] / L, ab[1] / L, ab[2] / L];
    const rel = [point[0] - a.x, point[1] - a.y, point[2] - a.z];
    const s = Math.max(0, Math.min(L, rel[0] * u[0] + rel[1] * u[1] + rel[2] * u[2]));
    const axis = [a.x + u[0] * s, a.y + u[1] * s, a.z + u[2] * s];
    let stub = keepStub;
    if (!stub) {
      const off = [point[0] - axis[0], point[1] - axis[1], point[2] - axis[2]];
      stub = this._cardinalPerpTo(off, u);
    }
    return { axis, dir: u, t: s, stub };
  }

  // Kardinale Richtung senkrecht zum Rohr, die am ehesten zur Klickseite zeigt.
  _cardinalPerpTo(off, u) {
    let best = null, bd = -Infinity;
    for (const c of CARDINALS) {
      if (Math.abs(dot3(c, u)) > 0.3) continue;
      const d = dot3(c, off);
      if (d > bd) { bd = d; best = c; }
    }
    return best || [0, 1, 0];
  }

  /**
   * Gegenrohre fuer ein Gitter. Anders als eine Platte hat das Gitter keine
   * feste Groesse -- die Datei speichert seine Masse -- deshalb passt jeder
   * Rohrabstand des Rasters. Die Laenge ist die Ueberdeckung der beiden Rohre,
   * auf volle Felder abgerundet und bei vier Feldern gedeckelt (so gross ist
   * das Netz im Ball Cage).
   */
  latticePartners(railId, tol = 1.5) {
    const ra = this._rail(railId);
    if (!ra) return [];
    const out = [];
    for (const t of this.tubes.values()) {
      if (t.id === railId || t.arm || t.link || t.bow) continue;
      const rb = this._rail(t.id);
      if (!rb) continue;
      const dot = rb.dir[0] * ra.dir[0] + rb.dir[1] * ra.dir[1] + rb.dir[2] * ra.dir[2];
      if (Math.abs(dot) < 0.999) continue;
      const off = [rb.p0[0] - ra.p0[0], rb.p0[1] - ra.p0[1], rb.p0[2] - ra.p0[2]];
      const along = off[0] * ra.dir[0] + off[1] * ra.dir[1] + off[2] * ra.dir[2];
      const perp = [off[0] - ra.dir[0] * along, off[1] - ra.dir[1] * along, off[2] - ra.dir[2] * along];
      const gap = Math.hypot(perp[0], perp[1], perp[2]);
      if (!LATTICE_GAPS.some((g) => Math.abs(g - gap) <= tol)) continue;
      const e = along + rb.len * dot;
      const lo = Math.max(0, Math.min(along, e));
      const hi = Math.min(ra.len, Math.max(along, e));
      const span = hi - lo;
      if (span < LATTICE_STEP - tol) continue;
      const len = Math.min(LATTICE_MAX, Math.floor((span + tol) / LATTICE_STEP) * LATTICE_STEP);
      out.push({ id: t.id, gap: round(gap), len, lo: round(lo), hi: round(hi) });
    }
    return out;
  }

  /**
   * Gitter auf zwei parallele Rohre setzen -- derselbe Ablauf wie bei einer
   * Platte, nur entsteht ein Anbauteil mit eigenen Massen. Die Masse sind an
   * den Ball-Cage-Entwuerfen gemessen: laengs der Rohre das Rastermass minus
   * eine Kupplung (1600 -> 1550), quer dazu minus eine halbe (800 -> 775), und
   * das Netz schliesst oben buendig mit dem Rohr ab, unten bleiben 25 mm Luft.
   */
  addLattice(aId, bId, t0, len, color) {
    const ra = this._rail(aId), rb = this._rail(bId);
    if (!ra || !rb) return null;
    const A = [ra.p0[0] + ra.dir[0] * t0, ra.p0[1] + ra.dir[1] * t0, ra.p0[2] + ra.dir[2] * t0];
    // Lot vom ersten auf das zweite Rohr
    const off = [rb.p0[0] - ra.p0[0], rb.p0[1] - ra.p0[1], rb.p0[2] - ra.p0[2]];
    const along = off[0] * ra.dir[0] + off[1] * ra.dir[1] + off[2] * ra.dir[2];
    const perp = [off[0] - ra.dir[0] * along, off[1] - ra.dir[1] * along, off[2] - ra.dir[2] * along];
    const gap = Math.hypot(perp[0], perp[1], perp[2]);
    if (gap < 1) return null;
    const u = [perp[0] / gap, perp[1] / gap, perp[2] / gap];   // erstes -> zweites Rohr
    // Lokales X zeigt zum OBEREN Rohr, lokales Y laeuft laengs, Z ist die Normale.
    const up = u[1] < 0 ? [-u[0], -u[1], -u[2]] : u;
    const sign = up === u ? 1 : -1;
    const w = round(len - 5), h = round(gap - 2.5);
    // Mitte: Feldmitte, dann 1,25 cm zum oberen Rohr -- so sitzt die Oberkante
    // auf der Rohrachse und unten bleibt der gemessene Spalt.
    const c = [
      A[0] + ra.dir[0] * (len / 2) + perp[0] / 2 + up[0] * 1.25,
      A[1] + ra.dir[1] * (len / 2) + perp[1] / 2 + up[1] * 1.25,
      A[2] + ra.dir[2] * (len / 2) + perp[2] / 2 + up[2] * 1.25,
    ];
    const ey = [ra.dir[0] * sign, ra.dir[1] * sign, ra.dir[2] * sign];
    const ez = [up[1] * ey[2] - up[2] * ey[1], up[2] * ey[0] - up[0] * ey[2], up[0] * ey[1] - up[1] * ey[0]];
    for (const f of this.fittings.values()) {
      if (f.kind === "lattice2" && Math.hypot(f.x - c[0], f.y - c[1], f.z - c[2]) < 2) return null;
    }
    return this.addFitting("lattice2", c[0], c[1], c[2],
      { quat: quatFromBasis(up, ey, ez), color: color || null, w, h });
  }

  /**
   * Anbauteil an einer Montagestelle setzen. Die lokale +X-Achse des Teils
   * zeigt in `dir` -- dieselbe Regel, nach der die Dateien des Herstellers
   * gelesen und geschrieben werden. Sitzt dort schon dasselbe Teil, passiert
   * nichts (kein Stapeln).
   */
  addFittingAt(kind, mount, color) {
    if (!PLACEABLE_FITTINGS.includes(kind)) return null;
    for (const f of this.fittings.values()) {
      if (f.kind !== kind) continue;
      if (Math.hypot(f.x - mount.pos[0], f.y - mount.pos[1], f.z - mount.pos[2]) < 2) return null;
    }
    const f = this.addFitting(kind, mount.pos[0], mount.pos[1], mount.pos[2],
      { quat: mount.quat || quatFromXAxis(mount.dir), color: color || null });
    // Eine Laufrolle sitzt immer auf ihrem Adapter -- der kommt deshalb im
    // selben Zug mit. In der Stueckliste bleiben es zwei Teile.
    if (f && kind === "casters2") {
      this.addFitting("adapter2", mount.pos[0], mount.pos[1], mount.pos[2],
        { quat: mount.quat || quatFromXAxis(mount.dir) });
    }
    return f;
  }

  // Montagestellen fuer eine Rutsche: zwei parallele SENKRECHTE Rohre. Die
  // Rutsche wird dort eingehaengt und sitzt knapp ueber den unteren Kupplungen.
  // Liefert je Stelle { nodes, hook:[x,y,z], normal:[..] } -- hook ist der
  // Einhaengepunkt (Mitte zwischen beiden Rohren, kurz ueber den unteren
  // Kupplungen), normal die Richtung, in die die Rutsche abfaellt.
  //
  // Weil das Teil eine feste Groesse hat, kommen nur Rohrpaare in Frage, deren
  // untere Kupplungen GENAU zwei Rasterebenen ueber dem Boden sitzen -- und nur
  // dann, wenn die Bahn davor frei ist (siehe _slidePathFree).
  slideMounts(width = 40, tol = 2) {
    const out = [];
    const seen = new Set();
    const groundY = this._groundLevel();
    // Alle SENKRECHTEN Rohre samt ihrem unteren Endknoten. Die Rohrlaenge ist
    // egal -- entscheidend ist nur, dass beide Rohre senkrecht stehen, ihre
    // unteren Kupplungen gleich hoch liegen und der Abstand der Rutschenbreite
    // entspricht. (Die Suche lief frueher ueber findRectangles und verlangte
    // dadurch gleich lange Rohre; beim Bauen kommen aber auch ungleiche vor.)
    const posts = [];
    for (const t of this.tubes.values()) {
      if (t.arm || t.link || t.bow) continue;
      const a = this.nodes.get(t.a), b = this.nodes.get(t.b);
      if (!a || !b) continue;
      if (Math.abs(a.x - b.x) > 0.5 || Math.abs(a.z - b.z) > 0.5) continue; // nicht senkrecht
      if (Math.abs(a.y - b.y) < 0.5) continue;
      posts.push({ x: a.x, z: a.z, low: Math.min(a.y, b.y), high: Math.max(a.y, b.y) });
    }
    for (let i = 0; i < posts.length; i++) {
      for (let j = i + 1; j < posts.length; j++) {
        const p = posts[i], q = posts[j];
        if (Math.abs(p.low - q.low) > 0.5) continue;          // untere Kupplungen versetzt
        const dx = q.x - p.x, dz = q.z - p.z;
        const d = Math.hypot(dx, dz);
        if (Math.abs(d - width) > tol) continue;              // falscher Abstand
        // Feste Bauhoehe: unterhalb von SLIDE_DROP ueber dem Boden wuerde der
        // Fuss in den Boden laufen. Nach oben ist alles erlaubt -- die Rutsche
        // endet dann auf einer Plattform statt auf dem Boden.
        if (p.low - groundY < SLIDE_DROP - 1) continue;
        const hook = [(p.x + q.x) / 2, p.low + SLIDE_HOOK_LIFT, (p.z + q.z) / 2];
        const key = [Math.round(hook[0]), Math.round(hook[1]), Math.round(hook[2])].join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        // Abfallrichtung: waagerecht, quer zur Verbindung der beiden Rohre.
        // Voreinstellung ist die Seite mit weniger Bauteilen (weg vom Geruest);
        // die tatsaechliche Seite entscheidet beim Klick der Blickwinkel.
        const nrm = [-dz / d, 0, dx / d];
        let front = 0, back = 0;
        for (const n of this.nodes.values()) {
          const sdist = (n.x - hook[0]) * nrm[0] + (n.z - hook[2]) * nrm[2];
          if (sdist > 5) front++; else if (sdist < -5) back++;
        }
        let dir = front > back ? [-nrm[0], 0, -nrm[2]] : nrm;
        // Reicht der Platz und traegt der Auslauf? Sonst die Gegenseite
        // versuchen, sonst gibt es hier keine Montagestelle.
        const usable = (d) => this._slidePathFree(hook, d) && this._slideFootRests(hook, d, groundY);
        if (!usable(dir)) {
          const other = [-dir[0], 0, -dir[2]];
          if (!usable(other)) continue;
          dir = other;
        }
        // Auswahlflaeche: unten am Rohrpaar, eine Rutschenbreite hoch.
        const top = Math.min(p.high, q.high);
        const h2 = Math.min(top, p.low + width);
        out.push({
          hook, normal: dir,
          corners: [
            [p.x, p.low, p.z], [q.x, q.low, q.z],
            [q.x, h2, q.z], [p.x, h2, p.z],
          ],
        });
      }
    }
    return out;
  }

  /**
   * Ist die Bahn zwischen Einstieg und Auslauf frei? Die Rutsche braucht ihre
   * volle Laenge; steht mittendrin eine Kupplung, laesst sie sich dort nicht
   * montieren. Die Enden bleiben ausgenommen: oben sind es die beiden Rohre,
   * an denen sie haengt, unten darf sie auf dem Geruest aufliegen.
   */
  _slidePathFree(hook, dir) {
    const foot = [hook[0] + dir[0] * SLIDE_RUN, hook[1] - SLIDE_DROP - SLIDE_HOOK_LIFT, hook[2] + dir[2] * SLIDE_RUN];
    for (const n of this.nodes.values()) {
      const rel = [n.x - hook[0], n.y - hook[1], n.z - hook[2]];
      const along = rel[0] * dir[0] + rel[2] * dir[2];
      if (along < SLIDE_CLEARANCE || along > SLIDE_RUN - SLIDE_CLEARANCE) continue;
      const t = along / SLIDE_RUN;
      const on = [hook[0] + (foot[0] - hook[0]) * t, hook[1] + (foot[1] - hook[1]) * t, hook[2] + (foot[2] - hook[2]) * t];
      if (Math.hypot(n.x - on[0], n.y - on[1], n.z - on[2]) < SLIDE_CLEARANCE) return false;
    }
    return true;
  }

  /**
   * Liegt der Auslauf auf? Entweder auf dem Boden oder auf dem Geruest -- eine
   * Rutsche, die in der Luft endet, laesst sich nicht bauen.
   */
  _slideFootRests(hook, dir, groundY) {
    const foot = [hook[0] + dir[0] * SLIDE_RUN, hook[1] - SLIDE_DROP - SLIDE_HOOK_LIFT, hook[2] + dir[2] * SLIDE_RUN];
    if (foot[1] - groundY < 1) return true;                      // steht auf dem Boden
    for (const n of this.nodes.values()) {
      if (Math.hypot(n.x - foot[0], n.y - foot[1], n.z - foot[2]) <= SLIDE_SUPPORT) return true;
    }
    return false;
  }

  // Rutsche an einer Montagestelle einhaengen. Feste Groesse: zwei Rasterebenen
  // Fall, drei Felder Auslauf -- der Fuss landet damit auf dem Boden.
  addSlide(hook, normal, kind = "slide-new2", color = null) {
    const drop = SLIDE_DROP + SLIDE_HOOK_LIFT;
    const run = SLIDE_RUN;
    const slide = {
      id: this._id("s"),
      x: round(hook[0] + normal[0] * run),
      y: round(hook[1] - drop),
      z: round(hook[2] + normal[2] * run),
      hook: [round(hook[0]), round(hook[1]), round(hook[2])],
      kind, color,
    };
    for (const s of this.slides.values()) {
      if (s.hook && Math.hypot(s.hook[0] - slide.hook[0], s.hook[1] - slide.hook[1], s.hook[2] - slide.hook[2]) < 1) {
        return null; // hier haengt schon eine Rutsche
      }
    }
    this.slides.set(slide.id, slide);
    return slide;
  }

  // Farbe eines Rohrs / einer Platte / eines Netzes setzen (Klick im Bau-Modus
  // mit gewaehlter Farbe). Liefert true, wenn sich die Farbe geaendert hat.
  setColorOf(kind, id, color) {
    const map = kind === "tube" ? this.tubes
      : kind === "panel" ? this.panels
      : kind === "textile" ? this.textiles
      : kind === "slide" ? this.slides : null;
    if (!map) return false;
    const el = map.get(id);
    if (!el || el.color === color) return false;
    // Arm-/Link-Kanten (C45-Adapter, Doppelrohr-Verbindung) sind keine echten
    // Rohre und werden nicht eingefaerbt.
    if (kind === "tube" && (el.arm || el.link)) return false;
    el.color = color;
    return true;
  }

  // --- Klemmen (Doppelrohrverbinder) -------------------------------------
  // Eine Klemme sitzt als freier Punkt auf/an einem Rohr und verbindet zwei
  // Rohre laengs (ermoeglicht Klappen, bewegliche und schraege Elemente).
  clampNear(x, y, z) {
    const eps2 = MERGE_EPS * MERGE_EPS;
    for (const c of this.clamps.values()) {
      if (dist2(c, { x, y, z }) <= eps2) return c;
    }
    return null;
  }

  addClamp(x, y, z, connectorId = "double_tube") {
    const existing = this.clampNear(x, y, z);
    if (existing) return existing;
    const clamp = { id: this._id("k"), x, y, z, connectorId };
    this.clamps.set(clamp.id, clamp);
    return clamp;
  }

  removeClamp(id) {
    this.clamps.delete(id);
  }

  // Klemm-Kupplungen haengen an ihrem umschlossenen Rohr: faellt es weg,
  // faellt die Kupplung mit (und mit ihr, was an ihr steckt).
  _pruneClamps() {
    for (const n of [...this.nodes.values()]) {
      if (n.clampOn && !this.tubes.has(n.clampOn.tubeId)) this.removeNode(n.id);
    }
  }

  // Platten und Netze haengen an ihren beiden Tragrohren: faellt eines weg,
  // faellt die Platte mit.
  _prunePanels() {
    for (const map of [this.panels, this.textiles]) {
      for (const p of [...map.values()]) {
        if (!this._rail(p.a) || !this._rail(p.b)) map.delete(p.id);
      }
    }
  }

  // Schlaegt Rohre vor, die ein Alu-Verstaerkungsprofil gebrauchen koennten:
  // Alle waagerechten und schraegen Rohre, bei denen mindestens ein erhoehter
  // Endknoten keine senkrechte Stuetze nach unten hat (frei tragend, Kragarm,
  // Diagonale mit ungestuetzter Kupplung).  Senkrechte Rohre und Rohre auf
  // Bodenebene werden ausgeschlossen.  Liefert ein Set von Rohr-IDs.
  /**
   * Traegt etwas den Auslauf dieser Rutsche? Boden, eine Kupplung oder ein Rohr
   * unter dem Fuss zaehlen. Ohne Auflage braucht die Rutsche eine Stuetze --
   * genau darauf weist der Verstaerkungs-Vorschlag hin.
   */
  slideRests(sl) {
    const groundY = this._groundLevel();
    if (sl.y - groundY < 1) return true;
    for (const n of this.nodes.values()) {
      if (Math.hypot(n.x - sl.x, n.y - sl.y, n.z - sl.z) <= SLIDE_SUPPORT) return true;
    }
    // Auch mitten auf einem Rohr liegt der Auslauf auf.
    for (const t of this.tubes.values()) {
      if (t.arm || t.link) continue;
      const a = this.nodes.get(t.a), b = this.nodes.get(t.b);
      if (!a || !b) continue;
      const d = [b.x - a.x, b.y - a.y, b.z - a.z];
      const len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
      if (len2 < 1e-6) continue;
      let u = ((sl.x - a.x) * d[0] + (sl.y - a.y) * d[1] + (sl.z - a.z) * d[2]) / len2;
      u = Math.max(0, Math.min(1, u));
      const p = [a.x + d[0] * u, a.y + d[1] * u, a.z + d[2] * u];
      if (Math.hypot(sl.x - p[0], sl.y - p[1], sl.z - p[2]) <= SLIDE_SUPPORT) return true;
    }
    return false;
  }

  reinforcementSuggestions() {
    const out = new Set();
    // Rutschen ohne Auflage brauchen eine Stuetze.
    for (const sl of this.slides.values()) if (!this.slideRests(sl)) out.add(sl.id);
    let minY = Infinity;
    for (const n of this.nodes.values()) if (n.y < minY) minY = n.y;
    for (const t of this.tubes.values()) {
      const a = this.nodes.get(t.a), b = this.nodes.get(t.b);
      if (!a || !b) continue;
      // Senkrechte Rohre benoetigen kein Laengsprofil.
      if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.z - b.z) < 0.5) continue;
      // Beide Knoten auf Bodenebene: keine Notwenigkeit.
      if (a.y - minY < 0.5 && b.y - minY < 0.5) continue;
      // Vorschlag wenn mindestens ein erhoehter Knoten ungestuetzt ist.
      const aUnsupported = a.y - minY > 0.5 && !this._supportedFromBelow(a);
      const bUnsupported = b.y - minY > 0.5 && !this._supportedFromBelow(b);
      if (aUnsupported || bUnsupported) out.add(t.id);
    }
    return out;
  }

  // Alle Rohre, die sich mit einem anderen ueberlagern -- kollineare Ueberdeckung
  // (zwei Rohre auf derselben Achse) oder Kreuzung im Rohrinneren. Genau die
  // beiden Faelle, die tubeCollision() beim Bauen verhindert; importierte oder
  // aeltere Modelle koennen sie trotzdem enthalten.
  // Arm-/Link-Kanten sind keine Rohre. Boegen bleiben aussen vor: gespeichert ist
  // ihre Sehne, nicht der Bogen -- ein Test darauf meldet Falschtreffer.
  // --- Verschieben --------------------------------------------------------
  /**
   * Welche Teile haengen an den Auswahl-Eintraegen? Rohre und Platten haben
   * keine eigene Position -- sie folgen ihren Kupplungen, also werden deren
   * Knoten verschoben. Klemmen und Rutschen sitzen frei und bewegen sich
   * selbst.
   * sel: Map id -> kind (wie builder.selection).
   */
  moveTargets(sel) {
    const nodes = new Set(), clamps = new Set(), slides = new Set(), fittings = new Set();
    const addNodes = (list) => { for (const id of list || []) if (this.nodes.has(id)) nodes.add(id); };
    for (const [id, kind] of sel) {
      if (kind === "node") { if (this.nodes.has(id)) nodes.add(id); }
      else if (kind === "tube") { const t = this.tubes.get(id); if (t) addNodes([t.a, t.b]); }
      // Platten und Netze haengen an zwei Rohren -- verschoben werden deren Knoten.
      else if (kind === "panel" || kind === "textile") {
        const p = (kind === "panel" ? this.panels : this.textiles).get(id);
        for (const tid of p ? [p.a, p.b] : []) {
          const t = this.tubes.get(tid);
          if (t) addNodes([t.a, t.b]);
        }
      }
      else if (kind === "clamp") { if (this.clamps.has(id)) clamps.add(id); }
      else if (kind === "slide") { if (this.slides.has(id)) slides.add(id); }
      else if (kind === "fitting") { if (this.fittings.has(id)) fittings.add(id); }
    }
    return { nodes, clamps, slides, fittings };
  }

  /**
   * Verbindungen zum stehen bleibenden Teil trennen.
   *
   * Ein Rohr, von dem sich nur EIN Ende bewegt, kann nicht mitwandern -- Rohre
   * haben feste Katalog-Laengen. Es bleibt deshalb liegen und bekommt an der
   * frei werdenden Seite eine eigene Kupplung an der bisherigen Stelle; die
   * abgedockte Kupplung behaelt nur noch die Arme, die mitgehen.
   *
   * Liefert die Anzahl getrennter Rohre.
   */
  _detachBoundary(nodeIds) {
    // Platten und Netze, deren Ecken auseinandergerissen wuerden, gibt es
    // danach nicht mehr -- sie sind starre Fertigteile.
    // Eine Platte, deren zwei Tragrohre auseinandergerissen wuerden, gibt es
    // danach nicht mehr -- sie ist ein starres Fertigteil.
    const railNodes = (p) => {
      const out = [];
      for (const tid of [p.a, p.b]) {
        const t = this.tubes.get(tid);
        if (t) out.push(t.a, t.b);
      }
      return out;
    };
    const torn = (ids) => ids.some((id) => nodeIds.has(id)) && ids.some((id) => !nodeIds.has(id));
    for (const p of [...this.panels.values()]) if (torn(railNodes(p))) this.panels.delete(p.id);
    for (const x of [...this.textiles.values()]) if (torn(railNodes(x))) this.textiles.delete(x.id);

    const stubs = new Map();   // mitwandernde Knoten-id -> zurueckbleibende Kupplung
    const touched = new Set();
    let count = 0;
    for (const t of this.tubes.values()) {
      const a = nodeIds.has(t.a), b = nodeIds.has(t.b);
      if (a === b) continue;
      const movingId = a ? t.a : t.b;
      let stubId = stubs.get(movingId);
      if (!stubId) {
        const src = this.nodes.get(movingId);
        const stub = { id: this._id("n"), x: src.x, y: src.y, z: src.z };
        this.nodes.set(stub.id, stub);
        stubs.set(movingId, stub.id);
        stubId = stub.id;
      }
      if (a) t.a = stubId; else t.b = stubId;
      touched.add(movingId).add(stubId);
      count++;
    }
    for (const id of touched) this._syncC45Flag(id);
    if (count) this._pruneOrphanedC45Bodies();
    return count;
  }

  /**
   * c45-Kennzeichen nachziehen: Der Knoten traegt genau dann eine 45-Grad-
   * Winkelkupplung, wenn eine Arm-Kante zu einem Adapter-Koerper an ihm haengt.
   * Nach dem Trennen oder Zusammenlegen kann das kippen.
   */
  _syncC45Flag(id) {
    const n = this.nodes.get(id);
    if (!n || n.c45body) return;
    let has = false;
    for (const t of this.tubes.values()) {
      if (t.arm && (t.a === id || t.b === id)) { has = true; break; }
    }
    n.c45 = has;
    if (!has) n.c45axis = null;
  }

  _applyOffset(tg, dx, dy, dz) {
    const shift = (o) => {
      o.x = round(o.x + dx); o.y = round(o.y + dy); o.z = round(o.z + dz);
    };
    for (const id of tg.nodes) shift(this.nodes.get(id));
    for (const id of tg.clamps) shift(this.clamps.get(id));
    for (const id of tg.fittings || []) shift(this.fittings.get(id));
    for (const id of tg.slides) {
      const s = this.slides.get(id);
      shift(s);
      // Der Einhaengepunkt gehoert zur Rutsche und wandert mit.
      if (s.hook && s.hook.length === 3)
        s.hook = [round(s.hook[0] + dx), round(s.hook[1] + dy), round(s.hook[2] + dz)];
    }
  }

  /**
   * Verschiebt die ausgewaehlten Teile um (dx,dy,dz).
   *
   * Haengt die Auswahl ueber Rohre am Rest, werden diese Verbindungen getrennt
   * (siehe _detachBoundary); trifft sie am Ziel auf vorhandene Kupplungen,
   * verschmelzen die (siehe _mergeMovedNodes).
   *
   * Abgelehnt wird, was es real nicht gibt: ein Ziel, an dem sich Rohre
   * ueberlagern wuerden, und eine Kupplung, die es im Sortiment nicht gibt.
   * Beides zaehlt nur, wenn es VORHER nicht schon so war -- sonst liesse sich
   * ein Modell, das bereits kollidiert oder eine Sonderkupplung enthaelt, nie
   * mehr bewegen. Die Pruefung der Kupplungen wird hereingereicht (validate),
   * damit dieses Modul den Katalog nicht kennen muss.
   *
   * merge = false laesst deckungsgleiche Kupplungen getrennt.
   *
   * Liefert { ok, reason, merged, detached }.
   */
  moveSelection(sel, dx, dy, dz, { merge = true, validate = null } = {}) {
    if (!dx && !dy && !dz) return { ok: true, merged: 0, detached: 0 };
    const tg = this.moveTargets(sel);
    if (!tg.nodes.size && !tg.clamps.size && !tg.slides.size && !tg.fittings.size) return { ok: false, reason: "empty" };

    // Unter den Boden wird nicht verschoben. Frueh geprueft, damit der teure
    // Schnappschuss bei einem offensichtlich ungueltigen Zug entfaellt.
    if (dy < 0) {
      for (const id of tg.nodes) if (this.isBelowGround(this.nodes.get(id).y + dy)) return { ok: false, reason: "ground" };
      for (const id of tg.clamps) if (this.isBelowGround(this.clamps.get(id).y + dy)) return { ok: false, reason: "ground" };
    }

    const snapshot = this.toJSON();
    const collidedBefore = this.collisions();
    const badBefore = validate ? validate(this) : null;

    const fail = (reason) => { this.loadJSON(snapshot); return { ok: false, reason }; };
    const detached = this._detachBoundary(tg.nodes);
    this._applyOffset(tg, dx, dy, dz);
    // Ueberlagerung VOR dem Zusammenlegen pruefen: das raeumt deckungsgleiche
    // Rohre weg und wuerde einen Zug, der ein Teil genau auf ein anderes
    // schiebt, sonst durchgehen lassen.
    for (const id of this.collisions()) if (!collidedBefore.has(id)) return fail("collision");

    const merged = merge ? this._mergeMovedNodes(tg.nodes) : 0;
    if (badBefore) {
      for (const id of validate(this)) if (!badBefore.has(id)) return fail("connector");
    }
    return { ok: true, merged, detached };
  }

  /**
   * Kupplungen anpassen: landet ein verschobener Knoten auf einem stehen
   * gebliebenen, werden beide zu EINER Kupplung -- so waechst das verschobene
   * Teil mit dem Rest zusammen (aus der 2-armigen wird z.B. eine 3-armige).
   * Der stehende Knoten ueberlebt, damit Verweise ausserhalb der Auswahl gelten
   * bleiben.
   */
  _mergeMovedNodes(movedIds) {
    let merged = 0;
    const survivors = new Set();
    const eps2 = MERGE_EPS * MERGE_EPS;
    for (const id of movedIds) {
      const n = this.nodes.get(id);
      if (!n) continue;
      let target = null;
      for (const o of this.nodes.values()) {
        if (o.id === id || movedIds.has(o.id)) continue;
        if (dist2(o, n) <= eps2) { target = o; break; }
      }
      if (!target) continue;
      // Kennzeichen der verschwindenden Kupplung uebernehmen, soweit die
      // ueberlebende noch keines hat (Schraegen-Traeger, Wuerfel-Drehung).
      for (const key of ["c45", "c45body", "c45axis", "quat", "arms", "armDirs"]) {
        if (!target[key] && n[key]) target[key] = n[key];
      }
      this._replaceNodeRefs(id, target.id);
      this.nodes.delete(id);
      survivors.add(target.id);
      merged++;
    }
    if (merged) {
      this._dedupeTubes();
      this._prunePanels();
      for (const id of survivors) this._syncC45Flag(id);
    }
    return merged;
  }

  _replaceNodeRefs(fromId, toId) {
    for (const t of this.tubes.values()) {
      if (t.a === fromId) t.a = toId;
      if (t.b === fromId) t.b = toId;
    }
    // Platten verweisen auf Rohre, nicht auf Knoten -- da ist nichts zu tauschen.
  }

  // Nach dem Zusammenlegen koennen Rohre zwischen denselben zwei Kupplungen
  // doppelt vorliegen oder auf einen Punkt zusammenfallen.
  _dedupeTubes() {
    const seen = new Set();
    for (const t of [...this.tubes.values()]) {
      if (t.a === t.b) { this.tubes.delete(t.id); continue; }
      const pair = t.a < t.b ? `${t.a}|${t.b}` : `${t.b}|${t.a}`;
      const key = `${pair}|${t.arm ? "a" : t.link ? "l" : "t"}`;
      if (seen.has(key)) this.tubes.delete(t.id);
      else seen.add(key);
    }
  }

  collisions() {
    const out = new Set();
    const list = [];
    for (const t of this.tubes.values()) {
      if (t.arm || t.link || t.bow) continue;
      const a = this.nodes.get(t.a), b = this.nodes.get(t.b);
      if (a && b) list.push({ id: t.id, a, b });
    }
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const p = list[i], q = list[j];
        if (segmentsOverlap(p.a, p.b, q.a, q.b) || segmentsCross(p.a, p.b, q.a, q.b)) {
          out.add(p.id);
          out.add(q.id);
        }
      }
    }
    return out;
  }

  // Hat der Knoten eine senkrechte Stuetze nach unten (Rohr zu einem Knoten direkt darunter)?
  _supportedFromBelow(node) {
    for (const nb of this.neighbors(node.id)) {
      if (nb && nb.y < node.y - 0.5 &&
          Math.abs(nb.x - node.x) < 0.5 && Math.abs(nb.z - node.z) < 0.5) return true;
    }
    return false;
  }

  // Baut von einem bestehenden Knoten in eine Richtung ein Rohr an und legt
  // (falls noetig) den Zielknoten an. spacing = Rohrlaenge + Kupplungsgroesse.
  // Rueckgabe:
  //   { node, tube }            erfolgreich gebaut
  //   { node, tube:null, duplicate:true }  Ziel existiert und ist schon verbunden (Navigation)
  //   { collision:true }        Pfad ist durch ein anderes Rohr belegt
  extend(fromNodeId, dirVec, tubeId, color, length, spacing) {
    const from = this.nodes.get(fromNodeId);
    if (!from) return null;
    const target = {
      x: from.x + dirVec[0] * spacing,
      y: from.y + dirVec[1] * spacing,
      z: from.z + dirVec[2] * spacing,
    };
    if (this.isBelowGround(target.y)) return { ground: true };
    // Bereits verbundener Zielknoten => reine Navigation, kein neuer Bau.
    const existing = this.findNodeNear(target.x, target.y, target.z);
    if (existing && this.tubeBetween(from.id, existing.id)) {
      return { node: existing, tube: null, duplicate: true };
    }
    // Liegt auf dem Pfad schon ein Rohr? Dann nicht ueberbauen.
    if (this.tubeCollision(from, target)) {
      return { collision: true };
    }
    const to = this.addNode(target.x, target.y, target.z);
    const tube = this.addTube(from.id, to.id, tubeId, color, length);
    return { node: to, tube };
  }

  // Schraege Strebe ueber eine 45-Grad-Winkelkupplung (C45) anbauen. Von der
  // Basiskupplung `fromId` fuehrt ein kurzer Adapter-Arm (kardinale Huelse,
  // Richtung c45axis) zum Adapter-Koerper; von dort geht das Diagonalrohr (45
  // Grad, Richtung dir) zum neuen Knoten. So belegt der Adapter echten Platz und
  // erscheint als Winkelkupplung in der Stueckliste -- wie beim QDF-Import.
  //   sleeveLen = Huelsenlaenge (Basis->Koerper, kardinal),
  //   armLen    = 45-Grad-Armlaenge (Koerper->Rohranschluss).
  extendC45Diagonal(fromId, dir, c45axis, tubeId, color, length, spacing, sleeveLen, armLen) {
    const from = this.nodes.get(fromId);
    if (!from) return null;
    const bx = from.x + c45axis[0] * sleeveLen + dir[0] * armLen;
    const by = from.y + c45axis[1] * sleeveLen + dir[1] * armLen;
    const bz = from.z + c45axis[2] * sleeveLen + dir[2] * armLen;
    const target = { x: bx + dir[0] * spacing, y: by + dir[1] * spacing, z: bz + dir[2] * spacing };
    // Adapter-Koerper UND Rohrende muessen ueber dem Boden bleiben.
    if (this.isBelowGround(by) || this.isBelowGround(target.y)) return { ground: true };
    // Am oberen Ende sitzt haeufig schon eine Kupplung. Die Winkelkupplung frisst
    // im Schraegen-Raster ein gutes Stueck Weg, deshalb landet das gerechnete
    // Rohrende ein bis zwei Zentimeter daneben -- zu weit fuer den Auto-Merge
    // (MERGE_EPS). Ohne dieses Snapping entstuende eine zweite Kupplung, die die
    // vorhandene ueberlagert. Gleiche Logik wie in extendDiagonalSnap.
    const snap = this._nodeNear(target, DIAGONAL_SNAP_TOL, [fromId]);
    const end = snap || target;
    // Pfad des Diagonalrohrs schon belegt?
    if (this.tubeCollision({ x: bx, y: by, z: bz }, end)) return { collision: true };
    const body = this.addNode(round(bx), round(by), round(bz));
    body.c45 = true;
    body.c45body = true;
    body.c45axis = c45axis.slice();
    this.addArm(from.id, body.id);
    const to = snap || this.addNode(round(target.x), round(target.y), round(target.z));
    const tube = this.addTube(body.id, to.id, tubeId, color, length);
    return { node: to, tube, body };
  }

  // Aussenmasse des Modells in cm. Die Bounding-Box laeuft ueber alle Kupplungen
  // (Platten/Netze haengen an ihnen) plus die Eckpunkte der Rutschen, die ueber
  // das Rohrgeruest hinausragen. `pad` schlaegt an jeder Seite etwas drauf --
  // die Kupplungswuerfel stehen um ihre halbe Kantenlaenge ueber den Knoten
  // hinaus, sonst faelle das Mass um eine Kupplung zu klein aus.
  // Liefert null, solange nichts gebaut ist.
  bounds(pad = 0) {
    let lo = null, hi = null;
    const push = (x, y, z) => {
      if (!lo) { lo = [x, y, z]; hi = [x, y, z]; return; }
      lo = [Math.min(lo[0], x), Math.min(lo[1], y), Math.min(lo[2], z)];
      hi = [Math.max(hi[0], x), Math.max(hi[1], y), Math.max(hi[2], z)];
    };
    for (const n of this.nodes.values()) push(n.x, n.y, n.z);
    for (const f of (this.fittings ? this.fittings.values() : [])) push(f.x, f.y, f.z);
    for (const s of (this.slides ? this.slides.values() : [])) {
      push(s.x, s.y, s.z);
      if (s.hook && s.hook.length === 3) push(s.hook[0], s.hook[1], s.hook[2]);
    }
    if (!lo) return null;
    return {
      min: [lo[0] - pad, lo[1] - pad, lo[2] - pad],
      max: [hi[0] + pad, hi[1] + pad, hi[2] + pad],
      size: [hi[0] - lo[0] + 2 * pad, hi[1] - lo[1] + 2 * pad, hi[2] - lo[2] + 2 * pad],
    };
  }

  // Naechster vorhandener Knoten innerhalb tol um p, ohne die ausgeschlossenen ids.
  _nodeNear(p, tol, exclude = []) {
    let best = null, bestD = tol;
    for (const n of this.nodes.values()) {
      if (exclude.includes(n.id)) continue;
      const d = Math.hypot(n.x - p.x, n.y - p.y, n.z - p.z);
      if (d <= bestD) { bestD = d; best = n; }
    }
    return best;
  }

  // Schräg-Rohr an einer (schon rotierten) Schräg-Kupplung weiterbauen. Wie
  // extend, aber wenn am Zielpunkt schon ein Konnektor sitzt (im Schräg-Raster
  // ~41 cm statt 40), wird grosszuegig daran angeschlossen -> nach Loeschen+
  // Neusetzen werden die Rohre wieder sauber zusammengefuehrt. Kein C45-Adapter
  // (die Kupplung ist bereits 45-Grad gedreht).
  extendDiagonalSnap(fromId, dir, tubeId, color, length, spacing, snapTol = DIAGONAL_SNAP_TOL) {
    const from = this.nodes.get(fromId);
    if (!from) return null;
    const tx = from.x + dir[0] * spacing, ty = from.y + dir[1] * spacing, tz = from.z + dir[2] * spacing;
    let best = null, bestD = snapTol;
    for (const n of this.nodes.values()) {
      if (n.id === fromId) continue;
      const d = Math.hypot(n.x - tx, n.y - ty, n.z - tz);
      if (d <= bestD) { bestD = d; best = n; }
    }
    if (best) {
      if (this.tubeBetween(fromId, best.id)) return { node: best, tube: null, duplicate: true };
      if (this.tubeCollision(from, best)) return { collision: true };
      const tube = this.addTube(fromId, best.id, tubeId, color, length);
      return { node: best, tube };
    }
    // Ohne Rasterpunkt entsteht ein neuer Knoten -- extend() prueft den Boden.
    return this.extend(fromId, dir, tubeId, color, length, spacing);
  }

  // Bogenrohr (Viertelkreis) anbauen. dirVec ist die Tangente am Startknoten,
  // normal die Richtung zum Kreismittelpunkt (senkrecht dazu), R der Radius.
  // Endpunkt = from + R * (dir + normal); der Mittelpunkt wird mitgespeichert,
  // damit die Szene denselben Bogen zeichnet wie beim QDF-Import.
  extendBow(fromNodeId, dirVec, normal, tubeId, color, R) {
    const from = this.nodes.get(fromNodeId);
    if (!from) return null;
    const cx = from.x + normal[0] * R, cy = from.y + normal[1] * R, cz = from.z + normal[2] * R;
    const target = {
      x: from.x + R * (dirVec[0] + normal[0]),
      y: from.y + R * (dirVec[1] + normal[1]),
      z: from.z + R * (dirVec[2] + normal[2]),
    };
    // Der Bogen haengt zwischen Start und Ziel durch: der tiefste Punkt liegt
    // bei einem abwaerts fuehrenden Viertelkreis am Mittelpunkt der Sehne.
    if (this.isBelowGround(target.y) || this.isBelowGround(cy)) return { ground: true };
    const existing = this.findNodeNear(target.x, target.y, target.z);
    if (existing && this.tubeBetween(from.id, existing.id)) {
      return { node: existing, tube: null, duplicate: true };
    }
    const to = this.addNode(round(target.x), round(target.y), round(target.z));
    if (from.id === to.id) return null;
    const tube = this.addTube(from.id, to.id, tubeId, color, null);
    if (tube) {
      tube.bow = true;
      tube.bowCenter = [round(cx), round(cy), round(cz)];
    }
    return { node: to, tube };
  }

  /**
   * Bogenrohr um 90 Grad um seine eigene Tangente drehen.
   *
   * Der Startknoten und die Richtung, in der der Bogen die Kupplung verlaesst,
   * bleiben stehen; die Kruemmungsebene kippt. Nach vier Aufrufen ist der Bogen
   * wieder da, wo er war. Das Ende wandert dabei auf einen neuen Rasterpunkt --
   * ein dadurch verwaister Knoten wird entfernt.
   *
   * Liefert { node } oder { ground:true } / { duplicate:true }.
   */
  rotateBow(id) {
    const t = this.tubes.get(id);
    if (!t || !t.bow || !t.bowCenter) return null;
    const a = this.nodes.get(t.a), b = this.nodes.get(t.b);
    if (!a || !b) return null;
    const c = { x: t.bowCenter[0], y: t.bowCenter[1], z: t.bowCenter[2] };
    const R = Math.hypot(c.x - a.x, c.y - a.y, c.z - a.z);
    if (R < 1) return null;
    const n = [(c.x - a.x) / R, (c.y - a.y) / R, (c.z - a.z) / R];
    // Tangente am Anfang: Sehne minus Radiusanteil, normiert.
    const t0 = unit([(b.x - a.x) / R - n[0], (b.y - a.y) / R - n[1], (b.z - a.z) / R - n[2]]);
    // Die drei uebrigen Lagen: 90, 180, 270 Grad um die Tangente. Geht eine
    // nicht (unter dem Boden, Ziel schon verbunden), wird die naechste
    // genommen -- sonst liesse sich ein Bogen ueber dem Boden gar nicht mehr
    // bewegen, weil ausgerechnet der naechste Schritt nach unten zeigt.
    const perp = cross(t0, n);
    const steps = [perp, [-n[0], -n[1], -n[2]], [-perp[0], -perp[1], -perp[2]]];
    let blocked = null;
    for (const n2 of steps) {
      const target = {
        x: round(a.x + R * (t0[0] + n2[0])),
        y: round(a.y + R * (t0[1] + n2[1])),
        z: round(a.z + R * (t0[2] + n2[2])),
      };
      const cy = a.y + n2[1] * R;
      if (this.isBelowGround(target.y) || this.isBelowGround(cy)) { blocked = { ground: true }; continue; }
      const hit = this.findNodeNear(target.x, target.y, target.z);
      if (hit && hit.id !== t.b && this.tubeBetween(t.a, hit.id)) { blocked = { duplicate: true }; continue; }

      const oldEnd = t.b;
      const to = hit || this.addNode(target.x, target.y, target.z);
      if (to.id === t.a) { blocked = { duplicate: true }; continue; }
      t.b = to.id;
      t.bowCenter = [round(a.x + n2[0] * R), round(cy), round(a.z + n2[2] * R)];
      // Zurueckgebliebener Knoten ohne Rohr verschwindet.
      if (oldEnd !== to.id && this.degree(oldEnd) === 0) this.nodes.delete(oldEnd);
      this._prunePanels();
      return { node: to };
    }
    return blocked || null;
  }

  /**
   * Platten-/Netz-Datensatz aus dem Speicherformat.
   *
   * Neue Staende bringen die beiden Tragrohre mit. Aeltere (und der QDF-Import)
   * liefern vier Eck-Knoten -- daraus werden die zwei gegenueberliegenden Rohre
   * gesucht, an denen die Platte haengt. Findet sich keines, gehoert die Platte
   * nirgends hin und faellt weg.
   */
  _panelRecord(p) {
    const side = p.side < 0 ? -1 : 1;
    if (p.a && p.b) {
      return { id: p.id, a: p.a, b: p.b, t0: p.t0 || 0, len: p.len || 0, color: p.color, side };
    }
    if (!p.nodes || p.nodes.length !== 4) return null;
    const ns = p.nodes.map((id) => this.nodes.get(id));
    if (ns.some((n) => !n)) return null;
    // [A,B,C,D] laeuft umlaufend: Kandidaten sind (A,B)+(D,C) oder (B,C)+(A,D).
    const pairs = [[[0, 1], [3, 2]], [[1, 2], [0, 3]]];
    for (const [[i0, i1], [j0, j1]] of pairs) {
      // Erst das Rohr genau zwischen den beiden Ecken; sonst irgendeines, das
      // auf der Kante liegt. Lange Platten (Baellebad-Wand, Netze) spannen ueber
      // mehrere Rohre -- dann traegt sie das erste davon.
      const ta = this.tubeBetween(p.nodes[i0], p.nodes[i1]) || this._tubeAlong(ns[i0], ns[i1]);
      const tb = this.tubeBetween(p.nodes[j0], p.nodes[j1]) || this._tubeAlong(ns[j0], ns[j1]);
      if (!ta || !tb || ta.bow || tb.bow) continue;
      const rail = this._rail(ta.id);
      if (!rail) continue;
      const s = (n) => (n.x - rail.p0[0]) * rail.dir[0] + (n.y - rail.p0[1]) * rail.dir[1] + (n.z - rail.p0[2]) * rail.dir[2];
      const s0 = s(ns[i0]), s1 = s(ns[i1]);
      return {
        id: p.id, a: ta.id, b: tb.id,
        t0: round(Math.min(s0, s1)), len: round(Math.abs(s1 - s0)),
        color: p.color, side,
      };
    }
    return null;
  }

  /**
   * Ein Rohr, das auf der Strecke a->b liegt (gleiche Achse, echte Ueberdeckung).
   * Gebraucht fuer Platten, die ueber mehrere Rohre spannen.
   */
  _tubeAlong(a, b) {
    const d = [b.x - a.x, b.y - a.y, b.z - a.z];
    const L = Math.hypot(d[0], d[1], d[2]);
    if (L < 1e-6) return null;
    const u = [d[0] / L, d[1] / L, d[2] / L];
    let best = null, bestS = Infinity;
    for (const t of this.tubes.values()) {
      if (t.arm || t.link || t.bow) continue;
      const p = this.nodes.get(t.a), q = this.nodes.get(t.b);
      if (!p || !q) continue;
      if (perpDist(a, u, p) > MERGE_EPS || perpDist(a, u, q) > MERGE_EPS) continue;
      const s0 = (p.x - a.x) * u[0] + (p.y - a.y) * u[1] + (p.z - a.z) * u[2];
      const s1 = (q.x - a.x) * u[0] + (q.y - a.y) * u[1] + (q.z - a.z) * u[2];
      if (Math.min(s0, s1) > L - MERGE_EPS || Math.max(s0, s1) < MERGE_EPS) continue;
      const start = Math.min(s0, s1);
      if (start < bestS) { bestS = start; best = t; }
    }
    return best;
  }

  isEmpty() {
    return this.nodes.size === 0;
  }

  clear() {
    this.nodes.clear();
    this.tubes.clear();
    this.panels.clear();
    this.clamps.clear();
    this.textiles.clear();
    this.slides.clear();
    this.fittings.clear();
    this._seq = 1;
  }

  // --- Serialisierung -----------------------------------------------------
  toJSON() {
    return {
      format: FORMAT_VERSION,
      nodes: [...this.nodes.values()].map((n) => {
        const o = { id: n.id, x: round(n.x), y: round(n.y), z: round(n.z) };
        if (n.c45) o.c45 = true; // Knoten traegt eine 45-Grad-Winkelkupplung
        if (n.c45body) o.c45body = true; // Adapter-Koerper am Arm-Ende der C45
        if (n.c45axis) o.c45axis = n.c45axis; // kardinale Huelsenachse des Adapters
        if (n.armDirs) o.armDirs = n.armDirs; // gespeicherte Arm-Richtungen (rotierte Kupplung)
        if (n.arms) o.arms = n.arms; // echte Arm-Stutzen aus variant2 (Darstellung)
        if (n.quat) o.quat = n.quat; // Wuerfel-Orientierung der Kupplung (Three x,y,z,w)
        if (n.part) o.part = n.part; // festes Katalogteil (Klemm-Kupplungen)
        if (n.clampOn) o.clampOn = n.clampOn; // umschlossenes Rohr + Stelle darauf
        if (n.stub) o.stub = n.stub; // Richtung des offenen Anschlusses
        return o;
      }),
      tubes: [...this.tubes.values()].map((t) => {
        const o = { id: t.id, a: t.a, b: t.b, tubeId: t.tubeId, color: t.color, length: t.length };
        if (t.reinforced) o.reinforced = true;
        if (t.arm) o.arm = true; // C45-Adapter-Arm (kein Rohr)
        if (t.link) o.link = true; // Doppelrohrverbinder-Verbindung (kein Rohr)
        if (t.bow) { o.bow = true; o.bowCenter = t.bowCenter; } // Bogenrohr (Viertelkreis)
        return o;
      }),
      panels: [...this.panels.values()].map((p) => {
        const o = { id: p.id, a: p.a, b: p.b, t0: round(p.t0), len: round(p.len), panelId: p.panelId, color: p.color };
        if ((p.side || 1) < 0) o.side = -1;   // Standard ist oben/aussen
        return o;
      }),
      clamps: [...this.clamps.values()].map((c) => {
        const o = { id: c.id, x: round(c.x), y: round(c.y), z: round(c.z), connectorId: c.connectorId };
        if (c.dir) o.dir = c.dir;   // Achse der gehaltenen Tubes
        if (c.off) o.off = c.off;   // Versatz zur zweiten Tube (die "8")
        return o;
      }),
      textiles: [...this.textiles.values()].map((t) => {
        const o = { id: t.id, a: t.a, b: t.b, t0: round(t.t0), len: round(t.len), w: t.w, h: t.h, color: t.color };
        if ((t.side || 1) < 0) o.side = -1;
        return o;
      }),
      fittings: [...this.fittings.values()].map((f) => {
        const o = { id: f.id, kind: f.kind, x: round(f.x), y: round(f.y), z: round(f.z) };
        if (f.quat) o.quat = f.quat;
        if (f.color) o.color = f.color;
        if (f.w != null) o.w = f.w;
        if (f.h != null) o.h = f.h;
        if (f.mask != null) o.mask = f.mask;
        return o;
      }),
      slides: [...this.slides.values()].map((s) => {
        const o = { id: s.id, x: round(s.x), y: round(s.y), z: round(s.z), kind: s.kind };
        if (s.quat) o.quat = s.quat;
        if (s.hook) o.hook = s.hook; // manuell gesetzt: Einhaengepunkt am Rohrpaar
        if (s.color) o.color = s.color; // Three-Quaternion x,y,z,w (vor Rz90)
        return o;
      }),
    };
  }

  // Laedt ein gespeichertes/importiertes Modell. Liefert { ok, reason }, damit
  // die UI-Schicht eine passende (uebersetzte) Meldung anzeigen kann, statt
  // ein kaputtes Modell still zu uebernehmen oder den Aufrufer abstuerzen zu
  // lassen. reason ist einer von: "format" (unbekannte/zu neue Version),
  // "data" (kein Objekt / nodes fehlt oder kein Array).
  loadJSON(data) {
    if (!data || typeof data !== "object" || !Array.isArray(data.nodes)) {
      return { ok: false, reason: "data" };
    }
    // Aeltere Speicherstaende ohne "format"-Feld gelten als Version 1
    // (Legacy) und werden weiter akzeptiert; nur eine abweichende, bekannte
    // Versionsnummer wird abgelehnt.
    if (data.format != null && data.format !== FORMAT_VERSION) {
      return { ok: false, reason: "format" };
    }
    this.clear();
    let maxSeq = 0;
    for (const n of data.nodes) {
      this.nodes.set(n.id, { id: n.id, x: n.x, y: n.y, z: n.z, c45: !!n.c45, c45body: !!n.c45body,
        c45axis: n.c45axis || null, armDirs: n.armDirs || null, arms: n.arms || null, quat: n.quat || null,
        part: n.part || null, clampOn: n.clampOn || null, stub: n.stub || null });
      maxSeq = Math.max(maxSeq, parseSeq(n.id));
    }
    for (const t of data.tubes || []) {
      if (!t.a || !t.b) continue;
      if (!this.nodes.has(t.a) || !this.nodes.has(t.b)) {
        console.warn(`Ungültiges Rohr: Knoten ${t.a} oder ${t.b} existiert nicht.`);
        continue;
      }
      this.tubes.set(t.id, {
        id: t.id, a: t.a, b: t.b, tubeId: t.tubeId, color: t.color, length: t.length,
        reinforced: !!t.reinforced, arm: !!t.arm, link: !!t.link,
        bow: !!t.bow, bowCenter: t.bowCenter || null,
      });
      maxSeq = Math.max(maxSeq, parseSeq(t.id));
    }
    for (const p of data.panels || []) {
      const rec = this._panelRecord(p);
      if (!rec) continue;
      rec.panelId = p.panelId;
      this.panels.set(p.id, rec);
      maxSeq = Math.max(maxSeq, parseSeq(p.id));
    }
    for (const c of data.clamps || []) {
      this.clamps.set(c.id, {
        id: c.id, x: c.x, y: c.y, z: c.z, connectorId: c.connectorId || "double_tube",
        dir: c.dir || null, off: c.off || null,
      });
      maxSeq = Math.max(maxSeq, parseSeq(c.id));
    }
    for (const t of data.textiles || []) {
      const rec = this._panelRecord(t);
      if (!rec) continue;
      rec.w = t.w; rec.h = t.h;
      this.textiles.set(t.id, rec);
      maxSeq = Math.max(maxSeq, parseSeq(t.id));
    }
    for (const f of data.fittings || []) {
      this.fittings.set(f.id, {
        id: f.id, kind: f.kind, x: f.x, y: f.y, z: f.z,
        quat: f.quat || null, color: f.color || null,
        w: f.w, h: f.h, mask: f.mask,
      });
      maxSeq = Math.max(maxSeq, parseSeq(f.id));
    }
    for (const s of data.slides || []) {
      this.slides.set(s.id, { id: s.id, x: s.x, y: s.y, z: s.z, quat: s.quat || null, hook: s.hook || null, color: s.color || null, kind: s.kind });
      maxSeq = Math.max(maxSeq, parseSeq(s.id));
    }
    this._seq = maxSeq + 1;
    return { ok: true };
  }
}

// Ueberlappen sich die Strecken p1->p2 und p3->p4 kollinear mit Laenge > eps?
function segmentsOverlap(p1, p2, p3, p4) {
  const d = [p2.x - p1.x, p2.y - p1.y, p2.z - p1.z];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-6) return false;
  const u = [d[0] / len, d[1] / len, d[2] / len];
  // p3, p4 muessen auf der Geraden durch p1 in Richtung u liegen.
  if (perpDist(p1, u, p3) > MERGE_EPS || perpDist(p1, u, p4) > MERGE_EPS) return false;
  const t3 = (p3.x - p1.x) * u[0] + (p3.y - p1.y) * u[1] + (p3.z - p1.z) * u[2];
  const t4 = (p4.x - p1.x) * u[0] + (p4.y - p1.y) * u[1] + (p4.z - p1.z) * u[2];
  const lo = Math.max(0, Math.min(t3, t4));
  const hi = Math.min(len, Math.max(t3, t4));
  return hi - lo > MERGE_EPS;
}

// Schneiden sich die Strecken p1->p2 und q1->q2 (nicht parallel) so, dass der
// Treffpunkt im Inneren mindestens einer Strecke liegt? Beruehrung an einem
// gemeinsamen Endpunkt (Kupplung) zaehlt nicht. Faengt den Fall ab, dass ein
// neues Rohr quer ueber ein laengeres Rohr (z. B. 75er) gebaut wird.
function segmentsCross(p1, p2, q1, q2) {
  const d1 = { x: p2.x - p1.x, y: p2.y - p1.y, z: p2.z - p1.z };
  const d2 = { x: q2.x - q1.x, y: q2.y - q1.y, z: q2.z - q1.z };
  const a = d1.x * d1.x + d1.y * d1.y + d1.z * d1.z;
  const e = d2.x * d2.x + d2.y * d2.y + d2.z * d2.z;
  if (a < 1e-9 || e < 1e-9) return false;
  const r = { x: p1.x - q1.x, y: p1.y - q1.y, z: p1.z - q1.z };
  const f = d2.x * r.x + d2.y * r.y + d2.z * r.z;
  const c = d1.x * r.x + d1.y * r.y + d1.z * r.z;
  const b = d1.x * d2.x + d1.y * d2.y + d1.z * d2.z;
  const denom = a * e - b * b;
  if (Math.abs(denom) < 1e-9) return false; // (nahezu) parallel -> kollinear separat geprueft
  let s = (b * f - c * e) / denom;
  let t = (a * f - b * c) / denom;
  s = Math.max(0, Math.min(1, s));
  t = Math.max(0, Math.min(1, t));
  const x1 = { x: p1.x + d1.x * s, y: p1.y + d1.y * s, z: p1.z + d1.z * s };
  const x2 = { x: q1.x + d2.x * t, y: q1.y + d2.y * t, z: q1.z + d2.z * t };
  if (dist2(x1, x2) > MERGE_EPS * MERGE_EPS) return false; // treffen sich nicht
  const eps = MERGE_EPS;
  const interior1 = Math.sqrt(dist2(x1, p1)) > eps && Math.sqrt(dist2(x1, p2)) > eps;
  const interior2 = Math.sqrt(dist2(x2, q1)) > eps && Math.sqrt(dist2(x2, q2)) > eps;
  return interior1 || interior2;
}

// Senkrechter Abstand des Punktes p von der Geraden (origin, Richtung u, |u|=1).
function perpDist(origin, u, p) {
  const r = [p.x - origin.x, p.y - origin.y, p.z - origin.z];
  const t = r[0] * u[0] + r[1] * u[1] + r[2] * u[2];
  const px = r[0] - t * u[0], py = r[1] - t * u[1], pz = r[2] - t * u[2];
  return Math.hypot(px, py, pz);
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function unit(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function parseSeq(id) {
  const m = /(\d+)$/.exec(id || "");
  return m ? parseInt(m[1], 10) : 0;
}
