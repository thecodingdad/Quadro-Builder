// Kleine, von allen Modulen geteilte Hilfsfunktionen (geometriefrei, ohne
// Abhaengigkeiten) -- vermeidet die mehrfache Definition von round2() in
// model.js, builder.js, bom.js und qdfimport.js.

// Rundet auf 2 Nachkommastellen (cm-Werte fuer Speicherung/Vergleich).
export function round2(v) {
  return Math.round(v * 100) / 100;
}

/**
 * Eindeutige Normale einer Platte aus ihren beiden Kantenrichtungen.
 *
 * Die Eckenreihenfolge einer Platte ist beliebig, ihr Kreuzprodukt zeigt also
 * mal so und mal so. Fuer "liegt oben drauf / haengt unten dran" braucht es
 * aber eine feste Bezugsrichtung. Die Regel stammt aus den Dateien der
 * Herstellersoftware: waagerechte Platten zeigen nach OBEN (1457 von 1464),
 * senkrechte nach AUSSEN, vom Modell weg (1141 von 1340).
 *
 * center = Mitte der Platte, middle = Mitte des Modells (beide in cm).
 */
export function panelNormal(e1, e2, center, middle) {
  const c = [
    e1[1] * e2[2] - e1[2] * e2[1],
    e1[2] * e2[0] - e1[0] * e2[2],
    e1[0] * e2[1] - e1[1] * e2[0],
  ];
  const l = Math.hypot(c[0], c[1], c[2]) || 1;
  const n = [c[0] / l, c[1] / l, c[2] / l];
  const flip = () => [-n[0], -n[1], -n[2]];
  if (Math.abs(n[1]) > 0.01) return n[1] < 0 ? flip() : n;
  const away = (center[0] - middle[0]) * n[0] + (center[2] - middle[2]) * n[2];
  if (Math.abs(away) > 0.5) return away < 0 ? flip() : n;
  if (Math.abs(n[0]) > 0.01) return n[0] < 0 ? flip() : n;
  return n[2] < 0 ? flip() : n;
}

/**
 * Quaternion (Three-Reihenfolge x,y,z,w), die die lokale +X-Achse auf `dir`
 * dreht -- auf kuerzestem Weg. Anbauteile speichern ihre Ausrichtung genau so:
 * die lokale +X ist Radachse, Rollenachse oder Flaechenbezug.
 */
export function quatFromXAxis(dir) {
  const L = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const d = [dir[0] / L, dir[1] / L, dir[2] / L];
  if (d[0] > 0.999999) return [0, 0, 0, 1];
  if (d[0] < -0.999999) return [0, 0, 1, 0];      // 180 Grad um die Z-Achse
  // Achse = +X x d, Winkel aus dem Skalarprodukt (halber Winkel ueber die
  // uebliche w = 1 + cos-Form, danach normiert).
  const q = [0, -d[2], d[1], 1 + d[0]];
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  // Vier Nachkommastellen wie beim Import -- zwei waeren als Drehung zu grob.
  const r4 = (v) => Math.round((v / n) * 1e4) / 1e4;
  return [r4(q[0]), r4(q[1]), r4(q[2]), r4(q[3])];
}

/** Mittelpunkt aller Kupplungen -- Bezugspunkt fuer panelNormal. */
export function modelMiddle(nodes) {
  const m = [0, 0, 0];
  let n = 0;
  for (const p of nodes) { m[0] += p.x; m[1] += p.y; m[2] += p.z; n++; }
  if (n) for (let i = 0; i < 3; i++) m[i] /= n;
  return m;
}
