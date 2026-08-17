# CLAUDE.md

Quadro Builder – 3D-Planungstool für QUADRO-Klettergerüste. Reine Vanilla-JS-Web-App,
**kein Build-Step, kein npm, keine Frameworks**, läuft offline aus dem Dateisystem eines
statischen Servers. Nutzerdoku: `README.md`, Beitragsregeln: `CONTRIBUTING.md`,
Historie: `CHANGELOG.md`.

## Starten & Verifizieren

```bash
python serve.py            # Port 8000, öffnet http://127.0.0.1:8000/web/index.html
python serve.py 8080       # anderer Port
python server.py 8000      # dasselbe PLUS optionales Backend (braucht aiohttp)
```

Nie `web/index.html` per `file://` öffnen – Browser blockieren dort ES-Module und `fetch()`.
Three.js r160 + OrbitControls liegen gevendort unter `web/vendor/three/` (kein Netz nötig).

### Eigener Dev-Server (der einzige Ort zum Prüfen)

**http://nuc-quadro gehört dem Nutzer – dort wird nicht getestet, auch nicht „nur kurz".**
Zum Prüfen einen **eigenen** Server aus diesem Arbeitsverzeichnis starten und ihn per Chrome MCP
(`navigate_page`, `take_screenshot`, `list_console_messages`, `evaluate_script`) ansteuern:

```bash
python serve.py 8090                                   # ohne Backend
QUADRO_DATA=<scratchpad>/store python server.py 8090   # mit Backend
```

Der Chrome-Container erreicht ihn über die **IP dieses Containers**, nicht über `localhost`
(`hostname -i`, zuletzt `http://192.168.168.119:8090/web/index.html`). Datenverzeichnis in den
Scratchpad legen, nie ins Repo. Für das Backend braucht es `aiohttp` – in dieser Umgebung fehlt
`pip`, es lässt sich aber per `get-pip.py` in ein `venv` im Scratchpad nachrüsten.

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

`model.js`, `bom.js`, `buildplan.js`, `qdfimport.js`, `qdfexport.js` und `library.js` sind bewusst
frei von Three.js und DOM
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
| `web/js/storage.js` | IndexedDB-Zugriff (`dbTx`), Modell-Sammlung, Datei-Export/Import |
| `web/js/docs.js` | Virtuelle Dateien: Modelle speichern/laden/umbenennen, offene Sitzung, Migration |
| `web/js/sync.js` | Abgleich mit dem optionalen Backend: Suche (`probe`), WebSocket-Ereignisse, `reconcile`, Konflikte |
| `server.py` | Optionales Backend (aiohttp): statische App + `/api/` + Ereignis-Kanal, Ablage als Dateien |
| `web/js/ui.js` | Toolbar, Datei-Tabs, Seitenleiste (Stückliste & Bestand / Modelle / Aufbau), Tastatur |
| `web/js/qdfimport.js` | Parser für QDF-Dateien der Original-QUADRO-3D-Software |
| `web/js/qdfexport.js` | Schreibt ein Modell als QDF (Gegenstück zu `qdfimport.js`) |
| `web/js/library.js` | Modell-Bibliothek: QDF-Sammlung einlesen, Kennzahlen, Bestandsabgleich |
| `manifest.webmanifest` | PWA-Manifest (Wurzel, damit `scope` auch `data/` umfasst) |
| `sw.js` | Service Worker: Netz zuerst, Cache als Rückfall – macht die App offline lauffähig |
| `tools/make-icons.py` | Erzeugt die Symbole in `icons/` (nur von Hand, kein Build-Step) |

**Datenfluss:** Jede Modelländerung → `builder.refresh()` → `scene.renderModel()` + Handles neu →
`builder.onChange()` → (in `main.js`) `ui.update()` + `ui.touchActiveTab()` (markiert den Tab,
sichert die Sitzung und – bei eingeschaltetem Auto-Save – die Datei).

**Mehrere Modelle:** Ein Tab hält ein Modell samt Werkzeugleiste, Ansicht und Schrittspeicher
(`builder.uiState()`/`setUiState()`). Umgeschaltet wird über EIN `BuildModel` und EINEN `Builder`:
Stand des alten Tabs sichern (`model.toJSON()`, Kamera, Schnittebene), Stand des neuen einsetzen.

**PWA:** `web/index.html` verweist auf `../manifest.webmanifest`, `main.js` meldet `../sw.js` an –
beide relativ, damit es unter GitHub Pages im Unterordner passt. Mit `?dev` wird der Worker
**nicht** angemeldet, und ohne sicheren Kontext (http:// auf einem fremden Host) lehnt der Browser
ihn ab; dann fehlen Offline-Betrieb und Installieren-Knopf, die App selbst läuft normal.

**Optionales Backend (ein Datenbestand!):** Die App liest und schreibt **immer** IndexedDB –
auch mit Server. `sync.js` hält diese Kopie mit `server.py` im Gleichklang: `probe()` beim Start
(`GET ../api/health`, 1,5 s Zeitgrenze), danach `reconcile()` bei jedem Verbinden, nach jeder
lokalen Änderung (`nudge()`, entprellt) und bei jedem Ereignis vom Server. Es gibt **keinen**
Umschaltbetrieb „Server-Daten vs. Browser-Daten": ohne Server läuft alles mit dem gecachten
Bestand weiter, Änderungen bleiben `dirty` liegen und gehen beim nächsten Verbinden hoch.

Dafür tragen die Datensätze in `docs`/`designs` drei Felder: `rev` (Revision, aus der der Inhalt
stammt, 0 = dem Server unbekannt), `dirty` (noch nicht hochgeladen) und `deletedAt` (Grabstein,
bis der Server die Löschung übernommen hat). Gefragt wird **nur** bei echten Konflikten – wenn
beide Seiten dieselbe Datei geändert haben (`onConflict` in `ui.js`, serielle Warteschlange, weil
ein zweiter `dialog()` den ersten abbricht). Der Server vergibt `rev` und lehnt ein Schreiben mit
veralteter `baseRev` mit **409** ab; ist der Inhalt identisch, bleibt `rev` stehen und es gibt
kein Ereignis. Bibliothek: Kennzahlen sofort, QDF-Text erst beim Öffnen (`sync.libQdf`) – ohne
Server wirft das `OfflineError` und die App meldet es. Abgeglichen werden **Modelle, Bestand und
Bibliothek**; der Bestand ist ein einziger Datensatz (`/api/inventory`) und liegt weiter in
localStorage, seine Marken daneben in `quadro.inventory.meta.v1`.

## Datenmodell

Koordinaten in **cm**, Three.js-Konvention **y = oben**, Boden bei y = 0.

`BuildModel` hält sieben Maps: `nodes`, `tubes`, `panels`, `clamps`, `textiles`, `slides`, `fittings`.

- Knoten `{id,x,y,z}` = Kupplung. Optionale Flags: `c45` (trägt 45°-Winkelkupplung),
  `c45body` (Adapter-Körper), `c45axis`, `armDirs`/`arms` (rotierte Kupplung aus QDF), `quat`.
- Kante `{id,a,b,tubeId,color,length,reinforced}` = Rohr. **Zwei Sonderkanten sind keine Rohre**
  und zählen nicht in der Stückliste:
  - `arm: true` – kurze Hülse zwischen Eck-Kupplung und C45-Adapterkörper
  - `link: true` – Verbindung zweier paralleler Rohre im Doppelrohrverbinder
- Platte `{id,a,b,t0,len,panelId,color,side}` – hängt an **zwei parallelen Rohren** (`a`,`b`), `t0`
  ist der Versatz entlang Rohr `a`, `len` die Länge in Rohrrichtung. `model.panelCorners(p)` liefert
  daraus die vier Ecken; sie müssen nicht auf Kupplungen liegen. `_prunePanels` entfernt die Platte,
  sobald eines der Tragrohre fehlt. Ältere Stände mit `nodes:[4]` werden in `loadJSON` umgerechnet
  (`_panelRecord`). `side` = +1 oben bzw. außen (Standard), −1 unten bzw.
  innen. Die Platte schließt **bündig** mit dem Rohr ab (Oberfläche auf Rohrscheitel), sie liegt
  also nicht darauf; Bezugsrichtung ist `util.panelNormal()` (waagerecht → oben,
  senkrecht → vom Modellmittelpunkt weg). Beim Setzen entscheidet der Blickwinkel, ein Klick auf
  eine liegende Platte legt sie um.
- Anbauteil `{id,kind,x,y,z,quat,color,w?,h?,mask?}` = Rad, Rolle, Lager, Gitter, Rundabdeckung …
  `kind` ist die QDF-Elementart, `quat` die volle Ausrichtung (Three-Reihenfolge x,y,z,w); die lokale
  +X-Achse ist die Bezugsrichtung (Radachse, Rollenachse). Wo ein Teil sitzen darf, steht in
  `FITTING_MOUNTS` (Kupplung oder Rohr, Abstand in cm) bzw. in eigenen Abläufen für Gitter
  (zwei parallele Rohre), Rundabdeckung (zwei Bogenrohre) und großes Dach (First-Rohr).
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
- **Rückfragen:** nie `alert`/`confirm`/`prompt`. In `ui.js` stehen `dialog()` und die
  Kurzformen `askConfirm()`, `askInput()`, `showMessage()`; sie füllen die Karte
  `#dlg-overlay` (Enter = erster Knopf, Escape/Klick daneben = Abbruch).
- **Neue Bau-Richtung/Logik:** `config.js` + `builder.js` (+ ggf. `scene.js`).
- **Tastatur:** zentral in `ui.js` (`keydown`). Pfeiltasten sind kamera-relativ über
  `scene.getHorizontalAxes()`.
- **Code-Stil:** ES2022+, Kommentare auf Deutsch **mit Umlauten** („Änderung", „Löschen", „Körper"),
  Bezeichner auf Englisch. Das gilt auch für Namen und Notizen in `data/parts.json`.
  Keine neuen externen Abhängigkeiten.
- Nur ändern, was gefragt ist – kein Over-Engineering.

## Fallstricke

- `catalog.js` lädt `../data/parts.json` relativ – die App muss unter `/web/` ausgeliefert werden.
- **Layout ohne feste Breakpoints:** `ui.js` setzt Klassen auf `<body>`, das CSS liest nur diese –
  `compact-colors`/`compact-view` (Bauteil-Zeile eng), `compact-head` (Kopfzeile eng),
  `sidebar-overlay`, `mobile-portrait`, `asm-sheet-on`. Die beiden Kollaps-Stufen misst ein
  `ResizeObserver` (`grp-build.scrollWidth > clientWidth`). **Zwei Fallen:** gemessen wird gegen
  `window.innerWidth`, nicht gegen die Leiste selbst (der Kollaps ändert deren Breite – daran
  gemessen schaukelt es sich auf); und zurückgeschaltet wird erst, wenn das Fenster um so viel
  breiter ist, wie der Kollaps damals freigemacht hat (`tightAt`), sonst zuckt es bei jeder
  Zwischenbreite einmal auf und zu. Die Kopfzeile hat dieselbe Mechanik in zwei Stufen
  (`compact-autosave`, `compact-head`); im Hochformat gilt immer die kompakte.
  Kollabiert wird durch **Umhängen des Original-Knotens** (`moveNode`), nicht durch eine zweite
  Garnitur Knöpfe; die Rückkehr-Stelle hält ein Kommentar-Knoten.
- **Zeiger-Eingaben teilen sich `builder.js` und OrbitControls:** ein Finger/die linke Maustaste
  gehören dem Builder (drehen um den Punkt unter dem Zeiger, wählen, bauen), zwei Finger und das
  Rad gehören OrbitControls. Beides muss **getrennt** abgeschaltet werden – `mouseButtons.LEFT`
  gilt nur für die Maus, für den Finger braucht es `controls.touches` (in `scene.js` an **beiden**
  Stellen, die Controls bauen). Der Builder merkt sich außerdem die `pointerId` des laufenden Zugs
  und bricht ihn ab, sobald ein zweiter Finger dazukommt (`_abortGesture`).
- Undo/Redo in `builder.js` arbeiten mit vollständigen JSON-Snapshots (`recordHistory`,
  max. 60 Schritte). Modelländerungen deshalb immer durch `recordHistory(...)` kapseln.
- **IndexedDB** `quadro.library.v1` (Version 2) hält drei Speicher: `designs` (eingelesene
  QDF-Sammlung, Originaltext + Kennzahlen), `docs` (eigene Modelle als virtuelle Dateien) und
  `session` (die offenen Tabs samt Arbeitsstand – damit übersteht auch Ungespeichertes einen
  Reload). Alles Größere gehört hierhin: `localStorage` teilt 5 MB unter allen Schlüsseln auf,
  ein großes Modell wiegt allein ~150 KB.
- **Backend-Fallen:** Der Service Worker darf `/api/` **nicht** cachen (eine gespeicherte
  Dateiliste wäre offline eine Behauptung) – `sw.js` klinkt diese Pfade früh aus. Ein Abgleich
  darf nie mit einer geratenen Serverliste laufen: `nudge()` ruft bewusst den vollen
  `reconcile()`, sonst hält ein fehlendes Gegenstück eine Datei fälschlich für „anderswo
  gelöscht". Und `?dev` schaltet nur den Service Worker ab, **nicht** das Backend – dafür gibt es
  `?nobackend` und den Schalter in den Einstellungen (`quadro.backend.v1`).
- In `localStorage` stehen nur noch Einstellungen: `quadro.inventory.v1`, `quadro.sidebarWidth.v1`,
  `quadro.sidebarPanel.v1`, `quadro.autosaveMode.v1`, `quadro.quality.v1`, `quadro.slice.v1`,
  `quadro.camera.v1`, `quadro.projection.v1`, `quadro.scene.v1`, `quadro.migrated.v2`,
  `quadro.backend.v1`, `quadro.clientId.v1`, `quadro.inventory.meta.v1`, Sprache in `i18n.js`. Die alten Schlüssel `quadro.autosave.v1`/`quadro.design.v1.<name>` werden beim ersten
  Start einmalig nach `docs` übernommen (`docs.migrateOldDrafts()`) und danach nur noch gelesen.
- Dev-Hook: App mit `?dev` in der URL öffnen ⇒ `window.__qdf.import(text)` importiert QDF
  programmatisch (für Tests aus der Konsole).
- `scene.js` cached Materialien/Geometrien bewusst (GPU-Leaks); neue Materialien nach diesem
  Muster anlegen und in `_disposeGroup`/`_disposeLabels` mit aufräumen.
- Bilder in `docs/screenshots/` werden vom README referenziert – Dateinamen nicht umbenennen.
