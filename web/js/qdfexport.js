// Export ins QDF-Format der originalen QUADRO-3D-Software.
//
// Gegenstueck zu qdfimport.js -- dort steht die Beschreibung des Formats. Kurz:
// Textdatei, eine Anweisung je Zeile, Koordinaten in Zehntel-Millimetern... genauer:
// in mm (Raster 400 mm = 40 cm), y = oben, Zeilenende CRLF.
//
// Drei Eigenheiten des Formats, die man beim Schreiben kennen muss:
//   1. Die Quaternion-Komponenten stehen vorzeichenbehaftet QUADRIERT in der
//      Datei (sign*v^2) und zusaetzlich mit 4 skaliert -- die vier Betraege
//      summieren sich in den Herstellerdateien ausnahmslos zu 4. Unser Import
//      normiert und merkt den Unterschied nicht; die Originalsoftware rechnet
//      ohne Normierung weiter und stellt ein falsch skaliertes Modell voellig
//      verdreht dar.
//   2. Rohre und Platten speichern das TEILEMASS, nicht die Rasterspannweite:
//      ein 40-cm-Feld steht als 350 (= 35 cm Rohr) in der Datei. Die Kupplung
//      steuert die fehlenden 5 cm bei (geometry.connectorSize).
//   3. Gedrehte Kupplungen behalten ihre Lage, und ihre Arm-Maske (variant2)
//      zaehlt die LOKALEN Wuerfelachsen, nicht die Weltachsen.
//
// Bewusst ohne Three.js und DOM -- wie qdfimport.js in Node testbar.

import { geometry, getPanel } from "./catalog.js";
import { panelNormal, modelMiddle } from "./util.js";

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

// Die vier Blickwinkel-Voreinstellungen der Herstellersoftware. Sie legen nicht
// nur die Kamera fest, sondern auch, wie weit sich herauszoomen laesst: das
// vorletzte Zahlenfeld (Index 21) begrenzt den Bereich. In den 945 Kamerazeilen
// der Beispieldateien steht dort 735-mal genau 40; kleinere Werte wie 4,54
// schneiden grosse Modelle beim Herauszoomen ab. Uebernommen aus einer Datei,
// die die Software selbst geschrieben hat -- alle vier Zeilen mit 40.
// Unser eigener Import ueberliest camera2.
const CAMERAS = [
  "camera2{520, 70, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 379, 595, 40, 60, 33, 3000, 10, 10, 1.571152, 40.000000, 0, 1.000000, 1.000000}",
  "camera2{520, 130, 0, 0, 0, 0, 0, 0, 300, 15, 55, 0, 233, 366, 40, 60, 33, 3000, 10, 10, 1.571152, 40.000000, 0, 1.000000, 1.000000}",
  "camera2{320, 130, 0, 0, 0, 0, 0, 0, 355, 0, 55, 0, 233, 0, 40, 0, 33, 3000, 10, 10, 0.000000, 40.000000, 0, 1.000000, 1.000000}",
  "camera2{320, 130, 0, 0, 0, 0, 0, 0, 355, 0, 55, 0, 233, 0, 40, 0, 33, 3000, 10, 10, 0.000000, 40.000000, 0, 1.000000, 1.000000}",
];

const EOL = "\r\n";

/** Zahl im Stil der Originaldateien: ganze Werte mit angehaengtem Punkt. */
function fmt(v) {
  const n = Math.abs(v) < 1e-9 ? 0 : v;
  if (Number.isInteger(n)) return `${n}.`;
  return String(Math.round(n * 1e6) / 1e6);
}

const mm = (cm) => fmt(Math.round(cm * 10 * 1e4) / 1e4);

// Die gespeicherten Quadrate sind mit 4 skaliert: in JEDER der 10.958 geprueften
// Zeilen der Herstellerdateien summieren sich die vier Betraege exakt zu 4 (die
// Einheitsquaternion allein ergaebe 1). Unser Import normiert und merkt den
// Unterschied nicht -- die Originalsoftware rechnet ohne Normierung weiter und
// stellt ein Modell mit Faktor 1 voellig verdreht dar.
const QUAT_SCALE = 4;

/** Einheitsquaternion [w,x,y,z] -> die vier Dateiwerte (vorzeichenbehaftet quadriert). */
function encodeQuat(q) {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return q.map((c) => {
    const u = c / n;
    return fmt(Math.round(Math.sign(u) * u * u * QUAT_SCALE * 1e12) / 1e12);
  });
}

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
/** Vektor mit dem Quaternion [w,x,y,z] drehen (wie qdfimport.rotateByQuat). */
function rotateByQuat(q, v) {
  let [w, x, y, z] = q;
  const n = Math.hypot(w, x, y, z) || 1;
  w /= n; x /= n; y /= n; z /= n;
  const u = [x, y, z];
  const t = cross(u, v).map((c) => 2 * c);
  const c2 = cross(u, t);
  return [v[0] + w * t[0] + c2[0], v[1] + w * t[1] + c2[1], v[2] + w * t[2] + c2[2]];
}
/** Gegendrehung: Welt -> lokale Achsen der Kupplung. */
function conjugate(q) { return [q[0], -q[1], -q[2], -q[3]]; }

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * Richtung des Kupplungs-Stutzens, in dem ein Bogenrohr steckt.
 *
 * Der Bogen ist ein Viertelkreis um `center`; am Knoten `from` verlaesst er die
 * Kupplung entlang der Tangente. Fuer 90 Grad ist die Tangente am einen Ende
 * genau der Radiusvektor des anderen Endes -- das spart jede Winkelrechnung.
 */
function bowStubDir(from, other, center) {
  return norm([other.x - center[0], other.y - center[1], other.z - center[2]]);
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

// Auch die Ruhelage traegt die Skala: (4,0,0,0), nicht (1,0,0,0).
const IDENTITY = [fmt(QUAT_SCALE), "0.", "0.", "0."];

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
  const lines = ["0, 0;", ...MATERIALS, ...CAMERAS];
  const stats = { connectors: 0, tubes: 0, bows: 0, panels: 0, textiles: 0, clamps: 0, slides: 0, alu: 0, fittings: 0 };
  // Das Lager fuehrt eine feste Laenge (50 mm in allen Herstellerdateien).
  const cs50 = 5;

  const node = (id) => model.nodes.get(id);
  const dirOf = (a, b) => norm([b.x - a.x, b.y - a.y, b.z - a.z]);
  const lenOf = (a, b) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  // Mittelpunkt des Modells: sagt bei senkrechten Platten, wo "aussen" ist.
  const middle = modelMiddle(model.nodes.values());

  // --- Kupplungen ---------------------------------------------------------
  // Der Adapterkoerper einer 45-Grad-Winkelkupplung ist kein eigenes Teil: er
  // steckt auf der Eck-Kupplung, die dafuer als connector45_2 geschrieben wird.
  for (const n of model.nodes.values()) {
    if (n.c45body) continue;
    // Klemm-Kupplung: eigene Zeile statt connector3. Der Punkt ist die
    // Muendung des offenen Anschlusses, das lokale -Y zeigt in ihn hinein und
    // das lokale X laeuft am umschlossenen Rohr entlang -- so steht es in allen
    // 51 Vorkommen der Herstellerdateien (Maskenfelder dort immer 11, 8, 3840).
    if (n.part && n.stub) {
      const tb = n.clampOn ? model.tubes.get(n.clampOn.tubeId) : null;
      const ta = tb && node(tb.a), tbb = tb && node(tb.b);
      // Ohne bekanntes Rohr irgendeine Achse quer zum Anschluss.
      const ex = ta && tbb ? dirOf(ta, tbb)
        : (Math.abs(n.stub[1]) > 0.5 ? [1, 0, 0] : [0, 1, 0]);
      const ey = [-n.stub[0], -n.stub[1], -n.stub[2]];
      const ez = [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0]];
      if (n.part === "hole_1") {
        lines.push(`hole-connector4{${CONNECTOR_MAT}, ${tuple(encodeQuat(quatFromAxes(ex, ey, ez)), n.x, n.y, n.z)}, 0, 0, 11, 8, 3840, 0, 0}`);
        stats.fittings++;
        continue;   // die Lochzapfenkupplung IST die Kupplung
      }
      // Lagerkupplung: eigene Zeile PLUS die normale Kupplung, die sie traegt --
      // genau so stehen beide in den Herstellerdateien am selben Punkt.
      lines.push(`bearing2{${CONNECTOR_MAT}, ${tuple(encodeQuat(quatFromX(n.stub)), n.x, n.y, n.z)}, 1, ${mm(cs50)}, 0., 0}`);
      stats.fittings++;
    }
    // Eine gedrehte Kupplung (aus dem Import) behaelt ihre Lage. Die Arm-Maske
    // zaehlt die LOKALEN Wuerfelachsen -- bei einer gedrehten Kupplung sind das
    // nicht die Weltachsen, sonst bekaeme sie gar keine Arme zugeordnet.
    const quat = n.quat && n.quat.length === 4
      ? [n.quat[3], n.quat[0], n.quat[1], n.quat[2]]      // Three (x,y,z,w) -> Datei (w,x,y,z)
      : null;
    const toLocal = (d) => (quat ? rotateByQuat(conjugate(quat), d) : d);

    let mask = 0;
    let carriesAdapter = false;
    // Vorhandene Stutzen aus dem Import (inklusive offener Arme ohne Rohr).
    for (const a of n.arms || []) {
      const l = toLocal(a);
      for (const [bit, v] of ARM_BITS) if (dot(l, v) > 0.9) mask |= bit;
    }
    for (const t of model.tubes.values()) {
      if (t.link) continue;
      const other = t.a === n.id ? node(t.b) : t.b === n.id ? node(t.a) : null;
      if (!other) continue;
      // Eine Arm-Kante heisst: hier steckt eine Winkelkupplung. Das Kennzeichen
      // c45 am Knoten fuehrt nur das Modell selbst nach, importierte Ecken
      // haben es nicht -- deshalb zaehlt die Kante, nicht das Flag.
      if (t.arm) carriesAdapter = true;
      // Am Bogenrohr steckt der Stutzen in der TANGENTE, nicht in der Sehne --
      // die laeuft 45 Grad daneben und traf gar keine Wuerfelachse, weshalb der
      // Kupplung in der Originalsoftware der Fortsatz zum Bogen fehlte.
      // Fuer den Viertelkreis gilt: Tangente am Anfang = Richtung vom
      // Mittelpunkt zum ANDEREN Ende, und umgekehrt.
      const l = toLocal(t.bow && t.bowCenter ? bowStubDir(n, other, t.bowCenter) : dirOf(n, other));
      for (const [bit, v] of ARM_BITS) if (dot(l, v) > 0.9) mask |= bit;
    }
    const kind = (n.c45 || carriesAdapter) ? "connector45_2" : "connector3";
    const q = quat ? encodeQuat(quat) : IDENTITY;
    lines.push(`${kind}{${CONNECTOR_MAT}, ${tuple(q, n.x, n.y, n.z)}, 1, 0, ${mask}, ${63 - mask}, ${RENDER_MASK}, 0}`);
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
  //
  // Zwei Konventionen, an den Herstellerdateien abgelesen:
  //   * Das ERSTE Mass gehoert zur lokalen Y-Achse, das zweite zur X-Achse --
  //     in allen 98 Rechteckplatten der Beispielsammlung. Andersherum liegt eine
  //     40x20-Platte quer. (Unser Import probiert beide Zuordnungen und merkt
  //     den Unterschied deshalb nicht.)
  //   * Die Plattenmitte liegt exakt in der Kupplungsebene (2603 von 2604
  //     Platten, Versatz 0). Auf welcher Seite der Rohre das Teil liegt, sagt
  //     die Normale -- siehe canonicalNormal.
  const rectLine = (name, corners, matNum, dims, side) => {
    if (!corners) return null;
    const [A, B, C, D] = corners.map((c) => ({ x: c[0], y: c[1], z: c[2] }));
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
    // Normale nicht aus der Ecken-Reihenfolge ableiten (die ist beliebig und
    // liess die Platte mal oben, mal unten erscheinen), sondern eindeutig
    // festlegen und mit der gespeicherten Seite multiplizieren.
    const n = panelNormal(e1, e2, [cx, cy, cz], middle).map((v) => v * (side < 0 ? -1 : 1));
    // Rechtshaendiges Dreibein zur gewaehlten Normalen: X bleibt e1.
    const q = encodeQuat(quatFromAxes(e1, cross(n, e1), n));
    // w liegt auf der lokalen X-Achse, h auf Y -- geschrieben wird Y zuerst.
    return `${name}{${matNum}, ${tuple(q, cx, cy, cz)}, 1, ${mm(h - conn)}, 0., ${mm(w - conn)}, 0., 0}`;
  };

  for (const p of model.panels.values()) {
    const def = getPanel(p.panelId);
    const line = rectLine("panel2", model.panelCorners(p), panelMat(p.color), def ? [def.w, def.h] : null, p.side);
    if (line) { lines.push(line); stats.panels++; }
  }
  for (const x of (model.textiles ? model.textiles.values() : [])) {
    const line = rectLine("textil2", model.panelCorners(x), panelMat(x.color), [x.w, x.h], x.side);
    if (line) { lines.push(line); stats.textiles++; }
  }

  // --- Klemmen und Rutschen ----------------------------------------------
  for (const c of (model.clamps ? model.clamps.values() : [])) {
    // Doppelrohrverbinder und Rohrklammer sind zwei Elemente; die lokale
    // +X-Achse ist die Richtung des umschlossenen Rohrs.
    const kind = c.connectorId === "tube_clamp" ? "clip2" : "clamp2";
    const q = c.dir ? encodeQuat(quatFromX(c.dir)) : IDENTITY;
    lines.push(`${kind}{${TUBE_MAT.red}, ${tuple(q, c.x, c.y, c.z)}, 1, 0, 0}`);
    stats.clamps++;
  }
  // Anbauteile: Punkt + Ausrichtung, beim Gitter zusaetzlich die Masse. Die
  // Feldzahl je Art richtet sich nach dem, was die Herstellerdateien fuehren.
  for (const f of (model.fittings ? model.fittings.values() : [])) {
    const q = f.quat && f.quat.length === 4
      ? encodeQuat([f.quat[3], f.quat[0], f.quat[1], f.quat[2]])
      : IDENTITY;
    const mat = f.color ? tubeMat(f.color) : CONNECTOR_MAT;
    // Der Spielsack wird an dem Rohr gespeichert, an dem er haengt -- unsere
    // Mitte liegt 20 cm weiter in der lokalen +Z-Richtung, also zurueckrechnen.
    let fx = f.x, fy = f.y, fz = f.z;
    if (f.kind === "bag2" && f.quat) {
      const ez = rotateByQuat([f.quat[3], f.quat[0], f.quat[1], f.quat[2]], [0, 0, 1]);
      fx -= ez[0] * 20; fy -= ez[1] * 20; fz -= ez[2] * 20;
    }
    if (f.kind === "lattice2" && f.w != null && f.h != null) {
      lines.push(`lattice2{${mat}, ${tuple(q, fx, fy, fz)}, 1, ${mm(f.w)}, 0., ${mm(f.h)}, 0., 0}`);
    } else if (f.kind === "hole-connector4") {
      const mask = f.mask || 0;
      lines.push(`hole-connector4{${CONNECTOR_MAT}, ${tuple(q, fx, fy, fz)}, 0, 0, ${mask}, ${mask - 3}, 3840, 0, 0}`);
    } else if (f.kind === "bearing2") {
      lines.push(`bearing2{${CONNECTOR_MAT}, ${tuple(q, fx, fy, fz)}, 1, ${mm(cs50)}, 0., 0}`);
    } else {
      lines.push(`${f.kind}{${mat}, ${tuple(q, fx, fy, fz)}, 1, 0}`);
    }
    stats.fittings++;
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
