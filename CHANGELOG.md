# Changelog

Alle wichtigen Änderungen an diesem Projekt werden hier dokumentiert.  
All notable changes to this project are documented here.

Das Format folgt [Keep a Changelog](https://keepachangelog.com/de/1.0.0/).  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Behoben · Fixed
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
