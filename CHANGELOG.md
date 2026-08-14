# Changelog

Alle wichtigen Änderungen an diesem Projekt werden hier dokumentiert.  
All notable changes to this project are documented here.

Das Format folgt [Keep a Changelog](https://keepachangelog.com/de/1.0.0/).  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Hinzugefügt · Added
- **Bogenrohre drehen** – ein Klick auf ein gesetztes Bogenrohr dreht es um 90° um seine eigene Tangente weiter; Lagen unter dem Boden werden übersprungen. Der Mauszeiger wird zur Hand, sobald etwas Anklickbares unter ihm liegt (Bogen im Bau-Modus, Platte im Platten-Modus) · **Rotate curved tubes** – clicking a placed bow turns it 90° about its own tangent; positions below ground are skipped. The cursor turns into a hand whenever something clickable is under it (a bow in build mode, a panel in panel mode)
- **Platten liegen auf den Rohren, nicht in ihnen** – neue Eigenschaft `side`: oben bzw. außen (Standard) oder unten bzw. innen, jeweils bündig mit dem Rohr abschließend. Die Ecken sind ausgespart, damit die Platte nicht auf den Kupplungen liegt – als Viertelkreis, auf der Render-Stufe „niedrig" rechtwinklig wie die dortigen Kupplungen. Beim Setzen entscheidet der Blickwinkel, ein Klick auf eine liegende Platte legt sie um · **Panels rest on the tubes instead of inside them** – new `side` property: top/outside (default) or bottom/inside, finishing flush with the tube either way. The corners are cut out so the panel clears the connectors – as a quarter circle, square on the “low” render level where the connectors are faceted too. The viewing angle decides when placing, a click on a placed panel flips it
- **QDF-Export** (`web/js/qdfexport.js`, „Export QDF" im Entwürfe-Menü) – Modelle im Format der Original-QUADRO-Software sichern. geschriebene Bauteil-Zeilen sind zu 64,6 % zeichengleich mit den Originaldateien des Herstellers, Abweichungen betreffen nur Anzeige-Felder. Rundlauf über alle 235 Beispieldateien: 193 kommen Teil für Teil identisch zurück · **QDF export** (`web/js/qdfexport.js`, “Export QDF” in the drafts menu) – save models in the original QUADRO software's format. 64.6 % of the part lines it writes are character for character what the manufacturer's own files contain, the differences being display fields only. Round-trip over all 235 sample files: 193 come back part for part identical
- **Modell-Bibliothek** (`web/js/library.js`, Panel „Modelle") – eigene QDF-Sammlung ordnerweise einlesen, durchsuchen und nach „mit meinem Bestand baubar" filtern; je Eintrag Kupplungen/Rohre/Platten, Außenmaße und die Zahl der fehlenden Teile. Ablage in IndexedDB (`quadro.library.v1`), nichts wird hochgeladen · **Model library** (`web/js/library.js`, “Models” panel) – read in your own QDF collection folder by folder, search it and filter by “buildable with my inventory”; each entry shows connectors/tubes/panels, outer dimensions and the number of missing parts. Stored in IndexedDB, nothing is uploaded
- `applyTranslations()` übersetzt jetzt auch `data-i18n-placeholder` · `applyTranslations()` now also translates `data-i18n-placeholder`

### Behoben · Fixed
- Rutschen hatten die falschen Maße (128 cm bei 38,7°) und landeten dadurch neben dem Boden. Die Rutsche ist ein Fertigteil fester Größe: im 40-cm-Raster **zwei Ebenen hoch und drei Felder lang**. Montagestellen gibt es deshalb nur an Kupplungen genau 80 cm über dem Boden und nur, wenn die Bahn davor frei ist · Slides had the wrong dimensions (128 cm at 38.7°) and so ended up beside the ground. A slide is a fixed part: two grid levels high and three fields long. Mounting points therefore only exist at connectors exactly 80 cm above the ground, and only where the run is clear
- QDF-Export: an den Bogenrohren fehlte der Kupplungs-Fortsatz, weil die Arm-Maske aus der Sehne statt aus der Tangente kam – die Sehne läuft 45° daneben und traf keine Würfelachse · QDF export: the connector stub at a curved tube was missing because the arm mask came from the chord instead of the tangent
- QDF-Export: die Plattenmaße standen auf den falschen lokalen Achsen (eine 40×20-Platte lag quer) und die Normale kam aus der beliebigen Eckenreihenfolge, wodurch Platten in der Herstellersoftware mal über und mal unter den Rohren erschienen · QDF export: the panel sizes sat on the wrong local axes (a 40×20 panel lay across its field) and the normal came from the arbitrary corner order, so panels showed up above the tubes in one place and below in another
- `qdfimport.js` zählte beim Aufräumen freistehender Knoten nur Rohre und Platten als Referenz – die Eckpunkte von Netzen wurden gelöscht, das Netz zeigte danach auf Knoten, die es nicht mehr gab · `qdfimport.js` only counted tubes and panels when pruning free-standing nodes, so the corners of nets were deleted and the net then referenced nodes that no longer existed
- `bom.js` `infeasibleConnectors()` wertete die Hülse einer 45°-Winkelkupplung als schiefen Arm (~17° gemessen) und hielt damit jede im Editor gebaute Schräge für nicht herstellbar – das blockierte das Verschieben jeder Auswahl, die eine enthielt · `infeasibleConnectors()` treated the sleeve of a 45° angle connector as a skewed arm (~17° as measured) and so considered every diagonal built in the editor impossible to build, which blocked moving any selection containing one
- Escape schließt jetzt zuerst ein offenes Overlay (Tastenkürzel), statt den Modus zu wechseln · Escape now closes an open overlay (shortcuts) first instead of switching the mode

---

## [0.3.0] – 2026-06-01

### Hinzugefügt · Added
- **Zweisprachigkeit (DE/EN)** – alle UI-Texte übersetzt, Sprach-Toggle-Button in der Toolbar, Browsersprache wird automatisch erkannt, Einstellung per `localStorage` gespeichert · **Bilingual (DE/EN)** – all UI strings translated, language toggle button in toolbar, browser language auto-detected, preference saved in localStorage
- **GitHub Pages Unterstützung** – `.nojekyll` + Root-`index.html`-Redirect, die App läuft ohne Python-Server direkt aus dem Repository · **GitHub Pages support** – `.nojekyll` + root `index.html` redirect; the app runs without a Python server directly from the repository
- `web/js/i18n.js` – neues i18n-Modul mit `t()`-Funktion und `applyTranslations()` · new i18n module with `t()` function and `applyTranslations()`

### Geändert · Changed
- `bom.js`: interne Gruppen-IDs von deutschen Strings (`"Rohre"`) auf neutrale Schlüssel (`"tubes"`) umgestellt · internal group IDs changed from German strings to neutral keys
- `catalog.js`, `main.js`, `ui.js`: alle Fehlermeldungen und Statusmeldungen nutzen jetzt `t()` · all error and status messages now use `t()`

---

## [0.2.0] – 2026-05-31

### Hinzugefügt · Added
- **Platten** – 40×40 und 40×20 Platten auf erkannte Felder einsetzen (`model.findRectangles`) · **Panels** – place 40×40 and 40×20 panels on detected fields
- **Schräge Streben** – 45°-Elemente für Rampen und Verstrebungen; eigener Kupplungstyp `diagonal`/C45 · **Diagonal braces** – 45° elements for ramps and cross-bracing; own connector type `diagonal`/C45
- **Alu-Verstärkungen** – Profile in Rohre einschieben, kollineare Läufe werden zusammengefasst (Stückliste berücksichtigt Gesamtlänge) · **Aluminium reinforcements** – insert profiles into tubes, collinear runs merged (BOM accounts for total length)
- **Doppelrohrverbinder** – Klemmen auf Rohre setzen/entfernen · **Double-tube connectors** – place/remove clamps on tubes
- **Aufbaumodus** – ebenenweiser Bauplan (`buildplan.js`), Navigation per Stepper oder Pfeiltasten, Drucken · **Assembly mode** – layer-by-layer plan, navigation via stepper or arrow keys, print
- **Kupplungsbeschriftungen** – Namen und Rohrlängen als Sprite-Labels, farbcodiert nach Kategorie (Flächenkupplung grün, Raumkupplung blau, 75er-Rohr violett) · **Connector labels** – names and tube lengths as sprite labels, colour-coded by category
- **Rohr-Buttons** statt Dropdown – aktuelle Länge immer sichtbar, Shortcut-Ziffern 1–8 · **Tube buttons** instead of dropdown – current length always visible, shortcut digits 1–8
- **Tastatur-Shortcuts** – Pfeiltasten verlegen Rohre kamera-relativ (`scene.getHorizontalAxes`), Bild↑/↓ und +/− für oben/unten · **Keyboard shortcuts** – arrow keys place tubes camera-relative, Page Up/Down and +/− for up/down
- **Rückgängig** – History-Stack (Strg/Cmd+Z) · **Undo** – history stack (Ctrl/Cmd+Z)
- **Seitenleiste** – verschiebbare Breite, ausblendbar · **Sidebar** – draggable width, collapsible
- **QDF-Import** – Entwürfe aus der Original-QUADRO-Software laden (`qdfimport.js`) · **QDF import** – load designs from the original QUADRO software
- **Bestandseditor** – vollständige Teileliste bearbeiten, JSON-Export/Import · **Inventory editor** – edit complete parts list, JSON export/import

### Geändert · Changed
- Kupplungstyp-Heuristik erweitert um C45-Knoten (schräge Arme werden als eigene Kupplung gezählt) · connector type heuristics extended for C45 nodes

---

## [0.1.0] – 2026-05-01

### Hinzugefügt · Added
- **3D-Editor** – Three.js r160, OrbitControls, lokal gevendort (offline) · **3D editor** – Three.js r160, OrbitControls, vendored locally (offline)
- **Graph-Datenmodell** – Kupplungen als Knoten, Rohre als Kanten; Auto-Merge bei Überlappung · **Graph data model** – connectors as nodes, tubes as edges; auto-merge on overlap
- **6 Richtungs-Handles** – grüne Punkte an jeder freien Achse einer gewählten Kupplung · **6 directional handles** – green dots on each free axis of a selected connector
- **Stückliste** – Kupplungstyp-Heuristik (`inferConnectorType`), Materialpreise aus `parts.json`, Gesamtkosten · **Bill of materials** – connector type heuristics, material prices from `parts.json`, total cost
- **Bestand & Machbarkeit** – Teile eintragen, Entwurf gegen Bestand prüfen · **Inventory & feasibility** – enter parts, check design against inventory
- **Farbwahl** – Rohre und Platten in verschiedenen Farben · **Colour picker** – tubes and panels in different colours
- **Autosave** – letzter Stand automatisch in `localStorage`, benannte Entwürfe, JSON-Export/Import · **Autosave** – last state automatically in localStorage, named designs, JSON export/import
- **`serve.py`** – lokaler statischer Server (Python-Standardbibliothek, kein pip nötig) · local static server (Python standard library, no pip required)
- **`data/parts.json`** – Teile-Katalog mit Kupplungen, Rohren, Platten und Preisen aus dem QUADRO-Shop (Stand Mai 2026) · parts catalogue with connectors, tubes, panels and prices from the QUADRO shop (as of May 2026)
