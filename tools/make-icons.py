#!/usr/bin/env python3
"""Erzeugt die PWA-Symbole (PNG) aus reinem Python -- ohne Bibliotheken.

Kein Build-Step fuer die App: das Skript laeuft nur von Hand, wenn sich das
Symbol aendern soll. Die fertigen PNGs liegen im Repo und werden ausgeliefert.

    python3 tools/make-icons.py

Gezeichnet wird ein isometrischer Wuerfel aus Rohren mit Kupplungen an den
Ecken -- die Kurzfassung dessen, was der Editor baut.
"""

import math
import os
import struct
import zlib

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZIEL = os.path.join(WURZEL, "icons")

BLAU = (26, 140, 255)
WEISS = (255, 255, 255)
SS = 3  # Supersampling: dreifach zeichnen, danach mitteln -> weiche Kanten


def wuerfel_kanten():
    """Kanten des Einheitswuerfels als Paare von 3D-Ecken."""
    ecken = [(x, y, z) for x in (0, 1) for y in (0, 1) for z in (0, 1)]
    kanten = []
    for i, a in enumerate(ecken):
        for b in ecken[i + 1:]:
            # Nachbarn unterscheiden sich in genau einer Achse.
            if sum(1 for k in range(3) if a[k] != b[k]) == 1:
                kanten.append((a, b))
    return ecken, kanten


def projiziere(p, groesse, rand):
    """Isometrie: x nach rechts unten, z nach links unten, y nach oben."""
    x, y, z = p
    bx = (x - z) * math.cos(math.radians(30))
    by = (x + z) * math.sin(math.radians(30)) - y
    # In den Rahmen einpassen: bx liegt in [-0.87, 0.87], by in [-1, 1].
    nutz = groesse - 2 * rand
    return (rand + (bx + 0.87) / 1.74 * nutz,
            rand + (by + 1.0) / 2.0 * nutz)


def dist_zu_strecke(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    laenge = dx * dx + dy * dy
    t = 0.0 if laenge == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / laenge))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def zeichne(groesse, glyph_anteil, rund=True):
    """Ein Symbol als Liste von RGB-Zeilen. `glyph_anteil` < 1 laesst Luft
    fuer maskierte Symbole (Android schneidet dort einen Kreis heraus);
    `rund=False` fuellt die ganze Flaeche, weil die Maske selbst rundet."""
    n = groesse * SS
    ecke_r = n * 0.22 if rund else 0.0
    rand = n * (1 - glyph_anteil) / 2 + n * 0.10

    ecken, kanten = wuerfel_kanten()
    punkte2d = {e: projiziere(e, n, rand) for e in ecken}
    rohr_r = n * 0.035
    kupplung_r = n * 0.058

    # Vorberechnen, welche Kanten/Ecken einen Bildpunkt ueberhaupt treffen
    # koennen -- ohne das laeuft die Schleife bei 1536 Pixeln ewig.
    segmente = [(punkte2d[a], punkte2d[b]) for a, b in kanten]

    zeilen = []
    for y in range(n):
        zeile = bytearray()
        for x in range(n):
            px, py = x + 0.5, y + 0.5
            # Abgerundetes Quadrat als Hintergrund
            cx = min(max(px, ecke_r), n - ecke_r)
            cy = min(max(py, ecke_r), n - ecke_r)
            if math.hypot(px - cx, py - cy) > ecke_r:
                zeile += bytes((0, 0, 0))          # ausserhalb -> transparent
                continue
            farbe = BLAU
            for (ax, ay), (bx, by) in segmente:
                if dist_zu_strecke(px, py, ax, ay, bx, by) <= rohr_r:
                    farbe = WEISS
                    break
            else:
                for (ax, ay) in punkte2d.values():
                    if math.hypot(px - ax, py - ay) <= kupplung_r:
                        farbe = WEISS
                        break
            zeile += bytes(farbe)
        zeilen.append(zeile)
    return zeilen, n


def alpha_maske(n, groesse, glyph_anteil, rund=True):
    """Deckkraft: 255 innerhalb des abgerundeten Quadrats, sonst 0."""
    ecke_r = n * 0.22 if rund else 0.0
    maske = []
    for y in range(n):
        zeile = bytearray()
        for x in range(n):
            px, py = x + 0.5, y + 0.5
            cx = min(max(px, ecke_r), n - ecke_r)
            cy = min(max(py, ecke_r), n - ecke_r)
            zeile.append(0 if math.hypot(px - cx, py - cy) > ecke_r else 255)
        maske.append(zeile)
    return maske


def verkleinere(zeilen, maske, n, groesse):
    """SS×SS-Bloecke mitteln -> weiche Kanten ohne Zeichen-Tricks."""
    out = []
    for y in range(groesse):
        zeile = bytearray()
        for x in range(groesse):
            r = g = b = a = 0
            for dy in range(SS):
                q = zeilen[y * SS + dy]
                m = maske[y * SS + dy]
                for dx in range(SS):
                    i = (x * SS + dx) * 3
                    deckung = m[x * SS + dx]
                    r += q[i] * deckung
                    g += q[i + 1] * deckung
                    b += q[i + 2] * deckung
                    a += deckung
            teiler = a if a else 1
            zeile += bytes((r // teiler, g // teiler, b // teiler, a // (SS * SS)))
        out.append(zeile)
    return out


def schreibe_png(pfad, zeilen, groesse):
    roh = b"".join(b"\x00" + bytes(z) for z in zeilen)

    def chunk(typ, daten):
        return (struct.pack(">I", len(daten)) + typ + daten
                + struct.pack(">I", zlib.crc32(typ + daten) & 0xFFFFFFFF))

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", groesse, groesse, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(roh, 9))
           + chunk(b"IEND", b""))
    with open(pfad, "wb") as f:
        f.write(png)


def baue(name, groesse, glyph_anteil, rund=True):
    zeilen, n = zeichne(groesse, glyph_anteil, rund)
    maske = alpha_maske(n, groesse, glyph_anteil, rund)
    schreibe_png(os.path.join(ZIEL, name), verkleinere(zeilen, maske, n, groesse), groesse)
    print(name, "geschrieben")


if __name__ == "__main__":
    os.makedirs(ZIEL, exist_ok=True)
    baue("icon-192.png", 192, 1.0)
    baue("icon-512.png", 512, 1.0)
    # Maskiert: Android schneidet einen Kreis aus, deshalb kleiner zeichnen.
    baue("icon-maskable-512.png", 512, 0.72, rund=False)
