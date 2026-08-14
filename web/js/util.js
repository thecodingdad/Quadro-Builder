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

/** Mittelpunkt aller Kupplungen -- Bezugspunkt fuer panelNormal. */
export function modelMiddle(nodes) {
  const m = [0, 0, 0];
  let n = 0;
  for (const p of nodes) { m[0] += p.x; m[1] += p.y; m[2] += p.z; n++; }
  if (n) for (let i = 0; i < 3; i++) m[i] /= n;
  return m;
}
