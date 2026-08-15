// 3D-Szene + Rendering (Three.js). Kennt das Modell nur zum Zeichnen.

import * as THREE from "three";
import { OrbitControls } from "../vendor/three/OrbitControls.js";
import { geometry, colorHex, connectorColor, getPanel } from "./catalog.js";
import { panelNormal, modelMiddle } from "./util.js";
import { clampOffset } from "./model.js";

const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);

// Render-Qualitaet: steuert nur die Aufloesung der gecachten Geometrien, nicht
// die Masse. conn = [Segmente breit, hoch] des abgerundeten Kupplungs-Wuerfels
// (null = scharfkantiger Wuerfel), tube = Umfangssegmente der Rohre.
export const QUALITY_LEVELS = ["low", "medium", "high"];
// notch = Segmente je Eck-Aussparung einer Platte. 0 heisst rechtwinklig --
// das passt zur Stufe "low", auf der auch die Kupplungen kantig sind.
const QUALITY = {
  low:    { conn: null,      tube: 8,  bow: 8,  notch: 0,  shadow: 0,    antialias: false },
  medium: { conn: [16, 10],  tube: 16, bow: 14, notch: 6,  shadow: 1024, antialias: true  },
  high:   { conn: [48, 32],  tube: 44, bow: 32, notch: 16, shadow: 2048, antialias: true  },
};
const DEFAULT_QUALITY = "medium";

// Hervorhebung (Cursor-Auswahl und Bestandsliste): immer dasselbe Lila,
// unabhaengig von der Teilefarbe. Nur die Emissive einzufaerben liess die
// Grundfarbe durchschlagen -- ein rotes und ein blaues Rohr sahen dann
// unterschiedlich aus. Lila kommt im Teile-Katalog nicht vor.
// Spalt zwischen benachbarten Platten (cm, gesamt -- je Seite die Haelfte).
const PANEL_GAP = 1.5;

// Anbauteile: Radgroesse und Radius der gebogenen Wand, aus den Entwurfsdaten
// (Rad sitzt 5 cm neben der Kupplung, Rundwand 40 cm von Kupplung und Rohr).
const WHEEL_R = 19;
const ROUND_WALL_R = 40;
// Laenge der Rundabdeckung entlang ihrer Achse: die Bogenpaare stehen in allen
// Entwuerfen 800 mm auseinander.
const ROUND_COVER_LEN = 80;

// Bogenrutsche, gemessen an allen zehn Vorkommen im Bestand: das Folgeteil sitzt
// stets 60 cm voraus (lokales +X), 80 cm tiefer und 60 cm zur Seite (lokales +Z).
const CURVED_SLIDE_DROP = new THREE.Vector3(60, -80, 60);
// Laufrichtung einer Rutsche ist ihr lokales +Z: bei 73 von 76 geraden Rutschen
// sitzt das Endstueck auf (0, -800, 1200). Die Bogenrutsche START ET ebenso in
// ihrem lokalen +Z und dreht auf das lokale +X -- das Folgeteil steht in allen
// zehn Faellen mit seinem eigenen +Z genau auf dem lokalen +X des Bogens.
const CURVED_SLIDE_ENTRY = new THREE.Vector3(0, 0, 1);
// Gerade Rutsche: Folgeteil auf dem lokalen Versatz (0, -800, 1200) mm.
const STRAIGHT_SLIDE_DROP = new THREE.Vector3(0, -80, 120);
// Austrittsrichtung am Ende des Bogens: lokales +X, rund 33 Grad abwaerts --
// dasselbe Gefaelle wie die gerade Rutsche (80 cm auf 120 cm).
const CURVED_SLIDE_EXIT = new THREE.Vector3(1, -0.55, 0).normalize();
// Flaechige Anbauteile verschwinden im Verstaerken- und Kollisions-Modus, wie
// Platten und Netze auch.
const FLAT_FITTINGS = new Set(["lattice2", "textil-round2", "roof-large2"]);
// Anbauteile, die auf einem Stutzen der Kupplung sitzen: die Kupplung bekommt
// dort denselben Stutzen wie fuer ein Rohr.
const ARM_FITTINGS = new Set(["adapter2", "bearing2"]);

const HIGHLIGHT_COLOR = 0x9b30ff;
const HIGHLIGHT_EMISSIVE = 0x3a0066;

// Rundung des Kupplungs-Wuerfels (p-Norm des Superellipsoids). 2 waere die
// Kugel, grosse Werte ein scharfer Wuerfel. Bei 3 liegen die Flanken buendig
// auf 2,5 cm (Rohrradius 2,45) und die Ecken stehen nur noch 0,5 cm ueber --
// bei 5 waren es 1 cm, die Kupplung wirkte dadurch klobig.
const CONNECTOR_ROUNDNESS = 3;

// Herauszoomen begrenzen: sonst schrumpft das Modell zu einem Punkt in der
// Bildmitte und man findet ohne Zuruecksetzen nicht mehr hin. Grenze ist ein
// Vielfaches der Modelldiagonale -- bei diesem Abstand fuellt das Modell noch
// rund ein Drittel der Bildhoehe. Der Mindestwert gilt fuer kleine und leere
// Modelle, damit man das Raster (800 cm) noch ganz sieht.
const ZOOM_OUT_FACTOR = 3;
const MIN_ZOOM_OUT_DISTANCE = 600;   // cm

// Wie nah darf der Blick an Drauf- und Untersicht heran? OrbitControls rechnet
// mit fester Oben-Achse und entartet genau am Pol, deshalb bleibt ein Rest von
// gut einem Zehntelgrad -- sichtbar ist der nicht.
const POLE_GAP = 0.002;                          // rad
const MAX_PITCH = Math.PI / 2 - POLE_GAP;

// Ansichtswuerfel oben rechts im Viewport (Fusion-Vorbild).
const CUBE_PX = 104;        // Kantenlaenge des Ausschnitts in CSS-Pixeln
const CUBE_MARGIN = 14;
const CUBE_SNAP_MS = 320;   // Dauer des Kameraschwenks beim Klick

// Hintergrundfarben fuer die Beschriftung nach Kategorie (Aufbaumodus-Hervorhebung).
const LABEL_BG = {
  tube75: "rgba(139,61,245,0.94)",  // 75er Rohre - violett
  flaeche: "rgba(20,160,110,0.95)", // Flaechenkupplungen - gruen
  raum: "rgba(26,140,255,0.95)",    // Raumkupplungen - blau
};

export class SceneManager {
  constructor(container) {
    this.container = container;

    // Nur zeichnen, wenn sich wirklich etwas geaendert hat (siehe requestRender).
    this._needsRender = true;
    this._quality = DEFAULT_QUALITY;
    this._makeRenderer(QUALITY[DEFAULT_QUALITY].antialias);
    this.onRendererReplaced = () => {};   // Builder haengt seine Listener neu ein

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xeef1f5);

    // Beide Kameras stehen bereit; umgeschaltet wird ueber setProjection().
    // Die orthografische zeigt keine Fluchtpunkte -- parallele Rohre bleiben
    // parallel, Masse sind vergleichbar (Bauplan-Blick).
    this._perspCam = new THREE.PerspectiveCamera(
      55, container.clientWidth / container.clientHeight, 1, 100000
    );
    this._orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -100000, 100000);
    this.camera = this._perspCam;
    this._projection = "perspective";
    this._defaultCam = { pos: [140, 120, 180], target: [0, 30, 0] };
    this.resetCamera();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    // Scrollrad zoomt auf den Mauszeiger statt auf die Bildmitte -- man haelt
    // damit die Stelle im Blick, an der man gerade baut.
    this.controls.zoomToCursor = true;
    // Drehen macht der Builder selbst (um den Punkt unter dem Zeiger), deshalb
    // bekommt OrbitControls die linke Taste gar nicht erst.
    this.controls.mouseButtons.LEFT = null;
    this.onCameraChange = () => {};   // von der UI zum Sichern ueberschrieben
    this.controls.addEventListener("end", () => {
      // Nach Zoomen/Schieben den Bezugspunkt nachfuehren (siehe _reanchorTarget).
      if (!this.orbiting) this._reanchorTarget();
      this.onCameraChange();
    });
    this.controls.target.set(...this._defaultCam.target);

    // Licht: warmes Sonnenlicht + Himmelslicht + weiche Schatten
    this._hemiLight = new THREE.HemisphereLight(0xffffff, 0x8090a0, 1.4); // Normal-Modus-Startwert
    this.scene.add(this._hemiLight);
    this._dirLight = new THREE.DirectionalLight(0xfff8e7, 1.3);
    this._dirLight.position.set(200, 320, 150);
    this._dirLight.castShadow = true;
    this._dirLight.shadow.mapSize.width  = 2048;
    this._dirLight.shadow.mapSize.height = 2048;
    this._dirLight.shadow.camera.left   = -480;
    this._dirLight.shadow.camera.right  =  480;
    this._dirLight.shadow.camera.top    =  480;
    this._dirLight.shadow.camera.bottom = -480;
    this._dirLight.shadow.camera.near   =   1;
    this._dirLight.shadow.camera.far    =  800;
    this._dirLight.shadow.bias          = -0.0005;
    this._dirLight.shadow.radius        =   3;
    this.scene.add(this._dirLight);
    // Schattenaufloesung richtet sich nach der Qualitaetsstufe.
    this._applyShadowQuality();

    // Boden-Raster (20 cm Zellen)
    const grid = new THREE.GridHelper(800, 40, 0xb8c0cc, 0xd6dce4);
    grid.position.y = 0;
    this.scene.add(grid);
    this._grid = grid;

    // Prozedurales Gras + gruener Boden (umschaltbar via setScene()).
    this._buildGrass();
    this._buildSky();
    this._buildTrees();

    // Gruppen
    this.buildGroup = new THREE.Group();
    this.handleGroup = new THREE.Group();
    this.labelGroup = new THREE.Group();
    this.scene.add(this.buildGroup);
    this.scene.add(this.handleGroup);
    this.scene.add(this.labelGroup);

    // Pick-Listen
    this.pickNodes = [];
    this.pickTubes = [];
    this.pickPanels = [];
    this.pickClamps = [];
    this.pickTextiles = [];
    this.pickSlides = [];
    this.pickFittings = [];
    this.handleMeshes = [];
    this.labelMeshes = [];

    // Wiederverwendbare Ressourcen
    this._raycaster = new THREE.Raycaster();
    this._mouse = new THREE.Vector2();
    this._hover = null;

    this._connGeo = null;     // lazy (braucht Katalog-Geometrie)
    this._clampGeo = null;    // lazy (Klemmen-Ring)
    this._clampRingGeo = null; // lazy (ein Ring der "8")
    this._c45Geo = null;      // lazy (45-Grad-Adapter-Koerper, Box)
    this._c45StubGeo = null;  // lazy (Diagonal-Stutzen des Adapters)
    this._panelGeos = new Map(); // lazy, pro Plattenmass/Lochbild (siehe _panelGeometry)
    this._tubeGeos = new Map();  // lazy, pro Rohrlaenge (siehe _tubeGeometry)
    // Alle dauerhaft gecachten Geometrien. _disposeGroup darf sie nicht
    // freigeben -- frueher war das ein Array, das pro Aufruf neu gebaut und je
    // Mesh linear durchsucht wurde.
    this._keepGeos = new Set();
    this._materials = {};
    // Sammelbecken fuer instanziert gezeichnete Teile (siehe _batchAdd).
    this._batches = new Map();
    // Weltpositionen der gezeichneten Kupplungen (Drehpunkt-Suche).
    this._nodePoints = [];

    window.addEventListener("resize", () => this.onResize());
    // Container-Größe verfolgen: Layout der Sidebar steht beim Konstruieren
    // evtl. noch nicht final -> sonst überlappen Canvas und Panel bis zum
    // ersten Resize. ResizeObserver gleicht das automatisch ab.
    if (typeof ResizeObserver !== "undefined") {
      this._resizeObserver = new ResizeObserver(() => this.onResize());
      this._resizeObserver.observe(container);
    }
    this._buildViewCube();
    this._animate = this._animate.bind(this);
    this._animate();
  }

  resetCamera() {
    this._needsRender = true;
    this.camera.position.set(...this._defaultCam.pos);
    this.camera.lookAt(...this._defaultCam.target);
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
    if (this.controls) {
      this.controls.target.set(...this._defaultCam.target);
      this.controls.update();
    }
    this._updateOrthoFrustum();
  }

  /** Aktive Projektion: "perspective" | "orthographic". */
  get projection() { return this._projection; }

  /**
   * Projektion umschalten. Standort, Blickrichtung und der sichtbare Ausschnitt
   * werden uebernommen: die Bildhoehe der orthografischen Kamera ergibt sich aus
   * Abstand und Oeffnungswinkel der perspektivischen, sonst springt das Bild.
   */
  setProjection(mode) {
    if (mode !== "perspective" && mode !== "orthographic") return false;
    if (mode === this._projection) return false;
    const from = this.camera;
    const to = mode === "orthographic" ? this._orthoCam : this._perspCam;
    const target = this.controls ? this.controls.target : new THREE.Vector3(...this._defaultCam.target);
    to.position.copy(from.position);
    to.quaternion.copy(from.quaternion);
    // Zurueck zur Perspektive: der orthografische Zoom steckt in camera.zoom,
    // die Perspektive kennt das nicht -- also in einen Abstand umrechnen, sonst
    // springt die Bildgroesse.
    if (mode === "perspective" && from.zoom !== 1) {
      const dir = new THREE.Vector3().subVectors(from.position, target);
      dir.setLength(dir.length() / from.zoom);
      to.position.copy(target).add(dir);
    }
    to.zoom = 1;
    to.updateProjectionMatrix();
    this._projection = mode;
    this.camera = to;
    this._needsRender = true;
    this._updateOrthoFrustum();
    if (this.controls) {
      this.controls.object = to;
      this.controls.update();
    }
    return true;
  }

  // Bildausschnitt der orthografischen Kamera aus Abstand zum Ziel und dem
  // Oeffnungswinkel der perspektivischen ableiten -- so deckt sie beim
  // Umschalten denselben Bereich ab.
  _updateOrthoFrustum() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    const target = this.controls ? this.controls.target : new THREE.Vector3(...this._defaultCam.target);
    const dist = this.camera.position.distanceTo(target) || 1;
    const height = 2 * dist * Math.tan((this._perspCam.fov / 2) * (Math.PI / 180));
    const width = height * (w / h);
    const o = this._orthoCam;
    o.left = -width / 2; o.right = width / 2;
    o.top = height / 2; o.bottom = -height / 2;
    o.updateProjectionMatrix();
    // Der kleinste Zoomfaktor haengt an der Bildhoehe -- die hat sich hier
    // gerade geaendert.
    this._applyZoomLimits();
  }

  /**
   * Grenze fuers Herauszoomen setzen. Mit model wird sie aus dessen Groesse neu
   * berechnet, ohne Argument nur erneut angewendet (Fenstergroesse, Projektion).
   *
   * Perspektivisch begrenzt OrbitControls den Abstand zum Ziel, orthografisch
   * dagegen camera.zoom -- dort bleibt die Kamera stehen und nur der Aus-
   * schnitt waechst. Deshalb dieselbe Grenze zusaetzlich als Zoomfaktor.
   */
  _applyZoomLimits(model) {
    if (model !== undefined) {
      const b = model && model.bounds ? model.bounds(0) : null;
      const diag = b ? Math.hypot(b.size[0], b.size[1], b.size[2]) : 0;
      this._maxDistance = Math.max(MIN_ZOOM_OUT_DISTANCE, diag * ZOOM_OUT_FACTOR);
    }
    const maxDist = this._maxDistance || MIN_ZOOM_OUT_DISTANCE;
    if (!this.controls) return;
    this.controls.maxDistance = maxDist;
    const o = this._orthoCam;
    const maxHeight = 2 * maxDist * Math.tan((this._perspCam.fov / 2) * (Math.PI / 180));
    const minZoom = maxHeight > 0 ? (o.top - o.bottom) / maxHeight : 0;
    this.controls.minZoom = minZoom;

    // Steht die Kamera schon zu weit draussen (kleineres Modell geladen), sie
    // gleich heranholen. OrbitControls klemmt sonst erst beim naechsten Zug.
    const t = this.controls.target;
    if (this._projection === "orthographic") {
      if (this.camera.zoom < minZoom) {
        this.camera.zoom = minZoom;
        this.camera.updateProjectionMatrix();
        this._needsRender = true;
      }
    } else {
      const d = this.camera.position.distanceTo(t);
      if (d > maxDist) {
        this.camera.position.copy(t)
          .addScaledVector(this.camera.position.clone().sub(t).normalize(), maxDist);
        this._needsRender = true;
      }
    }
  }

  onResize() {
    this._needsRender = true;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    // Unveraenderte Groesse ignorieren: sonst kann der ResizeObserver sich
    // ueber setSize() selbst erneut ausloesen (Endlosschleife).
    if (w === this._lastW && h === this._lastH) return;
    this._lastW = w;
    this._lastH = h;
    this._perspCam.aspect = w / h;
    this._perspCam.updateProjectionMatrix();
    this._updateOrthoFrustum();
    // updateStyle = false -> Three schreibt KEINE festen px-Werte in den
    // Canvas-Style. Sonst wird der Canvas breiter als sein Container, das
    // Dokument bekommt eine Scrollbar, der Container schrumpft um deren
    // Breite, der Observer feuert erneut -> Viewport flackert dauerhaft.
    this.renderer.setSize(w, h, false);
  }

  // Auf die nächste Achse gerundete horizontale Blickrichtung (für Pfeiltasten).
  /**
   * Schaut die Kamera eher flach von der Seite auf das Modell (frontal) oder
   * von oben herab? Ab 45 Grad Neigung gilt der Blick als Aufsicht. Die
   * Pfeiltasten richten sich danach: frontal zeigt "hoch" nach oben, in der
   * Aufsicht nach hinten -- also immer dorthin, wo es auf dem Bildschirm
   * tatsaechlich hingeht.
   */
  isFrontalView() {
    const f = new THREE.Vector3();
    this.camera.getWorldDirection(f);
    return Math.abs(f.y) < Math.SQRT1_2;
  }

  /** Standort der Kamera in Weltkoordinaten -- von wo aus wird gebaut? */
  cameraPosition() {
    const p = this.camera.position;
    return [p.x, p.y, p.z];
  }

  getHorizontalAxes() {
    const f = new THREE.Vector3();
    this.camera.getWorldDirection(f);
    f.y = 0;
    if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
    f.normalize();
    const forward = Math.abs(f.x) >= Math.abs(f.z)
      ? [Math.sign(f.x) || 1, 0, 0]
      : [0, 0, Math.sign(f.z) || 1];
    const right = [-forward[2], 0, forward[0]];
    return { forward, right };
  }

  /**
   * Die beiden Achsen, in denen sich mit der Maus schieben laesst. Sie folgen
   * dem Blickwinkel wie die Pfeiltasten: frontal die Waagerechte quer zum Blick
   * und die Senkrechte, aus der Aufsicht die beiden Waagerechten. Fuer die
   * dritte Achse dreht man die Ansicht.
   */
  dragAxes() {
    const ax = this.getHorizontalAxes();
    return this.isFrontalView() ? { u: ax.right, v: [0, 1, 0] } : { u: ax.right, v: ax.forward };
  }

  /**
   * Weltpunkt unter dem Zeiger auf der Schiebe-Ebene durch origin. Die Ebene
   * steht senkrecht auf der Achse, in der NICHT geschoben wird (siehe
   * dragAxes), damit die Bewegung der Maus folgt.
   */
  dragPlanePoint(clientX, clientY, origin) {
    this._setMouse(clientX, clientY);
    const ax = this.getHorizontalAxes();
    const n = this.isFrontalView()
      ? new THREE.Vector3(ax.forward[0], ax.forward[1], ax.forward[2])
      : new THREE.Vector3(0, 1, 0);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, origin);
    const p = new THREE.Vector3();
    return this._raycaster.ray.intersectPlane(plane, p) ? p : null;
  }

  /** Mauszeiger-Form setzen (Builder signalisiert damit "verschiebbar"). */
  setCursor(css) {
    this.container.style.cursor = css || "default";
  }

  // Abgerundeter Wuerfel (Superellipsoid): eine Kugel wird per p-Norm zum
  // Wuerfel mit weichen Kanten gezogen -- groesseres n = kantiger, n = 2 waere
  // wieder die Kugel. Das trifft die echte QUADRO-Kupplung deutlich besser als
  // ein scharfkantiger Wuerfel und braucht keine zusaetzliche Geometrie-Klasse.
  // Die Flanken liegen bei size/2 (2,5 cm) und schliessen damit buendig mit dem
  // Rohr ab (tubeRadius 2,45 cm).
  _roundedBoxGeometry(size, n = CONNECTOR_ROUNDNESS, segW = 16, segH = 10) {
    const half = size / 2;
    const geo = new THREE.SphereGeometry(half, segW, segH);
    const pos = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).divideScalar(half);   // auf die Einheitskugel
      const s = Math.abs(v.x) ** n + Math.abs(v.y) ** n + Math.abs(v.z) ** n;
      v.multiplyScalar(half * s ** (-1 / n));
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * Renderer anlegen bzw. ersetzen. Antialiasing laesst sich an einem
   * bestehenden WebGLRenderer nicht umschalten -- dafuer muss ein neuer her.
   */
  _makeRenderer(antialias) {
    const old = this.renderer;
    this.renderer = new THREE.WebGLRenderer({ antialias: !!antialias });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    // updateStyle = false: die CSS-Groesse des Canvas kommt aus dem Stylesheet
    // (100 % des Containers), nicht als feste px-Werte -> siehe onResize().
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight, false);
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Die Schattenkarte wird NICHT pro Bild neu gerechnet: das waere ein zweiter
    // Durchgang ueber alle ~1850 Werfer, obwohl sich Licht und Modell selten
    // aendern. _shadowsDirty() stoesst sie gezielt an (Modell, Szene, Schnitt).
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.shadowMap.enabled = QUALITY[this._quality].shadow > 0;
    if (this._clipPlane) this.renderer.clippingPlanes = [this._clipPlane];
    if (old) {
      old.dispose();
      old.domElement.remove();
    }
    this.container.appendChild(this.renderer.domElement);
    this._needsRender = true;
  }

  /** Schattenaufloesung der Stufe anwenden (0 = Schatten aus). */
  _applyShadowQuality() {
    const size = QUALITY[this._quality].shadow;
    this.renderer.shadowMap.enabled = size > 0;
    if (size > 0 && this._dirLight) {
      const sh = this._dirLight.shadow;
      if (sh.mapSize.width !== size) {
        sh.mapSize.set(size, size);
        if (sh.map) { sh.map.dispose(); sh.map = null; }
      }
    }
    this._shadowsDirty();
  }

  /** Aktuelle Qualitaetsstufe (Aufloesung der Geometrien). */
  get quality() { return this._quality; }

  /**
   * Qualitaetsstufe setzen. Wirft die davon abhaengigen Geometrie-Caches weg;
   * der Aufrufer muss anschliessend neu rendern (builder.refresh()), sonst
   * zeigen die vorhandenen Meshes noch die alte Aufloesung.
   */
  setQuality(level) {
    if (!QUALITY[level] || level === this._quality) return false;
    const prev = this._quality;
    this._quality = level;
    this._shadowsDirty();
    for (const key of ["_connGeo", "_c45Geo", "_c45StubGeo", "_clampGeo", "_clampRingGeo"]) {
      if (this[key]) { this._keepGeos.delete(this[key]); this[key].dispose(); }
      this[key] = null;
    }
    // Rohr-, Deckel- und Plattengeometrien haengen an der Stufe -> Cache leeren.
    for (const g of this._tubeGeos.values()) { this._keepGeos.delete(g); g.dispose(); }
    this._tubeGeos.clear();
    for (const g of this._panelGeos.values()) { this._keepGeos.delete(g); g.dispose(); }
    this._panelGeos.clear();
    if (this._capGeos) {
      for (const g of this._capGeos.values()) { this._keepGeos.delete(g); g.dispose(); }
      this._capGeos.clear();
    }
    this._applyShadowQuality();
    // Kantenglaettung nur ueber einen neuen Renderer moeglich. Danach haengen
    // OrbitControls und die Zeiger-Listener am alten Canvas -> neu binden.
    if (QUALITY[level].antialias !== QUALITY[prev].antialias) this._replaceRenderer();
    return true;
  }

  _q() { return QUALITY[this._quality] || QUALITY[DEFAULT_QUALITY]; }

  /**
   * Renderer austauschen und alles neu verbinden, was am Canvas haengt:
   * OrbitControls (Ziel/Position bleiben erhalten) und die Zeiger-Listener des
   * Builders ueber onRendererReplaced.
   */
  _replaceRenderer() {
    const pos = this.camera.position.clone();
    const target = this.controls.target.clone();
    const zoom = this.camera.zoom;
    this.controls.dispose();
    this._makeRenderer(QUALITY[this._quality].antialias);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.zoomToCursor = true;
    this.controls.mouseButtons.LEFT = null;   // Drehen macht der Builder selbst
    this.controls.addEventListener("end", () => {
      if (!this.orbiting) this._reanchorTarget();
      this.onCameraChange();
    });
    this.camera.position.copy(pos);
    this.camera.zoom = zoom;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(target);
    this.controls.update();
    this.onRendererReplaced();
  }

  // Rohr-Geometrie, gecacht je Laenge/Radius/Segmentzahl. Vorher entstand pro
  // Rohr und pro Render-Durchlauf eine neue CylinderGeometry (~425 Stueck), die
  // beim naechsten Durchlauf wieder weggeworfen wurde.
  _tubeGeometry(radius, length, segments) {
    const key = `${radius.toFixed(2)}:${length.toFixed(2)}:${segments}`;
    let geo = this._tubeGeos.get(key);
    if (!geo) {
      geo = new THREE.CylinderGeometry(radius, radius, length, segments);
      this._tubeGeos.set(key, geo);
      this._keepGeos.add(geo);
    }
    return geo;
  }

  // Abschluss-Scheibe fuer die Enden eines Bogenrohrs, gecacht wie die
  // Rohr-Geometrien. Liegt in der XY-Ebene, Normale +Z.
  _capGeometry(radius, segments) {
    if (!this._capGeos) this._capGeos = new Map();
    const key = `${radius.toFixed(2)}:${segments}`;
    let geo = this._capGeos.get(key);
    if (!geo) {
      geo = new THREE.CircleGeometry(radius, segments);
      this._capGeos.set(key, geo);
      this._keepGeos.add(geo);
    }
    return geo;
  }

  _connGeometry() {
    if (!this._connGeo) {
      const s = geometry().connectorSize;
      const seg = this._q().conn;
      this._connGeo = seg ? this._roundedBoxGeometry(s, CONNECTOR_ROUNDNESS, seg[0], seg[1])
        : new THREE.BoxGeometry(s, s, s);
    }
    return this._connGeo;
  }

  // Geometrie fuer eine Klemme/Doppelrohrverbinder: kurzer dicker Ring.
  _clampGeometry() {
    if (!this._clampGeo) {
      const r = geometry().tubeRadius;
      this._clampGeo = new THREE.TorusGeometry(r * 1.7, r * 0.7, 10, 18);
    }
    return this._clampGeo;
  }

  // Ein Ring der "8": Loch genau so gross, dass eine Tube hindurchpasst.
  // Zwei davon nebeneinander ergeben den Doppelrohrverbinder.
  _clampRingGeometry() {
    if (!this._clampRingGeo) {
      const r = geometry().tubeRadius;
      this._clampRingGeo = new THREE.TorusGeometry(r + 0.45, 0.5, 10, 22);
    }
    return this._clampRingGeo;
  }

  // Platten-Geometrie, gecacht pro Mass + Lochbild. Volle Platten sind eine
  // flache Box; Lochplatten (Katalog-Feld "holes") werden als Rechteck-Shape
  // mit ausgestanzten Kreisen extrudiert.
  // Wichtig: Der Cache muss in _disposeGroup ausgenommen werden, sonst gibt der
  // naechste Render-Durchlauf die noch benutzte Geometrie frei.
  // Zwischen zwei Platten bleibt ein schmaler Spalt, damit die Rohre darunter
  // sichtbar und anklickbar bleiben -- Kante an Kante verdeckt das Geruest.
  _panelGeometry(panelId, wSpan, dSpan, thickness) {
    const w = Math.max(1, wSpan - PANEL_GAP);
    const d = Math.max(1, dSpan - PANEL_GAP);
    const def = getPanel(panelId);
    const holes = (def && def.holes) || 0;
    const seg = this._q().notch;
    const key = `${holes}:${seg}:${w.toFixed(2)}x${d.toFixed(2)}x${thickness}`;
    const hit = this._panelGeos.get(key);
    if (hit) return hit;

    // Die Ecken sind ausgespart: dort sitzt die Kupplung. Der Wuerfel misst
    // connectorSize und steht mit seiner halben Kantenlaenge um den Knoten --
    // genau so gross ist die quadratische Aussparung. Bei sehr kleinen Platten
    // gedeckelt, damit nicht mehr Ecke fehlt als Platte bleibt.
    const notch = Math.min((geometry().connectorSize || 5) / 2, Math.min(w, d) / 4);
    const x0 = -w / 2, x1 = w / 2, y0 = -d / 2, y1 = d / 2;
    // Die Aussparung ist ein Viertelkreis um den Eckpunkt. Der Umriss laeuft
    // gegen den Uhrzeigersinn, die Boegen dagegen -- so schneiden sie in die
    // Platte hinein, statt sie abzurunden. Auf der Stufe "low" wird der Bogen
    // zum rechten Winkel; dort sind auch die Kupplungen kantig.
    const HALF = Math.PI / 2;
    const shape = new THREE.Shape();
    const corner = (cx, cy, from) => {
      if (seg > 0) { shape.absarc(cx, cy, notch, from, from - HALF, true); return; }
      const at = (a) => [cx + Math.cos(a) * notch, cy + Math.sin(a) * notch];
      const [sx, sy] = at(from), [ex, ey] = at(from - HALF);
      shape.lineTo(sx + (ex - cx), sy + (ey - cy));   // innere Ecke des Quadrats
      shape.lineTo(ex, ey);
    };
    shape.moveTo(x0 + notch, y0);
    shape.lineTo(x1 - notch, y0);
    corner(x1, y0, Math.PI);
    shape.lineTo(x1, y1 - notch);
    corner(x1, y1, -HALF);
    shape.lineTo(x0 + notch, y1);
    corner(x0, y1, 0);
    shape.lineTo(x0, y0 + notch);
    corner(x0, y0, HALF);
    shape.closePath();
    if (holes === 9) {
      const r = Math.min(w, d) * 0.105;   // Lochradius ~4 cm im 40er-Feld
      const off = Math.min(w, d) * 0.29;  // Mitte der aeusseren Lochreihen
      for (const gx of [-off, 0, off])
        for (const gy of [-off, 0, off])
          shape.holes.push(new THREE.Path().absarc(gx, gy, r, 0, Math.PI * 2, true));
    }
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: thickness, bevelEnabled: false, curveSegments: Math.max(seg, 6),
    });
    // Shape liegt in XY und wird nach +Z extrudiert. Die Drehung um -90 Grad
    // um X bringt das in die Box-Orientierung (x = u, y = Dicke, z = w);
    // danach mittig um die Plattenebene zentrieren.
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, -thickness / 2, 0);
    geo.computeVertexNormals();
    this._panelGeos.set(key, geo);
    this._keepGeos.add(geo);
    return geo;
  }

  /**
   * Vorschlags-Variante eines beliebigen Bauteil-Materials: orange, sonst
   * unveraendert. Geklont statt ersetzt -- das feste Vorschlags-Material ist
   * einseitig, und eine Rutsche (U-Rinne, DoubleSide) verlor damit ihre
   * Innenflaechen und sah aus wie ein Balken.
   */
  _suggestMaterial(base) {
    const key = "sug:" + base.uuid;
    if (!this._materials[key]) {
      const m = base.clone();
      m.color = new THREE.Color(0xff8c1a);
      if (m.emissive) m.emissive = new THREE.Color(0x5a3000);
      this._materials[key] = m;
    }
    return this._materials[key];
  }

  /**
   * Geometrie eines Anbauteils. Die Formen stammen aus den Bildschirmfotos der
   * Herstellersoftware; Lage und Ausrichtung aus den Entwurfsdateien. Die lokale
   * +X-Achse ist bei allen Teilen die Bezugsrichtung (Radachse, Rollenachse,
   * Flaechennormale) -- genau wie im QDF.
   */
  _fittingMeshes(f) {
    const q = f.quat && f.quat.length === 4
      ? new THREE.Quaternion(f.quat[0], f.quat[1], f.quat[2], f.quat[3]).normalize()
      : new THREE.Quaternion();
    const hex = f.color ? colorHex(f.color) : 0x2b2b2b;
    let geo = null, mat = null;
    const cs = geometry().connectorSize;

    switch (f.kind) {
      case "multi-wheel2": {            // Speichenrad: Scheibe mit Kranz
        geo = this._wheelGeometry(WHEEL_R, 2.4, true);
        mat = this._fittingMaterial(hex, false);
        break;
      }
      case "floating-wheel2": {         // Schwimmrad, knapp 15 cm dick
        // Es gibt es in mehreren Farben -- gesetzte Raeder tragen die Baufarbe,
        // importierte ohne Farbangabe bleiben grau.
        geo = this._wheelGeometry(WHEEL_R, 14, false);
        mat = this._fittingMaterial(f.color ? hex : 0x8f9296, false);
        break;
      }
      case "hub-cap2": {                // Radkappe: haelt das Schwimmrad fest
        // Gleiche Aufgabe wie die Radarretierung, nur groesser und gewoelbt --
        // und weiter aussen, weil das Schwimmrad 14 cm dick ist. Sie steht wie
        // die Arretierung 1 cm ueber die Aussenflaeche des Rades hinaus.
        // Sie sitzt auf der einarmigen Kupplung am Rohrende und greift von dort
        // nach INNEN ueber die Aussenflaeche des Schwimmrads -- deshalb liegt
        // ihr Koerper vor dem Ankerpunkt, nicht dahinter.
        geo = this._cachedGeo("hubcap", () => {
          const g = new THREE.CylinderGeometry(5.5, 7, 5, Math.max(16, this._q().tube * 2));
          g.rotateZ(-Math.PI / 2);          // Achse auf +X, schmale Seite aussen
          g.translate(-2.5, 0, 0);
          return g;
        });
        mat = this._fittingMaterial(0xd42e2e, false);
        break;
      }
      case "casters2": {                // Laufrolle: Gabel mit Raedchen am Ende
        // Wie bei allen Anbauteilen ist die lokale +X-Achse die Bezugsrichtung:
        // dorthin zeigt die Gabel. In den Entwurfsdateien steht dort immer
        // (0,-1,0) -- die Rolle haengt also nach unten.
        const dark = this._fittingMaterial(0x1c1c1c, false);
        const fork = new THREE.Mesh(this._cachedGeo("casterFork", () => {
          const g = new THREE.BoxGeometry(5, 4.5, 3);
          g.translate(2.5, 0, 0);
          return g;
        }), dark);
        const roll = new THREE.Mesh(this._cachedGeo("casterRoll", () => {
          const g = new THREE.CylinderGeometry(3.2, 3.2, 2.2, Math.max(10, this._q().tube));
          g.translate(6.5, 0, 0);
          return g;
        }), dark);
        return [fork, roll].map((m) => this._placeFitting(m, f, q));
      }
      case "bearing2": {                // Radlager: schwarzes 5-cm-Rohrstueck
        // Es steckt auf einem Stutzen der Kupplung und traegt das Multirad an
        // seinem aeusseren Ende. Laenge 5 cm -- so steht es im Datensatz.
        // Es steckt auf dem STUTZEN der Kupplung und beginnt deshalb erst an
        // deren Wuerfelflaeche -- sonst laege es ueber dem Kern der Kupplung.
        const rb = geometry().tubeRadius;
        const start = geometry().connectorSize / 2;
        geo = this._cachedGeo("bearingstub", () => {
          const g = new THREE.CylinderGeometry(rb, rb, 5, Math.max(10, this._q().tube));
          g.rotateZ(Math.PI / 2);
          g.translate(start + 2.5, 0, 0);
          return g;
        });
        mat = this._fittingMaterial(0x1c1c1c, false);
        break;
      }
      case "adapter2": {                // Topf, der ueber den Stutzen der Kupplung greift
        const r = geometry().tubeRadius * 1.3;
        geo = this._cachedGeo("fitcup", () => {
          const g = new THREE.CylinderGeometry(r, r, cs * 1.2, Math.max(10, this._q().tube));
          g.rotateZ(Math.PI / 2);                 // Achse auf lokales +X
          g.translate(cs * 0.4, 0, 0);
          return g;
        });
        mat = this._fittingMaterial(0x2b2b2b, false);
        break;
      }
      case "steering-lock2": {          // Radarretierung: runde Scheibe in der Nabe
        // Sie liegt in derselben Ebene wie das Rad (Achse = lokales +X) und ist
        // immer rot -- unabhaengig von der Baufarbe.
        geo = this._cachedGeo("wheellock", () => {
          const g = new THREE.CylinderGeometry(6, 6, 2.4, Math.max(16, this._q().tube * 2));
          g.rotateZ(Math.PI / 2);
          // Sie steht 1 cm ueber die Aussenflaeche des Rades hinaus (Rad 2,4 cm
          // dick, beide um denselben Punkt): 1,2 + 1 - 1,2 = 1 cm Versatz nach
          // aussen, also entlang der eigenen +X-Achse.
          g.translate(1, 0, 0);
          return g;
        });
        mat = this._fittingMaterial(0xd42e2e, false);
        break;
      }
      case "open-connector2": {         // Offenes Ende: runde Kappe auf dem Rohr
        // Sie verschliesst das Rohrende, ist also nur so dick wie noetig und hat
        // den Durchmesser des Rohrs. Sie sitzt auf der Schnittflaeche des Rohrs,
        // eine halbe Kupplungslaenge vor dem Knoten.
        const rc = geometry().tubeRadius;
        geo = this._cachedGeo("endcap", () => {
          const g = new THREE.CylinderGeometry(rc, rc, 1, Math.max(12, this._q().tube));
          g.rotateZ(Math.PI / 2);
          g.translate(-cs / 2 + 0.5, 0, 0);
          return g;
        });
        mat = this._fittingMaterial(0x2b2b2b, false);
        break;
      }
      case "hole-connector4": {         // Kupplungsnahes Teil: Wuerfel in Teilegroesse
        const sz = cs * 0.9;
        geo = this._cachedGeo("fitbox" + sz.toFixed(2), () => new THREE.BoxGeometry(sz, sz, sz));
        mat = this._fittingMaterial(0x2b2b2b, false);
        break;
      }
      case "lattice2": {                // Gitter: Rechteck in der lokalen XY-Ebene
        // Gemessen an den Ball-Cage-Entwuerfen: das erste Mass (f.w) liegt auf
        // der lokalen Y-, das zweite (f.h) auf der lokalen X-Achse, die Flaeche
        // steht senkrecht auf der lokalen Z-Achse -- dieselbe Regel wie bei den
        // Platten. Ein 1550 x 775 grosses Gitter spannt damit genau zwischen den
        // beiden Rohrebenen, statt flach in der Gegend zu liegen.
        const w = f.w || 40, h = f.h || 40;
        geo = this._cachedGeo(`lattice${w}x${h}`, () => this._latticeGeometry(h, w));
        mat = this._fittingMaterial(hex, false);
        break;
      }
      case "textil-round2": {           // Rundabdeckung: Viertelzylinder ueber einem Bogen
        // Die beiden Enden des Tuchs liegen 400 mm vom Punkt entfernt, in
        // lokaler +Y- und -X-Richtung (52 von 52 Vorkommen). Der Kruemmungs-
        // mittelpunkt ist die GEGENUEBERLIEGENDE Ecke, nicht der Punkt selbst:
        // nur so steht die Tangente am Fuss senkrecht (das Bogenrohr setzt den
        // Pfosten fort) und am Scheitel waagerecht. Das Tuch woelbt sich also
        // zum Punkt hin. Entlang der lokalen +Z-Achse laeuft es 800 mm weit.
        geo = this._cachedGeo("roundwall", () => {
          const g = new THREE.CylinderGeometry(ROUND_WALL_R, ROUND_WALL_R, ROUND_COVER_LEN,
            Math.max(12, this._q().tube * 2), 1, true, 0, Math.PI / 2);
          g.rotateX(Math.PI / 2);            // Achse von +Y auf +Z drehen
          g.translate(-ROUND_WALL_R, ROUND_WALL_R, ROUND_COVER_LEN / 2);
          return g;
        });
        mat = this._fittingMaterial(hex, true);
        break;
      }
      case "roof-large2": {             // grosses Dach: Giebel ueber dem First
        // Der Punkt liegt auf dem First, die lokale X-Achse laeuft am First
        // entlang. Von dort faellt eine Flaeche entlang +Z, die andere entlang
        // -Y ab (beide 45 Grad, deshalb stehen die Achsen senkrecht aufeinander).
        // Masse aus den neun Cover-Entwuerfen: First von -40 bis +120 cm, Traufe
        // 60 cm tiefer und 60 cm seitlich -> Schraege 60*sqrt(2).
        const slope = Math.SQRT2 * 60;
        return [
          this._cachedGeo("roofSlopeA", () => {
            const g = new THREE.BoxGeometry(160, 1.2, slope);
            g.translate(40, 0, slope / 2);
            return g;
          }),
          this._cachedGeo("roofSlopeB", () => {
            const g = new THREE.BoxGeometry(160, slope, 1.2);
            g.translate(40, -slope / 2, 0);
            return g;
          }),
        ].map((g) => this._placeFitting(new THREE.Mesh(g, this._fittingMaterial(hex, false)), f, q));
      }
      case "bag2": {
        geo = this._cachedGeo("bag", () => new THREE.SphereGeometry(12, 12, 8));
        mat = this._fittingMaterial(hex, false);
        break;
      }
      default:
        return [];
    }
    return [this._placeFitting(new THREE.Mesh(geo, mat), f, q)];
  }

  /** Anbauteil an seinen Platz drehen und setzen. */
  _placeFitting(mesh, f, q) {
    mesh.quaternion.copy(q);
    mesh.position.set(f.x, f.y, f.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  /**
   * Gitter als echtes Netz: schmale Baender in der lokalen XY-Ebene, aussen ein
   * Rahmen, innen ein Raster von rund 2,5 cm. Alles in EINER Geometrie (eine
   * Zeichnung), weil mergeGeometries nicht mitgeliefert ist. sx laeuft auf der
   * lokalen X-, sy auf der lokalen Y-Achse.
   */
  _latticeGeometry(sx, sy, bar = 0.5, step = 2.5) {
    const pos = [];
    // Ein Band als zwei Dreiecke, Ecken gegen den Uhrzeigersinn.
    const ribbon = (x0, y0, x1, y1) => {
      pos.push(x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y0, 0, x1, y1, 0, x0, y1, 0);
    };
    const hx = sx / 2, hy = sy / 2, b = bar / 2;
    const lines = (span, make) => {
      const n = Math.max(1, Math.round(span / step));
      for (let i = 0; i <= n; i++) make(-span / 2 + (span * i) / n);
    };
    lines(sx, (x) => ribbon(Math.max(-hx, Math.min(hx - bar, x - b)),
      -hy, Math.max(-hx + bar, Math.min(hx, x + b)), hy));
    lines(sy, (y) => ribbon(-hx, Math.max(-hy, Math.min(hy - bar, y - b)),
      hx, Math.max(-hy + bar, Math.min(hy, y + b))));
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }

  /** Rad: Scheibe mit Kranz, wahlweise mit Speichenkerben. */
  _wheelGeometry(r, thickness, spokes) {
    return this._cachedGeo(`wheel${r}x${thickness}${spokes ? "s" : ""}`, () => {
      const seg = Math.max(12, this._q().tube);
      const g = new THREE.CylinderGeometry(r, r, thickness, seg);
      // Das Rad steht senkrecht auf seiner Achse: lokale +X ist die Achse.
      g.rotateZ(Math.PI / 2);
      return g;
    });
  }

  /** Geometrie einmal bauen und behalten (wie _tubeGeometry). */
  _cachedGeo(key, make) {
    if (!this._fitGeos) this._fitGeos = new Map();
    let g = this._fitGeos.get(key);
    if (!g) {
      g = make();
      this._fitGeos.set(key, g);
      this._keepGeos.add(g);
    }
    return g;
  }

  _fittingMaterial(hex, transparent) {
    const key = `fit${hex}${transparent ? "t" : ""}`;
    if (!this._materials[key]) {
      this._materials[key] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(hex), roughness: 0.55, metalness: 0.05,
        side: THREE.DoubleSide,
        transparent, opacity: transparent ? 0.55 : 1,
      });
    }
    return this._materials[key];
  }

  // Hervorhebungs-Variante eines beliebigen Bauteil-Materials: durchgehend lila.
  // Geklont statt neu gebaut, damit Eigenschaften wie DoubleSide oder
  // Transparenz (Platten, Netze) erhalten bleiben. Pro Basis-Material einmal
  // gecacht -- _disposeGroup gibt nur Geometrien frei.
  _selectedMaterial(base) {
    const key = "sel:" + base.uuid;
    if (!this._materials[key]) {
      const m = base.clone();
      m.color = new THREE.Color(HIGHLIGHT_COLOR);
      if (m.emissive) m.emissive = new THREE.Color(HIGHLIGHT_EMISSIVE);
      this._materials[key] = m;
    }
    return this._materials[key];
  }

  // Zurueckgetretene Variante eines Bauteil-Materials: gleiche Farbe, stark
  // durchscheinend. depthWrite aus, damit die hervorgehobenen Teile dahinter
  // nicht weggeschnitten werden.
  _dimmedMaterial(base) {
    const key = "dim:" + base.uuid;
    if (!this._materials[key]) {
      const m = base.clone();
      m.transparent = true;
      m.opacity = (base.opacity != null ? base.opacity : 1) * 0.25;
      m.depthWrite = false;
      this._materials[key] = m;
    }
    return this._materials[key];
  }

  _clampMaterial() {
    if (!this._materials["clamp"]) {
      this._materials["clamp"] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x33373d), roughness: 0.5, metalness: 0.4,
      });
    }
    return this._materials["clamp"];
  }

  // Aussenradius der beiden Schenkel der 45-Grad-Winkelkupplung. Das Teil ist
  // ein KNIEROHR: es schiebt sich ueber das gerade Rohr, und das Diagonalrohr
  // steckt im zweiten Schenkel -- beide Schenkel also etwas weiter als ein Rohr.
  _c45SocketR() {
    return geometry().tubeRadius * 1.18;
  }

  // Der Knick des Kniestuecks: Kugel im Schenkelradius. Zusammen mit den beiden
  // Zylindern ergibt das den runden Bogen des echten Teils (statt eines Wuerfels,
  // der aus dem Rohr herausstand).
  _c45Geometry() {
    if (!this._c45Geo) {
      const seg = Math.max(10, this._q().tube);
      this._c45Geo = new THREE.SphereGeometry(this._c45SocketR(), seg, Math.max(6, seg / 2));
    }
    return this._c45Geo;
  }

  // Diagonal-Schenkel des Kniestuecks (nimmt das Diagonalrohr auf).
  _c45StubGeometry() {
    if (!this._c45StubGeo) {
      const r = this._c45SocketR();
      const cs = geometry().connectorSize;
      this._c45StubGeo = new THREE.CylinderGeometry(r, r, cs * 0.9, 14);
    }
    return this._c45StubGeo;
  }

  _c45Material() {
    if (!this._materials["c45"]) {
      // Schwarz wie die normalen Kupplungen (Gregor: die C45 sind auch schwarz).
      this._materials["c45"] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(connectorColor().hex), roughness: 0.6, metalness: 0.1,
        emissive: new THREE.Color(0x000000),
      });
    }
    return this._materials["c45"];
  }

  // Rutschen-Material je Art, SOLIDE (Gregor): gerade Rutsche rot, Bogenrutsche
  // gruen, Auslauf gelb, Dach grau. Im Aufbau-Modus hervorgehoben.
  _slideMatFor(kind, isCurrent, colorId) {
    const COL = {
      "slide2": 0xd23b3b, "slide-new2": 0xd23b3b,  // gerade Rutsche = rot
      "curved-slide2": 0x37a23f,                    // Bogenrutsche = gruen
      "slide-end2": 0xf0c020,                       // Auslauf = gelb
      "roof2": 0x37a23f,                            // Dach-Tuch = gruen, durchsichtig
    };
    const transp = kind === "roof2"; // Dach-Tuch durchsichtig wie ein Textil (Gregor)
    // Im Editor gesetzte Rutschen tragen die gewaehlte Baufarbe; importierte
    // ohne Farbangabe behalten die feste Farbe ihrer Art.
    const hex = colorId ? colorHex(colorId) : (COL[kind] || 0x9aa3ad);
    const key = "slidem_" + kind + (colorId || "") + (isCurrent ? "_c" : "");
    if (!this._materials[key]) {
      this._materials[key] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(hex), roughness: transp ? 0.9 : 0.6, metalness: 0.05,
        side: THREE.DoubleSide,
        transparent: transp, opacity: transp ? 0.5 : 1,
        emissive: new THREE.Color(isCurrent ? 0x3a2400 : 0x000000),
      });
    }
    return this._materials[key];
  }

  // Gerenderte Mitte eines Rutschen-Endstuecks (mit den Viewer-Offsets), damit
  // die Bogenrutsche dort optisch ankommt (nicht an der rohen QDF-Position).
  _slideEndRenderedCenter(se) {
    const g = new THREE.Group();
    g.position.set(se.x, se.y, se.z);
    if (se.quat && se.quat.length === 4) {
      const Rz90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
      g.quaternion.set(se.quat[0], se.quat[1], se.quat[2], se.quat[3]).normalize().multiply(Rz90).normalize();
    }
    const size = 35, depth = 0.4;
    g.translateZ(-size * 0.75); g.translateX(depth * 2); g.translateY(size * 0.5); g.rotateY(Math.PI / 2);
    g.updateMatrixWorld(true);
    return new THREE.Vector3(0, -size / 2, depth / 2).applyMatrix4(g.matrixWorld);
  }

  // Anschlusspunkt Rutschenkoerper <-> Auslauf: etwas ueber der Endstueck-Mitte.
  // Der Rutschenkoerper (Bogen/gerade) ENDET hier, der Auslauf BEGINNT hier -> kein
  // Versatz, gleicher Punkt = sauberer Uebergang. Der Auslauf faellt von hier auf
  // Bodenhoehe ab und flacht aus.
  _slideEndConnectPoint(se) {
    // QDF-ROHposition (nicht die magisch versetzte Viewer-Mitte!) + 12 cm hoch.
    // So hat die Bogenrutsche zu IHREM Folgeteil immer denselben festen Versatz
    // -> sie sieht in jeder Datei gleich aus (C0065 = C0076).
    return new THREE.Vector3(se.x, se.y + 12, se.z);
  }

  // Legt einen Rutschenkoerper als EINE durchgehende U-Rinne (Boden + 2 hochgezogene
  // Seitenwangen, als zusammenhaengender Flaechenstreifen) entlang einer Bahn
  // bez(t)∈[0,1] an. Ersetzt die fruehere Kette einzelner Box-Segmente, deren Kanten
  // an den Uebergaengen sichtbare "Stufen"/Rippen erzeugten (Gregor: "die Übergänge
  // sind nicht schön", "die curved slide ist noch nicht schön"). Querschnitt je
  // Stuetzstelle: Wange-links-oben, Boden-links, Boden-rechts, Wange-rechts-oben.
  // Breitenachse W = T×up (faellt die Bahn, dreht sich die Rinne mit; ~senkrechte
  // Abschnitte behalten die vorige Achse -- kein Vorzeichen-Flip = kein Verdrehen).
  // startFrame={W,Nrm}: optional -- erzwingt den ERSTEN Querschnitt (z.B. exakt der
  // LETZTE Querschnitt des Vorgaengerteils), damit zwei Rutschenteile am gemeinsamen
  // Punkt OHNE Spalt/Knick im Querschnitt ineinander uebergehen ("Übergänge"-Fix).
  // Rueckgabe: {W,Nrm} des LETZTEN Querschnitts, fuer das naechste Teil der Kette.
  _addSlideAlongCurve(mat, st, id, bez, SEG, startFrame) {
    const halfW = 35 / 2, wallH = 11;
    const N = SEG + 1, eps = 0.5 / SEG;
    const verts = [];
    let prevW = startFrame ? startFrame.W.clone() : null;
    let lastW = prevW, lastNrm = startFrame ? startFrame.Nrm.clone() : null;
    for (let i = 0; i < N; i++) {
      const t = i / SEG;
      const c = bez(t);
      let W, Nrm;
      if (i === 0 && startFrame) {
        W = startFrame.W.clone(); Nrm = startFrame.Nrm.clone();
      } else {
        const t0 = Math.max(0, t - eps), t1 = Math.min(1, t + eps);
        const T = bez(t1).sub(bez(t0));
        if (T.lengthSq() < 1e-8) T.set(1, 0, 0); else T.normalize();
        W = new THREE.Vector3().crossVectors(T, UP);
        if (W.lengthSq() < 0.02) W = prevW ? prevW.clone() : new THREE.Vector3(1, 0, 0);
        W.normalize();
        if (prevW && W.dot(prevW) < 0) W.negate();
        Nrm = new THREE.Vector3().crossVectors(W, T).normalize();
      }
      prevW = W; lastW = W; lastNrm = Nrm;
      const fl = c.clone().addScaledVector(W, -halfW);
      const fr = c.clone().addScaledVector(W, halfW);
      verts.push(fl.clone().addScaledVector(Nrm, wallH), fl, fr, fr.clone().addScaledVector(Nrm, wallH));
    }
    const positions = [];
    for (const v of verts) positions.push(v.x, v.y, v.z);
    const idx = [];
    for (let i = 0; i < N - 1; i++) {
      const r0 = i * 4, r1 = r0 + 4;
      for (let k = 0; k < 3; k++) {
        idx.push(r0 + k, r1 + k, r0 + k + 1,  r0 + k + 1, r1 + k, r1 + k + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData = { kind: "slide", id };
    this.buildGroup.add(mesh);
    if (st !== "future") this.pickSlides.push(mesh);
    return { W: lastW.clone(), Nrm: lastNrm.clone() };
  }

  // FESTE Austrittsrichtung einer Bogenrutsche (identisch zur Berechnung in
  // _addCurvedSlide): nach der 90°-Drehung in der PERPENDIKULAEREN kardinalen
  // Richtung zum waagerechten Einlauf, ~33° abwaerts. Damit der Auslauf knickfrei
  // an die Bogenrutsche anschliesst.
  _curvedSlideExit(sl) {
    return CURVED_SLIDE_EXIT.clone().applyQuaternion(this._slideQuat(sl));
  }

  /** Eigenes Quaternion eines Rutschenteils (Three-Reihenfolge), sonst Einheit. */
  _slideQuat(sl) {
    return sl.quat && sl.quat.length === 4
      ? new THREE.Quaternion(sl.quat[0], sl.quat[1], sl.quat[2], sl.quat[3]).normalize()
      : new THREE.Quaternion();
  }

  // Bogenrutsche: gekrümmte Rutschflaeche, die KARDINAL+waagerecht am Anschluss
  // Bogenrutsche: gekruemmte Rutschflaeche, die waagerecht in der lokalen
  // +X-Richtung beginnt und nach einer 90-Grad-Drehung in der lokalen
  // +Z-Richtung abwaerts wieder herauskommt. Kubische Bézier P0 -> C1 -> C2 -> P3,
  // alle vier Punkte aus dem eigenen Quaternion des Teils.
  _addCurvedSlide(sl, model, mat, st) {
    const P0 = new THREE.Vector3(sl.x, sl.y, sl.z);
    const q = this._slideQuat(sl);
    // Die Bogenrutsche ist ein FESTES Teil: gemessen an allen zehn Vorkommen im
    // Bestand liegt das Folgeteil IMMER auf demselben lokalen Versatz
    // (600, -800, 600) mm. Losgelaufen wird im lokalen +Z (Laufrichtung jeder
    // Rutsche), gedreht wird auf das lokale +X; der Bogen macht also 90 Grad in
    // der Draufsicht und faellt dabei 80 cm. Frueher kam die Form aus der Lage
    // des naechsten Rutschenteils; das ging schief, sobald ein anderes Teil
    // naeher lag.
    // Kette: das naechste Rutschenteil setzt am Bogen an.
    let target = null, bestD = Infinity;
    for (const s2 of model.slides.values()) {
      if (s2.kind !== "slide2" && s2.kind !== "slide-new2" && s2.kind !== "slide-end2") continue;
      if (s2.y > sl.y - 1) continue; // nur tiefer liegende Teile
      const d = (s2.x - sl.x) ** 2 + (s2.y - sl.y) ** 2 + (s2.z - sl.z) ** 2;
      if (d < bestD) { bestD = d; target = s2; }
    }
    // Endpunkt: der Bogen hoert dort auf, wo das Folgeteil ANFAENGT. Das
    // Endstueck beginnt nicht auf seinem QDF-Punkt, sondern 12 cm darueber
    // (_slideEndConnectPoint) -- ohne das blieb eine Stufe zwischen beiden
    // Teilen. Sitzt das Folgeteil nicht dort, wo es laut Versatz sitzen muesste,
    // bleibt es beim festen Endpunkt (die Form kippt dann nicht weg).
    let P3 = CURVED_SLIDE_DROP.clone().applyQuaternion(q).add(P0);
    if (target) {
      const entry = target.kind === "slide-end2"
        ? this._slideEndConnectPoint(target)
        : new THREE.Vector3(target.x, target.y, target.z);
      if (entry.distanceTo(P3) < 40) P3 = entry;
    }
    const C1 = P0.clone().addScaledVector(CURVED_SLIDE_ENTRY.clone().applyQuaternion(q), 33);
    const exitDir = this._curvedSlideExit(sl);
    const C2 = P3.clone().addScaledVector(exitDir, -33);
    // ECHTE kubische Bézier (P0,C1,C2,P3) -- vorher war C2 unbenutzt (quadratisch),
    // dadurch hatte der Bogen keine eigene Austrittsrichtung am Ende (Knick/unschoen).
    const bez = (t) => {
      const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
      return new THREE.Vector3(
        a * P0.x + b * C1.x + c * C2.x + d * P3.x,
        a * P0.y + b * C1.y + c * C2.y + d * P3.y,
        a * P0.z + b * C1.z + c * C2.z + d * P3.z);
    };
    // Bananenfoermiger, durchgehend gebogener Rinnenkoerper entlang der Bézier.
    const hint = this._slideChainNextId === sl.id ? this._slideChainFrame : null;
    this._slideChainFrame = this._addSlideAlongCurve(mat, st, sl.id, bez, 24, hint);
    this._slideChainNextId = target ? target.id : null;
  }

  // Nicht-achsparallele Richtungen der Rohre an einem Knoten.
  // Achsparallel = eine Komponente >= 0.90, alle anderen klein.
  // Alles darunter (echte Diagonalen: 45°, oder leicht davon abweichend durch
  // Snap auf reale Kupplungspositionen) wird als Adapter-Richtung zurueckgegeben.
  _diagonalDirsAt(model, node) {
    const out = [];
    for (const t of model.tubes.values()) {
      let other = null;
      if (t.a === node.id) other = model.nodes.get(t.b);
      else if (t.b === node.id) other = model.nodes.get(t.a);
      if (!other) continue;
      const dx = other.x - node.x, dy = other.y - node.y, dz = other.z - node.z;
      const L = Math.hypot(dx, dy, dz) || 1;
      const d = [dx / L, dy / L, dz / L];
      // Achsparallele Rohre (groesste Komponente >= 0.90) brauchen keinen Adapter.
      const mx = Math.max(Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2]));
      if (mx < 0.90) out.push(d);
    }
    return out;
  }

  // Bestimmt die Achse, in die der c45-Adapter gesteckt wird:
  // die axiale Tube-Richtung an diesem Knoten mit dem groessten positiven
  // Skalarprodukt zur Diagonalrichtung.
  // Physikalisch: der Adapter sitzt auf dem Arm, der der Diagonale am
  // naechsten liegt (z.B. Arm nach oben fuer eine Diagonale oben-rechts).
  _c45ArmDirAt(model, node, diagDir) {
    let bestDot = -Infinity, bestAxis = null;
    for (const t of model.tubes.values()) {
      let other = null;
      if (t.a === node.id) other = model.nodes.get(t.b);
      else if (t.b === node.id) other = model.nodes.get(t.a);
      if (!other) continue;
      const dx = other.x - node.x, dy = other.y - node.y, dz = other.z - node.z;
      const L = Math.hypot(dx, dy, dz) || 1;
      const nx = dx / L, ny = dy / L, nz = dz / L;
      // Nur achsparallele Rohre: groesste Komponente >= 0.90
      if (Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nz)) < 0.90) continue;
      const dot = nx * diagDir[0] + ny * diagDir[1] + nz * diagDir[2];
      if (dot > bestDot) {
        bestDot = dot;
        if (Math.abs(nx) >= 0.90) bestAxis = new THREE.Vector3(Math.sign(nx), 0, 0);
        else if (Math.abs(ny) >= 0.90) bestAxis = new THREE.Vector3(0, Math.sign(ny), 0);
        else bestAxis = new THREE.Vector3(0, 0, Math.sign(nz));
      }
    }
    // Fallback falls kein axiales Rohr vorhanden: dominante Komponente der Diagonale
    if (!bestAxis || bestDot <= 0) {
      const ax = Math.abs(diagDir[0]), ay = Math.abs(diagDir[1]), az = Math.abs(diagDir[2]);
      if (ax >= ay && ax >= az) bestAxis = new THREE.Vector3(Math.sign(diagDir[0]), 0, 0);
      else if (ay >= ax && ay >= az) bestAxis = new THREE.Vector3(0, Math.sign(diagDir[1]), 0);
      else bestAxis = new THREE.Vector3(0, 0, Math.sign(diagDir[2]));
    }
    return bestAxis;
  }

  // Geometrie des importierten C45-Adapters. n ist der Adapter-Koerper am
  // Diagonal-Fuss. Liefert die Huelse (von der Basiskupplung G KARDINAL weg),
  // die Koerperposition (Knick) und den 45°-Arm (in die Tube). Die kardinale
  // Huelsenachse kommt aus n.c45axis (QDF); sonst wird sie aus der Geometrie
  // hergeleitet (jene aktive Diagonal-Achse, die einen positiven Armarm ergibt).
  _c45AdapterGeo(model, n) {
    let G = null, foot = null;
    for (const t of model.tubes.values()) {
      const other = t.a === n.id ? model.nodes.get(t.b) : t.b === n.id ? model.nodes.get(t.a) : null;
      if (!other) continue;
      if (t.arm) G = other; else if (!foot) foot = other;
    }
    if (!G || !foot) return null;
    const d = new THREE.Vector3(foot.x - n.x, foot.y - n.y, foot.z - n.z).normalize();
    const v = new THREE.Vector3(n.x - G.x, n.y - G.y, n.z - G.z); // Basis -> Fuss
    // 45°-Arm-Laenge a so waehlen, dass (Fuss - d*a) - G kardinal liegt (Huelse).
    const active = [];
    for (let k = 0; k < 3; k++) if (Math.abs(d.getComponent(k)) > 0.3) active.push(k);
    let a = 0;
    const ci = n.c45axis ? (Math.abs(n.c45axis[0]) > 0.5 ? 0 : Math.abs(n.c45axis[1]) > 0.5 ? 1 : 2) : -1;
    if (ci >= 0) {
      const m = active.find((k) => k !== ci);
      if (m != null) a = v.getComponent(m) / d.getComponent(m);
    }
    if (!(a > 0.01)) {
      for (const m of active) { const aa = v.getComponent(m) / d.getComponent(m); if (aa > 0.01) { a = aa; break; } }
    }
    const bodyPos = new THREE.Vector3(n.x - d.x * a, n.y - d.y * a, n.z - d.z * a);
    const sleeveVec = new THREE.Vector3().subVectors(bodyPos, G);
    const fullLen = sleeveVec.length();
    if (fullLen < 0.5) return null;
    const sleeveDir = sleeveVec.clone().normalize();
    const cs = geometry().connectorSize;
    const Gv = new THREE.Vector3(G.x, G.y, G.z);
    // Der ARM der Basiskupplung ragt vom Wuerfel nach aussen und STECKT in die
    // C45-Huelse (Gregor: "Der Arm der Kupplung ragt in die Huelse der C45 rein").
    // Die Huelse beginnt daher ~40% entlang des Arms (nicht am Wuerfel), der Arm
    // ueberlappt ihre Innenseite.
    const baseArmLen = Math.max(1.5, Math.min(cs, fullLen - cs / 2 - 1.5));
    // Die Huelse sitzt KOMPLETT ueber dem Arm und beginnt direkt an der Kupplung
    // (Wuerfelflaeche cs/2) (Gregor: "naeher heran, passt komplett auf den Arm").
    const sleeveOff = Math.max(0, cs / 2 - 0.5);
    const sleeveStart = Gv.clone().addScaledVector(sleeveDir, sleeveOff);
    const sleeveLen = bodyPos.distanceTo(sleeveStart);
    if (sleeveLen < 0.5) return null;
    return {
      bodyPos,
      sleeveDir,
      sleeveLen,
      sleeveMid: sleeveStart.clone().add(bodyPos).multiplyScalar(0.5),
      baseArmLen,
      baseArmMid: Gv.clone().addScaledVector(sleeveDir, cs / 2 + baseArmLen / 2),
      armDir: d,
      armLen: a,
      armMid: new THREE.Vector3((bodyPos.x + n.x) / 2, (bodyPos.y + n.y) / 2, (bodyPos.z + n.z) / 2),
    };
  }

  // Drehachse eines Schräg-Konnektors: hat der Knoten ein Diagonalrohr, liegt es
  // in einer Achsenebene; die Kupplung ist um 45° um die dazu senkrechte Achse
  // gedreht. Liefert diese Achse (THREE.Vector3) oder null (keine Schräge).
  _slopeRotationAxis(model, n) {
    if (n.c45 || n.c45body) return null;
    for (const t of model.tubes.values()) {
      if (t.arm || t.link) continue;
      const o = t.a === n.id ? model.nodes.get(t.b) : t.b === n.id ? model.nodes.get(t.a) : null;
      if (!o) continue;
      // Bogenrohr: die Tangente am Knoten zaehlt, nicht die Sehne. Die Sehne
      // eines Viertelkreises steht 45 Grad schief -- die Kupplung am freien
      // Bogenende wuerde sonst um 45 Grad verdreht gezeichnet.
      const v = t.bow && t.bowCenter
        ? [o.x - t.bowCenter[0], o.y - t.bowCenter[1], o.z - t.bowCenter[2]]
        : [o.x - n.x, o.y - n.y, o.z - n.z];
      const L = Math.hypot(...v) || 1, u = v.map((c) => c / L);
      if (Math.max(...u.map(Math.abs)) >= 0.99) continue; // kardinal
      const act = [0, 1, 2].filter((a) => Math.abs(u[a]) > 0.3);
      if (act.length !== 2) continue;
      const k = [0, 1, 2].find((a) => !act.includes(a));
      return new THREE.Vector3(k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0);
    }
    return null;
  }

  _tubeMaterial(colorId) {
    const key = "tube:" + colorId;
    if (!this._materials[key]) {
      this._materials[key] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(colorHex(colorId)),
        roughness: 0.55,
        metalness: 0.05,
      });
    }
    return this._materials[key];
  }

  // Platten (solide) und Textilien/Netze (halbtransparent) – je Katalogfarbe und
  // Aufbau-Status gecacht. Frueher wurde pro renderModel() ein neues Material je
  // Platte/Textil alloziert und nie freigegeben (-> GPU-Speicher-Leck), da
  // _disposeGroup nur Geometrien disposed. transparent steckt im Key, damit eine
  // Platte und ein Textil gleicher Farbe nicht kollidieren. "current" im
  // Aufbau-Modus orange hervorgehoben (emissive).
  _panelMaterial(colorId, isCurrent, transparent) {
    const key = "panel:" + colorId + (isCurrent ? ":c" : "") + (transparent ? ":t" : "");
    if (!this._materials[key]) {
      this._materials[key] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(colorHex(colorId)),
        roughness: transparent ? 0.95 : 0.7, metalness: transparent ? 0.0 : 0.05,
        side: THREE.DoubleSide,
        transparent: !!transparent, opacity: transparent ? 0.5 : 1,
        emissive: new THREE.Color(isCurrent ? 0x3a2400 : 0x000000),
      });
    }
    return this._materials[key];
  }

  // Bällebad-Wasser: semitransparentes Blau (wird über pool_floor-Panel gerendert).
  _waterMaterial() {
    if (!this._materials["water"]) {
      this._materials["water"] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x2879d0),
        roughness: 0.05, metalness: 0.1,
        transparent: true, opacity: 0.58,
        side: THREE.FrontSide,
      });
    }
    return this._materials["water"];
  }

  // Verstaerkungsprofil-Stab (Bauen-Modus): dunkles Alu-Metallic.
  _rodMaterial() {
    if (!this._materials["rod"]) {
      this._materials["rod"] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x7a8794), roughness: 0.3, metalness: 0.85,
      });
    }
    return this._materials["rod"];
  }

  // Material fuer vorgeschlagene Verstaerkungsrohre (Hinweis-Modus): orange.
  _tubeSuggest() {
    if (!this._materials["tubeSuggest"]) {
      this._materials["tubeSuggest"] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0xff8c1a), roughness: 0.4, metalness: 0.1,
        emissive: new THREE.Color(0x5a3000),
      });
    }
    return this._materials["tubeSuggest"];
  }

  // Reinforce-Modus: neutrale graue Rohre.
  _tubeGray() {
    if (!this._materials["tubeGray"]) {
      this._materials["tubeGray"] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0xa0aab5), roughness: 0.7, metalness: 0.05,
      });
    }
    return this._materials["tubeGray"];
  }

  // Kollisions-Modus: sich ueberlagernde Rohre leuchtend rot.
  _tubeCollision() {
    if (!this._materials["tubeCollision"]) {
      this._materials["tubeCollision"] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0xe0342b), roughness: 0.35, metalness: 0.1,
        emissive: new THREE.Color(0x5a0400),
      });
    }
    return this._materials["tubeCollision"];
  }

  // Reinforce-Modus: Rohre, die bereits verstärkt sind (blau-metallic).
  _tubeReinforceActive() {
    if (!this._materials["tubeReinforceActive"]) {
      this._materials["tubeReinforceActive"] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x1a8cff), roughness: 0.2, metalness: 0.8,
        emissive: new THREE.Color(0x00213a),
      });
    }
    return this._materials["tubeReinforceActive"];
  }

  _connMaterial(selected) {
    const key = selected ? "conn:sel" : "conn:base";
    if (!this._materials[key]) {
      this._materials[key] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(selected ? 0xff8c1a : connectorColor().hex),
        roughness: 0.6, metalness: 0.1,
        emissive: new THREE.Color(selected ? 0x612f00 : 0x000000),
      });
    }
    return this._materials[key];
  }

  // Halbtransparentes "Geist"-Material fuer noch nicht gebaute Teile (Aufbaumodus).
  // Bereits gebaute Teile im Aufbaumodus: blass und leicht durchscheinend, damit
  // die Teile des AKTUELLEN Schritts klar hervortreten.
  _fadedMaterial(hex) {
    const key = "faded_" + hex;
    if (!this._materials[key]) {
      const c = new THREE.Color(hex);
      c.lerp(new THREE.Color(0xffffff), 0.55);
      this._materials[key] = new THREE.MeshStandardMaterial({
        color: c, roughness: 0.85, metalness: 0.02,
        transparent: true, opacity: 0.45, depthWrite: false,
      });
    }
    return this._materials[key];
  }

  _ghostMaterial() {
    if (!this._materials["ghost"]) {
      this._materials["ghost"] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x9aa6b4), roughness: 0.9, metalness: 0,
        transparent: true, opacity: 0.14, depthWrite: false,
      });
    }
    return this._materials["ghost"];
  }

  /**
   * Klemm-Kupplung zeichnen: eine Huelse, die das Rohr umschliesst, und der
   * offene Anschluss quer dazu. Der Knoten selbst liegt an der Muendung, eine
   * Kupplungslaenge neben der Rohrachse -- dort beginnt das eingesteckte Rohr.
   */
  _addTubeClamp(model, n, mat, st) {
    const g = geometry();
    const cs = g.connectorSize;
    const stub = n.stub || [0, 1, 0];
    const off = clampOffset(n.part, cs);
    const axis = new THREE.Vector3(n.x - stub[0] * off, n.y - stub[1] * off, n.z - stub[2] * off);
    const tube = n.clampOn ? model.tubes.get(n.clampOn.tubeId) : null;
    // Ohne bekanntes Rohr (importierte Kupplungen sitzen manchmal frei) liegt
    // die Huelse quer zum Anschluss.
    let dir = new THREE.Vector3(Math.abs(stub[1]) > 0.5 ? 1 : 0, Math.abs(stub[1]) > 0.5 ? 0 : 1, 0);
    if (tube) {
      const a = model.nodes.get(tube.a), b = model.nodes.get(tube.b);
      if (a && b) dir.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
    }
    const seg = Math.max(10, this._q().tube);
    const sleeveR = g.tubeRadius * 1.3;
    const sleeve = new THREE.Mesh(
      this._cachedGeo(`clampSleeve${seg}`, () => new THREE.CylinderGeometry(sleeveR, sleeveR, cs + 2, seg)), mat);
    sleeve.quaternion.setFromUnitVectors(UP, dir);
    sleeve.position.copy(axis);
    sleeve.userData = { kind: "node", id: n.id };
    this.buildGroup.add(sleeve);
    if (st !== "future") this.pickNodes.push(sleeve);
    // Der Hals ist bei beiden Klemm-Kupplungen gleich lang: eine Kupplungslaenge
    // ab der Rohrachse. Bei der Lagerkupplung schliesst dahinter der Wuerfel der
    // getragenen Kupplung an, die eine weitere Laenge weiter aussen sitzt.
    const sockR = g.tubeRadius * 1.18;
    const neck = cs * 1.4;
    const socket = new THREE.Mesh(
      this._cachedGeo(`clampSocket${seg}:${neck.toFixed(1)}`, () => new THREE.CylinderGeometry(sockR, sockR, neck, seg)), mat);
    const sv = new THREE.Vector3(stub[0], stub[1], stub[2]);
    socket.quaternion.setFromUnitVectors(UP, sv);
    socket.position.copy(axis).addScaledVector(sv, neck / 2);
    socket.userData = { kind: "node", id: n.id };
    this.buildGroup.add(socket);
    if (st !== "future") this.pickNodes.push(socket);
  }

  // Bau-Anfasser (Handle): 3 feste Varianten nach kind. War fruehers pro addHandle()-
  // Aufruf ein neues Material (-> Leak), da _disposeGroup nur Geometrien freigibt.
  _handleMaterial(kind) {
    const key = "handle:" + kind;
    if (!this._materials[key]) {
      const isOrigin = kind === "origin";
      const isDiag = kind === "diag";
      this._materials[key] = new THREE.MeshBasicMaterial({
        color: isOrigin ? 0x1a8cff : isDiag ? 0x8b3df5 : 0x18a558,
        transparent: true, opacity: isOrigin ? 0.45 : 0.85,
      });
    }
    return this._materials[key];
  }

  // Kandidaten-Feld fuer eine Platte (addPanelHandle): ein festes Material.
  // Feld-Handles (Platten/Rutschen-Montagestellen). Das Material ist bewusst
  // gecacht und damit von ALLEN Handles geteilt -- die Hervorhebung unter dem
  // Mauszeiger darf deshalb nicht seine Deckkraft aendern, sonst leuchten alle
  // Felder gleichzeitig auf. Stattdessen gibt es eine zweite Variante, die in
  // setHover() nur am getroffenen Mesh eingehaengt wird.
  _panelHandleMaterial(hovered) {
    const key = hovered ? "panelHandle:hover" : "panelHandle";
    if (!this._materials[key]) {
      this._materials[key] = new THREE.MeshBasicMaterial({
        color: 0x1a8cff, transparent: true, opacity: hovered ? 0.65 : 0.35,
        side: THREE.DoubleSide, depthWrite: false,
      });
    }
    return this._materials[key];
  }

  // Hervorhebung der im aktuellen Aufbau-Schritt hinzukommenden Rohre.
  // Rohre des AKTUELLEN Aufbauschritts (nur dort ist st === "current"): orange
  // hervorgehoben und leicht durchscheinend, damit die Kupplungen dahinter --
  // die im selben Schritt gesteckt werden -- sichtbar bleiben.
  _tubeHighlight(colorId) {
    const key = "tubehl:" + colorId;
    if (!this._materials[key]) {
      this._materials[key] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(colorHex(colorId)), roughness: 0.4, metalness: 0.05,
        emissive: new THREE.Color(0x3a2400),
        transparent: true, opacity: 0.75, depthWrite: false,
      });
    }
    return this._materials[key];
  }

  // Textmarke (Sprite mit Canvas-Textur) ueber einer Kupplung.
  _makeLabelSprite(text, current, category) {
    const dpr = 2;
    const pad = 10 * dpr, fs = 30 * dpr;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.font = `bold ${fs}px -apple-system, "Segoe UI", Arial, sans-serif`;
    const tw = ctx.measureText(text).width;
    canvas.width = Math.ceil(tw + pad * 2);
    canvas.height = Math.ceil(fs + pad * 1.4);
    ctx.font = `bold ${fs}px -apple-system, "Segoe UI", Arial, sans-serif`;
    ctx.textBaseline = "middle";
    const r = 12 * dpr;
    ctx.fillStyle = LABEL_BG[category] || (current ? "rgba(255,140,26,0.96)" : "rgba(31,38,48,0.92)");
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(canvas.width, 0, canvas.width, canvas.height, r);
    ctx.arcTo(canvas.width, canvas.height, 0, canvas.height, r);
    ctx.arcTo(0, canvas.height, 0, 0, r);
    ctx.arcTo(0, 0, canvas.width, 0, r);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, pad, canvas.height / 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    const worldH = 7; // cm Hoehe der Beschriftung
    sprite.scale.set(worldH * (canvas.width / canvas.height), worldH, 1);
    sprite.renderOrder = 1000;
    return sprite;
  }

  _disposeLabels() {
    for (let i = this.labelGroup.children.length - 1; i >= 0; i--) {
      const c = this.labelGroup.children[i];
      if (c.material) {
        if (c.material.map) c.material.map.dispose();
        c.material.dispose();
      }
      this.labelGroup.remove(c);
    }
    this.labelMeshes = [];
  }

  // --- Instanziertes Zeichnen ---------------------------------------------
  // Kupplungen, Arm-Stutzen und Rohre sind Hunderte gleicher Koerper. Statt je
  // Teil ein eigenes Mesh (= ein Draw-Call) werden sie nach Geometrie UND
  // Material gebuendelt und als ein InstancedMesh gezeichnet.
  //
  // Gebuendelt wird nach dem FERTIGEN Material, nicht ueber instanceColor: die
  // Varianten (grau im Kollisions-Modus, rot, orange, blass, lila) unter-
  // scheiden sich nicht nur in der Farbe, sondern auch in Rauheit, Emissive und
  // Transparenz -- das laesst sich nicht je Instanz setzen. Da es nur eine
  // Handvoll Rohrlaengen und Farben gibt, bleiben es trotzdem wenige Buendel.
  //
  // kind/id duerfen null sein (nicht anklickbare Teile wie die Alu-Profile).
  _batchAdd(geo, mat, matrix, kind, id, pickList) {
    const key = geo.uuid + "|" + mat.uuid;
    let b = this._batches.get(key);
    if (!b) { b = { geo, mat, mats: [], items: [], pick: pickList || null }; this._batches.set(key, b); }
    b.mats.push(matrix);
    b.items.push(kind ? { kind, id } : null);
  }

  // Gesammelte Buendel als InstancedMesh in die Bau-Gruppe haengen. Die
  // Zuordnung Instanz -> Bauteil steht in userData.instances und wird beim
  // Picking ueber intersection.instanceId aufgeloest (siehe _hitData).
  _batchFlush() {
    for (const b of this._batches.values()) {
      const im = new THREE.InstancedMesh(b.geo, b.mat, b.mats.length);
      for (let i = 0; i < b.mats.length; i++) im.setMatrixAt(i, b.mats[i]);
      im.instanceMatrix.needsUpdate = true;
      im.userData = { instances: b.items };
      im.castShadow = true;
      im.receiveShadow = true;
      this.buildGroup.add(im);
      if (b.pick) b.pick.push(im);
    }
    this._batches.clear();
  }

  // Baut die Szene aus dem Modell neu auf.
  // opts.labelFor(node) -> string|null  : Beschriftung an der Kupplung.
  // opts.slideNameFor(slide) -> string|null : Beschriftung an der Rutsche/Dach.
  // opts.assembly { done:Set, current:Set } : Aufbaumodus (fertig/aktuell/kuenftig).
  renderModel(model, selectedNodeId, opts = {}) {
    this._disposeGroup(this.buildGroup);
    this._disposeLabels();
    this.pickNodes = [];
    this.pickTubes = [];
    this.pickPanels = [];
    this.pickClamps = [];
    this.pickTextiles = [];
    this.pickSlides = [];
    this.pickFittings = [];
    this._nodePoints = [];
    this._batches.clear();

    // Hervorhebung (Cursor-Auswahl und Bestandsliste). Frueher lief das als
    // Nachlauf ueber die fertige Gruppe und tauschte je Mesh das Material.
    // Instanzen teilen sich ihr Material, deshalb muss die Entscheidung schon
    // beim Anlegen fallen -- matFor() liefert das endgueltige Material.
    // Bei der Bestands-Hervorhebung treten alle uebrigen Teile zusaetzlich
    // zurueck (halbtransparent), damit die gesuchten im Gewirr auffallen. Fuer
    // die Cursor-Auswahl waere das stoerend: dort waehlt man staendig etwas an.
    const selected = opts.selected && opts.selected.size ? opts.selected : null;
    const highlight = opts.highlight && opts.highlight.size ? opts.highlight : null;
    const marked = selected || highlight;
    const dimOthers = !selected && !!highlight;
    // Im Vorschlags-Modus treten alle Teile zurueck, die keine Verstaerkung
    // brauchen -- sonst sucht man die orangen Rohre im Gewirr.
    const hintDim = !!opts.hintDim && !!opts.suggest;
    const matFor = (id, base) => {
      if (marked) {
        if (id != null && marked.has(id)) return this._selectedMaterial(base);
        return dimOthers ? this._dimmedMaterial(base) : base;
      }
      if (hintDim && !(id != null && opts.suggest.has(id))) return this._dimmedMaterial(base);
      return base;
    };

    const tubeRadius = geometry().tubeRadius;
    const armRadius = geometry().armRadius; // C45-Arm: ~42 mm, duenner als das Rohr
    const asm = opts.assembly || null;
    const labelFor = opts.labelFor || null;
    const slideNameFor = opts.slideNameFor || null;
    // Nur diese ids beschriften (Cursor-Modus mit genau einem gewaehlten Teil).
    // null = alle, die labelFor/slideNameFor liefern.
    const labelIds = opts.labelIds || null;
    const wantsLabel = (id) => !labelIds || labelIds.has(id);
    // Einzeln angeklicktes Teil: wird IMMER beschriftet, auch wenn es im
    // Aufbaumodus nicht zum aktuellen Schritt gehoert (dort ist Nachschlagen
    // gerade der Zweck).
    const soloId = opts.soloId != null ? opts.soloId : null;
    const suggest = opts.suggest || null;
    const reinforce = opts.reinforce || false;
    // Kollisions-Modus: betroffene Rohre rot, alle anderen grau. Platten und
    // Netze bleiben aussen vor, damit die Ueberlagerungen sichtbar sind.
    const collide = opts.collide || null;
    const collision = !!collide;
    const hideFlat = reinforce || collision;
    const cs = geometry().connectorSize;
    // Echte Kupplungs-Arme (aus variant2 importiert, node.arms): kurze Stutzen
    // mit Arm-Durchmesser (~42 mm). Offene Arme ragen heraus; von Rohren belegte
    // stecken im Rohr (Arm dünner als Rohr) -> sichtbar nur die freien Arme.
    const armStubLen = cs * 0.85;
    const qual = this._q();   // Aufloesung je Qualitaetsstufe
    const armStubGeo = this._tubeGeometry(armRadius, armStubLen, Math.max(6, qual.tube - 4));
    const armStubOff = cs / 2 + armStubLen / 2 - 0.4;
    // Am BOGENROHR laeuft der Stutzen gerade, das Rohr biegt aber weg: bei
    // 6,85 cm Stutzenende weicht der Bogen schon 0,58 cm von der Tangente ab --
    // mehr als zwischen Stutzen (Radius ~2,1) und Rohrwand (2,45) Platz ist,
    // der Stutzen durchstiess die Wand. Dort also ein kurzer Stutzen.
    const bowStubLen = cs * 0.32;
    const bowStubGeo = this._tubeGeometry(armRadius, bowStubLen, Math.max(6, qual.tube - 4));
    const bowStubOff = cs / 2 + bowStubLen / 2 - 0.4;

    // Richtungen der an einem Knoten TATSAECHLICH angeschlossenen Rohre.
    // Einmal fuer alle Knoten aufgebaut (sonst waere die Pruefung je Knoten ueber
    // alle Rohre quadratisch). Bei Bogenrohren zaehlt die Tangente am Knoten,
    // nicht die Sehne zum Gegenknoten -- sonst gilt ein belegter Arm faelschlich
    // als frei.
    const tubeDirsAt = new Map();
    const pushDir = (nodeId, vx, vy, vz, bow) => {
      const L = Math.hypot(vx, vy, vz);
      if (L < 1e-6) return;
      if (!tubeDirsAt.has(nodeId)) tubeDirsAt.set(nodeId, []);
      tubeDirsAt.get(nodeId).push({ d: [vx / L, vy / L, vz / L], bow: !!bow });
    };
    // Ein Rad sitzt auf einem Stutzen der Kupplung -- also bekommt die Kupplung
    // dort auch einen, so wie bei einem Rohr. Der Anker ist die naechstgelegene
    // Kupplung, die Richtung die eigene Achse des Teils (lokales +X).
    for (const f of (model.fittings ? model.fittings.values() : [])) {
      if (!ARM_FITTINGS.has(f.kind) || !f.quat) continue;
      let near = null, nd = 16;
      for (const n of model.nodes.values()) {
        const d = Math.hypot(n.x - f.x, n.y - f.y, n.z - f.z);
        if (d < nd) { nd = d; near = n; }
      }
      if (!near) continue;
      // Sitzt das Teil GENAU auf der Kupplung (Radlager, Adapter), gibt der
      // Abstand keine Richtung her -- dann zaehlt seine eigene Achse.
      const dx = f.x - near.x, dy = f.y - near.y, dz = f.z - near.z;
      if (Math.hypot(dx, dy, dz) > 0.5) pushDir(near.id, dx, dy, dz, false);
      else {
        const qx = new THREE.Quaternion(f.quat[0], f.quat[1], f.quat[2], f.quat[3]).normalize();
        const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(qx);
        pushDir(near.id, ax.x, ax.y, ax.z, false);
      }
    }
    // Die Kupplung, die eine Lagerkupplung traegt, steckt mit einem Stutzen in
    // ihr -- der zeigt zurueck zum Rohr, sonst schwebt der Wuerfel frei.
    for (const n of model.nodes.values()) {
      if (n.part !== "bearing" || !n.stub) continue;
      pushDir(n.id, -n.stub[0], -n.stub[1], -n.stub[2], false);
    }
    for (const t of model.tubes.values()) {
      const na = model.nodes.get(t.a), nb = model.nodes.get(t.b);
      if (!na || !nb) continue;
      if (t.bow && t.bowCenter) {
        const [cx, cy, cz] = t.bowCenter;
        pushDir(t.a, nb.x - cx, nb.y - cy, nb.z - cz, true);
        pushDir(t.b, na.x - cx, na.y - cy, na.z - cz, true);
      } else {
        pushDir(t.a, nb.x - na.x, nb.y - na.y, nb.z - na.z, false);
        pushDir(t.b, na.x - nb.x, na.y - nb.y, na.z - nb.z, false);
      }
    }

    // Zustand eines Teils im Aufbaumodus: "done" | "current" | "future".
    const stateOf = (id) => {
      if (!asm) return "done";
      if (asm.current.has(id)) return "current";
      if (asm.done.has(id)) return "done";
      return "future";
    };

    // Kupplungen (Wuerfel)
    for (const n of model.nodes.values()) {
      const st = stateOf(n.id);
      if (st === "future") continue;   // noch nicht gebaute Teile bleiben unsichtbar
      // Bezugspunkte fuer die Drehpunkt-Suche (_pointUnderCursor).
      this._nodePoints.push(new THREE.Vector3(n.x, n.y, n.z));
      let mat;
      if (st === "future") mat = this._ghostMaterial();
      // Aufbau-Modus: Kupplungen des aktuellen Schritts schwarz wie am fertigen
      // Modell. Orange (die Hervorhebung der Bau-Kupplung) waere hier falsch --
      // vom schon Gebauten heben sie sich bereits durch dessen blasses,
      // durchscheinendes Material ab.
      else if (st === "current") mat = this._connMaterial(false);
      else if (asm && st === "done") mat = this._fadedMaterial(connectorColor().hex);
      else mat = this._connMaterial(n.id === selectedNodeId);
      // Adapter-Koerper (importierte C45, n.c45body) sind keine eigenstaendige
      // Kupplung -> kein dunkler Wuerfel; sie werden unten in Adapter-Farbe
      // gezeichnet (Huelse + Koerper + 45°-Arm).
      // Klemm-Kupplung: Huelse um das umschlossene Rohr, quer dazu der offene
      // Anschluss. Die Lochzapfenkupplung nimmt dort direkt ein Rohr auf und
      // braucht keinen Wuerfel; die Lagerkupplung traegt eine ganze Kupplung --
      // die wird unten zusaetzlich gezeichnet.
      if (n.stub && n.part) this._addTubeClamp(model, n, matFor(n.id, mat), st);
      // Wo eine Radkappe sitzt, gibt es keine Kupplung mehr -- die Kappe
      // schliesst das Rohrende selbst ab.
      if (!n.c45body && n.part !== "hole_1" && !(model.hasWheelCap && model.hasWheelCap(n))) {
        const pos = new THREE.Vector3(n.x, n.y, n.z);
        const quat = new THREE.Quaternion();
        // Importierte Kupplung: Wuerfel exakt um ihre Quaternion drehen, damit die
        // Arme aus den Flaechen kommen -- auch bei Rampenwinkeln (30°/60°). Kardinale
        // Kupplungen sind invariant. Manuell gebaute Schraegen (ohne quat) drehen wie
        // bisher 45° um die Schraegen-Achse (_slopeRotationAxis).
        if (n.quat && n.quat.length === 4) {
          quat.set(n.quat[0], n.quat[1], n.quat[2], n.quat[3]).normalize();
        } else {
          const sa = this._slopeRotationAxis(model, n);
          if (sa) quat.setFromAxisAngle(sa, Math.PI / 4);
        }
        this._batchAdd(this._connGeometry(), matFor(n.id, mat),
          new THREE.Matrix4().compose(pos, quat, ONE), "node", n.id, this.pickNodes);

        // Arm-Stutzen der Kupplung: kurze Zylinder, die in die Rohre greifen.
        // Gezeichnet wird je Richtung, in der wirklich ein Rohr steckt -- die
        // Kupplung zeigt damit genau ihr tatsaechliches Anschlussbild. Offene
        // Stutzen entfallen; die Herstellersoftware kennt sie ebenfalls nicht,
        // und die variant2-Maske importierter Dateien fuehrt Arme ins Leere.
        // Quelle sind die tatsaechlichen Rohrrichtungen, nicht node.arms: sonst
        // haetten im Editor gebaute Kupplungen (ohne variant2) gar keine.
        for (const e of tubeDirsAt.get(n.id) || []) {
          const dv = new THREE.Vector3(e.d[0], e.d[1], e.d[2]);
          const off = e.bow ? bowStubOff : armStubOff;
          const p = new THREE.Vector3(
            n.x + dv.x * off, n.y + dv.y * off, n.z + dv.z * off);
          const q = new THREE.Quaternion().setFromUnitVectors(UP, dv);
          this._batchAdd(e.bow ? bowStubGeo : armStubGeo, matFor(n.id, mat),
            new THREE.Matrix4().compose(p, q, ONE), "node", n.id, this.pickNodes);
        }
      }

      // 45-Grad-Winkelkupplung (C45). Echtes Teil: eine Huelse wird auf einen
      // KARDINALEN Arm der Basiskupplung gesteckt, davon zweigt ein 45°-Arm ab,
      // der in die Tube greift.
      if (n.c45 && st !== "future") {
        const c45mat = matFor(n.id, this._c45Material());
        if (n.c45body) {
          // Import: n ist der Adapter-Koerper am Diagonal-Fuss; die Basis sitzt
          // am anderen Ende der Arm-Kante. Huelse laeuft kardinal von der Basis.
          const ad = this._c45AdapterGeo(model, n);
          if (ad) {
            // Arm der Basiskupplung -- ragt vom Wuerfel in die C45-Huelse hinein.
            if (ad.baseArmLen > 0.5) {
              const baseArm = new THREE.Mesh(
                new THREE.CylinderGeometry(armRadius, armRadius, ad.baseArmLen, 14),
                c45mat);
              baseArm.position.copy(ad.baseArmMid);
              baseArm.quaternion.setFromUnitVectors(UP, ad.sleeveDir);
              baseArm.userData = { kind: "node", id: n.id };
              this.buildGroup.add(baseArm);
            }
            // C45-Huelse: etwas breiter als das Rohr, der Basis-Arm steckt darin.
            const sockR = this._c45SocketR();
            const sleeve = new THREE.Mesh(
              new THREE.CylinderGeometry(sockR, sockR, ad.sleeveLen, 14),
              c45mat);
            sleeve.position.copy(ad.sleeveMid);
            sleeve.quaternion.setFromUnitVectors(UP, ad.sleeveDir);
            sleeve.userData = { kind: "node", id: n.id };
            this.buildGroup.add(sleeve);
            if (st !== "future") this.pickNodes.push(sleeve);

            const body = new THREE.Mesh(this._c45Geometry(), c45mat);
            body.position.copy(ad.bodyPos);
            body.userData = { kind: "node", id: n.id };
            this.buildGroup.add(body);

            if (ad.armLen > 0.5) {
              // Zweiter Schenkel: gleicher Durchmesser wie die Huelse, das
              // Diagonalrohr steckt darin (Knierohr, kein duenner Stift). Er
              // reicht eine halbe Kupplungslaenge UEBER den Fusspunkt hinaus --
              // genau so weit ist das Diagonalrohr an seinem Ende gekuerzt,
              // sonst klafft dort eine Luecke zwischen Kupplung und Rohr.
              const armLen = ad.armLen + cs / 2;
              const arm = new THREE.Mesh(
                new THREE.CylinderGeometry(sockR, sockR, armLen, 14),
                c45mat);
              arm.position.copy(ad.bodyPos).addScaledVector(ad.armDir, armLen / 2);
              arm.quaternion.setFromUnitVectors(UP, ad.armDir);
              arm.userData = { kind: "node", id: n.id };
              this.buildGroup.add(arm);
            }
          }
        } else {
          // Manuell gebaut: Knoten ist die Basiskupplung, Adapter sitzt auf dem
          // zur Diagonale naechsten Achsarm (kleiner Versatz von cs).
          for (const d of this._diagonalDirsAt(model, n)) {
            const dv = new THREE.Vector3(d[0], d[1], d[2]).normalize();
            const cv = this._c45ArmDirAt(model, n, d);
            const bx = n.x + cv.x * cs, by = n.y + cv.y * cs, bz = n.z + cv.z * cs;
            // Huelse: schiebt sich vom Kupplungswuerfel bis zum Knick ueber den
            // Arm -- dieselbe Form wie bei den importierten C45.
            const sockR = this._c45SocketR();
            const sleeveLen = cs / 2;
            const sleeve = new THREE.Mesh(
              new THREE.CylinderGeometry(sockR, sockR, sleeveLen, 14), c45mat);
            sleeve.position.set(n.x + cv.x * cs * 0.75, n.y + cv.y * cs * 0.75, n.z + cv.z * cs * 0.75);
            sleeve.quaternion.setFromUnitVectors(UP, cv);
            sleeve.userData = { kind: "node", id: n.id };
            this.buildGroup.add(sleeve);
            const body = new THREE.Mesh(this._c45Geometry(), c45mat);
            body.position.set(bx, by, bz);
            body.userData = { kind: "node", id: n.id };
            this.buildGroup.add(body);
            const stub = new THREE.Mesh(this._c45StubGeometry(), c45mat);
            const stubOff = cs * 0.75;
            stub.position.set(bx + dv.x * stubOff, by + dv.y * stubOff, bz + dv.z * stubOff);
            stub.quaternion.setFromUnitVectors(UP, dv);
            stub.userData = { kind: "node", id: n.id };
            this.buildGroup.add(stub);
          }
        }
      }

      // Beschriftung: im Aufbaumodus nur die aktuelle Ebene, sonst alle sichtbaren.
      const showLabel = labelFor && wantsLabel(n.id) &&
        (n.id === soloId || (asm ? st === "current" : st !== "future"));
      if (showLabel) {
        const info = labelFor(n);
        const text = typeof info === "string" ? info : info && info.text;
        if (text) {
          const category = info && typeof info === "object" ? info.category : null;
          const sprite = this._makeLabelSprite(text, st === "current", category);
          sprite.position.set(n.x, n.y + cs / 2 + 6, n.z);
          this.labelGroup.add(sprite);
          this.labelMeshes.push(sprite);
        }
      }
    }

    // Rohre (Zylinder zwischen zwei Knoten)
    for (const t of model.tubes.values()) {
      const a = model.nodes.get(t.a), b = model.nodes.get(t.b);
      if (!a || !b) continue;
      const st = stateOf(t.id);
      if (st === "future") continue;   // noch nicht gebaute Teile bleiben unsichtbar
      // Reine Konnektivitaets-Kanten (Daten): C45-Adapter-Arm wird als Huelse am
      // c45body-Knoten gezeichnet, die Doppelrohr-Verbindung als "8"-Klemme --
      // beide nicht hier als Rohr.
      if (t.arm || t.link) continue;
      const va = new THREE.Vector3(a.x, a.y, a.z);
      const vb = new THREE.Vector3(b.x, b.y, b.z);
      const mid = va.clone().add(vb).multiplyScalar(0.5);
      const len = va.distanceTo(vb);

      // Bogenrohr: als Roehre entlang des Kreisbogens um bowCenter zeichnen.
      // cs / 2 je Ende -- dieselbe Kuerzung wie beim geraden Rohr (drawLen).
      const bowCurve = t.bow && t.bowCenter ? this._bowCurve(va, vb, t.bowCenter, cs / 2) : null;
      if (bowCurve) {
        const bowMat = st === "future" ? this._ghostMaterial()
          : st === "current" ? this._tubeHighlight(t.color)
          : (collide && collide.has(t.id)) ? this._tubeCollision()
          : (suggest && suggest.has(t.id)) ? this._tubeSuggest()
          : (reinforce || collision) ? this._tubeGray()
          : (asm && st === "done") ? this._fadedMaterial(colorHex(t.color))
          : this._tubeMaterial(t.color);
        const bowFinalMat = matFor(t.id, bowMat);
        const bowMesh = new THREE.Mesh(
          new THREE.TubeGeometry(bowCurve, 24, tubeRadius, qual.bow, false),
          bowFinalMat
        );
        bowMesh.userData = { kind: "tube", id: t.id };
        bowMesh.castShadow = true;
        this.buildGroup.add(bowMesh);
        if (st !== "future") this.pickTubes.push(bowMesh);

        // TubeGeometry ist ein offener Schlauch. Ohne Deckel sieht man in das
        // Rohr hinein (die Rueckseiten werden weggeschnitten) -- es wirkt als
        // blosse Flaeche, waehrend gerade Rohre als CylinderGeometry
        // geschlossen sind. Also je Ende eine Scheibe, Normale nach aussen.
        const capGeo = this._capGeometry(tubeRadius, qual.bow);
        for (const [u01, sign] of [[0, -1], [1, 1]]) {
          const cap = new THREE.Mesh(capGeo, bowFinalMat);
          cap.position.copy(bowCurve.getPointAt(u01));
          const outward = bowCurve.getTangentAt(u01).multiplyScalar(sign);
          cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), outward);
          cap.userData = { kind: "tube", id: t.id };
          this.buildGroup.add(cap);
          if (st !== "future") this.pickTubes.push(cap);
        }
        continue;
      }

      // Sichtbare Rohrlaenge: das echte Rohr, NICHT der Knotenabstand -- zwischen
      // zwei Kupplungsmitten liegen Rohrlaenge + connectorSize, ein Zylinder ueber
      // die volle Distanz schaut sonst aus der Kupplung wieder heraus. Gerechnet
      // wird aus der Distanz statt aus der Katalog-Laenge: im Schraegen-Raster
      // (importierte Diagonalen, ~41,5 statt 40) klaffte sonst eine Luecke.
      // Die Luecke zur Kupplung fuellen die Arm-Stutzen (siehe oben).
      const drawLen = Math.max(1, len - cs);
      const isReinforceActive = reinforce && t.reinforced;
      const effectiveRadius = isReinforceActive ? tubeRadius * 1.08 : tubeRadius;
      const geo = this._tubeGeometry(tubeRadius, drawLen, qual.tube);
      const geo2 = isReinforceActive
        ? this._tubeGeometry(effectiveRadius, drawLen, qual.tube)
        : geo;
      const mat = st === "future" ? this._ghostMaterial()
        : st === "current" ? this._tubeHighlight(t.color)
        : (collide && collide.has(t.id)) ? this._tubeCollision()
        : isReinforceActive ? this._tubeReinforceActive()
        : (suggest && suggest.has(t.id)) ? this._tubeSuggest()
        : (reinforce || collision) ? this._tubeGray()
        : (asm && st === "done") ? this._fadedMaterial(colorHex(t.color))
        : this._tubeMaterial(t.color);
      const dir = vb.clone().sub(va).normalize();
      const quat = new THREE.Quaternion().setFromUnitVectors(UP, dir);
      this._batchAdd(isReinforceActive ? geo2 : geo, matFor(t.id, mat),
        new THREE.Matrix4().compose(mid, quat, ONE), "tube", t.id, this.pickTubes);

      // Verstaerkungsprofil: dünner Alu-Innenstab im Bauen-Modus sichtbar.
      // Das Profil (ca. 2,5 cm) liegt im hohlen Rohr (5 cm Außen-Ø) und ragt
      // durch die Kupplungen hindurch – deshalb volle Rohrlänge.
      if (t.reinforced && !reinforce && st !== "future") {
        // Verstaerkungsprofil: ~30 mm Durchmesser (gemessen), passt in das hohle
        // Rohr (49 mm aussen, 3 mm Wandstaerke -> 43 mm Innen-Durchmesser).
        const rodRadius = 1.5;  // 15 mm Radius = 30 mm Durchmesser in cm
        const rodGeo = this._tubeGeometry(rodRadius, len, 8);
        // Nicht anklickbar (kind null) -- das Profil steckt im Rohr.
        this._batchAdd(rodGeo, matFor(null, this._rodMaterial()),
          new THREE.Matrix4().compose(mid, quat, ONE), null, null, null);
      }

      // Laengen-Beschriftung: gleiche Sichtbarkeitsregel wie die Kupplungs-Namen.
      const showTubeLabel = labelFor && wantsLabel(t.id) &&
        (t.id === soloId || (asm ? st === "current" : st !== "future"));
      if (showTubeLabel) {
        const cm = t.length != null ? t.length : Math.round(len - cs);
        const category = t.tubeId === "T75" ? "tube75" : null;
        const sprite = this._makeLabelSprite(`${cm} cm`, st === "current", category);
        sprite.position.set(mid.x, mid.y + tubeRadius + 4, mid.z);
        this.labelGroup.add(sprite);
        this.labelMeshes.push(sprite);
      }
    }

    // Platten (flache Box in der Feld-Ebene) – im Verstaerken-/Kollisions-Modus ausgeblendet.
    const thickness = geometry().panelThickness || 1.6;
    const middle = modelMiddle(model.nodes.values());
    for (const p of model.panels.values()) {
      if (hideFlat) continue;
      const cor = model.panelCorners(p);
      if (!cor) continue;
      const st = stateOf(p.id);
      if (st === "future") continue;
      const [A, B, , D] = cor.map((c) => ({ x: c[0], y: c[1], z: c[2] }));
      const va = new THREE.Vector3(A.x, A.y, A.z);
      const u = new THREE.Vector3(B.x, B.y, B.z).sub(va);
      const w = new THREE.Vector3(D.x, D.y, D.z).sub(va);
      const center = cor
        .reduce((acc, c) => acc.add(new THREE.Vector3(c[0], c[1], c[2])), new THREE.Vector3())
        .multiplyScalar(0.25);
      const xAxis = u.clone().normalize();
      const zAxis = w.clone().normalize();
      const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
      // Die Platte liegt nicht auf der Rohrachse, sondern oben (side +1) oder
      // unten (side -1) BUENDIG mit dem Rohr: ihre Oberflaeche schliesst mit dem
      // Rohrscheitel ab, sie sitzt also in der oberen Rohrhaelfte und steht
      // nicht darauf. Mitte = Scheitel - halbe Plattenstaerke.
      const nrm = panelNormal(
        [xAxis.x, xAxis.y, xAxis.z], [zAxis.x, zAxis.y, zAxis.z],
        [center.x, center.y, center.z], middle,
      );
      const lift = (geometry().tubeRadius || 2.45) - thickness / 2;
      const sgn = (p.side || 1) < 0 ? -1 : 1;
      center.add(new THREE.Vector3(nrm[0], nrm[1], nrm[2]).multiplyScalar(lift * sgn));
      const geo = this._panelGeometry(p.panelId, u.length(), w.length(), thickness);
      const mat = st === "future" ? this._ghostMaterial()
        : (asm && st === "done") ? this._fadedMaterial(colorHex(p.color))
        : this._panelMaterial(p.color, st === "current", false);
      // Gleiches Mass + gleiche Farbe teilen sich Geometrie und Material -> ein
      // Buendel. In grossen Modellen sind die Platten sonst der groesste
      // verbliebene Posten (56 Platten = 56 Draw-Calls).
      const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis).setPosition(center);
      this._batchAdd(geo, matFor(p.id, mat), basis, "panel", p.id, this.pickPanels);

      // Bällebad-Boden: Wasser-Volumen (75 % Füllhöhe) über dem Boden rendern.
      if (p.panelId === "pool_floor" && st !== "future") {
        const wallH = 40;                   // Wandhöhe pool2 in cm
        const waterH = wallH * 0.75;        // 30 cm Wasserstand
        const wGeo = new THREE.BoxGeometry(u.length(), waterH, w.length());
        const wMesh = new THREE.Mesh(wGeo, matFor(null, this._waterMaterial()));
        // Mitte des Wassers: Boden-Deckfläche + waterH/2  (kein Z-Fighting mit Bodenplatte)
        wMesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
        wMesh.position.copy(center).addScaledVector(yAxis, thickness / 2 + waterH / 2);
        this.buildGroup.add(wMesh);
      }
    }

    // Doppelrohrverbinder: "8" = zwei Ringe nebeneinander, durch jeden laeuft
    // eine Tube. Ringachse = Tube-Richtung (c.dir), die beiden Ringe sind um den
    // Versatz c.off (~5 cm) versetzt. Ohne Paar (manuell) -> ein Ring.
    const ringGeo = this._clampRingGeometry();
    for (const c of (model.clamps ? model.clamps.values() : [])) {
      const st = stateOf(c.id);
      if (st === "future") continue;
      const mat = matFor(c.id, this._clampMaterial());
      const dir = c.dir ? new THREE.Vector3(c.dir[0], c.dir[1], c.dir[2]).normalize() : new THREE.Vector3(1, 0, 0);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      const h = c.off ? [c.off[0] / 2, c.off[1] / 2, c.off[2] / 2] : null;
      const centers = h
        ? [[c.x - h[0], c.y - h[1], c.z - h[2]], [c.x + h[0], c.y + h[1], c.z + h[2]]]
        : [[c.x, c.y, c.z]];
      for (const [px, py, pz] of centers) {
        this._batchAdd(ringGeo, mat,
          new THREE.Matrix4().compose(new THREE.Vector3(px, py, pz), q, ONE),
          "clamp", c.id, this.pickClamps);
      }
    }

    // Netze/Stoffe (textil2): halbtransparente Flaeche ueber 4 Eck-Kupplungen.
    for (const tx of (model.textiles ? model.textiles.values() : [])) {
      if (hideFlat) continue;
      const cor = model.panelCorners(tx);
      if (!cor) continue;
      const st = stateOf(tx.id);
      if (st === "future") continue;
      const [A, B, , D] = cor.map((c) => ({ x: c[0], y: c[1], z: c[2] }));
      const va = new THREE.Vector3(A.x, A.y, A.z);
      const u = new THREE.Vector3(B.x, B.y, B.z).sub(va);
      const w = new THREE.Vector3(D.x, D.y, D.z).sub(va);
      const center = cor
        .reduce((acc, c) => acc.add(new THREE.Vector3(c[0], c[1], c[2])), new THREE.Vector3())
        .multiplyScalar(0.25);
      const xAxis = u.clone().normalize();
      const zAxis = w.clone().normalize();
      const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
      const geo = new THREE.BoxGeometry(u.length(), 0.6, w.length());
      const mat = matFor(tx.id,
        st === "future" ? this._ghostMaterial() : this._panelMaterial(tx.color, st === "current", true));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
      mesh.position.copy(center);
      mesh.userData = { kind: "textile", id: tx.id };
      this.buildGroup.add(mesh);
      if (st !== "future") this.pickTextiles.push(mesh);
    }

    // Anbauteile: Raeder, Rollen, Kappen, Gitter, Rundwand, Dach, Sonderkupplungen.
    for (const f of (model.fittings ? model.fittings.values() : [])) {
      if (hideFlat && FLAT_FITTINGS.has(f.kind)) continue;
      const st = stateOf(f.id);
      if (st === "future") continue;
      for (const mesh of this._fittingMeshes(f)) {
        mesh.userData = { kind: "fitting", id: f.id };
        const base = mesh.material;
        mesh.material = matFor(f.id, (suggest && suggest.has(f.id)) ? this._suggestMaterial(base)
          : (asm && st === "done") ? this._fadedMaterial(base.color.getHex()) : base);
        this.buildGroup.add(mesh);
        this.pickFittings.push(mesh);
      }
    }

    // Rutschen/Daecher: eigene Geometrie je Art (Bogen/gerade/Auslauf = U-Rinne,
    // Dach = flache Kappe). slide-end2-Position via _slideEndRenderedCenter.
    // Ketten-Status fuer nahtlose Uebergaenge: der Querschnitt (W/Nrm), mit dem das
    // VORHERIGE Rutschenteil endete, plus die ID des Teils, das ihn uebernehmen soll.
    this._slideChainFrame = null;
    this._slideChainNextId = null;
    for (const sl of (model.slides ? model.slides.values() : [])) {
      if (hideFlat) continue;
      const st = stateOf(sl.id);
      if (st === "future") continue;
      const base = (asm && st === "done")
        ? this._fadedMaterial(sl.color ? colorHex(sl.color) : 0xd23b3b)
        : this._slideMatFor(sl.kind, st === "current", sl.color);
      const mat = matFor(sl.id, (suggest && suggest.has(sl.id)) ? this._suggestMaterial(base) : base);

      // Beschriftung: Name des Rutschenenteils/Dachs wenn Labels aktiv.
      if (slideNameFor && wantsLabel(sl.id) && st !== "future") {
        const name = slideNameFor(sl);
        if (name) {
          const sprite = this._makeLabelSprite(name, st === "current", null);
          sprite.position.set(sl.x, sl.y + 30, sl.z);
          this.labelGroup.add(sprite);
          this.labelMeshes.push(sprite);
        }
      }

      // Bogenrutsche: gekrümmte 90°-Form oben, fuehrt nach unten ins Folgeteil.
      if (sl.kind === "curved-slide2") { this._addCurvedSlide(sl, model, mat, st); continue; }
      // Gerade Rutsche: schraege Rampe von ihrer Position zum naechsten Folgeteil.
      if (sl.kind === "slide2" || sl.kind === "slide-new2") { this._addStraightSlide(sl, model, mat, st); continue; }
      // Rutschenauslauf: kurzes, flaches U-Rinnen-Endstueck mit offenem Auslauf.
      if (sl.kind === "slide-end2") { this._addSlideEnd(sl, model, mat, st); continue; }
      // roof2 (Dach-Tuch): als GIEBEL ueber das Dach (von den C45-Traufen die
      // Dachschraegen hoch, 90°-Knick am First, andere Schraege runter).
      if (sl.kind === "roof2") { this._addRoof(sl, model, mat, st); continue; }
    }

    // Gesammelte Kupplungen, Arm-Stutzen und Rohre als InstancedMesh anlegen.
    this._batchFlush();

    // Schnittebene: Materialien muessen clipShadows tragen, sonst werfen
    // weggeschnittene Teile weiterhin Schatten auf den Boden. Die Materialien
    // entstehen erst bei ihrer ersten Verwendung, deshalb hier statt in setClip.
    if (this._clipPlane) {
      this.buildGroup.traverse((o) => {
        if (o.isMesh && o.material && !o.material.clipShadows) {
          o.material.clipShadows = true;
          o.material.needsUpdate = true;
        }
      });
    }

    // Gras unter bodennahen Bauteilen ausblenden (Footprint-Maske).
    this._updateGrassMask(model);

    // Schatten: alle Bauteile werfen und empfangen Schatten.
    this.buildGroup.traverse(child => {
      if (!child.isMesh) return;
      child.castShadow    = true;
      child.receiveShadow = true;
    });

    // Bäume: bei Bedarf ausblenden wenn zu nah an Knoten.
    this._updateTrees(model);

    // Zoom-Grenze richtet sich nach der Modellgroesse.
    this._applyZoomLimits(model);

    // Der Szenegraph ist neu -> Schattenkarte einmal nachziehen.
    this._shadowsDirty();
  }

  // Gerade Rutsche (slide2/slide-new2): schraege Rampe (Rutschflaeche + 2 erhoehte
  // Seitenholme) von ihrer QDF-Position zum NAECHSTEN tiefer liegenden Rutschenteil
  // (Endstueck oder weitere gerade Rutsche). Die QDF-Kette legt das Folgeteil genau
  // an ihr Ende -> die feste ~140cm-Form ergibt sich aus der Distanz. Ersetzt die
  // fehlplatzierte Viewer-Transformation (fester Block + rotateY45 + Offsets).
  _addStraightSlide(sl, model, mat, st) {
    let P0 = new THREE.Vector3(sl.x, sl.y, sl.z);
    // Auch die gerade Rutsche ist ein festes Teil: bei 73 von 76 Vorkommen im
    // Bestand sitzt das Folgeteil auf dem lokalen Versatz (0, -800, 1200) -- drei
    // Felder in Laufrichtung (lokales +Z), zwei Ebenen tiefer. Gesucht wird das
    // Teil DORT, nicht mehr das naechstgelegene tiefere: in Abenteuerschloss
    // liegt die Rutsche einer anderen Kette naeher, und die obere Rutsche lief
    // dadurch quer durch das Geruest zu ihr hinueber.
    const P1exp = STRAIGHT_SLIDE_DROP.clone().applyQuaternion(this._slideQuat(sl)).add(P0);
    let target = null, bestD = Infinity;
    for (const s2 of model.slides.values()) {
      if (s2 === sl) continue;
      if (s2.kind !== "slide2" && s2.kind !== "slide-new2" && s2.kind !== "slide-end2") continue;
      const d = Math.hypot(s2.x - P1exp.x, s2.y - P1exp.y, s2.z - P1exp.z);
      if (d < bestD) { bestD = d; target = s2; }
    }
    if (bestD > 40) target = null;   // dort steht nichts -> Rutsche haengt allein
    let P1;
    // Im Editor gesetzte Rutsche: Der Einhaengepunkt am senkrechten Rohrpaar ist
    // bekannt, es muss nichts aus Quaternion/Kette hergeleitet werden.
    if (sl.hook && sl.hook.length === 3) {
      P1 = P0.clone();                                  // Auslauf = gespeicherte Position
      P0 = new THREE.Vector3(sl.hook[0], sl.hook[1], sl.hook[2]);
      const C0 = new THREE.Vector3((P0.x + P1.x) / 2, P1.y + (P0.y - P1.y) * 0.32, (P0.z + P1.z) / 2);
      const bez0 = (t) => {
        const u = 1 - t;
        return new THREE.Vector3(
          u * u * P0.x + 2 * u * t * C0.x + t * t * P1.x,
          u * u * P0.y + 2 * u * t * C0.y + t * t * P1.y,
          u * u * P0.z + 2 * u * t * C0.z + t * t * P1.z);
      };
      this._slideChainFrame = this._addSlideAlongCurve(mat, st, sl.id, bez0, 9, null);
      this._slideChainNextId = null;
      return;
    }
    if (target) {
      P1 = target.kind === "slide-end2" ? this._slideEndConnectPoint(target) : new THREE.Vector3(target.x, target.y, target.z);
    } else {
      // Einzelne Rutsche ohne Folgeteil: Die QDF-Position ist dann der FUSS
      // (Auslauf am Boden), nicht der Einstieg -- alle Rutschen-Records einer
      // solchen Datei liegen auf y = 0. Die Rutsche steigt entgegen der
      // Laufrichtung auf Plattformhoehe an: 2 Ebenen hoch (80 cm) bei 100 cm
      // horizontal. Frueher lief der Fallback stattdessen 130 cm nach vorn und
      // 60 cm nach UNTEN -- die Rutsche lag dadurch flach unter dem Boden.
      // Geprueft an QuadroTobezimmer.qdf: Fuss (40,0,100) + Anstieg trifft
      // exakt die Kupplung (40,80,0), an der die Rutsche eingehaengt ist.
      const SLIDE_RUN = 100, SLIDE_RISE = 80; // Rueckfall, falls nichts passt
      const fwd = new THREE.Vector3(1, 0, 0);
      if (sl.quat && sl.quat.length === 4) fwd.applyQuaternion(new THREE.Quaternion(sl.quat[0], sl.quat[1], sl.quat[2], sl.quat[3]).normalize());
      if (fwd.lengthSq() < 0.01) fwd.set(1, 0, 0);
      fwd.normalize();
      // Die Rutsche steht 90 Grad gegen den Uhrzeigersinn (um die Hochachse) zu
      // der Richtung, die direkt aus der QDF-Quaternion faellt -- im Vergleich
      // mit der Herstellersoftware lag sie sonst quer und auf der falschen Seite
      // des Turms.
      fwd.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
      P1 = P0.clone();                       // Auslauf = QDF-Position
      // Einstieg = die Kupplung, an der die Rutsche oben eingehaengt ist: erhoeht,
      // in Laufrichtung vor dem Fuss und seitlich auf der Rutschenachse. Damit
      // reicht die Rutsche bis an das Geruest, statt frei in der Luft zu enden.
      // Von mehreren Kandidaten gewinnt der mit der rutschentypischen Neigung
      // (~35 Grad) -- sonst wuerde die oberste Ebene gewaehlt und die Rutsche
      // stuende viel zu steil.
      const IDEAL_SLOPE = 35 * Math.PI / 180;
      let hook = null, bestSlope = Infinity;
      for (const n of model.nodes.values()) {
        const rel = new THREE.Vector3(n.x - P1.x, 0, n.z - P1.z);
        const along = rel.dot(fwd);
        if (along < 20) continue;                                   // liegt hinter dem Fuss
        if (rel.clone().addScaledVector(fwd, -along).length() > 25) continue; // zu weit seitlich
        if (n.y < P1.y + 20) continue;                              // nicht erhoeht
        const off = Math.abs(Math.atan2(n.y - P1.y, along) - IDEAL_SLOPE);
        if (off < bestSlope) { bestSlope = off; hook = { y: n.y, along }; }
      }
      P0 = hook
        ? new THREE.Vector3(P1.x + fwd.x * hook.along, hook.y, P1.z + fwd.z * hook.along)
        : P1.clone().addScaledVector(fwd, SLIDE_RUN).setY(P1.y + SLIDE_RISE);
    }
    if (P0.distanceTo(P1) < 1) { this._slideChainFrame = null; this._slideChainNextId = null; return; }
    // Plan-Verlauf GERADE (Kontrollpunkt horizontal mittig), aber Seitenprofil
    // leicht KONKAV (Gregor: "oben steiler angesetzt, unten flacher auslaufend"):
    // Kontrollpunkt auf ~1/3-Hoehe -> steiler Einstieg oben, flacheres Ende unten.
    const C = new THREE.Vector3((P0.x + P1.x) / 2, P1.y + (P0.y - P1.y) * 0.32, (P0.z + P1.z) / 2);
    const bez = (t) => {
      const u = 1 - t;
      return new THREE.Vector3(
        u * u * P0.x + 2 * u * t * C.x + t * t * P1.x,
        u * u * P0.y + 2 * u * t * C.y + t * t * P1.y,
        u * u * P0.z + 2 * u * t * C.z + t * t * P1.z);
    };
    // U-Rinne mit hohen Seitenwangen entlang der leicht gebogenen Rampe.
    const hint = this._slideChainNextId === sl.id ? this._slideChainFrame : null;
    this._slideChainFrame = this._addSlideAlongCurve(mat, st, sl.id, bez, 9, hint);
    this._slideChainNextId = target ? target.id : null;
  }

  // Rutschenauslauf (Endstueck): kurzes, FLACHES U-Rinnen-Stueck. Hinten (am
  // Anschluss an den Rutschenkoerper) etwas hoeher, laeuft nach vorne flach und
  // OFFEN aus (Bremszone). Auslaufrichtung = horizontale (kardinale) Laufrichtung
  // der einlaufenden Rutsche. Ersetzt das alte 35×35-Viewer-Kaestchen.
  _addSlideEnd(sl, model, mat, st) {
    // Start = GLEICHER Anschlusspunkt, an dem der Rutschenkoerper endet (kein Versatz).
    const P0 = this._slideEndConnectPoint(sl);
    const groundY = sl.y; // QDF-Bodenhoehe des Auslaufs
    // Einlaufende Rutsche (naechstes Rutschenteil OBERHALB).
    let feeder = null, bestD = Infinity;
    for (const s2 of model.slides.values()) {
      if (s2 === sl) continue;
      if (s2.kind !== "slide2" && s2.kind !== "slide-new2" && s2.kind !== "curved-slide2") continue;
      if (s2.y < sl.y - 1) continue;
      const d = (s2.x - sl.x) ** 2 + (s2.y - sl.y) ** 2 + (s2.z - sl.z) ** 2;
      if (d < bestD) { bestD = d; feeder = s2; }
    }
    // Tangente, mit der die Rutsche hier ankommt -> KNICKFREIER Auslauf-Start:
    // Bogenrutsche = ihre feste Austrittsrichtung; gerade Rutsche = ihr Gefaelle.
    const entryT = feeder
      ? (feeder.kind === "curved-slide2"
          ? this._curvedSlideExit(feeder, model)
          : P0.clone().sub(new THREE.Vector3(feeder.x, feeder.y, feeder.z)).normalize())
      : new THREE.Vector3(0, -1, 0);
    // Horizontale Auslaufrichtung = horizontale (kardinale) Komponente der Einlauf-
    // tangente -> der Auslauf laeuft in DERSELBEN Richtung weiter wie die Rutsche.
    let h = new THREE.Vector3(entryT.x, 0, entryT.z);
    if (h.lengthSq() < 0.04 && feeder) h.set(P0.x - feeder.x, 0, P0.z - feeder.z);
    if (h.lengthSq() < 0.01) h.set(1, 0, 0);
    const fwd = Math.abs(h.z) >= Math.abs(h.x)
      ? new THREE.Vector3(0, 0, Math.sign(h.z) || -1)
      : new THREE.Vector3(Math.sign(h.x) || -1, 0, 0);
    // Kubische Bézier: P0 (Anschluss, Tangente=Rutschenrichtung) -> abfallend ->
    // flacher, offener Auslauf am Boden in fwd-Richtung.
    const front = new THREE.Vector3(P0.x + fwd.x * 50, groundY, P0.z + fwd.z * 50);
    const C1 = P0.clone().addScaledVector(entryT, 14);
    const C2 = front.clone().addScaledVector(fwd, -18);
    const bez = (t) => {
      const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
      return new THREE.Vector3(
        a * P0.x + b * C1.x + c * C2.x + e * front.x,
        a * P0.y + b * C1.y + c * C2.y + e * front.y,
        a * P0.z + b * C1.z + c * C2.z + e * front.z);
    };
    const hint = this._slideChainNextId === sl.id ? this._slideChainFrame : null;
    this._slideChainFrame = this._addSlideAlongCurve(mat, st, sl.id, bez, 7, hint);
    this._slideChainNextId = null; // Endstueck: Kette stoppt hier.
  }

  // Dach-Tuch (roof2) als GIEBEL: findet First (hoechste Knoten nahe roof2) + die
  // C45-Traufen-Ecken und spannt zwei Dachschraegen-Flaechen auf, die sich am First
  // mit ~90°-Knick treffen (Gregor: "startet bei den c45 kupplungen, entlang der
  // Dachschraegen, 90°-Knick oben, andere Schraege zu den c45 kupplungen"). Findet
  // er die Struktur nicht, faellt er auf eine flache Kappe zurueck.
  _addRoof(sl, model, mat, st) {
    const P = new THREE.Vector3(sl.x, sl.y, sl.z);
    const nodes = [...model.nodes.values()];
    const hxz = (n) => Math.hypot(n.x - P.x, n.z - P.z);
    let maxY = -Infinity;
    for (const n of nodes) if (hxz(n) < 80 && n.y > maxY) maxY = n.y;
    const ridge = nodes.filter((n) => Math.abs(n.y - maxY) < 8 && hxz(n) < 80);
    // C45-Traufen-Ecken: C45-Knoten im Dach-Hoehenband, nahe roof2.
    // Bei komplexen Strukturen (z.B. C0178) gibt es C45-Knoten von benachbarten Abschnitten
    // auf verschiedenen Hoehenebenen. Wir nehmen die HOECHSTE Ebene die mind. 4 Knoten liefert
    // (= die echten Traufen-Knoten, die dem First am naechsten liegen).
    const eavesAll = nodes.filter((n) => (n.c45 || n.c45body) && n.y < maxY - 15 && n.y > maxY - 115 && hxz(n) < 140);
    const yLevels = [...new Set(eavesAll.map((n) => Math.round(n.y * 10) / 10))].sort((a, b) => b - a);
    let eaves = eavesAll; // Fallback (triggert eaves.length<4-Check unten)
    for (const y0 of yLevels) {
      const band = eavesAll.filter((n) => Math.abs(n.y - y0) < 8);
      if (band.length >= 4) { eaves = band; break; }
    }
    if (ridge.length < 2 || eaves.length < 4) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(80, 0.6, 80), mat); // Fallback
      m.position.copy(P); m.userData = { kind: "slide", id: sl.id };
      this.buildGroup.add(m); if (st !== "future") this.pickSlides.push(m);
      return;
    }
    // First-Achse = horizontale Achse mit groesster Spannweite unter den First-Knoten.
    const rx = ridge.map((n) => n.x), rz = ridge.map((n) => n.z);
    const alongZ = (Math.max(...rz) - Math.min(...rz)) >= (Math.max(...rx) - Math.min(...rx));
    const ridgeKey = (n) => (alongZ ? n.z : n.x);
    const slopeKey = (n) => (alongZ ? n.x : n.z);
    const slopeCenter = alongZ ? P.x : P.z;
    // First-Endpunkte (auf der Querposition von roof2).
    const rMin = alongZ ? new THREE.Vector3(P.x, maxY, Math.min(...rz)) : new THREE.Vector3(Math.min(...rx), maxY, P.z);
    const rMax = alongZ ? new THREE.Vector3(P.x, maxY, Math.max(...rz)) : new THREE.Vector3(Math.max(...rx), maxY, P.z);
    // Zwei Seiten der Traufen (links/rechts der First-Achse).
    for (const sign of [-1, 1]) {
      const side = eaves.filter((n) => (slopeKey(n) - slopeCenter) * sign > 0);
      if (side.length < 2) continue;
      side.sort((a, b) => ridgeKey(a) - ridgeKey(b));
      const eA = side[0], eB = side[side.length - 1];
      // Quad: Traufe(min) -> Traufe(max) -> First(max) -> First(min).
      this._addRoofQuad([
        new THREE.Vector3(eA.x, eA.y, eA.z), new THREE.Vector3(eB.x, eB.y, eB.z),
        ridgeKey(eB) >= ridgeKey(eA) ? rMax : rMin,
        ridgeKey(eB) >= ridgeKey(eA) ? rMin : rMax,
      ], mat, st, sl.id);
    }
  }

  // Eine Dachschraegen-Flaeche (Rechteck-Quad aus 4 Ecken A,B,C,D) als duenne Platte.
  _addRoofQuad(c, mat, st, id) {
    const [A, B, , D] = c;
    const u = B.clone().sub(A), w = D.clone().sub(A);
    if (u.lengthSq() < 1 || w.lengthSq() < 1) return;
    const center = A.clone().add(B).add(c[2]).add(D).multiplyScalar(0.25);
    const xAxis = u.clone().normalize(), zAxis = w.clone().normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(u.length(), 0.8, w.length()), mat);
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
    mesh.position.copy(center);
    mesh.userData = { kind: "slide", id };
    this.buildGroup.add(mesh);
    if (st !== "future") this.pickSlides.push(mesh);
  }

  // --- Handles (Bau-Anfasser) --------------------------------------------
  // Kreisbogen von va nach vb um den Mittelpunkt center (Bogenrohr, 90 Grad).
  // Liefert null, wenn die Punkte keinen echten Bogen aufspannen (dann wird das
  // Rohr wie ein gerades gezeichnet).
  //
  // trim = Bogenlaenge, die an BEIDEN Enden entfaellt. va/vb sind Kupplungs-
  // MITTEN; ohne Kuerzung liefe die Roehre bis dorthin und schnitte sichtbar
  // durch den Kupplungswuerfel. Gerade Rohre kuerzen dafuer ihre Laenge um
  // connectorSize, hier ist es der zugehoerige Winkel trim/R je Ende.
  _bowCurve(va, vb, center, trim = 0) {
    const C = new THREE.Vector3(center[0], center[1], center[2]);
    const u = va.clone().sub(C);
    const v = vb.clone().sub(C);
    const R = (u.length() + v.length()) / 2;
    if (R < 1e-3) return null;
    u.normalize();
    v.normalize();
    // Komponente von v senkrecht zu u spannt mit u die Bogenebene auf.
    const w = v.clone().addScaledVector(u, -u.dot(v));
    if (w.lengthSq() < 1e-6) return null; // kollinear -> kein Bogen
    w.normalize();
    const ang = Math.acos(Math.max(-1, Math.min(1, u.dot(v))));
    // Punkt und Tangente auf dem Bogen (Winkel waechst von va nach vb).
    const pAt = (th) => C.clone()
      .addScaledVector(u, R * Math.cos(th))
      .addScaledVector(w, R * Math.sin(th));
    const tAt = (th) => w.clone().multiplyScalar(Math.cos(th))
      .addScaledVector(u, -Math.sin(th)).normalize();

    if (trim <= 0) {
      const pts = [];
      const SEG = 16;
      for (let i = 0; i <= SEG; i++) pts.push(pAt((ang * i) / SEG));
      return new THREE.CatmullRomCurve3(pts);
    }

    // Das Rohrende muss BUENDIG auf der Kupplungsflaeche sitzen. Kuerzt man nur
    // den Bogenwinkel, steht die Tangente dort schon um trim/R gedreht -- der
    // Endring wird schraeg angeschnitten (gemessen: 0,51 cm Versatz ueber den
    // Querschnitt, das Ende ragte halb in die Kupplung und halb heraus).
    // Deshalb laeuft das letzte Stueck GERADE in der Kupplungsachse: der Bogen
    // wird um trim + LEAD gekuerzt und um LEAD entlang der Achse am Knoten
    // verlaengert. Die Mittellinie weicht dabei um R*(1-cos) < 0,1 cm vom
    // echten Kreis ab -- unsichtbar, das Ende dafuer exakt rechtwinklig.
    const LEAD = 1.5;
    const dth = Math.min((trim + LEAD) / R, ang * 0.4);
    const span = ang - 2 * dth;
    const pts = [pAt(dth).addScaledVector(tAt(0), -LEAD)];
    const SEG = 16;
    for (let i = 0; i <= SEG; i++) pts.push(pAt(dth + (span * i) / SEG));
    pts.push(pAt(ang - dth).addScaledVector(tAt(ang), LEAD));
    return new THREE.CatmullRomCurve3(pts);
  }

  clearHandles() {
    this._needsRender = true;
    this._disposeGroup(this.handleGroup);
    this.handleMeshes = [];
  }

  addHandle(position, userData, kind = "dir") {
    this._needsRender = true;
    const isOrigin = kind === "origin";
    const isDiag = kind === "diag";
    const geo = isOrigin
      ? new THREE.BoxGeometry(geometry().connectorSize, geometry().connectorSize, geometry().connectorSize)
      : new THREE.SphereGeometry(2.4, 16, 12);
    const mat = this._handleMaterial(kind);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(position[0], position[1], position[2]);
    mesh.userData = Object.assign({ kind: "handle" }, userData);
    mesh.renderOrder = 999;
    this.handleGroup.add(mesh);
    this.handleMeshes.push(mesh);
    return mesh;
  }

  // Anklickbares Kandidaten-Feld fuer eine Platte (Quad aus 4 Eckpunkten).
  addPanelHandle(corners, userData) {
    this._needsRender = true;
    const cx = (corners[0][0] + corners[1][0] + corners[2][0] + corners[3][0]) / 4;
    const cy = (corners[0][1] + corners[1][1] + corners[2][1] + corners[3][1]) / 4;
    const cz = (corners[0][2] + corners[1][2] + corners[2][2] + corners[3][2]) / 4;
    const local = corners.map((c) => [c[0] - cx, c[1] - cy, c[2] - cz]);
    const tri = [0, 1, 2, 0, 2, 3];
    const pos = new Float32Array(18);
    for (let k = 0; k < 6; k++) {
      const p = local[tri[k]];
      pos[k * 3] = p[0]; pos[k * 3 + 1] = p[1]; pos[k * 3 + 2] = p[2];
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const mat = this._panelHandleMaterial();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, cy, cz);
    mesh.userData = Object.assign({ kind: "handle", panelCell: true }, userData);
    mesh.renderOrder = 998;
    this.handleGroup.add(mesh);
    this.handleMeshes.push(mesh);
    return mesh;
  }

  // --- Raycasting ---------------------------------------------------------
  _setMouse(clientX, clientY) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this._mouse.x = ((clientX - r.left) / r.width) * 2 - 1;
    this._mouse.y = -((clientY - r.top) / r.height) * 2 + 1;
    this._raycaster.setFromCamera(this._mouse, this.camera);
  }

  raycastObjects(clientX, clientY, objects) {
    this._setMouse(clientX, clientY);
    const hits = this._raycaster.intersectObjects(objects, false);
    if (!hits.length) return null;
    // Schnittebene aktiv: weggeschnittene Stellen sind nicht anklickbar. Damit
    // faellt ein komplett verdecktes Teil automatisch raus, ein angeschnittenes
    // bleibt an seiner sichtbaren Haelfte waehlbar.
    const plane = this._clipPlane;
    if (!plane) return hits[0];
    for (const h of hits) if (plane.distanceToPoint(h.point) >= 0) return h;
    return null;
  }

  /**
   * Nutzdaten eines Treffers. Bei instanziert gezeichneten Teilen (Kupplungen,
   * Rohre) traegt nicht das Mesh die id, sondern der Platz in userData.instances
   * -- welcher Platz, sagt intersection.instanceId.
   */
  _hitData(hit) {
    if (!hit) return null;
    const o = hit.object;
    if (o.isInstancedMesh) {
      const list = o.userData && o.userData.instances;
      return (list && hit.instanceId != null && list[hit.instanceId]) || null;
    }
    return o.userData || null;
  }

  /**
   * Weltpunkt unter dem Mauszeiger (Bauteil-Treffer, sonst Bodenebene).
   */
  _pointUnderCursor(clientX, clientY) {
    this._setMouse(clientX, clientY);
    const objects = [...this.pickNodes, ...this.pickTubes, ...this.pickPanels,
                     ...this.pickClamps, ...this.pickTextiles, ...this.pickSlides];
    for (const h of this._raycaster.intersectObjects(objects, false)) {
      if (this._clipPlane && this._clipPlane.distanceToPoint(h.point) < 0) continue;
      return h.point.clone();
    }
    // Daneben getroffen: die Kupplung nehmen, die dem Sehstrahl am naechsten
    // liegt. Ein Drehpunkt auf dem leeren Boden liegt sonst je nach Blickwinkel
    // weit weg vom Modell und das Drehen fuehlt sich wieder aus wie um nichts.
    let best = null, bestD = Infinity;
    for (const v of this._nodePoints) {
      if (this._clipPlane && this._clipPlane.distanceToPoint(v) < 0) continue;
      const d = this._raycaster.ray.distanceToPoint(v);
      if (d < bestD) { bestD = d; best = v.clone(); }
    }
    if (best) return best;
    // Gar kein Modell: auf die Bodenebene ausweichen.
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const p = new THREE.Vector3();
    return this._raycaster.ray.intersectPlane(ground, p) ? p : null;
  }

  /**
   * Drehen um den Punkt unter dem Mauszeiger -- eigene Implementierung, weil
   * OrbitControls immer um controls.target dreht und die Kamera in update() per
   * lookAt darauf ausrichtet. Ein verschobener target liesse das Bild also
   * springen (der Drehpunkt landet in der Bildmitte).
   *
   * Stattdessen wird das ganze Gespann aus Kamera-Position, Kamera-Ausrichtung
   * UND controls.target als starrer Koerper um den Drehpunkt gedreht. Der Blick
   * bleibt dadurch exakt erhalten (kein Sprung), der Punkt unter dem Zeiger
   * steht still, und weil der target mitwandert, passt anschliessend auch das
   * lookAt von OrbitControls genau zur gesetzten Ausrichtung.
   */
  beginOrbit(clientX, clientY) {
    this._orbitPivot = this._pointUnderCursor(clientX, clientY);
    return !!this._orbitPivot;
  }

  /**
   * Drehen um den aktuellen Bezugspunkt statt um einen Punkt unter dem Zeiger.
   * Fuer das Ziehen am Ansichtswuerfel: dort liegt der Zeiger neben der Szene.
   */
  beginOrbitAtTarget() {
    this._orbitPivot = this.controls ? this.controls.target.clone() : null;
    return !!this._orbitPivot;
  }

  endOrbit() {
    if (!this._orbitPivot) return;
    this._orbitPivot = null;
    this._reanchorTarget();
    this.onCameraChange();
  }

  /**
   * controls.target wieder auf die Modelloberflaeche in Blickmitte setzen.
   *
   * OrbitControls leitet BEIDES vom Abstand Kamera<->target ab: die Schrittweite
   * beim Zoomen (multiplikativ) und die Geschwindigkeit beim Verschieben
   * (proportional). Zoomt man laenger hinein, schrumpft dieser Abstand
   * geometrisch gegen null -- danach bewegt sich beim Schieben fast nichts mehr
   * und die Zoomschritte sind winzig. Der target wandert durch zoomToCursor
   * ausserdem seitlich aus dem Modell heraus.
   *
   * Der neue Punkt liegt auf der BLICKACHSE, nicht am Trefferpunkt: so bleibt
   * das Bild unveraendert (OrbitControls richtet die Kamera per lookAt auf den
   * target aus), nur der Bezugsabstand stimmt wieder.
   */
  _reanchorTarget() {
    if (!this.controls) return false;
    const r = this.renderer.domElement.getBoundingClientRect();
    const p = this._pointUnderCursor(r.left + r.width / 2, r.top + r.height / 2);
    if (!p) return false;
    const dist = this.camera.position.distanceTo(p);
    if (!(dist > 0.01)) return false;
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    this.controls.target.copy(this.camera.position).addScaledVector(fwd, dist);
    this.controls.update();
    this._needsRender = true;
    return true;
  }

  get orbiting() { return !!this._orbitPivot; }

  orbitBy(dx, dy) {
    const P = this._orbitPivot;
    if (!P) return;
    this._needsRender = true;
    const h = this.container.clientHeight || 1;
    const yaw = -2 * Math.PI * dx / h;
    const pitch = -2 * Math.PI * dy / h;
    const cam = this.camera;
    cam.updateMatrixWorld();
    // Waagerecht halten: nur um die Welt-Y-Achse und um die WAAGERECHTE
    // Kamera-Rechtsachse drehen -- so sammelt sich keine Rollung an.
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    right.y = 0;
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
    right.normalize();
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);

    // Neigung so BEGRENZEN, dass der Blick knapp vor dem Pol stehen bleibt --
    // frueher wurde sie ab 84 Grad ganz verworfen, die Draufsicht war damit gar
    // nicht erreichbar. Der Rest von 0,1 Grad haelt OrbitControls (rechnet mit
    // fester Oben-Achse) aus der Entartung heraus und ist nicht zu sehen.
    const clamp1 = (v) => Math.max(-1, Math.min(1, v));
    const phi = Math.asin(clamp1(fwd.y));
    // Vorzeichen: hebt eine positive Neigung um `right` den Blick oder senkt sie ihn?
    const probe = fwd.clone().applyQuaternion(
      new THREE.Quaternion().setFromAxisAngle(right, 1e-3));
    const sign = probe.y >= fwd.y ? 1 : -1;
    const phiNext = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, phi + sign * pitch));
    const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const qPitch = new THREE.Quaternion().setFromAxisAngle(right, sign * (phiNext - phi));
    const q = qYaw.multiply(qPitch);

    const move = (v) => v.sub(P).applyQuaternion(q).add(P);
    move(cam.position);
    if (this.controls) move(this.controls.target);
    cam.quaternion.premultiply(q);
    cam.updateMatrixWorld();
  }

  /** Kamerazustand zum Sichern (Position, Ziel, Zoom). */
  cameraState() {
    if (!this.controls) return null;
    return {
      pos: this.camera.position.toArray(),
      target: this.controls.target.toArray(),
      zoom: this.camera.zoom,
    };
  }

  restoreCameraState(st) {
    this._needsRender = true;
    if (!st || !this.controls || !Array.isArray(st.pos) || !Array.isArray(st.target)) return false;
    this.camera.position.fromArray(st.pos);
    this.controls.target.fromArray(st.target);
    if (typeof st.zoom === "number" && st.zoom > 0) this.camera.zoom = st.zoom;
    this.camera.updateProjectionMatrix();
    this._updateOrthoFrustum();
    this.controls.update();
    return true;
  }

  // --- Schnittebene --------------------------------------------------------
  // Blendet alles vor der Ebene aus (echtes Clipping, keine Objekt-Sichtbarkeit)
  // -- ein Rohr, das die Ebene kreuzt, bleibt zur Haelfte stehen.
  // axis: "x" | "y" | "z", value in cm, flip dreht die sichtbare Seite um.
  setClip(axis, value, flip) {
    const n = axis === "x" ? [1, 0, 0] : axis === "y" ? [0, 1, 0] : [0, 0, 1];
    const sign = flip ? 1 : -1;
    const normal = new THREE.Vector3(n[0] * sign, n[1] * sign, n[2] * sign);
    const constant = flip ? -value : value;
    if (this._clipPlane) this._clipPlane.set(normal, constant);
    else this._clipPlane = new THREE.Plane(normal, constant);
    this.renderer.clippingPlanes = [this._clipPlane];
    this._shadowsDirty();
  }

  clearClip() {
    this._clipPlane = null;
    this.renderer.clippingPlanes = [];
    this._shadowsDirty();
  }

  get clipping() { return !!this._clipPlane; }

  pickHandle(clientX, clientY) {
    const hit = this.raycastObjects(clientX, clientY, this.handleMeshes);
    // distance: Abstand zur Kamera -- damit laesst sich ein Griff gegen ein
    // Bauteil abwaegen, das davor liegt.
    return hit ? { object: hit.object, data: hit.object.userData, distance: hit.distance } : null;
  }

  /**
   * Erster Treffer entlang des Strahls, dessen id in `ids` steht -- auch wenn
   * etwas davor liegt. Gebraucht im Platten-Modus: die hervorgehobenen
   * Gegenrohre scheinen durch die zurueckgeblendeten Teile hindurch und sollen
   * sich auch dann anklicken lassen.
   */
  pickAmong(clientX, clientY, ids) {
    if (!ids || !ids.size) return null;
    this._setMouse(clientX, clientY);
    const objs = [...this.pickTubes, ...this.pickNodes, ...this.pickPanels,
                  ...this.pickClamps, ...this.pickTextiles, ...this.pickSlides,
                  ...this.pickFittings];
    for (const hit of this._raycaster.intersectObjects(objs, false)) {
      if (this._clipPlane && this._clipPlane.distanceToPoint(hit.point) < 0) continue;
      const data = this._hitData(hit);
      if (data && ids.has(data.id)) return { object: hit.object, data, point: hit.point, distance: hit.distance };
    }
    return null;
  }

  // Nur Rohre treffen -- fuer Teile, die auf einem Rohr sitzen und deshalb
  // durch schon gesetzte Anbauteile hindurch zielen muessen.
  pickTube(clientX, clientY) {
    const hit = this.raycastObjects(clientX, clientY, this.pickTubes);
    const data = this._hitData(hit);
    return data ? { object: hit.object, data, point: hit.point, distance: hit.distance } : null;
  }

  pickBuild(clientX, clientY) {
    const hit = this.raycastObjects(
      clientX, clientY,
      [...this.pickNodes, ...this.pickTubes, ...this.pickPanels, ...this.pickClamps,
       ...this.pickTextiles, ...this.pickFittings]
    );
    const data = this._hitData(hit);
    return data ? { object: hit.object, data, point: hit.point, distance: hit.distance } : null;
  }

  // Wie pickBuild, aber inkl. Rutschen/Dächer (nur fuers Loeschen relevant; im
  // Bau-Modus sollen die dekorativen Platzhalter keine Klicks abfangen).
  pickForDelete(clientX, clientY) {
    const hit = this.raycastObjects(
      clientX, clientY,
      [...this.pickNodes, ...this.pickTubes, ...this.pickPanels, ...this.pickClamps,
       ...this.pickTextiles, ...this.pickSlides, ...this.pickFittings]
    );
    const data = this._hitData(hit);
    return data ? { object: hit.object, data, point: hit.point, distance: hit.distance } : null;
  }

  // --- Auswahl-Rechteck (Cursor-Modus) ------------------------------------

  showSelectBox(x0, y0, x1, y1) {
    this._needsRender = true;
    if (!this._selectBox) {
      this._selectBox = document.createElement("div");
      this._selectBox.className = "select-box";
      this.container.appendChild(this._selectBox);
    }
    const r = this.renderer.domElement.getBoundingClientRect();
    const b = this._selectBox;
    b.hidden = false;
    b.style.left = (Math.min(x0, x1) - r.left) + "px";
    b.style.top = (Math.min(y0, y1) - r.top) + "px";
    b.style.width = Math.abs(x1 - x0) + "px";
    b.style.height = Math.abs(y1 - y0) + "px";
  }

  hideSelectBox() {
    this._needsRender = true;
    if (this._selectBox) this._selectBox.hidden = true;
  }

  /**
   * Alle waehlbaren Teile, deren Mittelpunkt im Bildschirm-Rechteck liegt.
   * Der Mittelpunkt entscheidet (nicht die Huelle): ein langes Rohr, das nur
   * durch das Rechteck streift, gilt damit als nicht enthalten.
   * Liefert id -> kind, passend zu builder.selection.
   */
  pickInRect(x0, y0, x1, y1) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
    const out = new Map();
    const v = new THREE.Vector3();
    this._forEachPickable((d, center) => {
      if (out.has(d.id)) return;
      v.copy(center).project(this.camera);
      if (v.z > 1) return;   // hinter der Kamera
      const sx = r.left + (v.x * 0.5 + 0.5) * r.width;
      const sy = r.top + (-v.y * 0.5 + 0.5) * r.height;
      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) out.set(d.id, d.kind);
    });
    return out;
  }

  /** Alles, was gerade waehlbar ist (Strg+A). Liefert id -> kind. */
  selectableParts() {
    const out = new Map();
    this._forEachPickable((d) => { if (!out.has(d.id)) out.set(d.id, d.kind); });
    return out;
  }

  /**
   * Ruft cb(data, weltMittelpunkt) fuer jedes waehlbare Teil auf. Der Mittel-
   * punkt entscheidet (nicht die Huelle): ein langes Rohr, das nur durch das
   * Rechteck streift, gilt damit als nicht enthalten. Weggeschnittene Teile
   * (Schnittebene) bleiben aussen vor -- sie sind nicht sichtbar und sollen
   * deshalb auch per Rechteck oder Strg+A nicht in die Auswahl geraten.
   */
  _forEachPickable(cb) {
    const c = new THREE.Vector3();
    const mat = new THREE.Matrix4();
    this.scene.updateMatrixWorld();
    const meshes = [...this.pickNodes, ...this.pickTubes, ...this.pickPanels,
                    ...this.pickClamps, ...this.pickTextiles, ...this.pickSlides,
                    ...this.pickFittings];
    const emit = (m, world, d) => {
      if (!d || !d.id) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      m.geometry.boundingBox.getCenter(c).applyMatrix4(world);
      if (this._clipPlane && this._clipPlane.distanceToPoint(c) < 0) return;
      cb(d, c);
    };
    for (const m of meshes) {
      if (m.isInstancedMesh) {
        const list = (m.userData && m.userData.instances) || [];
        for (let i = 0; i < list.length; i++) {
          if (!list[i]) continue;
          m.getMatrixAt(i, mat);
          emit(m, mat.premultiply(m.matrixWorld), list[i]);
        }
      } else {
        emit(m, m.matrixWorld, m.userData);
      }
    }
  }

  setHover(object) {
    if (this._hover === object) return;
    this._needsRender = true;
    if (this._hover && this._hover.userData.kind === "handle") {
      if (this._hover.userData.panelCell) this._hover.material = this._panelHandleMaterial(false);
      else this._hover.scale.setScalar(1);
    }
    this._hover = object;
    if (object && object.userData.kind === "handle") {
      if (object.userData.panelCell) object.material = this._panelHandleMaterial(true);
      else object.scale.setScalar(1.6);
    }
    this.container.style.cursor = object ? "pointer" : "default";
  }

  _disposeGroup(group) {
    const keep = this._keepGeos;
    for (const g of [this._connGeo, this._clampGeo, this._clampRingGeo, this._c45Geo, this._c45StubGeo])
      if (g) keep.add(g);
    for (let i = group.children.length - 1; i >= 0; i--) {
      const c = group.children[i];
      // Rekursiv (verschachtelte Gruppen, z.B. Rutschen) Geometrien freigeben.
      c.traverse((o) => {
        // InstancedMesh haelt eigene Attribut-Puffer (Matrizen) auf der GPU --
        // die gibt nur dispose() frei, nicht das Wegwerfen der Geometrie.
        if (o.isInstancedMesh) o.dispose();
        if (o.geometry && !keep.has(o.geometry)) o.geometry.dispose();
      });
      group.remove(c);
    }
  }

  // --- Prozedurales Gras (Instanced + Wind-Shader, keine Asset-Datei) --------
  // Ein konisch zulaufendes Grashalm-Mesh wird via InstancedMesh tausendfach
  // gestreut; ein Vertex-Shader biegt jeden Halm windabhaengig (Hoehe², Zeit,
  // Position, Zufallsphase). Darunter eine gruene Bodenflaeche. Alles statisch
  // in der Szene (NICHT in buildGroup, wird also nicht pro Render neu gebaut).
  // Prozedurale Gras-Textur: Canvas mit zufälligen Halm-Strichen aus der
  // Vogelperspektive → kein 3D-Geometry-Aufwand, kein Asset.
  _makeGrassTexture() {
    const S = 256;
    const cv = document.createElement("canvas");
    cv.width = cv.height = S;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#3d6620";
    ctx.fillRect(0, 0, S, S);
    const tones = ["#4d8228", "#3d6620", "#5c9430", "#466e24", "#52882e", "#3a5e1c"];
    for (let i = 0; i < 4000; i++) {
      const x = Math.random() * S, y = Math.random() * S;
      const len = 2 + Math.random() * 7;
      const a = Math.random() * Math.PI;
      ctx.strokeStyle = tones[Math.floor(Math.random() * tones.length)];
      ctx.lineWidth = 0.7 + Math.random() * 1.1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(64, 64);   // 1600 cm / 64 ≈ 25 cm pro Kachel
    return tex;
  }

  // Grasfläche als texturierter Boden (keine 3D-Halme). Empfängt Schatten der
  // Bauteile; Cull-Maske ist inaktiv wenn _grassMesh null ist.
  _buildGrass(opts = {}) {
    const area = opts.area || 1600;
    const env = new THREE.Group();
    env.name = "grass-env";

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(area, area),
      new THREE.MeshLambertMaterial({ map: this._makeGrassTexture() })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.4;
    ground.receiveShadow = true;
    env.add(ground);

    this.scene.add(env);
    this._grassEnv  = env;
    this._grassMesh = null;   // keine Halm-Instanzen → _updateGrassMask ist no-op
    this._grassXZ   = null;
    this._grassCull = null;
    this._grassMat  = null;
    this._grassArea = area;
    this._grassClearH = 32;
  }

  // Halme dort ausblenden, wo bodennahe Bauteile (y <= _grassClearH) stehen.
  // Pro renderModel() neu: grobes XZ-Belegungsraster (Uint8) aus Rohren/Knoten/
  // Platten/Rutschen, dann je Halm aCull=1, wenn seine Rasterzelle belegt ist.
  _updateGrassMask(model) {
    if (!this._grassMesh || !this._grassXZ || !model) return;
    const area = this._grassArea, half = area / 2, H = this._grassClearH;
    const CELL = 4;                          // cm pro Rasterzelle
    const N = Math.ceil(area / CELL);
    const occ = new Uint8Array(N * N);
    const g = geometry();
    const tubeR = g.tubeRadius + 3;
    const nodeR = Math.max(g.connectorSize / 2, g.tubeRadius) + 3;

    const markDisc = (x, z, r) => {
      const r2 = r * r;
      let cx0 = Math.floor((x - r + half) / CELL), cx1 = Math.floor((x + r + half) / CELL);
      let cz0 = Math.floor((z - r + half) / CELL), cz1 = Math.floor((z + r + half) / CELL);
      if (cx0 < 0) cx0 = 0; if (cz0 < 0) cz0 = 0;
      if (cx1 >= N) cx1 = N - 1; if (cz1 >= N) cz1 = N - 1;
      for (let cz = cz0; cz <= cz1; cz++) {
        const dz = (cz + 0.5) * CELL - half - z;
        for (let cx = cx0; cx <= cx1; cx++) {
          const dx = (cx + 0.5) * CELL - half - x;
          if (dx * dx + dz * dz <= r2) occ[cz * N + cx] = 1;
        }
      }
    };
    // Rohr: 3D-Strecke abtasten, nur wo y <= H markieren (Bodenrohr -> ganze
    // Strecke; Stuetze -> nur der Fuss; erhoehtes Rohr -> nichts).
    const markTube = (a, b, r) => {
      const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      const steps = Math.max(1, Math.ceil(len / (CELL * 0.5)));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        if (a.y + (b.y - a.y) * t > H) continue;
        markDisc(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, r);
      }
    };

    for (const tb of model.tubes.values()) {
      const a = model.nodes.get(tb.a), b = model.nodes.get(tb.b);
      if (!a || !b || Math.min(a.y, b.y) > H) continue;
      markTube(a, b, tubeR);
    }
    for (const n of model.nodes.values()) {
      if (n.y <= H) markDisc(n.x, n.z, nodeR);
    }
    // Platten/Netze: nur waagerechte Bodenplatten flaechig (Wandplatten decken
    // ihre Rahmen-Rohre/Knoten schon ab).
    const fillPanels = (coll) => {
      if (!coll) return;
      for (const p of coll.values()) {
        const ns = p.nodes.map((id) => model.nodes.get(id)).filter(Boolean);
        if (ns.length < 3) continue;
        let minY = Infinity, maxY = -Infinity;
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const v of ns) {
          if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
          if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
          if (v.z < minZ) minZ = v.z; if (v.z > maxZ) maxZ = v.z;
        }
        if (minY > H || maxY - minY > 8) continue; // nicht bodennah / nicht flach
        for (let z = minZ; z <= maxZ; z += CELL)
          for (let x = minX; x <= maxX; x += CELL) markDisc(x, z, CELL);
      }
    };
    fillPanels(model.panels);
    fillPanels(model.textiles);
    // Rutschen: tatsächliche Mesh-Positionen aus buildGroup verwenden (QDF-
    // Koordinaten stimmen nicht mit den gerenderten Positionen überein, da Bézier-
    // Versatz + _slideEndConnectPoint das Endstück verschiebt).
    this.buildGroup.traverse(child => {
      if (!child.isMesh || child.userData.kind !== "slide") return;
      const wy = child.position.y;
      if (wy > H) return;
      markDisc(child.position.x, child.position.z, 25);
    });

    // Je Halm: Rasterzelle belegt -> wegcullen.
    const xz = this._grassXZ, arr = this._grassCull.array, m = arr.length;
    for (let i = 0; i < m; i++) {
      const cx = Math.floor((xz[i * 2] + half) / CELL);
      const cz = Math.floor((xz[i * 2 + 1] + half) / CELL);
      arr[i] = (cx >= 0 && cx < N && cz >= 0 && cz < N && occ[cz * N + cx]) ? 1 : 0;
    }
    this._grassCull.needsUpdate = true;
  }

  // Gradient-Himmel: große Kugel (BackSide) mit GLSL-Verlauf Horizont → Zenit.
  _buildSky() {
    const mat = new THREE.ShaderMaterial({
      vertexShader: `
        varying float vY;
        void main() {
          vY = normalize(position).y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uHorizon;
        uniform vec3 uZenith;
        varying float vY;
        void main() {
          float t = clamp(vY * 2.5 + 0.10, 0.0, 1.0);
          gl_FragColor = vec4(mix(uHorizon, uZenith, t * t), 1.0);
        }`,
      uniforms: {
        uHorizon: { value: new THREE.Color(0xc9dff2) },
        uZenith:  { value: new THREE.Color(0x3a7bbb) },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest:  false,
    });
    this._skyMesh = new THREE.Mesh(new THREE.SphereGeometry(4800, 16, 10), mat);
    this._skyMesh.renderOrder = -1;
    this.scene.add(this._skyMesh);
    // Hintergrundfarbe auf Horizont setzen (kein sichtbarer Naht bei Abweichung).
    this.scene.background.set(0xc9dff2);
  }

  // Prozedurale Bäume am Rand der Grasfläche (Ring r 620–780 cm; die Fläche
  // reicht bis 790). Frueher standen sie bei 450–700 cm und ragten damit in
  // grosse Modelle hinein.
  // Geometrien und Materialien werden einmalig geteilt; per-Baum nur Transform.
  _buildTrees() {
    const trunkMat  = new THREE.MeshLambertMaterial({ color: 0x6b5a3e }); // graubraun (Obstbaumrinde)
    const crownMatA = new THREE.MeshLambertMaterial({ color: 0x4a8022 }); // frisches Grün
    const crownMatB = new THREE.MeshLambertMaterial({ color: 0x5a9428 });
    const crownMatC = new THREE.MeshLambertMaterial({ color: 0x3d7018 });
    // Obstbäume (Apfel/Birne/Pflaume): 250–350 cm hoch, kurzer dicker Stamm,
    // breite runde Krone — typisch für Hausgarten.
    const trunkGeo  = new THREE.CylinderGeometry(8, 13, 100, 7);
    const crownGeoA = new THREE.SphereGeometry(120, 8, 6);
    const crownGeoB = new THREE.SphereGeometry(100, 7, 5);
    const crownGeoC = new THREE.SphereGeometry(85,  7, 5);

    const group = new THREE.Group();
    this._treeNodes = [];

    // Deterministischer LCG-RNG (reproduzierbare Positionen je Session).
    let seed = 137;
    const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };

    for (let i = 0; i < 60; i++) {
      const r = 620 + rng() * 160;          // 620–780 cm vom Mittelpunkt
      const θ = rng() * Math.PI * 2;
      const tx = Math.cos(θ) * r, tz = Math.sin(θ) * r;
      if (Math.abs(tx) > 790 || Math.abs(tz) > 790) continue; // außerhalb der Fläche

      const sc = 0.65 + rng() * 0.75;       // Skalierung 0.65–1.4
      const ox2 = (rng() - 0.5) * 60, oz2 = (rng() - 0.5) * 60;
      const ox3 = (rng() - 0.5) * 50, oz3 = (rng() - 0.5) * 50;

      const tg = new THREE.Group();
      tg.position.set(tx, 0, tz);
      tg.scale.setScalar(sc);
      tg.rotation.y = rng() * Math.PI * 2;

      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 50; trunk.castShadow = true; tg.add(trunk);  // kurzer Stamm (100/2)

      const c1 = new THREE.Mesh(crownGeoA, crownMatA);
      c1.position.set(0, 175, 0); c1.castShadow = true; tg.add(c1);  // breite Hauptkrone

      const c2 = new THREE.Mesh(crownGeoB, crownMatB);
      c2.position.set(ox2, 210, oz2); c2.castShadow = true; tg.add(c2);

      const c3 = new THREE.Mesh(crownGeoC, crownMatC);
      c3.position.set(ox3, 195, oz3); c3.castShadow = true; tg.add(c3);

      group.add(tg);
      this._treeNodes.push({ group: tg, x: tx, z: tz });
    }

    this.scene.add(group);
    this._treeGroup = group;

    this._buildBushes();
  }

  _buildBushes() {
    const bushGeo = new THREE.SphereGeometry(30, 8, 6);
    const bushMat = new THREE.MeshLambertMaterial({ color: 0x2d5a27 });

    const group = new THREE.Group();
    this._bushNodes = [];

    let seed = 138;
    const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };

    for (let i = 0; i < 40; i++) {
      const r = 450 + rng() * 450;          // 450–900 cm vom Mittelpunkt
      const θ = rng() * Math.PI * 2;
      const tx = Math.cos(θ) * r, tz = Math.sin(θ) * r;
      if (Math.abs(tx) > 790 || Math.abs(tz) > 790) continue;

      const sc = 0.5 + rng() * 0.5;
      const ox = (rng() - 0.5) * 40, oz = (rng() - 0.5) * 40;

      const tg = new THREE.Group();
      tg.position.set(tx, 0, tz);
      tg.scale.setScalar(sc);
      tg.rotation.y = rng() * Math.PI * 2;

      const bush = new THREE.Mesh(bushGeo, bushMat);
      bush.position.y = 15; // Höhe ca. 30cm
      bush.castShadow = true;
      tg.add(bush);

      group.add(tg);
      this._bushNodes.push({ group: tg, x: tx, z: tz });
    }

    this.scene.add(group);
    this._bushGroup = group;
  }

  // Bäume ausblenden, die zu nah an einem Modellknoten stehen.
  // Prüft Abstand zu Modellknoten und setzt t.blocked. Die tatsächliche
  // Sichtbarkeit wird pro Frame von _updateTreeCamera() kombiniert.
  // Bewuchs ausblenden, der dem Bauwerk zu nahe kommt. Zwei Kriterien:
  // direkt an einer Kupplung (dichter Bewuchs im Geruest) und innerhalb des
  // Grundrisses plus Sicherheitsabstand -- Letzteres faengt grosse Modelle ab,
  // die sonst bis in den Baumring reichen wuerden. Die Baumpositionen selbst
  // stehen fest (einmal gestreut), nur die Sichtbarkeit wird nachgefuehrt.
  _updateTrees(model) {
    if (!this._treeNodes) return;
    const nodes = model && model.nodes ? [...model.nodes.values()] : [];
    const CLEAR2 = 90 * 90;
    const KEEP_OUT = 250;   // cm Abstand zum Grundriss
    // Grundriss-Radius um den Ursprung (waagerecht).
    let reach = 0;
    for (const n of nodes) reach = Math.max(reach, Math.hypot(n.x, n.z));
    const keepOut2 = (reach + KEEP_OUT) * (reach + KEEP_OUT);
    const markBlocked = (list) => {
      for (const t of list) {
        if (t.x * t.x + t.z * t.z < keepOut2) { t.blocked = true; continue; }
        let close = false;
        for (const n of nodes) {
          const dx = t.x - n.x, dz = t.z - n.z;
          if (dx * dx + dz * dz < CLEAR2) { close = true; break; }
        }
        t.blocked = close;
      }
    };
    markBlocked(this._treeNodes);
    if (this._bushNodes) markBlocked(this._bushNodes);
  }

  // Pro Frame: Bäume + Büsche im 90°-Sektor hinter der Kamera ausblenden (270° sichtbar).
  // Kombiniert mit t.blocked (Abstand zum Gerüst) und treeGroup/bushGroup.visible (Szene).
  _updateTreeCamera() {
    const tx = this.controls.target.x, tz = this.controls.target.z;
    const cx = this.camera.position.x - tx, cz = this.camera.position.z - tz;
    const cl = Math.hypot(cx, cz);

    // Liefert true, wenn sich mindestens eine Sichtbarkeit geaendert hat --
    // nur dann braucht es ein neues Bild.
    let changed = false;
    const setVis = (t, v) => { if (t.group.visible !== v) { t.group.visible = v; changed = true; } };
    const updateNodes = (nodes, groupVisible) => {
      if (!nodes || !groupVisible) return;
      if (cl < 1) { nodes.forEach(t => { if (!t.blocked) setVis(t, true); }); return; }
      const cnx = cx / cl, cnz = cz / cl;
      for (const t of nodes) {
        if (t.blocked) { setVis(t, false); continue; }
        const dx = t.x - tx, dz = t.z - tz;
        const dl = Math.hypot(dx, dz);
        if (dl < 1) { setVis(t, true); continue; }
        // dot > cos(45°)=0.707 → Objekt im 90°-Kamera-Sektor → ausblenden.
        setVis(t, (dx / dl) * cnx + (dz / dl) * cnz < 0.707);
      }
    };

    updateNodes(this._treeNodes, this._treeGroup?.visible);
    updateNodes(this._bushNodes, this._bushGroup?.visible);
    return changed;
  }

  // Szene komplett ein-/ausblenden (Gras, Bäume, Himmel, Licht, Schatten).
  // Ersetzt setGrass(); wird weiterhin von ui.js als scene.setScene(on) aufgerufen.
  setScene(on) {
    this._shadowsDirty();
    const v = !!on;
    if (this._grassEnv)  this._grassEnv.visible  = v;
    if (this._skyMesh)   this._skyMesh.visible    = v;
    if (this._treeGroup) this._treeGroup.visible  = v;
    if (this._bushGroup) this._bushGroup.visible  = v; // Büsche: nur im Szene-Modus
    // Direktionales Licht + Schatten ein-/ausschalten.
    if (this._dirLight) {
      this._dirLight.visible    = v;
      this._dirLight.castShadow = v;
      this._dirLight.intensity  = 1.9; // Szene-Modus: helles Sonnenlicht
    }
    // Hemisphärenlicht: im Builder-Modus neutral weiß, im Szene-Modus warm.
    if (this._hemiLight) {
      this._hemiLight.intensity = v ? 1.1 : 1.4;   // Szene heller, Normal leicht aufgehellt
      this._hemiLight.color.set(v ? 0xcde7ff : 0xffffff);
      this._hemiLight.groundColor.set(v ? 0x7a9060 : 0x8090a0);
    }
    // Hintergrundfarbe: Horizont-Blau wenn Szene an, neutrales Grau sonst.
    if (this.scene.background) this.scene.background.set(v ? 0xc9dff2 : 0xeef1f5);
  }

  /**
   * Ein Bild anfordern. Gezeichnet wird nur nach einer echten Aenderung --
   * die Schleife lief vorher stur mit 60 Bildern/s weiter, auch wenn nichts
   * passierte. Bei jedem Zweifel lieber ein Bild zu viel anfordern.
   */
  requestRender() { this._needsRender = true; }

  /** Schattenkarte einmalig neu rechnen lassen (Modell/Szene/Schnitt geaendert). */
  _shadowsDirty() {
    this.renderer.shadowMap.needsUpdate = true;
    this._needsRender = true;
  }

  // --- Ansichtswuerfel -----------------------------------------------------
  // Kleiner Wuerfel oben rechts, der die Blickrichtung zeigt und auf Klick die
  // Kamera dorthin schwenkt (Vorbild Fusion 360).
  //
  // Gezeichnet wird er im SELBEN Renderer ueber setViewport/setScissor, nicht
  // in einem zweiten Canvas: ein zweiter WebGL-Kontext kostet auf der
  // GPU-losen Testmaschine spuerbar und muesste beim Renderer-Tausch
  // (Kantenglaettung) mitgezogen werden.
  _buildViewCube() {
    this._cubeScene = new THREE.Scene();
    // Orthografisch, damit der Wuerfel unabhaengig von der Hauptprojektion
    // immer gleich aussieht. Der Ausschnitt fasst auch die Ecken der Diagonale.
    this._cubeCam = new THREE.OrthographicCamera(-1.75, 1.75, 1.75, -1.75, 0.1, 40);
    // Hell ausgeleuchtet: der Wuerfel ist ein Bedienelement, kein Bauteil --
    // er soll vor jedem Hintergrund gleich gut lesbar sein.
    this._cubeScene.add(new THREE.AmbientLight(0xffffff, 2.0));
    const light = new THREE.DirectionalLight(0xffffff, 1.1);
    light.position.set(4, 6, 5);
    this._cubeScene.add(light);

    // Wuerfelkoerper. Materialreihenfolge von BoxGeometry: +X, -X, +Y, -Y, +Z, -Z.
    this._cubeFaceOrder = ["right", "left", "top", "bottom", "front", "back"];
    this._cubeFaceMats = this._cubeFaceOrder.map(() => new THREE.MeshLambertMaterial({ color: 0xf2f4f8 }));
    this._cubeBody = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), this._cubeFaceMats);
    this._cubeScene.add(this._cubeBody);

    // Kanten nachziehen, sonst verschwimmt der Wuerfel vor hellem Hintergrund.
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(this._cubeBody.geometry),
      new THREE.LineBasicMaterial({ color: 0x8a94a3 }));
    this._cubeScene.add(edges);

    // 26 Klickfelder: das 3x3x3-Raster ohne die Mitte. Ein Feld mit einer
    // Nicht-Null-Achse ist eine Flaeche, mit zweien eine Kante, mit dreien eine
    // Ecke -- die Blickrichtung ist einfach seine normierte Lage.
    this._cubeCellMat = new THREE.MeshBasicMaterial({
      color: 0x1a8cff, transparent: true, opacity: 0, depthWrite: false });
    this._cubeCellHoverMat = new THREE.MeshBasicMaterial({
      color: 0x1a8cff, transparent: true, opacity: 0.42, depthWrite: false });
    this._cubeCells = [];
    const third = 2 / 3;
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          if (!x && !y && !z) continue;
          const cell = new THREE.Mesh(
            new THREE.BoxGeometry(third, third, third), this._cubeCellMat);
          // Knapp ausserhalb der Wuerfelflaeche, damit die Hervorhebung nicht
          // mit dem Koerper um dieselben Pixel streitet.
          cell.position.set(x * third * 1.03, y * third * 1.03, z * third * 1.03);
          cell.userData = { dir: [x, y, z] };
          this._cubeScene.add(cell);
          this._cubeCells.push(cell);
        }
      }
    }
    this._cubeHover = null;
    this._cubeEnabled = true;
  }

  /**
   * Beschriftung der sechs Flaechen. Kommt von aussen (ui.js), damit scene.js
   * die Sprachdateien nicht kennen muss; bei Sprachwechsel erneut aufrufen.
   * labels: { right, left, top, bottom, front, back }
   */
  setViewCubeLabels(labels) {
    if (!this._cubeFaceMats) return;
    this._cubeFaceOrder.forEach((key, i) => {
      const mat = this._cubeFaceMats[i];
      if (mat.map) mat.map.dispose();
      mat.map = this._cubeFaceTexture(labels[key] || "");
      mat.needsUpdate = true;
    });
    this._needsRender = true;
  }

  _cubeFaceTexture(text) {
    const S = 128;
    const cv = document.createElement("canvas");
    cv.width = cv.height = S;
    const g = cv.getContext("2d");
    g.fillStyle = "#f2f4f8";
    g.fillRect(0, 0, S, S);
    g.fillStyle = "#1f2733";
    g.font = "700 23px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(String(text).toUpperCase(), S / 2, S / 2);
    const tex = new THREE.CanvasTexture(cv);
    // Ohne sRGB-Kennzeichnung liest Three die Farbwerte als linear und die
    // Schrift kommt ausgewaschen heraus (gemessen: Helligkeit 140 statt 50
    // gegen einen Grund von 220).
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  /** Ausschnitt des Wuerfels in CSS-Pixeln, gemessen von der linken oberen Ecke. */
  _cubeRect() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (w < CUBE_PX * 2 || h < CUBE_PX * 2) return null;   // zu wenig Platz
    return { x: w - CUBE_PX - CUBE_MARGIN, y: CUBE_MARGIN, size: CUBE_PX, w, h };
  }

  _renderViewCube() {
    if (!this._cubeEnabled) return;
    const r = this._cubeRect();
    if (!r) return;
    // Wuerfel genauso ausrichten wie die Hauptkamera und von aussen anschauen.
    this._cubeCam.quaternion.copy(this.camera.quaternion);
    this._cubeCam.position.set(0, 0, 1).applyQuaternion(this.camera.quaternion).multiplyScalar(12);
    this._cubeCam.updateProjectionMatrix();

    const gl = this.renderer;
    const yBottom = r.h - r.y - r.size;    // Viewport rechnet von unten
    gl.autoClear = false;
    gl.setScissorTest(true);
    gl.setViewport(r.x, yBottom, r.size, r.size);
    gl.setScissor(r.x, yBottom, r.size, r.size);
    gl.clearDepth();
    // Clipping der Schnittebene gilt nur fuer das Modell.
    const clip = gl.clippingPlanes;
    gl.clippingPlanes = [];
    gl.render(this._cubeScene, this._cubeCam);
    gl.clippingPlanes = clip;
    gl.setScissorTest(false);
    gl.setViewport(0, 0, r.w, r.h);
    gl.autoClear = true;
  }

  /** Getroffenes Feld des Ansichtswuerfels oder null. */
  pickViewCube(clientX, clientY) {
    if (!this._cubeEnabled) return null;
    const r = this._cubeRect();
    if (!r) return null;
    const box = this.renderer.domElement.getBoundingClientRect();
    const cx = clientX - box.left, cy = clientY - box.top;
    if (cx < r.x || cx > r.x + r.size || cy < r.y || cy > r.y + r.size) return null;
    this._mouse.x = ((cx - r.x) / r.size) * 2 - 1;
    this._mouse.y = -(((cy - r.y) / r.size) * 2 - 1);
    this._raycaster.setFromCamera(this._mouse, this._cubeCam);
    const hits = this._raycaster.intersectObjects(this._cubeCells, false);
    return hits.length ? hits[0].object : null;
  }

  setViewCubeHover(cell) {
    if (this._cubeHover === cell) return;
    if (this._cubeHover) this._cubeHover.material = this._cubeCellMat;
    this._cubeHover = cell || null;
    if (this._cubeHover) this._cubeHover.material = this._cubeCellHoverMat;
    this._needsRender = true;
  }

  /**
   * Kamera auf eine Blickrichtung schwenken (Klick auf den Ansichtswuerfel).
   * dir zeigt vom Modell zur Kamera. Abstand und Drehpunkt bleiben.
   */
  snapToDirection(dir) {
    if (!this.controls) return false;
    const target = this.controls.target.clone();
    const dist = this.camera.position.distanceTo(target) || 200;
    const v = new THREE.Vector3(dir[0], dir[1], dir[2]);
    if (v.lengthSq() < 1e-9) return false;
    v.normalize();
    // Genau senkrecht waere fuer OrbitControls entartet -- minimal kippen, wie
    // beim Drehen von Hand (siehe POLE_GAP).
    if (Math.abs(v.y) > Math.cos(POLE_GAP)) {
      v.set(0, Math.sign(v.y) * Math.cos(POLE_GAP), -Math.sin(POLE_GAP));
    }
    this._camAnim = {
      from: this.camera.position.clone().sub(target).normalize(),
      to: v,
      target,
      dist,
      t0: performance.now(),
    };
    this._needsRender = true;
    return true;
  }

  _stepCameraAnimation() {
    const a = this._camAnim;
    if (!a) return false;
    const k = Math.min(1, (performance.now() - a.t0) / CUBE_SNAP_MS);
    // Weich anlaufen und auslaufen.
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    const v = new THREE.Vector3().copy(a.from).lerp(a.to, e);
    if (v.lengthSq() < 1e-9) v.copy(a.to);
    v.normalize();
    this.camera.position.copy(a.target).addScaledVector(v, a.dist);
    this.camera.up.set(0, 1, 0);
    this.controls.target.copy(a.target);
    this.controls.update();
    if (k >= 1) {
      this._camAnim = null;
      this.onCameraChange();
    }
    return true;
  }

  _animate() {
    requestAnimationFrame(this._animate);
    if (this._stepCameraAnimation()) this._needsRender = true;
    // controls.update() liefert true, solange das Damping noch nachlaeuft.
    if (this.controls.update()) this._needsRender = true;
    if (this._updateTreeCamera()) this._needsRender = true;
    if (!this._needsRender) return;
    this._needsRender = false;
    this.renderer.render(this.scene, this.camera);
    this._renderViewCube();
  }
}
