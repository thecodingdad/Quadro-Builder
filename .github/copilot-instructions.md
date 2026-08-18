# QUADRO 3D – Copilot Instructions

Modern, **offline-capable web app for planning QUADRO climbing scaffolds** (modular system of
couplings + tubes). Replaces the old Windows software "Quadro 3D". You build in 3D space,
see a live **bill of materials** with material costs, and verify feasibility against your own
**parts inventory**. Detailed context: `PROJECT_STATE.md`, usage: `README.md`.

## Language & Style
- **Responses and comments in English.** Use umlauts sparingly in code (ASCII comments ok).
- Concise and concrete. Only change what is asked for – no over-engineering.

## Start & Setup
```bash
cd quadro-3D
python serve.py          # öffnet Browser automatisch
```
Läuft komplett lokal/offline (Three.js liegt unter `web/vendor/`). **Wichtig:** über `serve.py`
öffnen, nicht per Doppelklick auf `index.html` (Browser blockieren ES-Module/`fetch` unter `file://`).

## Architektur (kein Build-Step, kein Framework)
Reine **ES-Module + Vanilla-JS**. Kein npm/webpack/Vite. Datenmodell ist ein **Graph**:
Knoten = Kupplungen, Kanten = Rohre.

| Datei | Aufgabe |
|---|---|
| `web/js/main.js` | Bootstrap: Katalog laden → Scene/Model/Builder/UI verdrahten, Autosave |
| `web/js/config.js` | Konstanten: `DIRECTIONS` (6 Achsen), `MERGE_EPS`, `AUTOSAVE_KEY`, `FORMAT_VERSION` |
| `web/js/i18n.js` | Übersetzungen DE/EN; `t(key, ...args)`, `setLang()`, `getLang()`, `applyTranslations()` |
| `web/js/catalog.js` | lädt `data/parts.json`; Helfer `getTube/getConnector/getPanel/colorHex/spacingFor` |
| `web/js/model.js` | **Datenmodell (KEIN Three.js/DOM)**: Knoten/Kanten/Platten, `addNode`(Merge)/`extend`/`removeNode`, `findRectangles`, `toJSON`/`loadJSON` |
| `web/js/bom.js` | Stückliste, Kupplungstyp-Heuristik `inferConnectorType`, Bestandscheck `compareInventory` |
| `web/js/buildplan.js` | **Aufbauplan (KEIN Three.js/DOM)**: zerlegt das Modell Lage für Lage in Bauschritte |
| `web/js/scene.js` | Three.js: Renderer, Kamera, OrbitControls, Rendering, Raycasting, Handles, Namens-Labels |
| `web/js/builder.js` | Interaktion: Auswahl, 6 Richtungs-Handles, Setzen/Löschen, Aufbaumodus |
| `web/js/storage.js` | Persistenz: `localStorage` (Autosave + benannte Entwürfe) + Datei-Export/Import |
| `web/js/ui.js` | Toolbar, Farb-/Rohr-/Platten-Auswahl, Stücklisten-, Bestands- & Aufbau-Panel, Tastatur |

**Datenfluss:** Jede Modelländerung → `builder.refresh()` → `scene.renderModel()` + Handles neu +
`builder.onChange()`. `onChange` (in `main.js`) ruft `ui.update()` + `autosave()`.

**Wichtige Trennung:** `model.js`, `bom.js` und `buildplan.js` sind **frei von Three.js/DOM** und
daher in Node testbar (`node --check`). Three.js nur in `scene.js`. Diese Trennung beim Erweitern
beibehalten.

## Datenmodell (Kurzregeln)
- Koordinaten in **cm**, Three.js-Konvention **y = oben**, Boden bei y = 0.
- Knoten `{id,x,y,z}`, Kante `{id,a,b,tubeId,color,length}`, Platte `{id,nodes:[4],panelId,color}`.
- **Auto-Merge:** `addNode` gibt vorhandenen Knoten zurück, wenn einer < `MERGE_EPS` (0,5 cm) existiert.
- **Abstand Mitte–Mitte** = `Rohrlänge + connectorSize` (`spacingFor()`; `connectorSize`=5 in `parts.json`).
- **Kupplungstyp** wird per Heuristik aus Anzahl/Lage der Arme abgeleitet (`inferConnectorType`),
  für achsenparallele Bauten exakt.

## Konventionen beim Erweitern
- **Neues Teil:** nur Eintrag in `data/parts.json` (`connectors`/`tubes`/`panels`). Gerade Rohre mit
  `buildable:true` + `length_cm` und baubare Platten erscheinen automatisch als Button – keine Code-Änderung.
- **Geometrie justieren:** `parts.json → geometry`.
- **Neue Bau-Richtung/Logik:** `config.js` (`DIRECTIONS`) + `builder.js` + ggf. `scene.js`.
- **Tastatur:** zentral in `ui.js` (`keydown`); Pfeiltasten nutzen `scene.getHorizontalAxes()` (kamera-relativ).
- **Neue UI-Texte:** immer in `i18n.js` in **beiden** Dictionaries (`de` und `en`) eintragen, dann `t('schluessel')` verwenden. Nie Strings direkt in `ui.js` hardcoden.
- **Persistenz/Backend:** `storage.js` + `catalog.loadCatalog()` sind die einzigen Andock-Punkte für ein
  späteres optionales Django-Backend (`GET /api/parts`, REST für Entwürfe). Editor sonst nicht umbauen.

## Verifikation
- `python -m json.tool data/parts.json` (JSON valide), `node --check web/js/<datei>.js` für ESM-Syntax.
- Logik (`model.js`/`bom.js`/`buildplan.js`) lässt sich isoliert in Node testen (kein Three.js/DOM).
