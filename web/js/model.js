// Datenmodell des Bauwerks: Graph aus Knoten (Kupplungen) und Kanten (Rohren).
// Bewusst ohne Three.js-Abhaengigkeit, damit es testbar und Backend-tauglich bleibt.

import { MERGE_EPS, FORMAT_VERSION, DIAGONAL_SNAP_TOL } from "./config.js";
import { round2 as round } from "./util.js";

// Rutsche: Einhaengepunkt sitzt knapp ueber den unteren Kupplungen des
// senkrechten Rohrpaars; SLIDE_SLOPE ist die rutschentypische Neigung.
const SLIDE_HOOK_LIFT = 5;                 // cm ueber der unteren Kupplung
// Rutsche = starres Fertigteil. Masse abgemessen an QuadroTobezimmer.qdf: dort
// haengt sie 80 cm hoch ein und laeuft 100 cm weit aus -> Bahn 128 cm bei 38,7 Grad.
const SLIDE_LENGTH = Math.hypot(100, 80);          // 128 cm Bahnlaenge
const SLIDE_SLOPE = Math.atan2(80, 100);           // fester Neigungswinkel

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
  _panelKey(nodeIds) {
    return nodeIds.slice().sort().join("|");
  }

  panelOnCell(nodeIds) {
    const k = this._panelKey(nodeIds);
    for (const p of this.panels.values()) if (this._panelKey(p.nodes) === k) return p;
    return null;
  }

  addPanel(nodeIds, panelId, color) {
    if (nodeIds.length !== 4) return null;
    if (this.panelOnCell(nodeIds)) return null;
    const panel = { id: this._id("p"), nodes: nodeIds.slice(), panelId, color };
    this.panels.set(panel.id, panel);
    return panel;
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

  // Montagestellen fuer eine Rutsche: zwei parallele SENKRECHTE Rohre. Die
  // Rutsche wird dort eingehaengt und sitzt knapp ueber den unteren Kupplungen.
  // Liefert je Stelle { nodes, hook:[x,y,z], normal:[..] } -- hook ist der
  // Einhaengepunkt (Mitte zwischen beiden Rohren, kurz ueber den unteren
  // Kupplungen), normal die Richtung, in die die Rutsche abfaellt.
  slideMounts(width = 40, tol = 2) {
    const out = [];
    for (const r of this.findRectangles()) {
      // u = Rohrrichtung, v = Abstand der beiden Rohre.
      if (Math.abs(r.u[1]) < 0.95) continue;                 // Rohre nicht senkrecht
      if (Math.abs(r.dims[1] - width) > tol) continue;        // falscher Abstand
      const ns = r.nodes.map((id) => this.nodes.get(id)).filter(Boolean);
      if (ns.length !== 4) continue;
      const minY = Math.min(...ns.map((n) => n.y));
      const low = ns.filter((n) => n.y - minY < 0.5);
      if (low.length !== 2) continue;
      const hook = [
        (low[0].x + low[1].x) / 2,
        minY + SLIDE_HOOK_LIFT,
        (low[0].z + low[1].z) / 2,
      ];
      // Abfallrichtung: waagerechte Feld-Normale, und zwar die Seite mit
      // weniger Bauteilen -- die Rutsche laeuft vom Geruest weg, nicht hinein.
      // Starres Teil: zu tief eingehaengt landet der Auslauf unter dem Boden --
      // dort laesst sich real keine Rutsche montieren, also nicht anbieten.
      if (hook[1] < SLIDE_LENGTH * Math.sin(SLIDE_SLOPE) - 1) continue;
      const nrm = [r.normal[0], 0, r.normal[2]];
      const nl = Math.hypot(nrm[0], nrm[2]);
      if (nl < 0.5) continue;                                 // Feld liegt waagerecht
      nrm[0] /= nl; nrm[2] /= nl;
      let front = 0, back = 0;
      for (const n of this.nodes.values()) {
        const d = (n.x - hook[0]) * nrm[0] + (n.z - hook[2]) * nrm[2];
        if (d > 5) front++; else if (d < -5) back++;
      }
      const dir = front > back ? [-nrm[0], 0, -nrm[2]] : nrm;
      out.push({ nodes: r.nodes.slice(), hook, normal: dir, center: r.center, u: r.u, v: r.v });
    }
    return out;
  }

  // Rutsche an einer Montagestelle einhaengen. Der Fuss liegt am Boden, um die
  // rutschentypische Neigung vom Einhaengepunkt entfernt.
  addSlide(hook, normal, kind = "slide-new2") {
    // Die Rutsche ist ein starres Fertigteil: feste Bahnlaenge UND fester
    // Neigungswinkel. Hoehenunterschied und waagerechter Auslauf stehen damit
    // fest; der Fuss liegt so tief unter dem Einhaengepunkt, wie das Teil es
    // vorgibt (bei der ueblichen Einhaenghoehe von 80 cm genau auf dem Boden).
    const run = SLIDE_LENGTH * Math.cos(SLIDE_SLOPE);
    const drop = SLIDE_LENGTH * Math.sin(SLIDE_SLOPE);
    const slide = {
      id: this._id("s"),
      x: round(hook[0] + normal[0] * run),
      y: round(hook[1] - drop),
      z: round(hook[2] + normal[2] * run),
      hook: [round(hook[0]), round(hook[1]), round(hook[2])],
      kind,
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
      : kind === "textile" ? this.textiles : null;
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

  // Entfernt Platten, deren 4 Rand-Rohre nicht mehr vollstaendig vorhanden sind.
  _prunePanels() {
    for (const p of [...this.panels.values()]) {
      const ns = p.nodes;
      // Wie beim Setzen (findRectangles) genuegen ZWEI GEGENUEBERLIEGENDE Rohre:
      // die Platte bleibt liegen, solange eines der beiden Seitenpaare steht.
      const edge = (k) => !!this.tubeBetween(ns[k], ns[(k + 1) % 4]);
      const ok = ns.every((id) => this.nodes.has(id)) &&
        ((edge(0) && edge(2)) || (edge(1) && edge(3)));
      if (!ok) this.panels.delete(p.id);
    }
    // Netze/Stoffe (textil2): entfernen, sobald eine ihrer 4 Eck-Kupplungen fehlt.
    for (const t of [...this.textiles.values()]) {
      if (!t.nodes.every((id) => this.nodes.has(id))) this.textiles.delete(t.id);
    }
  }

  // Schlaegt Rohre vor, die ein Alu-Verstaerkungsprofil gebrauchen koennten:
  // Alle waagerechten und schraegen Rohre, bei denen mindestens ein erhoehter
  // Endknoten keine senkrechte Stuetze nach unten hat (frei tragend, Kragarm,
  // Diagonale mit ungestuetzter Kupplung).  Senkrechte Rohre und Rohre auf
  // Bodenebene werden ausgeschlossen.  Liefert ein Set von Rohr-IDs.
  reinforcementSuggestions() {
    const out = new Set();
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

  // Hat der Knoten eine senkrechte Stuetze nach unten (Rohr zu einem Knoten direkt darunter)?
  _supportedFromBelow(node) {
    for (const nb of this.neighbors(node.id)) {
      if (nb && nb.y < node.y - 0.5 &&
          Math.abs(nb.x - node.x) < 0.5 && Math.abs(nb.z - node.z) < 0.5) return true;
    }
    return false;
  }

  // Findet rechteckige Felder fuer Platten. Es genuegen ZWEI GEGENUEBERLIEGENDE
  // Rohre -- eine Platte liegt beim Bauen auf zwei parallelen Rohren auf, die
  // beiden Querseiten muessen nicht geschlossen sein. Gesucht wird deshalb ueber
  // Paare paralleler, gleich langer Rohre, deren Endknoten ein Rechteck bilden
  // (frueher lief die Suche ueber die Rohr-Nachbarn eines Knotens und verlangte
  // alle vier Randrohre; ein Feld mit offenen Querseiten wurde so nie gefunden).
  // Liefert je Feld { nodes:[A,B,C,D], dims:[l1,l2], center, normal, u, v }.
  findRectangles() {
    const rects = [];
    const seen = new Set();
    // Arm-/Link-Kanten sind keine Rohre; Boegen sind gekruemmt und tragen keine Platte.
    const tubes = [...this.tubes.values()].filter((t) => !t.arm && !t.link && !t.bow);
    for (let i = 0; i < tubes.length; i++) {
      const A = this.nodes.get(tubes[i].a), B = this.nodes.get(tubes[i].b);
      if (!A || !B) continue;
      const v1 = [B.x - A.x, B.y - A.y, B.z - A.z];
      const L1 = Math.hypot(v1[0], v1[1], v1[2]);
      if (L1 < 1e-6) continue;
      for (let j = i + 1; j < tubes.length; j++) {
        let D = this.nodes.get(tubes[j].a), C = this.nodes.get(tubes[j].b);
        if (!D || !C) continue;
        let v2 = [C.x - D.x, C.y - D.y, C.z - D.z];
        const L2 = Math.hypot(v2[0], v2[1], v2[2]);
        if (Math.abs(L1 - L2) > 0.5) continue;                     // ungleich lang
        const dot = (v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]) / (L1 * L2);
        if (Math.abs(Math.abs(dot) - 1) > 1e-3) continue;          // nicht parallel
        if (dot < 0) { const tmp = D; D = C; C = tmp; }            // gleichsinnig ausrichten
        // Versatz A->D: senkrecht zum Rohr und identisch zu B->C (echtes Rechteck).
        const w = [D.x - A.x, D.y - A.y, D.z - A.z];
        const wl = Math.hypot(w[0], w[1], w[2]);
        if (wl < 0.5) continue;
        if (Math.abs(w[0] * v1[0] + w[1] * v1[1] + w[2] * v1[2]) > 1e-3) continue;
        if (Math.abs(C.x - B.x - w[0]) > 0.5 ||
            Math.abs(C.y - B.y - w[1]) > 0.5 ||
            Math.abs(C.z - B.z - w[2]) > 0.5) continue;
        const key = [A.id, B.id, C.id, D.id].slice().sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        const n = cross(v1, w);
        const nl = Math.hypot(n[0], n[1], n[2]) || 1;
        rects.push({
          nodes: [A.id, B.id, C.id, D.id],
          dims: [L1, wl],
          center: [(A.x + B.x + C.x + D.x) / 4, (A.y + B.y + C.y + D.y) / 4, (A.z + B.z + C.z + D.z) / 4],
          normal: [n[0] / nl, n[1] / nl, n[2] / nl],
          u: unit(v1),
          v: unit(w),
        });
      }
    }
    return rects;
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
    // Pfad des Diagonalrohrs schon belegt?
    if (this.tubeCollision({ x: bx, y: by, z: bz }, target)) return { collision: true };
    const body = this.addNode(round(bx), round(by), round(bz));
    body.c45 = true;
    body.c45body = true;
    body.c45axis = c45axis.slice();
    this.addArm(from.id, body.id);
    const to = this.addNode(round(target.x), round(target.y), round(target.z));
    const tube = this.addTube(body.id, to.id, tubeId, color, length);
    return { node: to, tube, body };
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
      panels: [...this.panels.values()].map((p) => ({
        id: p.id, nodes: p.nodes.slice(), panelId: p.panelId, color: p.color,
      })),
      clamps: [...this.clamps.values()].map((c) => {
        const o = { id: c.id, x: round(c.x), y: round(c.y), z: round(c.z), connectorId: c.connectorId };
        if (c.dir) o.dir = c.dir;   // Achse der gehaltenen Tubes
        if (c.off) o.off = c.off;   // Versatz zur zweiten Tube (die "8")
        return o;
      }),
      textiles: [...this.textiles.values()].map((t) => ({
        id: t.id, nodes: t.nodes.slice(), w: t.w, h: t.h, color: t.color,
      })),
      slides: [...this.slides.values()].map((s) => {
        const o = { id: s.id, x: round(s.x), y: round(s.y), z: round(s.z), kind: s.kind };
        if (s.quat) o.quat = s.quat;
        if (s.hook) o.hook = s.hook; // manuell gesetzt: Einhaengepunkt am Rohrpaar // Three-Quaternion x,y,z,w (vor Rz90)
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
      this.nodes.set(n.id, { id: n.id, x: n.x, y: n.y, z: n.z, c45: !!n.c45, c45body: !!n.c45body, c45axis: n.c45axis || null, armDirs: n.armDirs || null, arms: n.arms || null, quat: n.quat || null });
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
      if (!p.nodes || !Array.isArray(p.nodes)) continue;
      this.panels.set(p.id, {
        id: p.id, nodes: p.nodes.slice(), panelId: p.panelId, color: p.color,
      });
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
      this.textiles.set(t.id, { id: t.id, nodes: t.nodes.slice(), w: t.w, h: t.h, color: t.color });
      maxSeq = Math.max(maxSeq, parseSeq(t.id));
    }
    for (const s of data.slides || []) {
      this.slides.set(s.id, { id: s.id, x: s.x, y: s.y, z: s.z, quat: s.quat || null, hook: s.hook || null, kind: s.kind });
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
