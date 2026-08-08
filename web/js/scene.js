// 3D-Szene + Rendering (Three.js). Kennt das Modell nur zum Zeichnen.

import * as THREE from "three";
import { OrbitControls } from "../vendor/three/OrbitControls.js";
import { geometry, colorHex, connectorColor } from "./catalog.js";

const UP = new THREE.Vector3(0, 1, 0);

// Hintergrundfarben fuer die Beschriftung nach Kategorie (Aufbaumodus-Hervorhebung).
const LABEL_BG = {
  tube75: "rgba(139,61,245,0.94)",  // 75er Rohre - violett
  flaeche: "rgba(20,160,110,0.95)", // Flaechenkupplungen - gruen
  raum: "rgba(26,140,255,0.95)",    // Raumkupplungen - blau
};

export class SceneManager {
  constructor(container) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    // updateStyle = false: die CSS-Groesse des Canvas kommt aus dem Stylesheet
    // (100 % des Containers), nicht als feste px-Werte -> siehe onResize().
    this.renderer.setSize(container.clientWidth, container.clientHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xeef1f5);

    this.camera = new THREE.PerspectiveCamera(
      55, container.clientWidth / container.clientHeight, 1, 100000
    );
    this._defaultCam = { pos: [140, 120, 180], target: [0, 30, 0] };
    this.resetCamera();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
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
    this._materials = {};

    window.addEventListener("resize", () => this.onResize());
    // Container-Größe verfolgen: Layout der Sidebar steht beim Konstruieren
    // evtl. noch nicht final -> sonst überlappen Canvas und Panel bis zum
    // ersten Resize. ResizeObserver gleicht das automatisch ab.
    if (typeof ResizeObserver !== "undefined") {
      this._resizeObserver = new ResizeObserver(() => this.onResize());
      this._resizeObserver.observe(container);
    }
    this._animate = this._animate.bind(this);
    this._animate();
  }

  resetCamera() {
    this.camera.position.set(...this._defaultCam.pos);
    this.camera.lookAt(...this._defaultCam.target);
    if (this.controls) {
      this.controls.target.set(...this._defaultCam.target);
      this.controls.update();
    }
  }

  onResize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    // Unveraenderte Groesse ignorieren: sonst kann der ResizeObserver sich
    // ueber setSize() selbst erneut ausloesen (Endlosschleife).
    if (w === this._lastW && h === this._lastH) return;
    this._lastW = w;
    this._lastH = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // updateStyle = false -> Three schreibt KEINE festen px-Werte in den
    // Canvas-Style. Sonst wird der Canvas breiter als sein Container, das
    // Dokument bekommt eine Scrollbar, der Container schrumpft um deren
    // Breite, der Observer feuert erneut -> Viewport flackert dauerhaft.
    this.renderer.setSize(w, h, false);
  }

  // Auf die nächste Achse gerundete horizontale Blickrichtung (für Pfeiltasten).
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

  _connGeometry() {
    if (!this._connGeo) {
      const s = geometry().connectorSize;
      this._connGeo = new THREE.BoxGeometry(s, s, s);
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

  _clampMaterial() {
    if (!this._materials["clamp"]) {
      this._materials["clamp"] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x33373d), roughness: 0.5, metalness: 0.4,
      });
    }
    return this._materials["clamp"];
  }

  // Geometrie fuer den 45-Grad-Adapter-Koerper: kleiner Wuerfel,
  // der in einen Arm der Basiskupplung gesteckt wird.
  _c45Geometry() {
    if (!this._c45Geo) {
      const s = geometry().connectorSize * 0.82;
      this._c45Geo = new THREE.BoxGeometry(s, s, s);
    }
    return this._c45Geo;
  }

  // Geometrie fuer den Diagonal-Stutzen des Adapters (Arm, der ins Rohr greift).
  // Echtes Mass: Arm ~42 mm Durchmesser (armRadius) -> duenner als das Rohr
  // (49 mm), damit er sichtbar IN die Tube einsteckt.
  _c45StubGeometry() {
    if (!this._c45StubGeo) {
      const ar = geometry().armRadius;
      const cs = geometry().connectorSize;
      this._c45StubGeo = new THREE.CylinderGeometry(ar, ar, cs * 0.75, 14);
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
  _slideMatFor(kind, isCurrent) {
    const COL = {
      "slide2": 0xd23b3b, "slide-new2": 0xd23b3b,  // gerade Rutsche = rot
      "curved-slide2": 0x37a23f,                    // Bogenrutsche = gruen
      "slide-end2": 0xf0c020,                       // Auslauf = gelb
      "roof2": 0x37a23f,                            // Dach-Tuch = gruen, durchsichtig
    };
    const transp = kind === "roof2"; // Dach-Tuch durchsichtig wie ein Textil (Gregor)
    const key = "slidem_" + kind + (isCurrent ? "_c" : "");
    if (!this._materials[key]) {
      this._materials[key] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(COL[kind] || 0x9aa3ad), roughness: transp ? 0.9 : 0.6, metalness: 0.05,
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
  _curvedSlideExit(sl, model) {
    let target = null, bestD = Infinity;
    for (const s2 of model.slides.values()) {
      if (s2 === sl) continue;
      if (s2.kind !== "slide2" && s2.kind !== "slide-new2" && s2.kind !== "slide-end2") continue;
      if (s2.y > sl.y - 1) continue;
      const d = (s2.x - sl.x) ** 2 + (s2.y - sl.y) ** 2 + (s2.z - sl.z) ** 2;
      if (d < bestD) { bestD = d; target = s2; }
    }
    const dx = target ? target.x - sl.x : -60;
    const dz = target ? target.z - sl.z : -60;
    const exitH = Math.abs(dz) >= Math.abs(dx)
      ? new THREE.Vector3(Math.sign(dx) || -1, 0, 0)
      : new THREE.Vector3(0, 0, Math.sign(dz) || -1);
    return exitH.multiplyScalar(1.4).add(new THREE.Vector3(0, -1, 0)).normalize();
  }

  // Bogenrutsche: gekrümmte Rutschflaeche, die KARDINAL+waagerecht am Anschluss
  // beginnt (kein 45°) und SENKRECHT nach unten ins Rutschen-Endstueck laeuft
  // (Gregor: "schliesst gekruemmt nach unten an slide end an"). Kubische Bézier:
  //   P0(Bogen) -> C1 = P0 + Kardinalrichtung·d  (waagerechter, achsparalleler Start)
  //             -> C2 = ueber P3                 (senkrechtes Ende)
  //             -> P3 (gerenderte slide-end-Mitte).
  // Der frueher diagonale Kontrollpunkt (P2.x,P0.y,P2.z) erzeugte die 45°-Drehung.
  _addCurvedSlide(sl, model, mat, st) {
    const P0 = new THREE.Vector3(sl.x, sl.y, sl.z);
    // Die Bogenrutsche geht in das NAECHSTE Rutschenteil ueber -- das kann eine
    // GERADE Rutsche (slide2) ODER direkt das Endstueck sein (in C0065: gerade
    // Rutsche; in C0076: Endstueck). Nimm das naechstgelegene unterhalb.
    let target = null, bestD = Infinity;
    for (const s2 of model.slides.values()) {
      if (s2.kind !== "slide2" && s2.kind !== "slide-new2" && s2.kind !== "slide-end2") continue;
      if (s2.y > sl.y - 1) continue; // nur tiefer liegende Teile
      const d = (s2.x - sl.x) ** 2 + (s2.y - sl.y) ** 2 + (s2.z - sl.z) ** 2;
      if (d < bestD) { bestD = d; target = s2; }
    }
    let P3;
    if (target) {
      // Endstueck: gerenderte Mitte (mit Offsets); gerade Rutsche: QDF-Position
      // (= Beginn der Rutsche; der feste Versatz Bogen->Folgeteil ist QDF-zu-QDF).
      P3 = target.kind === "slide-end2"
        ? this._slideEndConnectPoint(target)
        : new THREE.Vector3(target.x, target.y, target.z);
    } else {
      const fwd = new THREE.Vector3(1, 0, 0);
      if (sl.quat && sl.quat.length === 4) fwd.applyQuaternion(new THREE.Quaternion(sl.quat[0], sl.quat[1], sl.quat[2], sl.quat[3]).normalize());
      fwd.y = 0; if (fwd.lengthSq() < 0.01) fwd.set(1, 0, 0); fwd.normalize();
      P3 = P0.clone().addScaledVector(fwd, 60).add(new THREE.Vector3(0, -80, 0));
    }
    // Waagerechte Laufrichtung auf die naechste KARDINALE Achse snappen (kein 45°).
    const dx = P3.x - P0.x, dz = P3.z - P0.z;
    const card = Math.abs(dz) >= Math.abs(dx)
      ? new THREE.Vector3(0, 0, Math.sign(dz) || -1)
      : new THREE.Vector3(Math.sign(dx) || -1, 0, 0);
    const horizDist = Math.hypot(dx, dz) || 1;
    const C1 = P0.clone().addScaledVector(card, horizDist * 0.5);  // waagerechter, kardinaler Start
    // FESTE Austrittsrichtung der Bogenrutsche -- UNABHAENGIG vom Folgeteil, damit
    // der Bogen in jeder Datei gleich aussieht (Gregor: C0065 richtig, C0076 war
    // anders/falsch). Nach der 90°-Drehung laeuft sie in der PERPENDIKULAEREN
    // kardinalen Richtung, ~33° abwaerts (= Standard-Anschluss an die gerade
    // Rutsche). Frueher: senkrecht (Endstueck) vs. Folgeteil-Richtung -> uneinheitlich.
    const exitH = Math.abs(card.z) > 0.5
      ? new THREE.Vector3(Math.sign(dx) || -1, 0, 0)
      : new THREE.Vector3(0, 0, Math.sign(dz) || -1);
    const exitDir = exitH.multiplyScalar(1.4).add(new THREE.Vector3(0, -1, 0)).normalize();
    const span = P0.distanceTo(P3) || 1;
    const C2 = P3.clone().addScaledVector(exitDir, -span * 0.45);
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
  _ghostMaterial() {
    if (!this._materials["ghost"]) {
      this._materials["ghost"] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x9aa6b4), roughness: 0.9, metalness: 0,
        transparent: true, opacity: 0.14, depthWrite: false,
      });
    }
    return this._materials["ghost"];
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
  _panelHandleMaterial() {
    if (!this._materials["panelHandle"]) {
      this._materials["panelHandle"] = new THREE.MeshBasicMaterial({
        color: 0x1a8cff, transparent: true, opacity: 0.35,
        side: THREE.DoubleSide, depthWrite: false,
      });
    }
    return this._materials["panelHandle"];
  }

  // Hervorhebung der im aktuellen Aufbau-Schritt hinzukommenden Rohre.
  _tubeHighlight(colorId) {
    const key = "tubehl:" + colorId;
    if (!this._materials[key]) {
      this._materials[key] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(colorHex(colorId)), roughness: 0.4, metalness: 0.05,
        emissive: new THREE.Color(0x3a2400),
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

    const tubeRadius = geometry().tubeRadius;
    const armRadius = geometry().armRadius; // C45-Arm: ~42 mm, duenner als das Rohr
    const asm = opts.assembly || null;
    const labelFor = opts.labelFor || null;
    const slideNameFor = opts.slideNameFor || null;
    const suggest = opts.suggest || null;
    const reinforce = opts.reinforce || false;
    const cs = geometry().connectorSize;
    // Echte Kupplungs-Arme (aus variant2 importiert, node.arms): kurze Stutzen
    // mit Arm-Durchmesser (~42 mm). Offene Arme ragen heraus; von Rohren belegte
    // stecken im Rohr (Arm dünner als Rohr) -> sichtbar nur die freien Arme.
    const armStubLen = cs * 0.85;
    const armStubGeo = new THREE.CylinderGeometry(armRadius, armRadius, armStubLen, 12);
    const armStubOff = cs / 2 + armStubLen / 2 - 0.4;

    // Richtungen der an einem Knoten TATSAECHLICH angeschlossenen Rohre.
    // Einmal fuer alle Knoten aufgebaut (sonst waere die Pruefung je Knoten ueber
    // alle Rohre quadratisch). Bei Bogenrohren zaehlt die Tangente am Knoten,
    // nicht die Sehne zum Gegenknoten -- sonst gilt ein belegter Arm faelschlich
    // als frei.
    const tubeDirsAt = new Map();
    const pushDir = (nodeId, vx, vy, vz) => {
      const L = Math.hypot(vx, vy, vz);
      if (L < 1e-6) return;
      if (!tubeDirsAt.has(nodeId)) tubeDirsAt.set(nodeId, []);
      tubeDirsAt.get(nodeId).push([vx / L, vy / L, vz / L]);
    };
    for (const t of model.tubes.values()) {
      const na = model.nodes.get(t.a), nb = model.nodes.get(t.b);
      if (!na || !nb) continue;
      if (t.bow && t.bowCenter) {
        const [cx, cy, cz] = t.bowCenter;
        pushDir(t.a, nb.x - cx, nb.y - cy, nb.z - cz);
        pushDir(t.b, na.x - cx, na.y - cy, na.z - cz);
      } else {
        pushDir(t.a, nb.x - na.x, nb.y - na.y, nb.z - na.z);
        pushDir(t.b, na.x - nb.x, na.y - nb.y, na.z - nb.z);
      }
    }
    // Ist diese Arm-Richtung von einem Rohr belegt?
    const armIsUsed = (nodeId, d) => {
      const dirs = tubeDirsAt.get(nodeId);
      if (!dirs) return false;
      return dirs.some((v) => v[0] * d[0] + v[1] * d[1] + v[2] * d[2] > 0.9);
    };

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
      let mat;
      if (st === "future") mat = this._ghostMaterial();
      else if (st === "current") mat = this._connMaterial(true);
      else mat = this._connMaterial(n.id === selectedNodeId);
      // Adapter-Koerper (importierte C45, n.c45body) sind keine eigenstaendige
      // Kupplung -> kein dunkler Wuerfel; sie werden unten in Adapter-Farbe
      // gezeichnet (Huelse + Koerper + 45°-Arm).
      if (!n.c45body) {
        const mesh = new THREE.Mesh(this._connGeometry(), mat);
        mesh.position.set(n.x, n.y, n.z);
        // Importierte Kupplung: Wuerfel exakt um ihre Quaternion drehen, damit die
        // Arme aus den Flaechen kommen -- auch bei Rampenwinkeln (30°/60°). Kardinale
        // Kupplungen sind invariant. Manuell gebaute Schraegen (ohne quat) drehen wie
        // bisher 45° um die Schraegen-Achse (_slopeRotationAxis).
        if (n.quat && n.quat.length === 4) {
          mesh.quaternion.set(n.quat[0], n.quat[1], n.quat[2], n.quat[3]).normalize();
        } else {
          const sa = this._slopeRotationAxis(model, n);
          if (sa) mesh.quaternion.setFromAxisAngle(sa, Math.PI / 4);
        }
        mesh.userData = { kind: "node", id: n.id };
        this.buildGroup.add(mesh);
        if (st !== "future") this.pickNodes.push(mesh);

        // Arm-Stutzen der Kupplung (variant2 -> node.arms). Es werden NUR Arme
        // gezeichnet, an denen wirklich ein Rohr steckt: die Kupplung zeigt damit
        // immer genau ihr tatsaechliches Anschlussbild. Offene Stutzen entfallen
        // -- die Herstellersoftware kennt sie ebenfalls nicht, und die
        // variant2-Maske der QDF-Datei fuehrt sonst Arme ins Leere.
        if (n.arms) {
          for (const d of n.arms) {
            const dv = new THREE.Vector3(d[0], d[1], d[2]);
            if (dv.lengthSq() < 0.1) continue;
            dv.normalize();
            if (!armIsUsed(n.id, [dv.x, dv.y, dv.z])) continue;
            const stub = new THREE.Mesh(armStubGeo, mat);
            stub.position.set(n.x + dv.x * armStubOff, n.y + dv.y * armStubOff, n.z + dv.z * armStubOff);
            stub.quaternion.setFromUnitVectors(UP, dv);
            stub.userData = { kind: "node", id: n.id };
            this.buildGroup.add(stub);
            if (st !== "future") this.pickNodes.push(stub);
          }
        }
      }

      // 45-Grad-Winkelkupplung (C45). Echtes Teil: eine Huelse wird auf einen
      // KARDINALEN Arm der Basiskupplung gesteckt, davon zweigt ein 45°-Arm ab,
      // der in die Tube greift.
      if (n.c45 && st !== "future") {
        if (n.c45body) {
          // Import: n ist der Adapter-Koerper am Diagonal-Fuss; die Basis sitzt
          // am anderen Ende der Arm-Kante. Huelse laeuft kardinal von der Basis.
          const ad = this._c45AdapterGeo(model, n);
          if (ad) {
            // Arm der Basiskupplung -- ragt vom Wuerfel in die C45-Huelse hinein.
            if (ad.baseArmLen > 0.5) {
              const baseArm = new THREE.Mesh(
                new THREE.CylinderGeometry(armRadius, armRadius, ad.baseArmLen, 14),
                this._c45Material());
              baseArm.position.copy(ad.baseArmMid);
              baseArm.quaternion.setFromUnitVectors(UP, ad.sleeveDir);
              baseArm.userData = { kind: "node", id: n.id };
              this.buildGroup.add(baseArm);
            }
            // C45-Huelse: etwas breiter als das Rohr, der Basis-Arm steckt darin.
            const sleeve = new THREE.Mesh(
              new THREE.CylinderGeometry(tubeRadius * 1.18, tubeRadius * 1.18, ad.sleeveLen, 14),
              this._c45Material());
            sleeve.position.copy(ad.sleeveMid);
            sleeve.quaternion.setFromUnitVectors(UP, ad.sleeveDir);
            sleeve.userData = { kind: "node", id: n.id };
            this.buildGroup.add(sleeve);
            if (st !== "future") this.pickNodes.push(sleeve);

            const body = new THREE.Mesh(this._c45Geometry(), this._c45Material());
            body.position.copy(ad.bodyPos);
            body.userData = { kind: "node", id: n.id };
            this.buildGroup.add(body);

            if (ad.armLen > 0.5) {
              const arm = new THREE.Mesh(
                new THREE.CylinderGeometry(armRadius, armRadius, ad.armLen, 14),
                this._c45Material());
              arm.position.copy(ad.armMid);
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
            const body = new THREE.Mesh(this._c45Geometry(), this._c45Material());
            body.position.set(bx, by, bz);
            body.userData = { kind: "node", id: n.id };
            this.buildGroup.add(body);
            const stub = new THREE.Mesh(this._c45StubGeometry(), this._c45Material());
            const stubOff = cs * 0.75;
            stub.position.set(bx + dv.x * stubOff, by + dv.y * stubOff, bz + dv.z * stubOff);
            stub.quaternion.setFromUnitVectors(UP, dv);
            stub.userData = { kind: "node", id: n.id };
            this.buildGroup.add(stub);
          }
        }
      }

      // Beschriftung: im Aufbaumodus nur die aktuelle Ebene, sonst alle sichtbaren.
      const showLabel = labelFor && (asm ? st === "current" : st !== "future");
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
      // Reine Konnektivitaets-Kanten (Daten): C45-Adapter-Arm wird als Huelse am
      // c45body-Knoten gezeichnet, die Doppelrohr-Verbindung als "8"-Klemme --
      // beide nicht hier als Rohr.
      if (t.arm || t.link) continue;
      const va = new THREE.Vector3(a.x, a.y, a.z);
      const vb = new THREE.Vector3(b.x, b.y, b.z);
      const mid = va.clone().add(vb).multiplyScalar(0.5);
      const len = va.distanceTo(vb);

      // Bogenrohr: als Roehre entlang des Kreisbogens um bowCenter zeichnen.
      const bowCurve = t.bow && t.bowCenter ? this._bowCurve(va, vb, t.bowCenter) : null;
      if (bowCurve) {
        const bowMat = st === "future" ? this._ghostMaterial()
          : st === "current" ? this._tubeHighlight(t.color)
          : (suggest && suggest.has(t.id)) ? this._tubeSuggest()
          : reinforce ? this._tubeGray()
          : this._tubeMaterial(t.color);
        const bowMesh = new THREE.Mesh(
          new THREE.TubeGeometry(bowCurve, 24, tubeRadius, 14, false), bowMat
        );
        bowMesh.userData = { kind: "tube", id: t.id };
        bowMesh.castShadow = true;
        this.buildGroup.add(bowMesh);
        if (st !== "future") this.pickTubes.push(bowMesh);
        continue;
      }

      const geo = new THREE.CylinderGeometry(tubeRadius, tubeRadius, len, 16);
      const isReinforceActive = reinforce && t.reinforced;
      const effectiveRadius = isReinforceActive ? tubeRadius * 1.08 : tubeRadius;
      const geo2 = isReinforceActive
        ? new THREE.CylinderGeometry(effectiveRadius, effectiveRadius, len, 16)
        : geo;
      const mat = st === "future" ? this._ghostMaterial()
        : st === "current" ? this._tubeHighlight(t.color)
        : isReinforceActive ? this._tubeReinforceActive()
        : (suggest && suggest.has(t.id)) ? this._tubeSuggest()
        : reinforce ? this._tubeGray()
        : this._tubeMaterial(t.color);
      const mesh = new THREE.Mesh(isReinforceActive ? geo2 : geo, mat);
      mesh.position.copy(mid);
      const dir = vb.clone().sub(va).normalize();
      mesh.quaternion.setFromUnitVectors(UP, dir);
      mesh.userData = { kind: "tube", id: t.id };
      this.buildGroup.add(mesh);
      if (st !== "future") this.pickTubes.push(mesh);

      // Verstaerkungsprofil: dünner Alu-Innenstab im Bauen-Modus sichtbar.
      // Das Profil (ca. 2,5 cm) liegt im hohlen Rohr (5 cm Außen-Ø) und ragt
      // durch die Kupplungen hindurch – deshalb volle Rohrlänge.
      if (t.reinforced && !reinforce && st !== "future") {
        // Verstaerkungsprofil: ~30 mm Durchmesser (gemessen), passt in das hohle
        // Rohr (49 mm aussen, 3 mm Wandstaerke -> 43 mm Innen-Durchmesser).
        const rodRadius = 1.5;  // 15 mm Radius = 30 mm Durchmesser in cm
        const rodGeo = new THREE.CylinderGeometry(rodRadius, rodRadius, len, 8);
        const rodMesh = new THREE.Mesh(rodGeo, this._rodMaterial());
        rodMesh.position.copy(mid);
        rodMesh.quaternion.copy(mesh.quaternion);
        this.buildGroup.add(rodMesh);
      }

      // Laengen-Beschriftung: gleiche Sichtbarkeitsregel wie die Kupplungs-Namen.
      const showTubeLabel = labelFor && (asm ? st === "current" : st !== "future");
      if (showTubeLabel) {
        const cm = t.length != null ? t.length : Math.round(len - cs);
        const category = t.tubeId === "T75" ? "tube75" : null;
        const sprite = this._makeLabelSprite(`${cm} cm`, st === "current", category);
        sprite.position.set(mid.x, mid.y + tubeRadius + 4, mid.z);
        this.labelGroup.add(sprite);
        this.labelMeshes.push(sprite);
      }
    }

    // Platten (flache Box in der Feld-Ebene) – im Reinforce-Modus ausgeblendet.
    const thickness = geometry().panelThickness || 1.6;
    for (const p of model.panels.values()) {
      if (reinforce) continue;
      const ns = p.nodes.map((id) => model.nodes.get(id));
      if (ns.some((n) => !n)) continue;
      const st = stateOf(p.id);
      const [A, B, , D] = ns;
      const va = new THREE.Vector3(A.x, A.y, A.z);
      const u = new THREE.Vector3(B.x, B.y, B.z).sub(va);
      const w = new THREE.Vector3(D.x, D.y, D.z).sub(va);
      const center = ns
        .reduce((acc, n) => acc.add(new THREE.Vector3(n.x, n.y, n.z)), new THREE.Vector3())
        .multiplyScalar(0.25);
      const xAxis = u.clone().normalize();
      const zAxis = w.clone().normalize();
      const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
      const geo = new THREE.BoxGeometry(u.length(), thickness, w.length());
      const mat = st === "future" ? this._ghostMaterial() : this._panelMaterial(p.color, st === "current", false);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
      mesh.position.copy(center);
      mesh.userData = { kind: "panel", id: p.id };
      this.buildGroup.add(mesh);
      if (st !== "future") this.pickPanels.push(mesh);

      // Bällebad-Boden: Wasser-Volumen (75 % Füllhöhe) über dem Boden rendern.
      if (p.panelId === "pool_floor" && st !== "future") {
        const wallH = 40;                   // Wandhöhe pool2 in cm
        const waterH = wallH * 0.75;        // 30 cm Wasserstand
        const wGeo = new THREE.BoxGeometry(u.length(), waterH, w.length());
        const wMesh = new THREE.Mesh(wGeo, this._waterMaterial());
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
      const mat = st === "future" ? this._ghostMaterial() : this._clampMaterial();
      const dir = c.dir ? new THREE.Vector3(c.dir[0], c.dir[1], c.dir[2]).normalize() : new THREE.Vector3(1, 0, 0);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      const h = c.off ? [c.off[0] / 2, c.off[1] / 2, c.off[2] / 2] : null;
      const centers = h
        ? [[c.x - h[0], c.y - h[1], c.z - h[2]], [c.x + h[0], c.y + h[1], c.z + h[2]]]
        : [[c.x, c.y, c.z]];
      for (const [px, py, pz] of centers) {
        const mesh = new THREE.Mesh(ringGeo, mat);
        mesh.position.set(px, py, pz);
        mesh.quaternion.copy(q);
        mesh.userData = { kind: "clamp", id: c.id };
        this.buildGroup.add(mesh);
        if (st !== "future") this.pickClamps.push(mesh);
      }
    }

    // Netze/Stoffe (textil2): halbtransparente Flaeche ueber 4 Eck-Kupplungen.
    for (const tx of (model.textiles ? model.textiles.values() : [])) {
      if (reinforce) continue;
      const ns = tx.nodes.map((id) => model.nodes.get(id));
      if (ns.some((n) => !n)) continue;
      const st = stateOf(tx.id);
      const [A, B, , D] = ns;
      const va = new THREE.Vector3(A.x, A.y, A.z);
      const u = new THREE.Vector3(B.x, B.y, B.z).sub(va);
      const w = new THREE.Vector3(D.x, D.y, D.z).sub(va);
      const center = ns
        .reduce((acc, n) => acc.add(new THREE.Vector3(n.x, n.y, n.z)), new THREE.Vector3())
        .multiplyScalar(0.25);
      const xAxis = u.clone().normalize();
      const zAxis = w.clone().normalize();
      const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
      const geo = new THREE.BoxGeometry(u.length(), 0.6, w.length());
      const mat = st === "future" ? this._ghostMaterial() : this._panelMaterial(tx.color, st === "current", true);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
      mesh.position.copy(center);
      mesh.userData = { kind: "textile", id: tx.id };
      this.buildGroup.add(mesh);
      if (st !== "future") this.pickTextiles.push(mesh);
    }

    // Rutschen/Daecher: eigene Geometrie je Art (Bogen/gerade/Auslauf = U-Rinne,
    // Dach = flache Kappe). slide-end2-Position via _slideEndRenderedCenter.
    // Ketten-Status fuer nahtlose Uebergaenge: der Querschnitt (W/Nrm), mit dem das
    // VORHERIGE Rutschenteil endete, plus die ID des Teils, das ihn uebernehmen soll.
    this._slideChainFrame = null;
    this._slideChainNextId = null;
    for (const sl of (model.slides ? model.slides.values() : [])) {
      if (reinforce) continue;
      const st = stateOf(sl.id);
      const mat = st === "future" ? this._ghostMaterial() : this._slideMatFor(sl.kind, st === "current");

      // Beschriftung: Name des Rutschenenteils/Dachs wenn Labels aktiv.
      if (slideNameFor && st !== "future") {
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
  }

  // Gerade Rutsche (slide2/slide-new2): schraege Rampe (Rutschflaeche + 2 erhoehte
  // Seitenholme) von ihrer QDF-Position zum NAECHSTEN tiefer liegenden Rutschenteil
  // (Endstueck oder weitere gerade Rutsche). Die QDF-Kette legt das Folgeteil genau
  // an ihr Ende -> die feste ~140cm-Form ergibt sich aus der Distanz. Ersetzt die
  // fehlplatzierte Viewer-Transformation (fester Block + rotateY45 + Offsets).
  _addStraightSlide(sl, model, mat, st) {
    let P0 = new THREE.Vector3(sl.x, sl.y, sl.z);
    let target = null, bestD = Infinity;
    for (const s2 of model.slides.values()) {
      if (s2 === sl) continue;
      if (s2.kind !== "slide2" && s2.kind !== "slide-new2" && s2.kind !== "slide-end2") continue;
      if (s2.y > sl.y - 1) continue;
      const d = (s2.x - sl.x) ** 2 + (s2.y - sl.y) ** 2 + (s2.z - sl.z) ** 2;
      if (d < bestD) { bestD = d; target = s2; }
    }
    let P1;
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
  _bowCurve(va, vb, center) {
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
    const pts = [];
    const SEG = 16;
    for (let i = 0; i <= SEG; i++) {
      const th = (ang * i) / SEG;
      pts.push(C.clone()
        .addScaledVector(u, R * Math.cos(th))
        .addScaledVector(w, R * Math.sin(th)));
    }
    return new THREE.CatmullRomCurve3(pts);
  }

  clearHandles() {
    this._disposeGroup(this.handleGroup);
    this.handleMeshes = [];
  }

  addHandle(position, userData, kind = "dir") {
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
    return hits.length ? hits[0] : null;
  }

  pickHandle(clientX, clientY) {
    const hit = this.raycastObjects(clientX, clientY, this.handleMeshes);
    return hit ? { object: hit.object, data: hit.object.userData } : null;
  }

  pickBuild(clientX, clientY) {
    const hit = this.raycastObjects(
      clientX, clientY,
      [...this.pickNodes, ...this.pickTubes, ...this.pickPanels, ...this.pickClamps, ...this.pickTextiles]
    );
    return hit ? { object: hit.object, data: hit.object.userData, point: hit.point } : null;
  }

  // Wie pickBuild, aber inkl. Rutschen/Dächer (nur fuers Loeschen relevant; im
  // Bau-Modus sollen die dekorativen Platzhalter keine Klicks abfangen).
  pickForDelete(clientX, clientY) {
    const hit = this.raycastObjects(
      clientX, clientY,
      [...this.pickNodes, ...this.pickTubes, ...this.pickPanels, ...this.pickClamps,
       ...this.pickTextiles, ...this.pickSlides]
    );
    return hit ? { object: hit.object, data: hit.object.userData, point: hit.point } : null;
  }

  setHover(object) {
    if (this._hover === object) return;
    if (this._hover && this._hover.userData.kind === "handle") {
      if (this._hover.userData.panelCell) this._hover.material.opacity = 0.35;
      else this._hover.scale.setScalar(1);
    }
    this._hover = object;
    if (object && object.userData.kind === "handle") {
      if (object.userData.panelCell) object.material.opacity = 0.65;
      else object.scale.setScalar(1.6);
    }
    this.container.style.cursor = object ? "pointer" : "default";
  }

  _disposeGroup(group) {
    const cached = [this._connGeo, this._clampGeo, this._clampRingGeo, this._c45Geo, this._c45StubGeo];
    for (let i = group.children.length - 1; i >= 0; i--) {
      const c = group.children[i];
      // Rekursiv (verschachtelte Gruppen, z.B. Rutschen) Geometrien freigeben.
      c.traverse((o) => {
        if (o.geometry && !cached.includes(o.geometry)) o.geometry.dispose();
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

  // Prozedurale Bäume am Rand der Grasfläche (r 320–440 cm).
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
      const r = 450 + rng() * 250;          // 450–700 cm vom Mittelpunkt
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
  _updateTrees(model) {
    if (!this._treeNodes) return;
    const nodes = model && model.nodes ? [...model.nodes.values()] : [];
    const CLEAR2 = 90 * 90;
    const markBlocked = (list) => {
      for (const t of list) {
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

    const updateNodes = (nodes, groupVisible) => {
      if (!nodes || !groupVisible) return;
      if (cl < 1) { nodes.forEach(t => { if (!t.blocked) t.group.visible = true; }); return; }
      const cnx = cx / cl, cnz = cz / cl;
      for (const t of nodes) {
        if (t.blocked) { t.group.visible = false; continue; }
        const dx = t.x - tx, dz = t.z - tz;
        const dl = Math.hypot(dx, dz);
        if (dl < 1) { t.group.visible = true; continue; }
        // dot > cos(45°)=0.707 → Objekt im 90°-Kamera-Sektor → ausblenden.
        t.group.visible = (dx / dl) * cnx + (dz / dl) * cnz < 0.707;
      }
    };

    updateNodes(this._treeNodes, this._treeGroup?.visible);
    updateNodes(this._bushNodes, this._bushGroup?.visible);
  }

  // Szene komplett ein-/ausblenden (Gras, Bäume, Himmel, Licht, Schatten).
  // Ersetzt setGrass(); wird weiterhin von ui.js als scene.setScene(on) aufgerufen.
  setScene(on) {
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

  _animate() {
    requestAnimationFrame(this._animate);
    this.controls.update();
    this._updateTreeCamera();
    this.renderer.render(this.scene, this.camera);
  }
}
