// Stueckliste (BOM) + Kupplungstyp-Heuristik + Bestands-/Machbarkeitscheck.

import { getTube, getConnector, getPanel, colorName, partName, reinforcementPart, reinforcementRunName, partForFitting } from "./catalog.js";
import { round2 } from "./util.js";

// Einheitsvektoren der Nachbarn eines Knotens. Doppelrohr-Verbindungen (link)
// sind KEIN Arm der Kupplung und zaehlen nicht in die Kupplungstyp-Heuristik
// (sonst werden offene Rohrenden faelschlich als 2-armige Kupplung gezaehlt).
// Der C45-Adapter-Arm (arm) bleibt dagegen drin -- er gehoert zur Klassifizierung
// des Adapter-Koerpers (c45body).
function neighborDirs(model, node) {
  const dirs = [];
  for (const t of model.tubes.values()) {
    if (t.link) continue;
    let nb = null;
    if (t.a === node.id) nb = model.nodes.get(t.b);
    else if (t.b === node.id) nb = model.nodes.get(t.a);
    if (!nb) continue;
    const dx = nb.x - node.x, dy = nb.y - node.y, dz = nb.z - node.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    dirs.push([dx / len, dy / len, dz / len]);
  }
  return dirs;
}

// Liegen alle Richtungen in einer Ebene (teilen sich eine Null-Achse)?
function isCoplanar(dirs) {
  for (let axis = 0; axis < 3; axis++) {
    if (dirs.every((d) => Math.abs(d[axis]) < 0.05)) return true;
  }
  return false;
}

// Ist die (normierte) Richtung eine ECHTE 45-Grad-Schraege, die eine
// Winkelkupplung (C45) braucht? Kennzeichen: zwei betragsgleiche Komponenten
// (je ~0,707) und die dritte ~0 (also exakt 45 Grad in einer Achsenebene).
// Flache Rampen (z. B. Doppelrohr-Rampe 19,47 Grad = Richtung 0,94/0,33/0) oder
// steile Sparren erfuellen das NICHT und werden daher nicht als C45 gezaehlt.
function isC45Dir(d) {
  const a = [Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2])].sort((x, y) => y - x);
  return a[1] > 0.5 && a[0] - a[1] < 0.2 && a[2] < 0.2;
}

// Geometrische Klassifikation rein achsenparalleler Arme nach Anzahl + Lage.
function connectorTypeForDirs(dirs) {
  const deg = dirs.length;
  if (deg === 0) return null;
  if (deg === 1) return "end";
  const planar = isCoplanar(dirs);
  if (deg === 2) {
    // gegenueberliegend => gerade; sonst Winkel
    const dot = dirs[0][0] * dirs[1][0] + dirs[0][1] * dirs[1][1] + dirs[0][2] * dirs[1][2];
    return dot < -0.95 ? "straight" : "elbow";
  }
  if (deg === 3) return planar ? "t" : "3way";
  if (deg === 4) return planar ? "cross" : "4way";
  if (deg === 5) return "5way";
  return "6way";
}

// Zeigt die (normierte) Richtung genau eine Achse entlang? Echte Kupplungen
// haben ihre Stutzen nur auf den sechs Wuerfelflaechen.
function isAxisDir(d) {
  const a = [Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2])].sort((x, y) => y - x);
  return a[0] > 0.95 && a[1] < 0.1;
}

// Laesst sich ein Knoten mit diesen Arm-Richtungen aus dem echten Sortiment
// bauen? Liefert null wenn ja, sonst einen Grund.
function armsFeasible(dirs) {
  if (dirs.length <= 1) return null;   // freies Rohrende braucht keine Kupplung
  const axis = [], other = [];
  for (const d of dirs) (isAxisDir(d) ? axis : other).push(d);
  // Schraegen laufen ueber die aufgesteckte 45-Grad-Winkelkupplung. Alles
  // andere Schiefe (Rampen, Sparren) gibt es als Kupplung nicht.
  for (const d of other) if (!isC45Dir(d)) return "shape";
  // Zwei Rohre in dieselbe Richtung passen nicht in einen Stutzen.
  for (let i = 0; i < axis.length; i++) {
    for (let j = i + 1; j < axis.length; j++) {
      const a = axis[i], b = axis[j];
      if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] > 0.95) return "duplicate";
    }
  }
  if (axis.length > 6) return "arms";   // mehr Stutzen als ein Wuerfel Flaechen hat
  const type = connectorTypeForDirs(axis);
  if (!type || type === "end") return null;
  const def = getConnector(type);
  return def && def.buildable ? null : "type";
}

/**
 * Alle Knoten, fuer die es keine real erhaeltliche Kupplung gibt.
 *
 * Wird beim Verschieben gebraucht: fusionieren zwei Kupplungen zu einer, die es
 * so nicht gibt (zu viele Arme, zwei Rohre in derselben Richtung, eine schiefe
 * Lage), darf das Verschieben nicht stattfinden. Ein Durchlauf ueber die Rohre
 * statt neighborDirs je Knoten -- die Pruefung laeuft bei jedem Zieh-Schritt.
 */
export function infeasibleConnectors(model) {
  const dirsAt = new Map();
  const push = (id, from, to, arm) => {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    let d = [dx / len, dy / len, dz / len];
    // Die Huelse einer 45-Grad-Winkelkupplung steckt auf einem KARDINALEN
    // Stutzen; ihr Adapterkoerper sitzt aber zusaetzlich um den 45-Grad-Arm
    // versetzt, sodass die Kante gemessen leicht schief laeuft (~17 Grad).
    // Ungerundet gaelte damit jede gebaute Schraege als nicht herstellbar.
    if (arm) {
      const m = [Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2])];
      const ax = m.indexOf(Math.max(m[0], m[1], m[2]));
      d = [0, 0, 0];
      d[ax] = Math.sign([dx, dy, dz][ax]) || 1;
    }
    if (!dirsAt.has(id)) dirsAt.set(id, []);
    dirsAt.get(id).push(d);
  };
  for (const t of model.tubes.values()) {
    if (t.link) continue;   // Doppelrohr-Verbindung ist kein Arm
    const a = model.nodes.get(t.a), b = model.nodes.get(t.b);
    if (!a || !b) continue;
    push(a.id, a, b, t.arm);
    push(b.id, b, a, t.arm);
  }
  const bad = new Set();
  for (const n of model.nodes.values()) {
    if (n.c45body) continue;            // Adapter-Koerper ist immer einarmig
    if (armsFeasible(dirsAt.get(n.id) || [])) bad.add(n.id);
  }
  return bad;
}

// Heuristik: aus Anzahl + Lage der Rohre den repraesentativen Kupplungstyp
// ableiten (fuer Beschriftung). Eine Winkelkupplung (45 Grad) ist nur dann
// kennzeichnend, wenn der Knoten als C45-Traeger markiert ist (node.c45, beim
// Import an einer echten connector45_2 gesetzt bzw. vom Editor beim Schraegbau).
// Sonst zaehlen schraege Arme als normale Arme der Basiskupplung (z. B. die
// Gegenenden von Schraegen oder flache Rampen = T-Stueck/Winkel). Der echte C45-
// Knoten ist die Basiskupplung selbst; das Schraegrohr dockt ~9 cm versetzt an,
// daher reicht das Flag und kein geometrischer 45-Grad-Arm am Knoten ist noetig.
export function inferConnectorType(model, node) {
  if (node.part) return node.part;
  const dirs = neighborDirs(model, node);
  if (dirs.length === 0) return null;
  if (node.c45) return "diagonal";
  return connectorTypeForDirs(dirs);
}

// Liefert ALLE an einem Knoten verbauten Kupplungen als Liste von Typen.
// Nur an einem C45-Knoten bilden die achsenparallelen Arme die Basiskupplung und
// es kommt mindestens eine aufgesteckte 45-Grad-Winkelkupplung hinzu (Schraege
// braucht also 2 Kupplungen: Basis + 45 Grad). An allen anderen Knoten zaehlen
// alle Arme zusammen als eine normale Kupplung. Ein reines, freies Rohrende
// ("end") liefert eine leere Liste.
export function connectorsForNode(model, node) {
  // Klemm-Kupplungen sind ein festes Katalogteil. Die Lochzapfenkupplung nimmt
  // das Rohr selbst auf -- sie zaehlt allein. Die Lagerkupplung traegt eine
  // ganze Kupplung, die zusaetzlich in die Liste gehoert.
  if (node.part === "hole_1") return [node.part];
  if (node.part) {
    const t = connectorTypeForDirs(neighborDirs(model, node));
    return t && t !== "end" ? [node.part, t] : [node.part];
  }
  const dirs = neighborDirs(model, node);
  if (dirs.length === 0) return [];
  // Adapter-Koerper (c45body): genau HIER sitzt die 45-Grad-Winkelkupplung --
  // sie steckt mit ihrer Huelse auf dem Rohrende der Basiskupplung und nimmt
  // mit dem 45-Grad-Arm die Schraege auf. Es gibt sie nur einarmig, also immer
  // genau eine je Adapter-Koerper. Die Arm-Richtungen (Huelse + Schraege) nach
  // Anzahl/Lage zu klassifizieren lieferte hier faelschlich eine
  // "Flaechenkupplung 2-armig (90 Grad)".
  if (node.c45body) return ["diagonal"];
  if (!node.c45) {
    const t = connectorTypeForDirs(dirs);
    return t && t !== "end" ? [t] : [];
  }
  const axis = [], diag = [];
  for (const d of dirs) (isC45Dir(d) ? diag : axis).push(d);
  const out = [];
  const baseType = connectorTypeForDirs(axis);
  if (baseType && baseType !== "end") out.push(baseType);
  // 45-Grad-Winkelkupplung sitzt auf einer Basiskupplung; fehlt eine
  // achsenparallele Basis, traegt eine gerade Kupplung die Diagonale.
  if (out.length === 0) out.push("straight");
  const dcount = Math.max(diag.length, 1);
  for (let i = 0; i < dcount; i++) out.push("diagonal");
  return out;
}

// Fasst verstaerkte Rohre zu "Laeufen" zusammen: Rohre, die kollinear (gleiche
// Achse) ueber einen gemeinsamen Knoten aneinanderstossen, bilden EIN
// durchgehendes, laengeres Verstaerkungsprofil. Ueber Ecken (Richtungswechsel)
// hinweg wird NICHT verbunden, da ein Profil gerade ist. Die 45-Grad-Kupplungen
// brauchen etwas Platz, daher wird ueber Knoten-IDs (Topologie) statt exakter
// Koordinaten verbunden und die Laenge aus der echten Knotendistanz summiert.
function reinforcementRuns(model) {
  const reinforced = [...model.tubes.values()].filter((t) => t.reinforced);
  if (!reinforced.length) return [];

  const dirOf = (t) => {
    const a = model.nodes.get(t.a), b = model.nodes.get(t.b);
    if (!a || !b) return null;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const L = Math.hypot(dx, dy, dz) || 1;
    return [dx / L, dy / L, dz / L];
  };
  const lenOf = (t) => {
    const a = model.nodes.get(t.a), b = model.nodes.get(t.b);
    if (!a || !b) return 0;
    return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  };

  // Union-Find ueber Rohr-IDs.
  const parent = new Map(reinforced.map((t) => [t.id, t.id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { parent.set(find(a), find(b)); };

  // Verstaerkte Rohre pro Knoten sammeln.
  const byNode = new Map();
  for (const t of reinforced) {
    for (const nid of [t.a, t.b]) {
      if (!byNode.has(nid)) byNode.set(nid, []);
      byNode.get(nid).push(t);
    }
  }
  // An jedem Knoten kollineare verstaerkte Rohre zu einem Lauf verbinden.
  for (const list of byNode.values()) {
    for (let i = 0; i < list.length; i++) {
      const d1 = dirOf(list[i]);
      if (!d1) continue;
      for (let j = i + 1; j < list.length; j++) {
        const d2 = dirOf(list[j]);
        if (!d2) continue;
        const dot = d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2];
        if (Math.abs(dot) > 0.999) union(list[i].id, list[j].id); // gerade Linie
      }
    }
  }

  const runs = new Map(); // Wurzel -> { segments, length }
  for (const t of reinforced) {
    const r = find(t.id);
    if (!runs.has(r)) runs.set(r, { segments: 0, length: 0 });
    const run = runs.get(r);
    run.segments++;
    run.length += lenOf(t);
  }
  return [...runs.values()];
}

export function computeBOM(model) {
  // --- Rohre nach Typ + Farbe ---
  const tubeMap = new Map();
  for (const t of model.tubes.values()) {
    if (t.arm || t.link) continue; // C45-Arm / Doppelrohr-Verbindung ist kein Rohr
    const key = t.tubeId + "|" + t.color;
    if (!tubeMap.has(key)) tubeMap.set(key, { tubeId: t.tubeId, color: t.color, count: 0 });
    tubeMap.get(key).count++;
  }
  const tubes = [...tubeMap.values()].map((r) => {
    const def = getTube(r.tubeId) || { name: r.tubeId, price: 0, length_cm: null };
    return {
      key: r.tubeId + "|" + r.color,
      tubeId: r.tubeId, color: r.color,
      name: partName(def), colorName: colorName(r.color),
      length: def.length_cm, count: r.count,
      price: def.price, subtotal: round2(def.price * r.count),
    };
  }).sort((a, b) => (a.length || 0) - (b.length || 0));

  // --- Kupplungen nach abgeleitetem Typ ---
  // Pro Knoten koennen mehrere Kupplungen anfallen: eine Basiskupplung plus eine
  // aufgesteckte 45-Grad-Winkelkupplung je Knoten mit schraegem Arm.
  const connMap = new Map();
  let openEnds = 0;
  for (const n of model.nodes.values()) {
    const types = connectorsForNode(model, n);
    if (types.length === 0) {
      if (model.degree(n.id) >= 1) openEnds++;
      continue;
    }
    for (const type of types) connMap.set(type, (connMap.get(type) || 0) + 1);
  }
  // Doppelrohrverbinder / Klemmen sind eigenstaendige Bauteile (nicht an Knoten).
  if (model.clamps) {
    for (const c of model.clamps.values()) {
      const type = c.connectorId || "double_tube";
      connMap.set(type, (connMap.get(type) || 0) + 1);
    }
  }
  const connectors = [...connMap.entries()].map(([type, count]) => {
    const def = getConnector(type) || { name: type, code: "", price: 0 };
    return {
      type, code: def.code, name: partName(def), count,
      price: def.price, subtotal: round2(def.price * count),
    };
  }).sort((a, b) => b.count - a.count);

  // --- Platten nach Typ + Farbe ---
  const panelMap = new Map();
  for (const p of model.panels.values()) {
    const key = p.panelId + "|" + p.color;
    if (!panelMap.has(key)) panelMap.set(key, { panelId: p.panelId, color: p.color, count: 0 });
    panelMap.get(key).count++;
  }
  const panels = [...panelMap.values()].map((r) => {
    const def = getPanel(r.panelId) || { name: r.panelId, price: 0 };
    return {
      key: r.panelId + "|" + r.color,
      panelId: r.panelId, color: r.color,
      name: partName(def), colorName: colorName(r.color), count: r.count,
      price: def.price, subtotal: round2(def.price * r.count),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const tubeCount = tubes.reduce((s, r) => s + r.count, 0);
  const connCount = connectors.reduce((s, r) => s + r.count, 0);
  const panelCount = panels.reduce((s, r) => s + r.count, 0);

  // --- Netze/Stoffe (textil2) nach Groesse + Farbe ---
  const textileMap = new Map();
  for (const tx of (model.textiles ? model.textiles.values() : [])) {
    const key = tx.w + "x" + tx.h + "|" + tx.color;
    if (!textileMap.has(key)) textileMap.set(key, { w: tx.w, h: tx.h, color: tx.color, count: 0 });
    textileMap.get(key).count++;
  }
  const textiles = [...textileMap.values()].map((r) => ({
    key: r.w + "x" + r.h + "|" + r.color, w: r.w, h: r.h,
    color: r.color, colorName: colorName(r.color), count: r.count,
  })).sort((a, b) => b.count - a.count);
  const textileCount = textiles.reduce((s, r) => s + r.count, 0);

  // --- Anbauteile (Raeder, Rollen, Gitter, Sonderkupplungen) --------------
  // Gezaehlt wird nach Katalogteil, nicht nach QDF-Art: ein- und dreiarmige
  // Lochzapfenkupplung sind dieselbe Elementart, aber zwei Teile.
  const fitMap = new Map();
  for (const f of (model.fittings ? model.fittings.values() : [])) {
    const def = partForFitting(f.kind, f.mask);
    const key = def ? def.id : f.kind;
    if (!fitMap.has(key)) fitMap.set(key, { def, kind: f.kind, count: 0 });
    fitMap.get(key).count++;
  }
  const fittings = [...fitMap.entries()].map(([key, r]) => ({
    key, id: key, kind: r.kind,
    name: r.def ? partName(r.def) : r.kind,
    code: (r.def && r.def.code) || "",
    count: r.count,
    price: (r.def && r.def.price) || 0,
    subtotal: round2(((r.def && r.def.price) || 0) * r.count),
  })).sort((a, b) => b.count - a.count);
  const fittingCount = fittings.reduce((s, r) => s + r.count, 0);

  // --- Rutschen/Daecher (slide*/roof2) nach Art (dekorativ, ohne Preis) ---
  const slideMap = new Map();
  for (const sl of (model.slides ? model.slides.values() : [])) {
    slideMap.set(sl.kind, (slideMap.get(sl.kind) || 0) + 1);
  }
  const slides = [...slideMap.entries()].map(([kind, count]) => ({ key: kind, kind, count }))
    .sort((a, b) => b.count - a.count);
  const slideCount = slides.reduce((s, r) => s + r.count, 0);

  // --- Verstaerkungen ---
  // Kollineare verstaerkte Rohre bilden einen "Lauf" (Union-Find). Jeder Lauf
  // wird als EINE Zeile mit seiner Gesamtlaenge angezeigt: 4 x 40 cm = 160 cm.
  // Gleich lange Laeufe werden zusammengefasst (z. B. zwei Laeufe a 160 cm -> 2x).
  // Fuer Bestellung / Bestandspruefung bleibt die physische Stueckzahl massgeblich
  // (r.pieces): ein 40-cm-Profil geht in jedes einzelne verstaerkte Rohr.
  const runs = reinforcementRuns(model);
  const reinforcements = [];
  const part = reinforcementPart();

  if (runs.length > 0 && part) {
    // Laeufe nach gerundeter Gesamtlaenge gruppieren.
    const lenGroups = new Map(); // len_cm -> { runCount, segCount }
    for (const run of runs) {
      const len = Math.round(run.length);
      if (!lenGroups.has(len)) lenGroups.set(len, { runCount: 0, segCount: 0 });
      const g = lenGroups.get(len);
      g.runCount++;
      g.segCount += run.segments;
    }
    // Laengste Laeufe zuerst.
    for (const [len, g] of [...lenGroups.entries()].sort((a, b) => b[0] - a[0])) {
      reinforcements.push({
        key:      part.id + "|" + len,
        id:       part.id,
        len,
        name:     reinforcementRunName(part, len), // z. B. "Verstaerkungsprofil 160 cm (Holz)"
        count:    g.runCount,    // Anzahl Laeufe dieser Laenge (BOM-Anzeige)
        pieces:   g.segCount,    // Physische 40-cm-Profile (Bestellung / Bestand)
        price:    round2(part.price * g.segCount / g.runCount), // Preis je Lauf
        subtotal: round2(part.price * g.segCount),              // Gesamtpreis Gruppe
      });
    }
  }

  // Gesamtzahl der Laeufe (konzeptuelle Einheiten, erscheint im Summen-Footer).
  const reinfCount = runs.length;

  const price = round2(
    tubes.reduce((s, r) => s + r.subtotal, 0) +
    connectors.reduce((s, r) => s + r.subtotal, 0) +
    panels.reduce((s, r) => s + r.subtotal, 0) +
    reinforcements.reduce((s, r) => s + r.subtotal, 0) +
    fittings.reduce((s, r) => s + r.subtotal, 0)
  );

  return {
    tubes, connectors, panels, reinforcements, openEnds, textiles, slides, fittings,
    totals: {
      tubes: tubeCount, connectors: connCount, panels: panelCount,
      reinforcements: reinfCount, textiles: textileCount, slides: slideCount,
      fittings: fittingCount, price,
    },
  };
}

// Bestand: benoetigte Mengen je Rohrlaenge (Farbe egal) und je Kupplungstyp.
export function neededParts(bom) {
  const tubes = new Map();   // tubeId -> count
  for (const r of bom.tubes) tubes.set(r.tubeId, (tubes.get(r.tubeId) || 0) + r.count);
  const connectors = new Map(); // type -> count
  for (const r of bom.connectors) connectors.set(r.type, r.count);
  const panels = new Map();  // panelId -> count
  for (const r of bom.panels || []) panels.set(r.panelId, (panels.get(r.panelId) || 0) + r.count);
  const fittings = new Map();   // Katalog-id -> Stueckzahl
  for (const r of bom.fittings || []) fittings.set(r.id, (fittings.get(r.id) || 0) + r.count);
  const reinforcements = new Map(); // id -> physische Stueckzahl (40-cm-Profile)
  for (const r of bom.reinforcements || [])
    reinforcements.set(r.id, (reinforcements.get(r.id) || 0) + (r.pieces ?? r.count));
  return { tubes, connectors, panels, reinforcements, fittings };
}

// Vergleicht Bedarf mit Bestand. inv = { tubes:{id:n}, connectors:{type:n}, panels:{id:n} }.
export function compareInventory(bom, inv) {
  const need = neededParts(bom);
  const rows = [];
  let feasible = true;

  for (const [tubeId, count] of need.tubes) {
    const def = getTube(tubeId) || { name: tubeId };
    const owned = (inv.tubes && inv.tubes[tubeId]) || 0;
    const ok = owned >= count;
    if (!ok) feasible = false;
    rows.push({ group: "tubes", key: tubeId, name: partName(def), need: count, owned, ok });
  }
  for (const [type, count] of need.connectors) {
    const def = getConnector(type) || { name: type };
    const owned = (inv.connectors && inv.connectors[type]) || 0;
    const ok = owned >= count;
    if (!ok) feasible = false;
    rows.push({ group: "connectors", key: type, name: partName(def), need: count, owned, ok });
  }
  for (const [panelId, count] of need.panels) {
    const def = getPanel(panelId) || { name: panelId };
    const owned = (inv.panels && inv.panels[panelId]) || 0;
    const ok = owned >= count;
    if (!ok) feasible = false;
    rows.push({ group: "panels", key: panelId, name: partName(def), need: count, owned, ok });
  }
  for (const [id, count] of need.reinforcements) {
    const def = reinforcementPart() || { name: id };
    const owned = (inv.reinforcements && inv.reinforcements[id]) || 0;
    const ok = owned >= count;
    if (!ok) feasible = false;
    rows.push({ group: "reinforcements", key: id, name: partName(def), need: count, owned, ok });
  }
  return { rows, feasible };
}
