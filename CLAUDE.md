# CLAUDE.md

Quadro Builder – 3D-Planungstool für QUADRO-Klettergerüste. Reine Vanilla-JS-Web-App,
**kein Build-Step, kein npm, keine Frameworks**, läuft offline aus dem Dateisystem eines
statischen Servers. Nutzerdoku: `README.md`, Beitragsregeln: `CONTRIBUTING.md`,
Historie: `CHANGELOG.md`.

## Starten & Verifizieren

```bash
python serve.py            # Port 8000, öffnet http://127.0.0.1:8000/web/index.html
python serve.py 8080       # anderer Port
```

Nie `web/index.html` per `file://` öffnen – Browser blockieren dort ES-Module und `fetch()`.
Three.js r160 + OrbitControls liegen gevendort unter `web/vendor/three/` (kein Netz nötig).

### Live-Instanz (bevorzugt zum Prüfen)

Die App läuft dauerhaft unter **http://nuc-quadro** und serviert direkt dieses Arbeitsverzeichnis –
Code-Änderungen sind ohne Neustart sofort live. Erreichbar über **Chrome MCP**
(`navigate_page`, `take_screenshot`, `list_console_messages`, `evaluate_script`).

**Wichtig:** Nach jeder Code-Änderung den Browser-Cache umgehen, sonst lädt die Seite alte
ES-Module. Entweder `navigate_page` mit `type: "reload"` **und `ignoreCache: true`**, oder per
`evaluate_script` ein Cache-Buster (`location.href = location.pathname + '?v=' + Date.now()`,
mit `?dev` kombinierbar).

Der Chromium-Container läuft ohne GPU und rendert WebGL über SwiftShader
(`CHROME_CLI=--enable-unsafe-swiftshader --use-angle=swiftshader`, `shm_size: 1gb`). Das 3D-Bild
ist damit voll prüfbar, nur langsam. Fehlt das Flag, scheitert Three.js mit
`A WebGL context could not be created` – dann ist die Container-Config schuld, nicht der Code.

Nützlich zur Diagnose: `renderer.info.render` (Draw Calls/Dreiecke) zeigt, ob Three.js überhaupt
zeichnet; `gl.readPixels` beweist Bildinhalt unabhängig vom Screenshot-Pfad. Mit `?dev` steht
`window.__qdf` mit `{ model, builder, scene, import(qdfText) }` bereit.

### Statische Prüfungen

Es gibt **keine Testsuite und keinen Linter**. Verifikation:

```bash
python -m json.tool data/parts.json > /dev/null && echo OK
node --check web/js/model.js && node --check web/js/bom.js && node --check web/js/buildplan.js
```

`model.js`, `bom.js`, `buildplan.js` und `qdfimport.js` sind bewusst frei von Three.js und DOM
und dadurch in Node isoliert testbar/ausführbar. **Diese Trennung beim Erweitern halten** –
Three.js ausschließlich in `scene.js`, DOM ausschließlich in `ui.js`/`scene.js`/`storage.js`.

## Architektur

| Datei | Aufgabe |
|---|---|
| `web/js/main.js` | Bootstrap: Katalog → Scene → Model → Builder → UI, Autosave-Verdrahtung |
| `web/js/config.js` | Konstanten: `DIRECTIONS`, `DIAGONAL_DIRECTIONS`, Toleranzen, `AUTOSAVE_KEY`, `FORMAT_VERSION` |
| `web/js/catalog.js` | Einziger Ort, der `data/parts.json` kennt; `getTube/getConnector/getPanel/colorHex/spacingFor/gridSpacing` |
| `web/js/i18n.js` | DE/EN-Dictionaries, `t()`, `setLang()`, `applyTranslations()` |
| `web/js/model.js` | Datenmodell (Graph), Auto-Merge, Kollisionsprüfung, `findRectangles`, `toJSON`/`loadJSON` |
| `web/js/bom.js` | Stückliste, Kupplungstyp-Heuristik, Verstärkungs-Läufe, Bestandsvergleich |
| `web/js/buildplan.js` | Aufbauplan: Modell Lage für Lage in Bauschritte zerlegen |
| `web/js/scene.js` | Three.js: Renderer, Kamera, Rendering, Raycasting, Handles, Label-Sprites, Umgebung (Gras/Bäume/Himmel) |
| `web/js/builder.js` | Interaktion: Auswahl, Handles, Setzen/Löschen, Modi, Undo/Redo |
| `web/js/storage.js` | `localStorage` (Autosave + benannte Entwürfe) + Datei-Export/Import |
| `web/js/ui.js` | Toolbar, Panels (Stückliste/Bestand/Aufbau), Tastatur, Entwurfs-Menü |
| `web/js/qdfimport.js` | Parser für QDF-Dateien der Original-QUADRO-3D-Software |
| `web/js/library.js` | Modell-Bibliothek: QDF-Sammlung einlesen, Kennzahlen, Bestandsabgleich |

**Datenfluss:** Jede Modelländerung → `builder.refresh()` → `scene.renderModel()` + Handles neu →
`builder.onChange()` → (in `main.js`) `ui.update()` + `autosave(model.toJSON())`.

**Backend-Andockpunkte:** nur `storage.js` und `catalog.loadCatalog()`. Ein optionales
Django-Backend (Roadmap) darf ausschließlich diese beiden Module ersetzen.

## Datenmodell

Koordinaten in **cm**, Three.js-Konvention **y = oben**, Boden bei y = 0.

`BuildModel` hält sechs Maps: `nodes`, `tubes`, `panels`, `clamps`, `textiles`, `slides`.

- Knoten `{id,x,y,z}` = Kupplung. Optionale Flags: `c45` (trägt 45°-Winkelkupplung),
  `c45body` (Adapter-Körper), `c45axis`, `armDirs`/`arms` (rotierte Kupplung aus QDF), `quat`.
- Kante `{id,a,b,tubeId,color,length,reinforced}` = Rohr. **Zwei Sonderkanten sind keine Rohre**
  und zählen nicht in der Stückliste:
  - `arm: true` – kurze Hülse zwischen Eck-Kupplung und C45-Adapterkörper
  - `link: true` – Verbindung zweier paralleler Rohre im Doppelrohrverbinder
- Platte `{id,nodes:[4],panelId,color}` – wird automatisch entfernt (`_prunePanels`), wenn eines
  der vier Randrohre verschwindet.
- **Auto-Merge:** `addNode` liefert einen vorhandenen Knoten zurück, wenn einer < `MERGE_EPS`
  (0,5 cm) existiert – so entstehen geschlossene Rahmen ohne Doppelteile.
- **Abstand Mitte–Mitte** = Rohrlänge + `geometry.connectorSize` (5 cm) → `spacingFor()`.
  35er-Rohr ⇒ 40-cm-Raster (passend zur 40×40-Platte).
- `extend()` liefert drei Fälle: gebaut, `{duplicate:true}` (Ziel bereits verbunden ⇒ reine
  Navigation) oder `{collision:true}` (`tubeCollision` prüft kollineare Überlappung **und**
  Kreuzungen im Rohrinneren).
- Schrägen sind **immer 45°** (`DIAGONAL_DIRECTIONS`). Im Editor gebaute Schrägen laufen über
  `extendC45Diagonal` (Basiskupplung → Adapter-Arm → Adapterkörper → Diagonalrohr); an bereits
  rotierten Kupplungen greift `extendDiagonalSnap` mit größerer Toleranz.
- `loadJSON` gibt `{ok, reason}` zurück (`"data"` / `"format"`), statt still ein kaputtes Modell
  zu übernehmen. Aufrufer muss das Ergebnis auswerten und via `t()` melden.

## Stückliste (bom.js)

- `inferConnectorType` klassifiziert nach Anzahl + Lage der Arme (koplanar ⇒ `t`/`cross`,
  sonst `3way`/`4way`, …). Für achsenparallele Bauten exakt.
- `connectorsForNode` liefert **alle** Kupplungen eines Knotens: an einem `c45`-Knoten
  Basiskupplung **plus** je Diagonale eine `diagonal`-Winkelkupplung.
- `link`-Kanten sind kein Arm und fließen nicht in die Heuristik ein; `arm`-Kanten schon.
- Verstärkungen: kollineare verstärkte Rohre werden per Union-Find zu **Läufen** verschmolzen.
  In den BOM-Zeilen ist `count` = Anzahl Läufe (Anzeige), `pieces` = physische 40-cm-Profile
  (maßgeblich für Bestellung/Bestandscheck in `neededParts`).

## Konventionen

- **Neues Teil:** nur Eintrag in `data/parts.json` (`connectors`/`tubes`/`panels`/`reinforcements`).
  Gerade Rohre mit `buildable:true` + `length_cm` und Platten mit `buildable:true` + `w`/`h`
  erscheinen automatisch als Button – **keine Code-Änderung**. Geometrie unter `geometry`.
  Preisänderungen bitte mit Quelle im Commit (z. B. quadroshop.com, Stand).
- **Neue UI-Texte:** immer in **beide** Dictionaries (`de` und `en`) in `i18n.js`, dann `t('key')`
  bzw. `data-i18n`/`data-i18n-title` im HTML. Nie Strings in `ui.js` hardcoden.
- **Neue Bau-Richtung/Logik:** `config.js` + `builder.js` (+ ggf. `scene.js`).
- **Tastatur:** zentral in `ui.js` (`keydown`). Pfeiltasten sind kamera-relativ über
  `scene.getHorizontalAxes()`.
- **Code-Stil:** ES2022+, Kommentare auf Deutsch **ohne Umlaute** (ASCII: „Aenderung", „Loeschen"),
  Bezeichner auf Englisch. Keine neuen externen Abhängigkeiten.
- Nur ändern, was gefragt ist – kein Over-Engineering.

## Fallstricke

- `catalog.js` lädt `../data/parts.json` relativ – die App muss unter `/web/` ausgeliefert werden.
- Undo/Redo in `builder.js` arbeiten mit vollständigen JSON-Snapshots (`recordHistory`,
  max. 60 Schritte). Modelländerungen deshalb immer durch `recordHistory(...)` kapseln.
- `localStorage`-Schlüssel: `quadro.autosave.v1`, `quadro.designs.index.v1`,
  `quadro.design.v1.<name>`, `quadro.inventory.v1`, `quadro.sidebarWidth.v1`,
  `quadro.sidebarPanel.v1`, Sprache in `i18n.js`. Quota-Fehler werden als `QuotaError` geworfen.
- Die **Modell-Bibliothek** liegt in **IndexedDB** (`quadro.library.v1`, Store `designs`), nicht in
  `localStorage` – eine QDF-Sammlung bringt schnell 3–4 MB mit und würde die 5-MB-Grenze sprengen,
  die sich Autosave und Entwürfe teilen. Gespeichert wird der QDF-Text im Original plus die beim
  Einlesen berechneten Kennzahlen; geparst wird erst beim Öffnen.
- Dev-Hook: App mit `?dev` in der URL öffnen ⇒ `window.__qdf.import(text)` importiert QDF
  programmatisch (für Tests aus der Konsole).
- `scene.js` cached Materialien/Geometrien bewusst (GPU-Leaks); neue Materialien nach diesem
  Muster anlegen und in `_disposeGroup`/`_disposeLabels` mit aufräumen.
- Bilder in `docs/screenshots/` werden vom README referenziert – Dateinamen nicht umbenennen.
