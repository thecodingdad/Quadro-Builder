// Export ins QDF-Format der originalen QUADRO-3D-Software.
//
// Gegenstueck zu qdfimport.js -- dort steht die Beschreibung des Formats. Kurz:
// Textdatei, eine Anweisung je Zeile, Koordinaten in Zehntel-Millimetern... genauer:
// in mm (Raster 400 mm = 40 cm), y = oben, Zeilenende CRLF.
//
// Zwei Eigenheiten des Formats, die man beim Schreiben kennen muss:
//   1. Die Quaternion-Komponenten stehen vorzeichenbehaftet QUADRIERT in der
//      Datei (sign*v^2). Beim Lesen wird sign*sqrt(|v|) zurueckgerechnet und
//      normiert -- geschrieben wird also das Quadrat der Einheitsquaternion.
//   2. Rohre und Platten speichern das TEILEMASS, nicht die Rasterspannweite:
//      ein 40-cm-Feld steht als 350 (= 35 cm Rohr) in der Datei. Die Kupplung
//      steuert die fehlenden 5 cm bei (geometry.connectorSize).
//
// Bewusst ohne Three.js und DOM -- wie qdfimport.js in Node testbar.

import { geometry, getPanel } from "./catalog.js";

// Farbtabelle wie in den Dateien der Herstellersoftware: erst der Satz fuer
// Rohre und Kupplungen (kind 1), dann derselbe Satz fuer Platten (kind 2). Die
// Namen sind entscheidend -- der Import bildet ueber sie auf unsere Farb-IDs ab.
const MATERIALS = [
  'material3{1,"black", 1, 1.,1.,1., 0.,0.,1.,7.5, 0.,0.,0.,7.5, "", 0}',
  'material3{2,"red", 1, 1.,0.,0., 0.5,1.,1.,7.5, 0.3,0.,0.,7.5, "", 0}',
  'material3{3,"green", 1, 0.,0.5,0.1, 0.5,1.,1.,7.5, 0.3,0.,0.,7.5, "", 0}',
  'material3{4,"blue", 1, 0.,0.,1., 0.5,1.,1.,7.5, 0.3,0.,0.,7.5, "", 0}',
  'material3{5,"yellow", 1, 1.,1.,0., 0.5,1.,1.,7.5, 0.3,0.,0.,7.5, "", 0}',
  'material3{6,"red", 2, 1.,0.,0., 0.6,0.5,0.5,7.5, 0.6,0.5,0.5,7.5, "", 0}',
  'material3{7,"green", 2, 0.,0.4941,0.0941, 0.6,0.5,0.5,7.5, 0.6,0.5,0.5,7.5, "", 0}',
  'material3{8,"blue", 2, 0.,0.,1., 0.6,0.5,0.5,7.5, 0.6,0.5,0.5,7.5, "", 0}',
  'material3{9,"yellow", 2, 1.,1.,0., 0.6,0.5,0.5,7.5, 0.6,0.5,0.5,7.5, "", 0}',
  'material3{13,"Aluminium", 1, 0.8,0.8,0.8, 0.5,0.4,0.7,7.5, 0.3,0.,0.,7.5, "", 0}',
  'material3{14,"white", 2, 1.,1.,1., 0.6,0.5,0.5,7.5, 0.6,0.5,0.5,7.5, "", 0}',
];

// Farb-ID -> Material-Nummer. Rohre nehmen den ersten Satz, Platten den zweiten;
// schwarze Platten gibt es dort nicht, sie fallen auf das schwarze Material des
// ersten Satzes zurueck.
const TUBE_MAT = { black: 1, red: 2, green: 3, blue: 4, yellow: 5 };
const PANEL_MAT = { red: 6, green: 7, blue: 8, yellow: 9, black: 1, white: 14 };
const ALU_MAT = 13;
const CONNECTOR_MAT = 1;

// Sichtbarkeitsmaske der Kupplungsflaechen (0xFFF), wie in den Originaldateien.
const RENDER_MASK = 4095;

// Arm-Bits einer Kupplung (variant2): lokale Achsen des Wuerfels.
const ARM_BITS = [
  [0x01, [1, 0, 0]], [0x02, [-1, 0, 0]],
  [0x04, [0, 1, 0]], [0x08, [0, -1, 0]],
  [0x10, [0, 0, 1]], [0x20, [0, 0, -1]],
];

// Blickwinkel-Zeile aus einer Originaldatei. Die Software erwartet mindestens
// eine Kamera; unser Import ueberliest sie.
const CAMERA = "camera2{2080, 108, 1, 0, 0, 0, 0, 0, 40, 20, 55, 0, 165, 272, 5, 7, 303, 3000, 10, 10, 1.650485, 4.535909, 0, 1.100000, 1.000000}";

const EOL = "\r\n";

/** Zahl im Stil der Originaldateien: ganze Werte mit angehaengtem Punkt. */
function fmt(v) {
  const n = Math.abs(v) < 1e-9 ? 0 : v;
  if (Number.isInteger(n)) return `${n}.`;
  return String(Math.round(n * 1e6) / 1e6);
}

const mm = (cm) => fmt(Math.round(cm * 10 * 1e4) / 1e4);

/** Einheitsquaternion [w,x,y,z] -> die vier Dateiwerte (vorzeichenbehaftet quadriert). */
function encodeQuat(q) {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return q.map((c) => {
    const u = c / n;
    return fmt(Math.round(Math.sign(u) * u * u * 1e12) / 1e12);
  });
}

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

/** Kuerzeste Drehung, die die lokale +X-Achse auf dir legt. */
function quatFromX(dir) {
  const d = norm(dir);
  const c = dot([1, 0, 0], d);
  if (c > 0.999999) return [1, 0, 0, 0];
  if (c < -0.999999) return [0, 0, 1, 0];        // 180 Grad um Y
  const axis = cross([1, 0, 0], d);
  const s = Math.sqrt((1 + c) * 2);
  return [s / 2, axis[0] / s, axis[1] / s, axis[2] / s];
}

/**
 * Drehung aus einem vollstaendigen Dreibein: lokale X-, Y- und Z-Achse gehen auf
 * ex, ey, ez. Gebraucht fuer Boegen (Tangente + Normale) und Platten (die beiden
 * Kantenrichtungen).
 */
function quatFromAxes(ex, ey, ez) {
  const m = [ex, ey, ez];                        // Spalten der Drehmatrix
  const tr = m[0][0] + m[1][1] + m[2][2];
  let w, x, y, z;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = s / 4; x = (m[1][2] - m[2][1]) / s; y = (m[2][0] - m[0][2]) / s; z = (m[0][1] - m[1][0]) / s;
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
    w = (m[1][2] - m[2][1]) / s; x = s / 4; y = (m[1][0] + m[0][1]) / s; z = (m[2][0] + m[0][2]) / s;
  } else if (m[1][1] > m[2][2]) {
    const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
    w = (m[2][0] - m[0][2]) / s; x = (m[1][0] + m[0][1]) / s; y = s / 4; z = (m[2][1] + m[1][2]) / s;
  } else {
    const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
    w = (m[0][1] - m[1][0]) / s; x = (m[2][0] + m[0][2]) / s; y = (m[2][1] + m[1][2]) / s; z = s / 4;
  }
  return [w, x, y, z];
}

const IDENTITY = ["1.", "0.", "0.", "0."];

function tuple(q, x, y, z) {
  return `{${q[0]}, ${q[1]}, ${q[2]}, ${q[3]}, ${mm(x)}, ${mm(y)}, ${mm(z)}}`;
}

function tubeMat(color) { return TUBE_MAT[color] || TUBE_MAT.blue; }
function panelMat(color) { return PANEL_MAT[color] || PANEL_MAT.blue; }

/**
 * Modell als QDF-Text.
 *
 * Was NICHT eins zu eins zurueckkommt, steht im README: der Import normalisiert
 * (Schraegen auf 45 Grad), und Teile ohne QDF-Entsprechung fallen weg. Geliefert
 * wird deshalb zusaetzlich eine Zaehlung, was geschrieben wurde.
 *
 * Liefert { text, stats }.
 */
export function buildQDF(model) {
  const conn = geometry().connectorSize;
  const lines = ["0, 0;", ...MATERIALS, CAMERA];
  const stats = { connectors: 0, tubes: 0, bows: 0, panels: 0, textiles: 0, clamps: 0, slides: 0, alu: 0 };

  const node = (id) => model.nodes.get(id);
  const dirOf = (a, b) => norm([b.x - a.x, b.y - a.y, b.z - a.z]);
  const lenOf = (a, b) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);

  // --- Kupplungen ---------------------------------------------------------
  // Der Adapterkoerper einer 45-Grad-Winkelkupplung ist kein eigenes Teil: er
  // steckt auf der Eck-Kupplung, die dafuer als connector45_2 geschrieben wird.
  for (const n of model.nodes.values()) {
    if (n.c45body) continue;
    let mask = 0;
    let carriesAdapter = false;
    for (const t of model.tubes.values()) {
      if (t.link) continue;
      const other = t.a === n.id ? node(t.b) : t.b === n.id ? node(t.a) : null;
      if (!other) continue;
      // Eine Arm-Kante heisst: hier steckt eine Winkelkupplung. Das Kennzeichen
      // c45 am Knoten fuehrt nur das Modell selbst nach, importierte Ecken
      // haben es nicht -- deshalb zaehlt die Kante, nicht das Flag.
      if (t.arm) carriesAdapter = true;
      const d = dirOf(n, other);
      for (const [bit, v] of ARM_BITS) if (dot(d, v) > 0.9) mask |= bit;
    }
    const kind = (n.c45 || carriesAdapter) ? "connector45_2" : "connector3";
    lines.push(`${kind}{${CONNECTOR_MAT}, ${tuple(IDENTITY, n.x, n.y, n.z)}, 1, 0, ${mask}, ${63 - mask}, ${RENDER_MASK}, 0}`);
    stats.connectors++;
  }

  // --- Rohre --------------------------------------------------------------
  for (const t of model.tubes.values()) {
    if (t.arm || t.link) continue;               // Adapter-Huelse und Doppelrohr-Verbindung sind keine Teile
    const a = node(t.a), b = node(t.b);
    if (!a || !b) continue;
    const mat = tubeMat(t.color);
    if (t.bow && t.bowCenter) {
      // Bogen: lokale X-Achse = Tangente am Anfang, lokale Y-Achse zeigt zum
      // Kreismittelpunkt. Radius = Rasterschritt, gespeichert wird das Rohrmass.
      const c = { x: t.bowCenter[0], y: t.bowCenter[1], z: t.bowCenter[2] };
      const R = lenOf(a, c);
      const N = dirOf(a, c);
      const T = norm([
        (b.x - a.x) / R - N[0], (b.y - a.y) / R - N[1], (b.z - a.z) / R - N[2],
      ]);
      const q = encodeQuat(quatFromAxes(T, N, cross(T, N)));
      lines.push(`round-tube2{${mat}, ${tuple(q, a.x, a.y, a.z)}, 1, ${mm(R - conn)}, 0., 0}`);
      stats.bows++;
      continue;
    }
    // Massgeblich ist der KUPPLUNGSABSTAND, nicht die Katalog-Laenge: der Import
    // rechnet das Rohrende aus Start + Richtung * (Laenge + Kupplung) und sucht
    // erst danach das passende Teil. Bei schraegen Streben aus alten Entwuerfen
    // weichen beide um ein paar Zentimeter voneinander ab -- mit der Katalog-
    // Laenge landete das Ende dann neben der Kupplung.
    const span = lenOf(a, b);
    const len = span - conn;
    const q = encodeQuat(quatFromX(dirOf(a, b)));
    lines.push(`tube2{${mat}, ${tuple(q, a.x, a.y, a.z)}, 1, ${mm(len)}, 0., 0}`);
    stats.tubes++;
    if (t.reinforced) {
      // Verstaerkungsprofil liegt im Rohr; der Import ordnet es ueber die Lage zu.
      lines.push(`alu2{${ALU_MAT}, ${tuple(q, a.x, a.y, a.z)}, 1, ${mm(len)}, 0., 0}`);
      stats.alu++;
    }
  }

  // --- Platten und Netze --------------------------------------------------
  // Geschrieben wird das KATALOGMASS, nicht der gemessene Eckabstand: eine
  // 40x40-Platte auf einer 45-Grad-Schraege spannt gemessen 40,9 cm, und mit
  // diesem krummen Mass findet der Import beim Zurueckladen kein Teil mehr.
  // Die Ecken selbst vertragen den kleinen Versatz (Snap-Toleranz 5 cm).
  const rectLine = (name, nodeIds, matNum, dims) => {
    const [A, B, C, D] = nodeIds.map(node);
    if (!A || !B || !C || !D) return null;
    const e1 = dirOf(A, B), e2 = dirOf(A, D);
    let w = lenOf(A, B), h = lenOf(A, D);
    if (dims && dims[0] > 0 && dims[1] > 0) {
      // Katalogmasse der langen/kurzen Kante zuordnen, nicht stur w vor h.
      const [d1, d2] = w >= h ? [Math.max(...dims), Math.min(...dims)] : [Math.min(...dims), Math.max(...dims)];
      if (Math.abs(d1 - w) < conn && Math.abs(d2 - h) < conn) { w = d1; h = d2; }
    }
    const cx = (A.x + B.x + C.x + D.x) / 4;
    const cy = (A.y + B.y + C.y + D.y) / 4;
    const cz = (A.z + B.z + C.z + D.z) / 4;
    const q = encodeQuat(quatFromAxes(e1, e2, cross(e1, e2)));
    return `${name}{${matNum}, ${tuple(q, cx, cy, cz)}, 1, ${mm(w - conn)}, 0., ${mm(h - conn)}, 0., 0}`;
  };

  for (const p of model.panels.values()) {
    const def = getPanel(p.panelId);
    const line = rectLine("panel2", p.nodes, panelMat(p.color), def ? [def.w, def.h] : null);
    if (line) { lines.push(line); stats.panels++; }
  }
  for (const x of (model.textiles ? model.textiles.values() : [])) {
    const line = rectLine("textil2", x.nodes, panelMat(x.color), [x.w, x.h]);
    if (line) { lines.push(line); stats.textiles++; }
  }

  // --- Klemmen und Rutschen ----------------------------------------------
  for (const c of (model.clamps ? model.clamps.values() : [])) {
    lines.push(`clamp2{${CONNECTOR_MAT}, ${tuple(IDENTITY, c.x, c.y, c.z)}, 1, 0, 0}`);
    stats.clamps++;
  }
  for (const s of (model.slides ? model.slides.values() : [])) {
    // s.quat steht in Three-Reihenfolge (x,y,z,w), die Datei will (w,x,y,z).
    const q = s.quat && s.quat.length === 4
      ? encodeQuat([s.quat[3], s.quat[0], s.quat[1], s.quat[2]])
      : IDENTITY;
    lines.push(`${s.kind || "slide-new2"}{${tubeMat(s.color)}, ${tuple(q, s.x, s.y, s.z)}, 1, 0}`);
    stats.slides++;
  }

  return { text: lines.join(EOL) + EOL, stats };
}
