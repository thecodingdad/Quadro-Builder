// Bau-Interaktion: Auswahl, Anbau ueber Richtungs-Handles, Loeschen.

import { DIRECTIONS, DIAGONAL_DIRECTIONS, DIR_ALIGN_TOL, ARM_ALIGN_TOL, CLAMP_LINK_DIST } from "./config.js";
import { geometry, getTube, spacingFor, getPanel, defaultPanel, diagonalTubeId, slideKindLabel, isCurvedTube, gridSpacing } from "./catalog.js";
import { computeBuildPlan, connectorLabelInfo } from "./buildplan.js";
import { t } from "./i18n.js";
import { round2 } from "./util.js";

const CLICK_TOLERANCE = 9; // px: groessere Bewegung = Kamera drehen, kein Klick (Touch-tauglich)

export class Builder {
  constructor(scene, model, { onChange } = {}) {
    this.scene = scene;
    this.model = model;
    this.onChange = onChange || (() => {});
    this.onNotice = () => {};        // kurze Hinweis-Meldung an die UI
    this.onHistoryChange = () => {}; // Undo-Verfuegbarkeit hat sich geaendert

    this.mode = "add";            // "add" | "panel" | "clamp" | "delete" | "reinforce" | "assembly"
    this.tubeId = geometry().defaultTube;
    this.panelId = defaultPanel();
    this.color = "blue";
    this.selectedNodeId = null;

    this.showLabels = false;     // Kupplungs-Namen im normalen Bauen anzeigen
    this.diagonal = false;       // schraege (45-Grad) Streben statt Achsen
    this.showHints = false;      // Verstaerkungs-Vorschlaege hervorheben
    this.buildPlan = { levels: [], steps: [] };
    this.assemblyStep = 0;

    this._undoStack = [];
    this._redoStack = [];
    this._maxUndo = 60;

    this._down = null;
    this._attach();
    this.refresh();
  }

  // --- Undo ---------------------------------------------------------------
  // Fuehrt eine Modell-Aenderung aus und merkt den Zustand davor (nur wenn sich
  // wirklich etwas geaendert hat).
  recordHistory(mutateFn) {
    const before = JSON.stringify(this.model.toJSON());
    const ret = mutateFn();
    const after = JSON.stringify(this.model.toJSON());
    if (after !== before) {
      this._undoStack.push(before);
      if (this._undoStack.length > this._maxUndo) this._undoStack.shift();
      this._redoStack = []; // neue Aenderung verwirft die Redo-Historie
      this.onHistoryChange();
    }
    return ret;
  }

  canUndo() { return this._undoStack.length > 0; }

  canRedo() { return this._redoStack.length > 0; }

  clearHistory() {
    this._undoStack = [];
    this._redoStack = [];
    this.onHistoryChange();
  }

  undo() {
    if (!this._undoStack.length) return;
    const prev = this._undoStack.pop();
    this._redoStack.push(JSON.stringify(this.model.toJSON()));
    if (this._redoStack.length > this._maxUndo) this._redoStack.shift();
    this.model.loadJSON(JSON.parse(prev));
    if (this.selectedNodeId && !this.model.nodes.has(this.selectedNodeId)) {
      this.selectedNodeId = null;
    }
    if (this.mode === "assembly") this.enterAssembly();
    this.onHistoryChange();
    this.refresh();
  }

  redo() {
    if (!this._redoStack.length) return;
    const next = this._redoStack.pop();
    this._undoStack.push(JSON.stringify(this.model.toJSON()));
    if (this._undoStack.length > this._maxUndo) this._undoStack.shift();
    this.model.loadJSON(JSON.parse(next));
    if (this.selectedNodeId && !this.model.nodes.has(this.selectedNodeId)) {
      this.selectedNodeId = null;
    }
    if (this.mode === "assembly") this.enterAssembly();
    this.onHistoryChange();
    this.refresh();
  }

  // --- oeffentliche Steuerung --------------------------------------------
  setMode(mode) {
    this.mode = mode;
    if (mode === "delete") this.selectedNodeId = null;
    // Labels beim Moduswechsel grundsaetzlich ausschalten;
    // der Aufbaumodus schaltet sie in enterAssembly() selbst wieder ein.
    this.showLabels = false;
    if (mode === "assembly") this.enterAssembly(); // Aufbau zeigt wieder eigene Labels
    this.refresh();
  }
  setTube(tubeId) { this.tubeId = tubeId; }
  setPanel(panelId) { this.panelId = panelId; if (this.mode === "panel") this.refresh(); }
  setColor(colorId) { this.color = colorId; }
  setShowLabels(on) { this.showLabels = !!on; this.refresh(); }
  setDiagonal(on) { this.diagonal = !!on; if (this.mode === "add") this.refresh(); }
  setShowHints(on) { this.showHints = !!on; this.refresh(); }

  // Anzahl der Rohre, die ein Verstaerkungsprofil gebrauchen koennten.
  suggestionCount() { return this.model.reinforcementSuggestions().size; }

  // --- Aufbaumodus -------------------------------------------------------
  // Aufbauplan (neu) berechnen und beim aktuellen Schritt bleiben (geklemmt).
  enterAssembly() {
    this.buildPlan = computeBuildPlan(this.model);
    const max = Math.max(0, this.buildPlan.steps.length - 1);
    this.assemblyStep = Math.min(this.assemblyStep, max);
    this.showLabels = true; // im Aufbaumodus sind die Ebenen-Namen standardmaessig an
  }

  assemblyCount() { return this.buildPlan.steps.length; }
  currentStep() { return this.buildPlan.steps[this.assemblyStep] || null; }

  setAssemblyStep(i) {
    const max = this.buildPlan.steps.length - 1;
    this.assemblyStep = Math.max(0, Math.min(i, max));
    this.refresh();
  }

  // Sichtbarkeit fuer den Aufbaumodus: bereits gebaute vs. aktueller Schritt.
  _assemblyVisibility() {
    const done = new Set();
    const current = new Set();
    const steps = this.buildPlan.steps;
    for (let k = 0; k <= this.assemblyStep && k < steps.length; k++) {
      const s = steps[k];
      const target = k === this.assemblyStep ? current : done;
      for (const id of s.nodeIds) target.add(id);
      for (const id of s.tubeIds) target.add(id);
      for (const id of s.panelIds) target.add(id);
      for (const id of s.textileIds || []) target.add(id);
      for (const id of s.slideIds || []) target.add(id);
    }
    return { done, current };
  }

  // Ein Bau-Schritt per Tastatur: vom ausgewaehlten Knoten in Richtung dirVec.
  buildStep(dirVec) {
    if (this.model.isEmpty()) {
      this.recordHistory(() => {
        const cs = geometry().connectorSize;
        this.selectedNodeId = this.model.addNode(0, cs / 2, 0).id;
      });
      this.refresh();
      return;
    }
    const node = this.selectedNodeId && this.model.nodes.get(this.selectedNodeId);
    if (!node) return;
    const tube = getTube(this.tubeId);
    let res;
    this.recordHistory(() => {
      res = isCurvedTube(this.tubeId)
        ? this.model.extendBow(node.id, dirVec, this._bowNormal(dirVec), this.tubeId, this.color, gridSpacing())
        : this.model.extend(
            node.id, dirVec, this.tubeId, this.color, tube.length_cm, spacingFor(tube.length_cm)
          );
    });
    if (res && res.collision) this.onNotice(t("notice_collision"));
    else if (res && res.node) this.selectedNodeId = res.node.id;
    this.refresh();
  }

  // Krummungsrichtung (zum Kreismittelpunkt) eines neu gesetzten Bogenrohrs:
  // waagerecht angesetzt krummt der Bogen nach UNTEN (der ueblichste Fall --
  // Geruestkante, Dachbogen), senkrecht angesetzt in die Blickrichtung, damit
  // der Bogen vom Betrachter weg schwingt statt zufaellig zur Seite.
  _bowNormal(dirVec) {
    if (Math.abs(dirVec[1]) < 0.5) return [0, -1, 0];
    const ax = this.scene.getHorizontalAxes ? this.scene.getHorizontalAxes() : null;
    const f = (ax && (ax.forward || ax.f)) || [0, 0, -1];
    return Math.abs(f[0]) >= Math.abs(f[2])
      ? [Math.sign(f[0]) || 1, 0, 0]
      : [0, 0, Math.sign(f[2]) || -1];
  }

  // Kardinaler Huelsen-Arm fuer eine 45-Grad-Diagonale. Gueltig (45°-Innenwinkel
  // zur Diagonale) sind die NEGIERTEN Komponenten von d: Diagonale rechts-unten
  // (+X-Y) -> linker Arm (-X) ODER oberer Arm (+Y). Bevorzugt die Waagerechte
  // (Gregors Regel), nimmt aber nur einen FREIEN Arm -- sonst kollidiert die
  // Huelse mit einem vorhandenen Rohr. Liefert null, wenn kein gueltiger Arm
  // frei ist (dann darf hier keine Winkelkupplung gesetzt werden).
  _diagSleeveAxis(node, d) {
    const cands = [];
    if (Math.abs(d[0]) > 0.3) cands.push([-Math.sign(d[0]), 0, 0]); // negierte Waagerechte X
    if (Math.abs(d[2]) > 0.3) cands.push([0, 0, -Math.sign(d[2])]); // negierte Waagerechte Z
    if (Math.abs(d[1]) > 0.3) cands.push([0, -Math.sign(d[1]), 0]); // negierte Senkrechte Y
    for (const c of cands) if (!this._armOccupied(node, c)) return c;
    return null;
  }

  // Steckt am Knoten schon etwas in Arm-Richtung `axis`? Zaehlt echte Rohre UND
  // bereits gesteckte C45-Adapter (deren Arm-Kante zeigt ~kardinal in Huelsen-
  // richtung); nur reine Doppelrohr-Links zaehlen nicht. Dann ist dort kein Platz
  // fuer eine weitere Winkelkupplung/Huelse.
  _armOccupied(node, axis) {
    for (const t of this.model.tubes.values()) {
      if (t.link) continue;
      let nb = null;
      if (t.a === node.id) nb = this.model.nodes.get(t.b);
      else if (t.b === node.id) nb = this.model.nodes.get(t.a);
      if (!nb) continue;
      // Bereits gesteckter C45-Adapter: seine Huelse sitzt auf nb.c45axis-Arm
      // (die Arm-Kante selbst zeigt nicht sauber kardinal).
      if (t.arm) {
        const a = nb.c45body && nb.c45axis;
        if (a && a[0] * axis[0] + a[1] * axis[1] + a[2] * axis[2] > 0.9) return true;
        continue;
      }
      // Echtes Rohr: Richtung pruefen.
      const dx = nb.x - node.x, dy = nb.y - node.y, dz = nb.z - node.z;
      const L = Math.hypot(dx, dy, dz) || 1;
      if ((dx / L) * axis[0] + (dy / L) * axis[1] + (dz / L) * axis[2] > 0.9) return true;
    }
    return false;
  }

  // Schraege Strebe (45 Grad) vom ausgewaehlten Knoten in eine Diagonalrichtung.
  // Projektvorgabe: alle Schraegen sind immer 45 Grad ueber eine C45-Winkel-
  // kupplung (Adapter belegt Platz, eigene Kupplung). Nutzt das Diagonalrohr (T35).
  buildDiagonal(dirVec) {
    const node = this.selectedNodeId && this.model.nodes.get(this.selectedNodeId);
    if (!node) return;
    const dt = getTube(diagonalTubeId());
    if (!dt) return;
    const axis = this._diagSleeveAxis(node, dirVec);
    if (!axis) { this.onNotice(t("notice_no_free_arm")); return; }
    const cs = geometry().connectorSize;
    let res;
    this.recordHistory(() => {
      res = this.model.extendC45Diagonal(
        node.id, dirVec, axis, dt.id, this.color,
        dt.length_cm, spacingFor(dt.length_cm), cs, cs * 0.75
      );
    });
    if (res && res.collision) this.onNotice(t("notice_collision"));
    else if (res && res.node) this.selectedNodeId = res.node.id;
    this.refresh();
  }

  selectNode(id) {
    this.selectedNodeId = id;
    this.refresh();
  }

  refresh() {
    const assembly = this.mode === "assembly" && this.buildPlan.steps.length
      ? this._assemblyVisibility() : null;
    const labelFor = this.showLabels ? (node) => connectorLabelInfo(this.model, node) : null;
    const slideNameFor = this.showLabels ? (sl) => slideKindLabel(sl.kind) : null;
    const suggest = (this.showHints || this.mode === "reinforce")
      ? this.model.reinforcementSuggestions() : null;
    const reinforce = this.mode === "reinforce";
    this.scene.renderModel(this.model, this.selectedNodeId, { labelFor, slideNameFor, assembly, suggest, reinforce });
    this._buildHandles();
    this.onChange();
  }

  // --- Handles ------------------------------------------------------------
  _buildHandles() {
    this.scene.clearHandles();
    if (this.mode === "panel") { this._buildPanelHandles(); return; }
    if (this.mode === "clamp") { this._buildClampHandles(); return; }
    if (this.mode !== "add") return;

    const cs = geometry().connectorSize;
    const gap = cs / 2 + 4;

    if (this.model.isEmpty()) {
      this.scene.addHandle([0, cs / 2, 0], { origin: true }, "origin");
      return;
    }
    const node = this.selectedNodeId ? this.model.nodes.get(this.selectedNodeId) : null;
    if (!node) return;

    // An einem c45body-Knoten (Adapter-Koerper) kann keine weitere C45-Kupplung
    // angebaut werden – von dort gehen nur normale Rohre ab (kardinale Richtungen).
    const forcedCardinal = !!node.c45body;
    // Rotierte Kupplung (armDirs aus QDF-Import): eigene Arm-Richtungen verwenden,
    // kein C45-Adapter noetig – die Kupplung ist bereits korrekt ausgerichtet.
    const hasArmDirs = !forcedCardinal && node.armDirs && node.armDirs.length > 0;
    // Schräg-Konnektor: liegt auf einer Schräge (hat schon ein Diagonalrohr) =
    // ist bereits 45-Grad gedreht. Bietet automatisch Diagonal-Richtungen an und
    // baut OHNE neuen C45-Adapter weiter (snappt an vorhandene Schräg-Kupplungen).
    const isSlope = !forcedCardinal && !hasArmDirs && this._hasDiagonalTube(node);
    const occupied = this._occupiedDirs(node);
    const useDiag = !forcedCardinal && !hasArmDirs && (this.diagonal || isSlope);
    const isC45 = useDiag && !isSlope; // C45-Adapter nur an einer NICHT-schraegen Kupplung
    // Schräg-Konnektor: nur seine eigene gedrehte 90°-Arm-Basis (Schräge + Quer
    // in der Ebene + die zwei Kardinalen senkrecht dazu), NICHT beliebige Diagonalen.
    const dirs = hasArmDirs ? node.armDirs
      : isSlope ? (this._slopeArmDirs(node) || DIAGONAL_DIRECTIONS)
      : (this.diagonal ? DIAGONAL_DIRECTIONS : DIRECTIONS);
    for (const d of dirs) {
      if (occupied.has(d.name)) continue;
      // C45-Schräge nur anbieten, wenn ein freier Arm fuer die Winkelkupplung da ist.
      if (isC45 && !this._diagSleeveAxis(node, d.vec)) continue;
      const isCardDir = Math.max(Math.abs(d.vec[0]), Math.abs(d.vec[1]), Math.abs(d.vec[2])) > DIR_ALIGN_TOL;
      const hg = (useDiag && !isCardDir) ? gap * 1.6 : gap;
      const pos = [
        node.x + d.vec[0] * hg,
        node.y + d.vec[1] * hg,
        node.z + d.vec[2] * hg,
      ];
      this.scene.addHandle(
        pos, { nodeId: node.id, dir: d.vec, dirName: d.name, diagonal: isC45, slope: isSlope },
        (useDiag && !isCardDir) ? "diag" : "dir"
      );
    }
  }

  // Rotierte 90°-Arm-Basis eines Schräg-Konnektors: die Schräge liegt in EINER
  // Achsenebene (Drehung um die dritte Achse). Moegliche Arme = die 4 in-Ebene-
  // Diagonalen (Schräge + Quer dazu) PLUS die 2 Kardinalen entlang der Drehachse
  // -- alle 90° zueinander. (Aus DIRECTIONS/DIAGONAL_DIRECTIONS gefiltert, damit
  // die Namen zur Belegungspruefung passen.)
  _slopeArmDirs(node) {
    let d = null;
    for (const t of this.model.tubes.values()) {
      if (t.arm || t.link) continue;
      const o = t.a === node.id ? this.model.nodes.get(t.b)
        : t.b === node.id ? this.model.nodes.get(t.a) : null;
      if (!o) continue;
      const v = [o.x - node.x, o.y - node.y, o.z - node.z], L = Math.hypot(...v) || 1, u = v.map((c) => c / L);
      if (Math.max(...u.map(Math.abs)) < DIR_ALIGN_TOL) { d = u; break; }
    }
    if (!d) return null;
    const act = [0, 1, 2].filter((a) => Math.abs(d[a]) > 0.3);
    if (act.length !== 2) return null;
    const k = [0, 1, 2].find((a) => !act.includes(a)); // Drehachse
    const out = [];
    for (const dd of DIAGONAL_DIRECTIONS) {
      if (Math.abs(dd.vec[k]) < 0.01 && Math.abs(dd.vec[act[0]]) > 0.3 && Math.abs(dd.vec[act[1]]) > 0.3) out.push(dd);
    }
    for (const cd of DIRECTIONS) {
      if (Math.abs(cd.vec[k]) > DIR_ALIGN_TOL) out.push(cd);
    }
    return out.length ? out : null;
  }

  // Hat der Knoten schon ein nicht-kardinales (45-Grad) Rohr? Dann liegt er auf
  // einer Schräge und ist selbst eine 45-Grad-gedrehte Kupplung.
  _hasDiagonalTube(node) {
    for (const t of this.model.tubes.values()) {
      if (t.arm || t.link) continue;
      const o = t.a === node.id ? this.model.nodes.get(t.b)
        : t.b === node.id ? this.model.nodes.get(t.a) : null;
      if (!o) continue;
      const dx = o.x - node.x, dy = o.y - node.y, dz = o.z - node.z, L = Math.hypot(dx, dy, dz) || 1;
      if (Math.max(Math.abs(dx / L), Math.abs(dy / L), Math.abs(dz / L)) < DIR_ALIGN_TOL) return true;
    }
    return false;
  }

  _occupiedDirs(node) {
    const occ = new Set();
    // Rotierte Kupplung (armDirs aus QDF-Import): Belegung gegen gespeicherte
    // Arm-Richtungen pruefen (nicht gegen DIRECTIONS/DIAGONAL_DIRECTIONS).
    if (node.armDirs && !node.c45body) {
      for (const nb of this.model.neighbors(node.id)) {
        if (!nb) continue;
        const dx = nb.x - node.x, dy = nb.y - node.y, dz = nb.z - node.z;
        const len = Math.hypot(dx, dy, dz) || 1;
        for (const d of node.armDirs) {
          if ((dx * d.vec[0] + dy * d.vec[1] + dz * d.vec[2]) / len > ARM_ALIGN_TOL) {
            occ.add(d.name);
          }
        }
      }
      return occ;
    }
    // C45-Eckkupplung im Diagonal-Modus: eine schon gebaute Diagonale (ueber den
    // Adapter-Koerper) gilt als belegt.
    if (this.diagonal) {
      for (const arm of this.model.tubes.values()) {
        if (!arm.arm) continue;
        const bId = arm.a === node.id ? arm.b : arm.b === node.id ? arm.a : null;
        const B = bId && this.model.nodes.get(bId);
        if (!B || !B.c45body) continue;
        for (const t of this.model.tubes.values()) {
          if (t.arm) continue;
          const fId = t.a === bId ? t.b : t.b === bId ? t.a : null;
          if (!fId) continue;
          const F = this.model.nodes.get(fId);
          const dx = F.x - B.x, dy = F.y - B.y, dz = F.z - B.z;
          const len = Math.hypot(dx, dy, dz) || 1;
          for (const d of DIAGONAL_DIRECTIONS) {
            if ((dx * d.vec[0] + dy * d.vec[1] + dz * d.vec[2]) / len > DIR_ALIGN_TOL) occ.add(d.name);
          }
        }
      }
    }
    // Direkte Rohre belegen ihre Richtung -- kardinal UND diagonal (Schräg-
    // Konnektor). Arm-/Link-Kanten zaehlen nicht.
    for (const t of this.model.tubes.values()) {
      if (t.arm || t.link) continue;
      const nb = t.a === node.id ? this.model.nodes.get(t.b)
        : t.b === node.id ? this.model.nodes.get(t.a) : null;
      if (!nb) continue;
      const dx = nb.x - node.x, dy = nb.y - node.y, dz = nb.z - node.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      const ux = dx / len, uy = dy / len, uz = dz / len;
      for (const d of DIRECTIONS) if (ux * d.vec[0] + uy * d.vec[1] + uz * d.vec[2] > DIR_ALIGN_TOL) occ.add(d.name);
      for (const d of DIAGONAL_DIRECTIONS) if (ux * d.vec[0] + uy * d.vec[1] + uz * d.vec[2] > DIR_ALIGN_TOL) occ.add(d.name);
    }
    return occ;
  }

  // Kandidaten-Felder fuer die aktuell gewaehlte Plattengroesse anzeigen.
  _buildPanelHandles() {
    const def = getPanel(this.panelId);
    if (!def) return;
    const tol = 1.5;
    const eq = (a, b) => Math.abs(a - b) <= tol;
    const fits = (d) =>
      (eq(d[0], def.w) && eq(d[1], def.h)) || (eq(d[0], def.h) && eq(d[1], def.w));
    for (const rect of this.model.findRectangles()) {
      if (!fits(rect.dims)) continue;
      if (this.model.panelOnCell(rect.nodes)) continue;
      const corners = rect.nodes.map((id) => {
        const n = this.model.nodes.get(id);
        return [n.x, n.y, n.z];
      });
      this.scene.addPanelHandle(corners, { rectNodes: rect.nodes });
    }
  }

  // --- Doppelrohrverbinder ------------------------------------------------
  // Grüner Punkt in der leeren Öffnung jeder "8": dort kann eine zweite,
  // parallele Tube gesetzt werden.
  _buildClampHandles() {
    for (const c of this.model.clamps.values()) {
      if (!c.dir || !c.off) continue;
      const center = [c.x + c.off[0] / 2, c.y + c.off[1] / 2, c.z + c.off[2] / 2];
      if (this._openingOccupied(center, c.dir)) continue;
      this.scene.addHandle(center, { clampOpening: true, center, dir: c.dir }, "dir");
    }
  }

  // Laeuft schon eine (parallele) Tube durch die Oeffnung?
  _openingOccupied(center, dir) {
    const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const u = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
    for (const t of this.model.tubes.values()) {
      if (t.arm || t.link) continue;
      const a = this.model.nodes.get(t.a), b = this.model.nodes.get(t.b);
      if (!a || !b) continue;
      const ab = [b.x - a.x, b.y - a.y, b.z - a.z];
      const L = Math.hypot(...ab) || 1;
      if (Math.abs((ab[0] * u[0] + ab[1] * u[1] + ab[2] * u[2]) / L) < 0.9) continue; // nicht parallel
      let s = ((center[0] - a.x) * ab[0] + (center[1] - a.y) * ab[1] + (center[2] - a.z) * ab[2]) / (L * L);
      s = Math.max(0, Math.min(1, s));
      const cp = [a.x + ab[0] * s, a.y + ab[1] * s, a.z + ab[2] * s];
      if (Math.hypot(center[0] - cp[0], center[1] - cp[1], center[2] - cp[2]) < 3) return true;
    }
    return false;
  }

  // Kardinale Richtung senkrecht zu u, die am besten zu p (Klickseite) passt.
  _cardinalPerp(p, u) {
    const cards = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    let best = cards[0], bd = -Infinity;
    for (const c of cards) {
      if (Math.abs(c[0] * u[0] + c[1] * u[1] + c[2] * u[2]) > 0.3) continue;
      const dot = c[0] * p[0] + c[1] * p[1] + c[2] * p[2];
      if (dot > bd) { bd = dot; best = c; }
    }
    return best;
  }

  // Doppelrohrverbinder auf ein Rohr setzen: Achse (Rohr) + Versatz (zur leeren
  // Oeffnung, Richtung Klickseite, auf Kardinale gerundet) merken -> "8".
  _placeClampOnTube(tubeId, hit) {
    const t = this.model.tubes.get(tubeId);
    if (!t) return;
    const a = this.model.nodes.get(t.a), b = this.model.nodes.get(t.b);
    if (!a || !b) return;
    const cs = geometry().connectorSize;
    const ab = [b.x - a.x, b.y - a.y, b.z - a.z];
    const dl = Math.hypot(...ab) || 1;
    const u = [ab[0] / dl, ab[1] / dl, ab[2] / dl];
    let s = (hit.x - a.x) * u[0] + (hit.y - a.y) * u[1] + (hit.z - a.z) * u[2];
    s = Math.max(0, Math.min(dl, s));
    const ax = [a.x + u[0] * s, a.y + u[1] * s, a.z + u[2] * s];
    let p = [hit.x - ax[0], hit.y - ax[1], hit.z - ax[2]];
    const pa = p[0] * u[0] + p[1] * u[1] + p[2] * u[2];
    p = [p[0] - u[0] * pa, p[1] - u[1] * pa, p[2] - u[2] * pa];
    const pl = Math.hypot(...p) || 1; p = [p[0] / pl, p[1] / pl, p[2] / pl];
    const card = this._cardinalPerp(p, u);
    const off = [card[0] * cs, card[1] * cs, card[2] * cs];
    const pos = [ax[0] + off[0] / 2, ax[1] + off[1] / 2, ax[2] + off[2] / 2];
    this.recordHistory(() => {
      const clamp = this.model.addClamp(round2(pos[0]), round2(pos[1]), round2(pos[2]));
      clamp.dir = u.map(round2); clamp.off = off.map(round2);
    });
    this.onNotice(t("notice_clamp_placed"));
    this.refresh();
  }

  // Zweite, parallele Tube in die leere Oeffnung setzen (mittig an der Klemme).
  _placeSecondTube(center, dir) {
    const tube = getTube(this.tubeId);
    if (!tube) return;
    const span = spacingFor(tube.length_cm);
    const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const u = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
    const h = span / 2;
    const p1 = [center[0] - u[0] * h, center[1] - u[1] * h, center[2] - u[2] * h];
    const p2 = [center[0] + u[0] * h, center[1] + u[1] * h, center[2] + u[2] * h];
    this.recordHistory(() => {
      const n1 = this.model.addNode(round2(p1[0]), round2(p1[1]), round2(p1[2]));
      const n2 = this.model.addNode(round2(p2[0]), round2(p2[1]), round2(p2[2]));
      this.model.addTube(n1.id, n2.id, tube.id, this.color, tube.length_cm);
      // Jedes Ende an seinen ausgerichteten Nachbar-Knoten (~Versatz) anbinden,
      // damit die Klemme beide Rohre als Paar zusammenhaelt.
      for (const nn of [n1, n2]) {
        let near = null, nd = Infinity;
        for (const m of this.model.nodes.values()) {
          if (m.id === n1.id || m.id === n2.id) continue;
          const d = Math.hypot(m.x - nn.x, m.y - nn.y, m.z - nn.z);
          if (d < nd) { nd = d; near = m; }
        }
        if (near && nd < CLAMP_LINK_DIST) this.model.addLink(near.id, nn.id);
      }
    });
    this.onNotice(t("notice_second_tube_placed"));
    this.refresh();
  }

  // --- Events -------------------------------------------------------------
  _attach() {
    const el = this.scene.renderer.domElement;
    el.addEventListener("pointerdown", (e) => {
      this._down = { x: e.clientX, y: e.clientY };
    });
    el.addEventListener("pointermove", (e) => this._onMove(e));
    el.addEventListener("pointerup", (e) => this._onUp(e));
  }

  _onMove(e) {
    let obj = null;
    if (this.mode === "add" || this.mode === "panel" || this.mode === "clamp") {
      const h = this.scene.pickHandle(e.clientX, e.clientY);
      obj = h ? h.object : (this.scene.pickBuild(e.clientX, e.clientY)?.object || null);
    } else {
      obj = this.scene.pickBuild(e.clientX, e.clientY)?.object || null;
    }
    this.scene.setHover(obj);
  }

  _onUp(e) {
    const d = this._down;
    this._down = null;
    if (!d) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_TOLERANCE) return; // Drehen
    if (this.mode === "add") this._clickAdd(e);
    else if (this.mode === "panel") this._clickPanel(e);
    else if (this.mode === "clamp") this._clickClamp(e);
    else if (this.mode === "delete") this._clickDelete(e);
    else if (this.mode === "reinforce") this._clickReinforce(e);
    // Aufbaumodus: nur ansehen/drehen, keine Modelländerung
  }

  // Klick auf ein Rohr schaltet die Alu-Verstaerkung an/aus.
  _clickReinforce(e) {
    const pick = this.scene.pickBuild(e.clientX, e.clientY);
    if (!pick || pick.data.kind !== "tube") return;
    let on;
    this.recordHistory(() => { on = this.model.toggleReinforced(pick.data.id); });
    this.onNotice(t(on ? "notice_reinforce_added" : "notice_reinforce_removed"));
    this.refresh();
  }

  // Klick auf ein Rohr setzt einen Doppelrohrverbinder (Klemme) an den Treffpunkt.
  // Klick auf eine bestehende Klemme entfernt sie wieder.
  _clickClamp(e) {
    // Grüner Punkt in der leeren Öffnung? -> zweite parallele Tube setzen.
    const h = this.scene.pickHandle(e.clientX, e.clientY);
    if (h && h.data.clampOpening) { this._placeSecondTube(h.data.center, h.data.dir); return; }
    const pick = this.scene.pickBuild(e.clientX, e.clientY);
    if (!pick) return;
    if (pick.data.kind === "clamp") {
      this.recordHistory(() => this.model.removeClamp(pick.data.id));
      this.onNotice(t("notice_clamp_removed"));
      this.refresh();
      return;
    }
    if (pick.data.kind !== "tube" || !pick.point) {
      this.onNotice(t("notice_clamp_click_tube"));
      return;
    }
    this._placeClampOnTube(pick.data.id, pick.point);
  }

  _clickPanel(e) {
    // Bestehende Platte/Netz anklicken → Farbe ändern (wie bei Rohren).
    const pick = this.scene.pickBuild(e.clientX, e.clientY);
    if (pick && (pick.data.kind === "panel" || pick.data.kind === "textile")) {
      let changed;
      this.recordHistory(() => { changed = this.model.setColorOf(pick.data.kind, pick.data.id, this.color); });
      if (changed) { this.onNotice(t("notice_color_changed")); this.refresh(); }
      return;
    }
    // Neues Platten-Handle → Platte hinzufügen.
    const h = this.scene.pickHandle(e.clientX, e.clientY);
    if (h && h.data.panelCell) {
      this.recordHistory(() => this.model.addPanel(h.data.rectNodes, this.panelId, this.color));
      this.refresh();
    }
  }

  _clickAdd(e) {
    // 1. Handle?
    const h = this.scene.pickHandle(e.clientX, e.clientY);
    if (h) {
      if (h.data.origin) {
        this.recordHistory(() => {
          const cs = geometry().connectorSize;
          this.selectedNodeId = this.model.addNode(0, cs / 2, 0).id;
        });
        this.refresh();
        return;
      }
      let res;
      if (h.data.diagonal) {
        const dt = getTube(diagonalTubeId());
        const cs = geometry().connectorSize;
        const node = this.model.nodes.get(h.data.nodeId);
        const axis = node && this._diagSleeveAxis(node, h.data.dir);
        if (!axis) { this.onNotice(t("notice_no_free_arm")); return; }
        this.recordHistory(() => {
          res = this.model.extendC45Diagonal(
            h.data.nodeId, h.data.dir, axis, dt.id,
            this.color, dt.length_cm, spacingFor(dt.length_cm), cs, cs * 0.75
          );
        });
      } else if (h.data.slope) {
        // Schräg-Konnektor (schon 45-Grad gedreht): Diagonalrohr weiterbauen,
        // OHNE neuen C45-Adapter; snappt an vorhandene Schräg-Kupplungen.
        const dt = getTube(diagonalTubeId());
        this.recordHistory(() => {
          res = this.model.extendDiagonalSnap(
            h.data.nodeId, h.data.dir, dt.id, this.color, dt.length_cm, spacingFor(dt.length_cm)
          );
        });
      } else {
        // Normales Rohr in Achsrichtung -- entweder kardinal/diagonal, oder
        // (bei rotierten Kupplungen aus QDF-Import) entlang einer Arm-Richtung;
        // model.extend() braucht das nicht zu unterscheiden.
        const tube = getTube(this.tubeId);
        this.recordHistory(() => {
          res = isCurvedTube(this.tubeId)
            ? this.model.extendBow(h.data.nodeId, h.data.dir, this._bowNormal(h.data.dir), tube.id, this.color, gridSpacing())
            : this.model.extend(
                h.data.nodeId, h.data.dir, tube.id, this.color, tube.length_cm, spacingFor(tube.length_cm)
              );
        });
      }
      if (res && res.collision) this.onNotice(t("notice_collision"));
      else if (res && res.node) this.selectedNodeId = res.node.id;
      this.refresh();
      return;
    }
    // 2. bestehende Kupplung auswaehlen ODER Teil umfaerben
    const pick = this.scene.pickBuild(e.clientX, e.clientY);
    if (!pick) return;
    if (pick.data.kind === "node") {
      this.selectedNodeId = pick.data.id;
      this.refresh();
    } else if (pick.data.kind === "tube" || pick.data.kind === "panel" || pick.data.kind === "textile") {
      // Mit gewaehlter Farbe auf ein Rohr/eine Platte/ein Netz klicken faerbt es um.
      let changed;
      this.recordHistory(() => { changed = this.model.setColorOf(pick.data.kind, pick.data.id, this.color); });
      if (changed) {
        this.onNotice(t("notice_color_changed"));
        this.refresh();
      }
    }
  }

  _clickDelete(e) {
    const pick = this.scene.pickForDelete(e.clientX, e.clientY);
    if (!pick) return;
    this.recordHistory(() => {
      if (pick.data.kind === "tube") {
        this.model.removeTube(pick.data.id);
      } else if (pick.data.kind === "panel") {
        this.model.removePanel(pick.data.id);
      } else if (pick.data.kind === "textile") {
        this.model.removeTextile(pick.data.id);
      } else if (pick.data.kind === "slide") {
        this.model.removeSlide(pick.data.id);
      } else if (pick.data.kind === "clamp") {
        this.model.removeClamp(pick.data.id);
      } else if (pick.data.kind === "node") {
        if (this.selectedNodeId === pick.data.id) this.selectedNodeId = null;
        this.model.removeNode(pick.data.id);
      }
    });
    this.refresh();
  }
}
