// Verkabelt die Bedienoberflaeche (Toolbar, Tastatur, Stueckliste, Bestand).

import { buildableTubes, buildableCurvedTubes, buildablePanels, tubeColors, geometry, allTubes, allConnectors, panels, reinforcements, slideKindName, partName, partForFitting, accessories, getPartById } from "./catalog.js";
import { PLACEABLE_FITTINGS } from "./model.js";
import { computeBOM, compareInventory, connectorsForNode } from "./bom.js";
import { computeBuildPlan, BUILD_ORDERS } from "./buildplan.js";
import { parseQDF } from "./qdfimport.js";
import { QUALITY_LEVELS } from "./scene.js";
import { RANDOM_COLOR } from "./builder.js";
import * as storage from "./storage.js";
import * as docs from "./docs.js";
import { designEntry, parseDesign, checkAgainstInventory, missingCount } from "./library.js";
import { buildQDF } from "./qdfexport.js";
import { t, getLang, setLang, applyTranslations } from "./i18n.js";

const INV_KEY = "quadro.inventory.v1";

function $(id) { return document.getElementById(id); }

// Zeitstempel "YYYY-MM-DD HH:MM" fuer eindeutige Entwurf-Namen beim Import.
function importStamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function eur(v) { return v.toFixed(2).replace(".", ",") + " €"; }
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function neg(v) { return [-v[0], -v[1], -v[2]]; }

function loadInv() {
  let inv;
  try { inv = JSON.parse(localStorage.getItem(INV_KEY)) || {}; }
  catch { inv = {}; }
  inv.tubes = inv.tubes || {};
  inv.connectors = inv.connectors || {};
  inv.panels = inv.panels || {};
  inv.reinforcements = inv.reinforcements || {};
  inv.fittings = inv.fittings || {};
  return inv;
}
function saveInv(inv) { localStorage.setItem(INV_KEY, JSON.stringify(inv)); }

/** Rendert die Hilfe-Tabelle aus den Übersetzungen neu. */
function renderHelpTable() {
  const table = $("help-table");
  if (!table) return;
  table.innerHTML = "";
  for (const [key, desc] of t("help_shortcuts")) {
    const tr = document.createElement("tr");
    const td1 = document.createElement("td"); td1.textContent = key;
    const td2 = document.createElement("td"); td2.textContent = desc;
    tr.appendChild(td1); tr.appendChild(td2);
    table.appendChild(tr);
  }
}

export function initUI({ scene, model, builder }) {
  let slideGroupBtn = null;
  let renderFittingButton = () => {};
  const inventory = loadInv();

  // Übersetzungen initial anwenden
  applyTranslations();
  renderHelpTable();

  // Sprach-Dropdown (direkt in toolbar-right)
  const langBtn = $("btn-lang");
  if (langBtn) {
    langBtn.value = getLang();
    langBtn.addEventListener("change", () => {
      const next = langBtn.value;
      setLang(next);
      applyTranslations();
      renderHelpTable();
      renderColorButtons();
      applyViewCubeLabels();
      renderOrderOptions();
      renderPartButtons();
      renderQualityOptions();
      syncProjectionButton();
      // Dynamische UI-Texte aktualisieren
      setMode(builder.mode);
      update();
    });
  }

  // Beschriftung des Ansichtswuerfels. scene.js kennt die Sprachdateien nicht,
  // deshalb kommen die sechs Woerter von hier -- auch nach jedem Sprachwechsel.
  function applyViewCubeLabels() {
    scene.setViewCubeLabels({
      right: t("cube_right"), left: t("cube_left"),
      top: t("cube_top"), bottom: t("cube_bottom"),
      front: t("cube_front"), back: t("cube_back"),
    });
  }
  applyViewCubeLabels();

  // --- Hinweise + Undo-Verfuegbarkeit ------------------------------------
  builder.onNotice = (msg) => flash(msg);
  builder.onHistoryChange = () => updateUndoButton();
  function updateUndoButton() {
    $("btn-undo").disabled = !builder.canUndo();
    $("btn-redo").disabled = !builder.canRedo();
  }



  // Die Datei-Aktionen stehen jetzt als einzelne Knöpfe in der Kopfzeile.
  // toggleFileMenu bleibt als Attrappe, damit die Aufrufe in den Handlern
  // nichts kaputt machen.
  function toggleFileMenu() { /* kein Menü mehr */ }

  /** Popup fixed unter einem Anker-Button platzieren, am rechten Rand geklemmt. */
  function placePopupUnder(pop, anchorBtn) {
    const rect = anchorBtn.getBoundingClientRect();
    pop.style.position = "fixed";
    pop.style.top = (rect.bottom + 5) + "px";
    pop.style.left = rect.left + "px";
    pop.style.right = "auto";
    requestAnimationFrame(() => {
      const maxLeft = window.innerWidth - pop.offsetWidth - 8;
      if (parseFloat(pop.style.left) > maxLeft) pop.style.left = Math.max(8, maxLeft) + "px";
    });
  }
  // --- Schnittebene ------------------------------------------------------
  // Schneidet das Modell entlang einer Achse auf, damit man hineinsehen und
  // weiter innen bauen kann. Kein eigener Modus: laeuft parallel zu Bauen,
  // Platten setzen usw. weiter.
  const SLICE_KEY = "quadro.slice.v1";
  // Die Schalter folgen der CAD-Konvention (Z zeigt nach oben), das Modell der
  // Three.js-Konvention (Y zeigt nach oben). Der Schalter "Z" schneidet
  // deshalb entlang der internen Y-Achse und legt die Ebene in X/Y -- so, wie
  // man es aus Fusion & Co. kennt.
  const SLICE_AXIS = { x: "x", y: "z", z: "y" };
  const sliceBar = $("slice-bar");
  const sliceRange = $("slice-range");
  // values haelt die zuletzt benutzte Lage JE ACHSE fest: Aus- und Einschalten
  // und ein Wechsel der Achse sollen die Ebene dort wieder aufnehmen, wo man
  // sie verlassen hat. null = fuer diese Achse noch nie gesetzt -> mittig.
  const slice = { on: false, axis: "z", value: 0, flip: false,
                  values: { x: null, y: null, z: null } };
  try {
    const st = JSON.parse(localStorage.getItem(SLICE_KEY));
    if (st && ["x", "y", "z"].includes(st.axis) && typeof st.value === "number") {
      Object.assign(slice, { on: !!st.on, axis: st.axis, value: st.value, flip: !!st.flip });
      if (st.values) for (const a of ["x", "y", "z"])
        if (typeof st.values[a] === "number") slice.values[a] = st.values[a];
      // Aeltere Staende kannten nur EINEN Wert -- der gehoert zur aktiven Achse.
      if (slice.values[slice.axis] == null) slice.values[slice.axis] = slice.value;
    }
  } catch { /* kaputter Eintrag -> Standard */ }

  /** Lage fuer die aktive Achse holen; beim ersten Mal in die Mitte legen. */
  function sliceValueForAxis() {
    const stored = slice.values[slice.axis];
    if (stored != null) return stored;
    const lim = sliceLimits();
    return Math.round((lim.min + lim.max) / 2);
  }

  function sliceLimits() {
    const b = model.bounds(geometry().connectorSize / 2);
    if (!b) return { min: -100, max: 100 };
    const ax = SLICE_AXIS[slice.axis];
    const i = ax === "x" ? 0 : ax === "y" ? 1 : 2;
    return { min: Math.floor(b.min[i]), max: Math.ceil(b.max[i]) };
  }

  function applySlice() {
    if (!sliceBar) return;
    sliceBar.hidden = !slice.on;
    $("btn-slice").classList.toggle("active", slice.on);
    if (!slice.on) { scene.clearClip(); builder.refresh(); return; }
    const lim = sliceLimits();
    sliceRange.min = lim.min;
    sliceRange.max = lim.max;
    slice.value = Math.min(lim.max, Math.max(lim.min, slice.value));
    slice.values[slice.axis] = slice.value;
    sliceRange.value = slice.value;
    $("slice-value").textContent = `${Math.round(slice.value)} cm`;
    for (const b of $("slice-axes").querySelectorAll("button"))
      b.classList.toggle("active", b.dataset.axis === slice.axis);
    scene.setClip(SLICE_AXIS[slice.axis], slice.value, slice.flip);
    builder.refresh();   // Handles neu: verdeckte sind nicht mehr anklickbar
  }

  function saveSlice() {
    localStorage.setItem(SLICE_KEY, JSON.stringify(slice));
  }

  if (sliceBar) {
    $("btn-slice").addEventListener("click", () => {
      slice.on = !slice.on;
      // Beim Einschalten die zuletzt benutzte Lage dieser Achse wieder
      // aufnehmen -- frueher sprang die Ebene jedes Mal in die Mitte.
      if (slice.on) slice.value = sliceValueForAxis();
      applySlice(); saveSlice();
    });
    $("slice-close").addEventListener("click", () => { slice.on = false; applySlice(); saveSlice(); });
    $("slice-flip").addEventListener("click", () => { slice.flip = !slice.flip; applySlice(); saveSlice(); });
    for (const b of $("slice-axes").querySelectorAll("button")) {
      b.addEventListener("click", () => {
        slice.axis = b.dataset.axis;
        slice.value = sliceValueForAxis();
        applySlice(); saveSlice();
      });
    }
    sliceRange.addEventListener("input", () => {
      slice.value = parseFloat(sliceRange.value);
      // Auch beim Ziehen mitschreiben -- applySlice() laeuft hier nicht.
      slice.values[slice.axis] = slice.value;
      $("slice-value").textContent = `${Math.round(slice.value)} cm`;
      scene.setClip(SLICE_AXIS[slice.axis], slice.value, slice.flip);
    });
    // Erst beim Loslassen neu aufbauen -- waehrend des Ziehens waere das zaeh.
    sliceRange.addEventListener("change", () => { builder.refresh(); saveSlice(); });
    // Gemerkten Schnitt beim Start wiederherstellen.
    if (slice.on) applySlice();
  }

  // --- Kamera merken -----------------------------------------------------
  // Position, Blickziel und Zoom ueberleben einen Reload; sonst landet man
  // immer wieder in der Standardansicht.
  const CAMERA_KEY = "quadro.camera.v1";
  let camSaveTimer = null;
  scene.onCameraChange = () => {
    clearTimeout(camSaveTimer);
    camSaveTimer = setTimeout(() => {
      const st = scene.cameraState();
      if (st) localStorage.setItem(CAMERA_KEY, JSON.stringify(st));
    }, 400);
  };

  // --- Kamera-Projektion -------------------------------------------------
  // Orthogonal = keine Fluchtpunkte: parallele Rohre bleiben parallel, gut zum
  // Ausmessen und Vergleichen. Perspektivisch = raeumlicher Eindruck.
  const PROJECTION_KEY = "quadro.projection.v1";
  const projBtn = $("btn-projection");
  function syncProjectionButton() {
    if (!projBtn) return;
    const ortho = scene.projection === "orthographic";
    projBtn.classList.toggle("active", ortho);
    projBtn.title = t(ortho ? "btn_projection_ortho" : "btn_projection_persp");
  }
  if (projBtn) {
    const savedProj = localStorage.getItem(PROJECTION_KEY);
    if (savedProj) scene.setProjection(savedProj);
    syncProjectionButton();
    // Erst Projektion, dann Kamera: setProjection() setzt den Zoom zurueck.
    try {
      const st = JSON.parse(localStorage.getItem(CAMERA_KEY));
      if (st) scene.restoreCameraState(st);
    } catch { /* kaputter Eintrag -> Standardansicht */ }
    projBtn.addEventListener("click", () => {
      const next = scene.projection === "orthographic" ? "perspective" : "orthographic";
      scene.setProjection(next);
      localStorage.setItem(PROJECTION_KEY, next);
      syncProjectionButton();
      flash(t(next === "orthographic" ? "btn_projection_ortho" : "btn_projection_persp"));
    });
  }

  // --- Einstellungen -----------------------------------------------------
  // Render-Qualitaet: nur die Aufloesung der Geometrien, keine Masse. Wird in
  // localStorage gemerkt und beim Start angewendet.
  const QUALITY_KEY = "quadro.quality.v1";
  const settingsMenu = $("settings-menu");
  const qualitySelect = $("quality-select");

  function renderQualityOptions() {
    if (!qualitySelect) return;
    qualitySelect.innerHTML = "";
    for (const level of QUALITY_LEVELS) {
      const o = el("option", null, t("quality_" + level));
      o.value = level;
      qualitySelect.appendChild(o);
    }
    qualitySelect.value = scene.quality;
  }

  function toggleSettingsMenu(open) {
    const pop = $("settings-pop");
    const show = open == null ? pop.hidden : open;
    pop.hidden = !show;
    $("btn-settings").classList.toggle("active", show);
  }

  if (qualitySelect) {
    const saved = localStorage.getItem(QUALITY_KEY);
    if (saved && scene.setQuality(saved)) builder.refresh();
    renderQualityOptions();
    qualitySelect.addEventListener("change", () => {
      if (scene.setQuality(qualitySelect.value)) builder.refresh();
      localStorage.setItem(QUALITY_KEY, qualitySelect.value);
    });
    $("btn-settings").addEventListener("click", (e) => { e.stopPropagation(); toggleSettingsMenu(); });
    document.addEventListener("click", (e) => {
      if (settingsMenu && !settingsMenu.contains(e.target)) toggleSettingsMenu(false);
    });
  }

  // --- Hamburger-Menü (Mobile) -------------------------------------------
  const hamburgerBtn = $("btn-hamburger");
  const hamburgerInner = $("toolbar-right-inner");
  function toggleHamburger(open) {
    const show = open == null ? !hamburgerInner.classList.contains("open") : open;
    hamburgerInner.classList.toggle("open", show);
    hamburgerBtn.classList.toggle("active", show);
  }
  if (hamburgerBtn) {
    hamburgerBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleHamburger(); });
    document.addEventListener("click", (e) => {
      if (!hamburgerInner.contains(e.target) && e.target !== hamburgerBtn)
        toggleHamburger(false);
    });
  }


  // --- Modus -------------------------------------------------------------
  $("mode-add").addEventListener("click", () => setMode("add"));
  $("mode-select").addEventListener("click", () => setMode("select"));
  $("mode-clamp").addEventListener("click", () => setMode("clamp"));
  // Loeschen arbeitet auf der Cursor-Auswahl; der Button ist sonst ausgeblendet.
  $("mode-delete").addEventListener("click", () => {
    const n = builder.deleteSelection();
    if (n) flash(t("flash_deleted_n", n));
    syncDeleteButton();
  });
  $("mode-reinforce").addEventListener("click", () => setMode(builder.mode === "reinforce" ? "select" : "reinforce"));
  $("mode-assembly").addEventListener("click", () => setMode("assembly"));
  $("btn-labels").addEventListener("click", () => toggleLabels());
  $("btn-hints").addEventListener("click", () => toggleHints());
  $("btn-diagonal").addEventListener("click", () => toggleDiagonal());

  function toggleLabels() {
    builder.setShowLabels(!builder.showLabels);
    $("btn-labels").classList.toggle("active", builder.showLabels);
    const ml = $("mobile-btn-labels"); if (ml) ml.classList.toggle("active", builder.showLabels);
  }
  function toggleHints() {
    builder.setShowHints(!builder.showHints);
    $("btn-hints").classList.toggle("active", builder.showHints);
    const mh = $("mobile-btn-hints"); if (mh) mh.classList.toggle("active", builder.showHints);
    if (builder.showHints) {
      const n = builder.suggestionCount();
      flash(n ? t("flash_hints_n", n) : t("flash_hints_0"));
    }
  }
  function toggleDiagonal() {
    if (builder.mode !== "add" && builder.mode !== "panel") setMode("add");
    builder.setDiagonal(!builder.diagonal);
    syncPartHighlights();
  }

  function syncPartHighlights() {
    renderCurrentPart();
    const inAdd = builder.mode === "add";
    const inPanel = builder.mode === "panel";
    // Die Buttons zeigen die Auswahl (auch wenn sie per Tastatur kam) und
    // markieren per .active, welcher der beiden Bau-Modi gerade laeuft.
    renderPartButtons();
    const curved = isCurved(builder.tubeId);
    tubeBtn.classList.toggle("active", inAdd && !curved);
    if (bowBtn) bowBtn.classList.toggle("active", inAdd && curved);
    panelBtn.classList.toggle("active", inPanel);
    if (slideGroupBtn) {
      slideGroupBtn.classList.toggle("active", builder.mode === "slide");
      // Beschriftung nach einem Sprachwechsel nachziehen; im Titel steht, welches
      // Teil gerade gewaehlt ist.
      slideGroupBtn.lastChild.textContent = t("grp_slides");
      slideGroupBtn.title = `${t("grp_slides")}: ${slideKindName(builder.slideKind)}`;
    }
    renderFittingButton();
    $("btn-diagonal").classList.toggle("active", inAdd && builder.diagonal);
    syncPartColors();
  }

  /** Loeschen-Button: nur sichtbar, wenn im Cursor-Modus etwas ausgewaehlt ist. */
  function syncDeleteButton() {
    const on = builder.mode === "select" && builder.selection.size > 0;
    $("mode-delete").hidden = !on;
  }

  /** Alle Knöpfe zum Bauen sperren oder freigeben (Aufbau-Modus). */
  function setzeBauteileGesperrt(gesperrt) {
    const bereiche = ["#grp-build", "#mode-delete", "#btn-undo", "#btn-redo"];
    for (const wahl of bereiche) {
      for (const el2 of document.querySelectorAll(`${wahl}, ${wahl} button, ${wahl} input`)) {
        if (el2.closest(".view-row")) continue;      // Ansicht bleibt bedienbar
        if (el2.tagName === "BUTTON" || el2.tagName === "INPUT") el2.disabled = gesperrt;
      }
    }
    $("toolbar-ctx").classList.toggle("locked", gesperrt);
    if (!gesperrt) { updateUndoButton(); syncDeleteButton(); }
  }

  function setMode(m) {
    builder.setMode(m);
    // Der Cursor-Modus gehoert zum Bauen (nicht zum Aufbau-Modus), deshalb
    // bleibt "Bauen" oben mit markiert.
    $("mode-add").classList.toggle("active", m === "add" || m === "panel" || m === "slide" || m === "fitting" || m === "select");
    $("mode-select").classList.toggle("active", m === "select");
    $("mode-clamp").classList.toggle("active", m === "clamp");
    $("mode-reinforce").classList.toggle("active", m === "reinforce");
    $("mode-assembly").classList.toggle("active", m === "assembly");
    // Im Aufbau-Modus bleibt die Bauteil-Zeile stehen, aber alles zum Bauen
    // ist ausgegraut -- gebaut wird dort nicht. Die Ansichts-Schalter
    // (Namen, Hinweise, Schnitt, Perspektive) bleiben nutzbar.
    $("toolbar-ctx").hidden = false;
    setzeBauteileGesperrt(m === "assembly");
    // Aufbau-Modus zeigt das Aufbau-Panel; beim Verlassen zurück zum zuletzt
    // gewählten Panel (oder zu). Andere Modi lassen das Panel unberührt.
    if (m === "assembly") {
      // Szene beim Wechsel in den Aufbau-Modus ausblenden.
      // Aufbau-Modus blendet die Szene aus, ohne die Vorliebe zu ueberschreiben.
      applyScene(false, false);
      showSidebarPanel("assembly");
    }
    else if (currentPanel === "assembly")
      showSidebarPanel(localStorage.getItem(SIDEBAR_PANEL_KEY) || null);
    $("btn-labels").classList.toggle("active", builder.showLabels);
    syncPartHighlights();
    syncDeleteButton();
    const statusMap = {
      select: "status_select",
      add: "status_add",
      panel: "status_panel",
      reinforce: "status_reinforce",
      clamp: "status_clamp",
      fitting: "status_fitting",
      assembly: "status_assembly",
    };
    $("status").textContent = t(statusMap[m] || "status_add");
    renderCurrentPart();
    if (m === "assembly") renderAssembly();
  }

  /**
   * Zeigt oben mittig über der Szene, welches Bauteil gerade gewählt ist --
   * Gegenstück zur Statuszeile unten links. Die Gruppen-Knöpfe in der Leiste
   * tragen nur noch den Gruppennamen, die Variante steht hier.
   */
  function renderCurrentPart() {
    const box = $("current-part");
    if (!box) return;
    let text = null;
    if (builder.mode === "add") {
      const tube = getPartById(builder.tubeId);
      if (tube) text = `${partName(tube)}${builder.diagonal ? " · 45°" : ""}`;
    } else if (builder.mode === "panel") {
      const pan = getPartById(builder.panelId);
      if (pan) text = partName(pan);
    } else if (builder.mode === "slide") {
      text = slideKindName(builder.slideKind);
    } else if (builder.mode === "clamp") {
      const def = allConnectors().find((c) => c.id === builder.clampPart)
        || accessories().find((a) => a.id === builder.clampPart);
      text = def ? partName(def) : null;
    } else if (builder.mode === "fitting") {
      const def = partForFitting(builder.fittingKind);
      text = def ? partName(def) : null;
    } else if (builder.mode === "reinforce") {
      const def = reinforcements()[0];
      text = def ? partName(def) : null;
    }
    box.textContent = text || "";
    box.hidden = !text;
  }

  // Schwarz gibt es nur fuer Platten, nicht fuer Rohre.
  const PANEL_EXTRA_COLORS = [{ id: "black", name: "Schwarz", name_en: "Black", hex: "#2b2b2b" }];

  let activePopup = null;
  let popupAnchor = null; // Button, der das Popup geöffnet hat

  function colorHexFor(colorId) {
    const c = tubeColors().find((x) => x.id === colorId);
    if (c) return c.hex;
    const extra = PANEL_EXTRA_COLORS.find((x) => x.id === colorId);
    return extra ? extra.hex : "#888";
  }

  /** Helligkeit prüfen → braucht dunkle Schrift? */
  function needsDarkInk(hex) {
    if (!hex || hex.length < 7) return false;
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return 0.299 * r + 0.587 * g + 0.114 * b > 0.55;
  }

  /** Aktive Tube/Panel-Buttons in der gewählten Baufarbe einfärben. */
  function syncPartColors() {
    // Zufallsfarbe: es gibt keine Farbe, die der Teile-Button zeigen koennte --
    // also bleibt er neutral.
    const random = builder.color === RANDOM_COLOR;
    const hex = colorHexFor(builder.color);
    const ink = needsDarkInk(hex) ? "var(--ink)" : "#fff";
    document.querySelectorAll(".btn.part[data-tube], .btn.part[data-panel]").forEach((b) => {
      if (b.classList.contains("active") && !random) {
        b.style.setProperty("--part-bg", hex);
        b.style.setProperty("--part-ink", ink);
      } else {
        b.style.removeProperty("--part-bg");
        b.style.removeProperty("--part-ink");
      }
    });
  }

  function closePopup() {
    if (!activePopup) return;
    activePopup.remove();
    activePopup = null;
    popupAnchor = null;
    document.removeEventListener("click", onPopupOutsideClick, true);
  }

  function onPopupOutsideClick(e) {
    // Klick auf den Anker-Button selbst (oder dessen Kinder) → Popup bleibt offen;
    // der Button-Handler togglet das Popup dann selbst.
    if (popupAnchor && popupAnchor.contains(e.target)) return;
    if (activePopup && !activePopup.contains(e.target)) closePopup();
  }

  /**
   * Öffnet die Varianten-Liste unter einem Bauteil-Button (Rohre/Platten).
   * Zweiter Klick auf denselben Button schließt sie wieder (Toggle).
   * iconOf(item) liefert das SVG-Markup, onPick(item) übernimmt die Auswahl.
   */
  function showPartPopup(anchorBtn, items, currentId, iconOf, onPick) {
    // Toggle: Popup für denselben Button bereits offen → schließen
    if (activePopup && popupAnchor === anchorBtn) {
      closePopup();
      return;
    }
    closePopup();

    const pop = el("div", "part-popup");
    for (const item of items) {
      const row = el("button", "part-popup-row" + (item.id === currentId ? " active" : ""));
      row.innerHTML = iconOf(item) + `<span class="pp-name"></span>`;
      row.querySelector(".pp-name").textContent = partName(item);
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        onPick(item);
        closePopup();
      });
      pop.appendChild(row);
    }

    document.body.appendChild(pop);
    placePopupUnder(pop, anchorBtn);

    activePopup = pop;
    popupAnchor = anchorBtn;
    // Leicht verzögert registrieren, damit der auslösende Klick nicht sofort schließt
    // In der CAPTURE-Phase: die Knöpfe der Leiste stoppen das Ereignis, damit
    // sich das eigene Popup nicht sofort wieder schließt. In der Bubble-Phase
    // käme der Schließer deshalb nie an, und eine offene Liste blieb stehen,
    // wenn man daneben etwas anklickt, das gar kein Popup öffnet (Bogenrohr).
    setTimeout(() => document.addEventListener("click", onPopupOutsideClick, true), 0);
  }

  // --- Rohr-Auswahl (Button + Popup) -------------------------------------
  // Frueher stand je Rohrlaenge ein eigener Button in der Leiste; auf schmalen
  // Screens musste die Haelfte davon per hide-narrow verschwinden. Jetzt zeigt
  // EIN Button die aktuelle Wahl, der Klick klappt die Varianten darunter auf.
  // Bogenrohre haben keine gerade Laenge und stehen deshalb nicht in
  // buildableTubes(); sie bauen ueber dieselben Richtungs-Handles, setzen dort
  // aber einen Viertelkreis -> eigener Button daneben.
  const tubeWrap = $("tube-buttons");
  const tubes = buildableTubes();
  const curvedTubes = buildableCurvedTubes();
  const isCurved = (id) => curvedTubes.some((x) => x.id === id);
  // Der Rohr-Button zeigt weiter die zuletzt gewaehlte GERADE Laenge, auch
  // waehrend ein Bogenrohr aktiv ist.
  let lastStraightTubeId = tubes.some((x) => x.id === builder.tubeId) ? builder.tubeId : tubes[0].id;

  function tubeIcon(tube) {
    if (tube.shape === "curved")
      return `<svg viewBox="0 0 28 16" width="28" height="16" aria-hidden="true">` +
        `<path d="M5 14 A9 9 0 0 1 14 5 L23 5" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/></svg>`;
    const w = Math.round(8 + Math.min(tube.length_cm, 75) / 75 * 18);
    return `<svg viewBox="0 0 28 16" width="28" height="16" aria-hidden="true">` +
      `<line x1="${14 - w / 2}" y1="8" x2="${14 + w / 2}" y2="8" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/></svg>`;
  }
  function tubeShortLabel(tube) {
    return tube.shape === "curved" ? t("part_bow") : String(tube.length_cm);
  }

  const tubeBtn = el("button", "btn part");
  tubeBtn.dataset.tube = "";
  tubeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    // Klick auf den Rohr-Button heisst "ich will gerade Rohre bauen" ->
    // Modus mitschalten und von einem aktiven Bogen zurueckwechseln.
    if (builder.mode !== "add") setMode("add");
    if (isCurved(builder.tubeId)) { builder.setTube(lastStraightTubeId); syncPartHighlights(); }
    showPartPopup(tubeBtn, tubes, builder.tubeId, tubeIcon, (tube) => {
      builder.setTube(tube.id);
      if (builder.mode !== "add") setMode("add");
      else syncPartHighlights();
    });
  });
  tubeWrap.appendChild(tubeBtn);

  // Bogenrohr: eigener Button direkt neben den geraden Rohren. Bei mehreren
  // Bogen-Varianten klappt dieselbe Varianten-Liste auf.
  const bowBtn = curvedTubes.length ? el("button", "btn part") : null;
  if (bowBtn) {
    bowBtn.dataset.tube = "";
    bowBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (builder.mode !== "add") setMode("add");
      if (curvedTubes.length < 2) {
        builder.setTube(curvedTubes[0].id);
        syncPartHighlights();
        return;
      }
      showPartPopup(bowBtn, curvedTubes, builder.tubeId, tubeIcon, (tube) => {
        builder.setTube(tube.id);
        syncPartHighlights();
      });
    });
    tubeWrap.appendChild(bowBtn);
  }

  // --- Farb-Buttons ------------------------------------------------------
  // Die Farben stehen direkt in der Toolbar. Frueher oeffnete ein zweiter Klick
  // auf einen Teile-Button ein Popup -- schlecht auffindbar und ein Klick, der
  // je nach Zustand etwas anderes tat. Schwarz gilt nur fuer Platten.
  const colorWrap = $("color-buttons");
  function renderColorButtons() {
    if (!colorWrap) return;
    colorWrap.innerHTML = "";
    for (const c of [...tubeColors(), ...PANEL_EXTRA_COLORS]) {
      const sw = el("button", "swatch");
      sw.style.background = c.hex;
      sw.title = (getLang() === "en" && c.name_en) ? c.name_en : c.name;
      sw.dataset.color = c.id;
      sw.addEventListener("click", () => {
        builder.setColor(c.id);
        renderColorButtons();
        syncPartColors();
      });
      colorWrap.appendChild(sw);
    }
    // Zufallsfarbe: faerbt jedes neu gesetzte Teil einzeln ein. Steht schon eine
    // Auswahl, wuerfelt ein Klick sie neu -- auch ein zweiter Klick, deshalb
    // ohne die "schon aktiv"-Abkuerzung.
    const rnd = el("button", "swatch swatch-random");
    rnd.title = t("color_random");
    rnd.dataset.color = RANDOM_COLOR;
    rnd.addEventListener("click", () => {
      builder.setColor(RANDOM_COLOR);
      renderColorButtons();
      syncPartColors();
    });
    colorWrap.appendChild(rnd);
    colorWrap.querySelectorAll("button").forEach((x) =>
      x.classList.toggle("active", x.dataset.color === builder.color));
  }
  renderColorButtons();

  // --- Platten-Auswahl (Button + Popup) ----------------------------------
  // Analog zu den Rohren. Volle Platte und Lochplatte gleicher Groesse stehen
  // als getrennte Varianten drin und zaehlen in der Stueckliste getrennt; das
  // Icon zeigt das 3x3-Lochraster.
  const panelWrap = $("panel-buttons");
  const panelList = buildablePanels();

  function panelIcon(p) {
    let holes = "";
    if (p.holes === 9)
      for (const cy of [4.6, 8, 11.4])
        for (const cx of [4.6, 8, 11.4])
          holes += `<circle cx="${cx}" cy="${cy}" r="1.35" fill="currentColor"/>`;
    return `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">` +
      `<rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill="currentColor" opacity="0.18" stroke="currentColor" stroke-width="1.4"/>` +
      holes + `</svg>`;
  }

  const panelBtn = el("button", "btn part");
  panelBtn.dataset.panel = "";
  panelBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (builder.mode !== "panel") setMode("panel");
    showPartPopup(panelBtn, panelList, builder.panelId, panelIcon, (p) => {
      builder.setPanel(p.id);
      setMode("panel");
    });
  });
  panelWrap.appendChild(panelBtn);

  /** Beschriftet die Bauteil-Buttons mit der jeweils aktuellen Variante. */
  function renderPartButtons() {
    if (tubes.some((x) => x.id === builder.tubeId)) lastStraightTubeId = builder.tubeId;
    const tube = tubes.find((x) => x.id === lastStraightTubeId) || tubes[0];
    // Der Gruppen-Knopf trägt den Gruppennamen, nicht die gewählte Variante --
    // welches Teil in der Hand liegt, steht oben mittig über der Szene.
    tubeBtn.innerHTML = tubeIcon(tube) + `<span></span>`;
    tubeBtn.lastChild.textContent = t("label_tubes");
    tubeBtn.title = `${t("label_tube")}: ${partName(tube)} – ${eur(tube.price)}`;

    if (bowBtn) {
      const bow = curvedTubes.find((x) => x.id === builder.tubeId) || curvedTubes[0];
      bowBtn.innerHTML = tubeIcon(bow) + `<span></span>`;
      bowBtn.lastChild.textContent = t("part_bow");
      bowBtn.title = `${partName(bow)} – ${eur(bow.price)}`;
    }

    const pan = panelList.find((x) => x.id === builder.panelId) || panelList[0];
    panelBtn.innerHTML = panelIcon(pan) + `<span></span>`;
    panelBtn.lastChild.textContent = t("label_panels");
    panelBtn.title = `${t("label_panel")}: ${partName(pan)} – ${eur(pan.price)}`;
  }

  // --- Rutschen-Button ---------------------------------------------------
  // Rutschen sind keine Rohre/Platten: sie werden an zwei senkrechten,
  // parallelen Rohren eingehaengt. Der Modus zeigt die passenden Felder an.
  // --- Rutschen: eine Gruppe mit Klappliste (wie die Anbauteile) ---------
  // Vier Teile: Integralrutsche (steht fuer sich), Modular- und Bogenrutschen-
  // Koerper (lassen sich aneinanderhaengen) und der Auslauf, der eine Kette
  // abschliesst.
  {
    const SLIDE_KINDS = ["slide-new2", "slide2", "curved-slide2", "slide-end2"];
    const items = SLIDE_KINDS.map((k) => {
      const def = partForFitting(k);
      return def ? { ...def, id: k, qdf: k } : null;
    }).filter(Boolean);
    // Je Teil ein eigenes Sinnbild: durchgehende Rutsche, gewellter Modul-
    // koerper, Viertelbogen, Auslauf mit Schnabel.
    const FORMEN = {
      "slide-new2": `<path d="M3 13 C7 13 5 4 13 3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
      "slide2": `<path d="M3 12 C6 12 6 6 9 6 C11 6 11 4 13 4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
      "curved-slide2": `<path d="M13 3 C13 9 9 13 3 13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
      "slide-end2": `<path d="M2 11 C6 11 8 6 13 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>` +
        `<path d="M2 11 L2 14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
    };
    const icon = (item) => `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">` +
      `${FORMEN[(item && item.qdf) || builder.slideKind] || FORMEN["slide-new2"]}</svg>`;
    const btn = el("button", "btn part");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      showPartPopup(btn, items, builder.slideKind, icon, (p) => {
        builder.slideKind = p.qdf;
        setMode("slide");
        syncPartHighlights();
      });
    });
    btn.innerHTML = icon() + `<span></span>`;
    btn.lastChild.textContent = t("grp_slides");
    btn.title = t("grp_slides");
    $("slide-buttons").appendChild(btn);
    slideGroupBtn = btn;
  }

  // --- Anbauteile: drei Gruppen mit je einer Klappliste -------------------
  // Geordnet wie am Bauteil gedacht: alles rund ums Rad, alles was Rohre
  // verbindet, und der Rest. Der Doppelrohrverbinder ist kein Anbauteil, er hat
  // einen eigenen Modus -- in der Liste steht er trotzdem bei den Verbindungen.
  const CLAMP_ENTRY = "double_tube";
  const CLIP_ENTRY = "tube_clamp";
  const FITTING_GROUPS = [
    ["grp_wheels", ["multi-wheel2", "floating-wheel2", "casters2", "bearing2", "hub-cap2", "steering-lock2"],
      `<circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" stroke-width="1.6"/>` +
      `<circle cx="8" cy="8" r="1.6" fill="currentColor"/>`],
    ["grp_joints", ["bearing-clamp", CLAMP_ENTRY, CLIP_ENTRY, "open-connector2"],
      `<line x1="2.5" y1="6" x2="13.5" y2="6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>` +
      `<line x1="2.5" y1="11" x2="13.5" y2="11" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>` +
      `<rect x="6" y="3" width="4" height="11" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.3"/>`],
    ["grp_other", ["bag2", "lattice2", "textil2", "textil-round2"],
      `<rect x="2.5" y="2.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>` +
      `<line x1="2.5" y1="8" x2="13.5" y2="8" stroke="currentColor" stroke-width="1.3"/>`],
  ];
  // Eigenes Sinnbild je Teil -- vorher trug jede Zeile einer Gruppe dasselbe
  // Gruppen-Icon, in der aufgeklappten Liste war damit nichts zu unterscheiden.
  const FITTING_ICONS = {
    // Räder
    "multi-wheel2": `<circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.5"/>` +
      `<circle cx="8" cy="8" r="1.5" fill="currentColor"/>` +
      `<path d="M8 2.4 L8 13.6 M2.4 8 L13.6 8 M4 4 L12 12 M12 4 L4 12" stroke="currentColor" stroke-width="0.9"/>`,
    "floating-wheel2": `<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2.6"/>` +
      `<circle cx="8" cy="8" r="1.8" fill="currentColor"/>`,
    "casters2": `<path d="M8 1.6 L8 5.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>` +
      `<path d="M4.4 5.4 L11.6 5.4 L10.4 9 L5.6 9 Z" fill="none" stroke="currentColor" stroke-width="1.3"/>` +
      `<circle cx="8" cy="11.6" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/>`,
    "bearing2": `<rect x="2.2" y="5.2" width="5.6" height="5.6" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/>` +
      `<rect x="7.8" y="6.6" width="6" height="2.8" rx="1.2" fill="currentColor"/>`,
    "hub-cap2": `<circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.2"/>` +
      `<circle cx="8" cy="8" r="3" fill="currentColor"/>`,
    "steering-lock2": `<circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.2"/>` +
      `<path d="M8 2.6 L8 8 L11.6 9.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>`,
    // Verbindungen
    "bearing-clamp": `<line x1="1.5" y1="10.5" x2="14.5" y2="10.5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>` +
      `<rect x="5.4" y="7.4" width="5.2" height="6.2" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/>` +
      `<rect x="6.6" y="2.4" width="2.8" height="5.4" rx="1.2" fill="currentColor"/>`,
    "hole-connector4": `<line x1="1.5" y1="10.5" x2="14.5" y2="10.5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>` +
      `<rect x="5.4" y="7.4" width="5.2" height="6.2" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/>` +
      `<circle cx="8" cy="4" r="2.4" fill="none" stroke="currentColor" stroke-width="1.4"/>`,
    // Doppelrohrverbinder: eine "8" mit den beiden Rohren mittendurch.
    "double_tube": `<line x1="1" y1="5.2" x2="15" y2="5.2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>` +
      `<line x1="1" y1="10.8" x2="15" y2="10.8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>` +
      `<circle cx="8" cy="5.2" r="3.1" fill="none" stroke="currentColor" stroke-width="1.4"/>` +
      `<circle cx="8" cy="10.8" r="3.1" fill="none" stroke="currentColor" stroke-width="1.4"/>`,
    // Rohrklammer: dieselbe "8", aber oben und unten offen -- zwei "C", die mit
    // dem Rücken aneinanderliegen.
    "tube_clamp": `<line x1="1" y1="5.2" x2="15" y2="5.2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>` +
      `<line x1="1" y1="10.8" x2="15" y2="10.8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>` +
      `<path d="M5.4 3.5 A3.1 3.1 0 1 0 10.6 3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>` +
      `<path d="M5.4 12.5 A3.1 3.1 0 1 1 10.6 12.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`,
    "open-connector2": `<line x1="1.5" y1="8" x2="9.5" y2="8" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>` +
      `<ellipse cx="11.4" cy="8" rx="2.2" ry="3.4" fill="currentColor"/>`,
    // Sonstiges
    "bag2": `<path d="M3 4 L13 4 L11.6 13 L4.4 13 Z" fill="none" stroke="currentColor" stroke-width="1.4"/>` +
      `<line x1="3" y1="4" x2="13" y2="4" stroke="currentColor" stroke-width="1.8"/>`,
    "lattice2": `<rect x="2.5" y="4" width="11" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/>` +
      `<path d="M6 4 L6 12 M9.5 4 L9.5 12 M2.5 6.7 L13.5 6.7 M2.5 9.3 L13.5 9.3" stroke="currentColor" stroke-width="0.8"/>`,
    "textil-round2": `<path d="M3 13 L3 8 A8 8 0 0 1 11 13 Z" fill="none" stroke="currentColor" stroke-width="1.4"/>` +
      `<path d="M3 8 A8 8 0 0 1 11 13" fill="none" stroke="currentColor" stroke-width="1.6"/>`,
    "textil2": `<path d="M2.5 4 L13.5 4 L13.5 12 L2.5 12 Z" fill="none" stroke="currentColor" stroke-width="1.4"/>` +
      `<path d="M2.5 6.5 C5 5.4 6.5 7.6 8 6.5 C9.5 5.4 11 7.6 13.5 6.5" fill="none" stroke="currentColor" stroke-width="1"/>` +
      `<path d="M2.5 9.5 C5 8.4 6.5 10.6 8 9.5 C9.5 8.4 11 10.6 13.5 9.5" fill="none" stroke="currentColor" stroke-width="1"/>`,
  };
  const fittingGroupBtns = [];
  for (const [key, kinds, path] of FITTING_GROUPS) {
    const items = kinds.map((k) => {
      const def = (k === CLAMP_ENTRY || k === CLIP_ENTRY)
        ? allConnectors().find((c) => c.id === k) : partForFitting(k);
      return def ? { ...def, id: k, qdf: k } : null;
    }).filter(Boolean);
    if (!items.length) continue;
    // Der Gruppen-Knopf trägt das Gruppen-Sinnbild, jede Zeile der Liste ihr
    // eigenes.
    const icon = (item) => `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">` +
      `${(item && FITTING_ICONS[item.qdf]) || path}</svg>`;
    const btn = el("button", "btn part");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      showPartPopup(btn, items, builder.mode === "clamp" ? builder.clampPart : builder.fittingKind, icon, (p) => {
        if (p.qdf === CLAMP_ENTRY || p.qdf === CLIP_ENTRY) {
          builder.setClampPart(p.qdf);
          setMode("clamp");
          return;
        }
        builder.setFitting(p.qdf);
        setMode("fitting");
      });
    });
    btn.innerHTML = icon() + `<span></span>`;
    btn.lastChild.textContent = t(key);
    btn.title = t(key);
    $("fitting-buttons").appendChild(btn);
    fittingGroupBtns.push({ btn, kinds, key });
  }
  renderFittingButton = () => {
    for (const g of fittingGroupBtns) {
      const aktiv = (builder.mode === "fitting" && g.kinds.includes(builder.fittingKind))
        || (builder.mode === "clamp" && g.kinds.includes(builder.clampPart));
      g.btn.classList.toggle("active", aktiv);
      g.btn.lastChild.textContent = t(g.key);
    }
  };
  renderFittingButton();

  // --- Aktionen ----------------------------------------------------------
  $("btn-undo").addEventListener("click", () => builder.undo());
  $("btn-redo").addEventListener("click", () => builder.redo());
  const camBtn = $("btn-camera");
  if (camBtn) camBtn.addEventListener("click", () => scene.resetCamera());
  /** Ein Modell als QDF anbieten. `daten` ist ein Modell-JSON. */
  function exportiereModell(name, daten) {
    const m2 = new (model.constructor)();
    m2.loadJSON(daten);
    const { text, stats } = buildQDF(m2);
    storage.exportText(text, `${dateiName(name)}.qdf`);
    const parts = `${stats.connectors} + ${stats.tubes + stats.bows} + ${stats.panels}`;
    flash(t("flash_exported_qdf", parts));
  }

  /** Aus einem Entwurfsnamen einen brauchbaren Dateinamen machen. */
  function dateiName(name) {
    return (name || "quadro").replace(/[\\/:*?"<>|]/g, "-").trim() || "quadro";
  }

  // Alle Modelle auf einmal: mit Ordner-Auswahl (Chrome/Edge) in einen Rutsch,
  // sonst nacheinander als einzelne Downloads.
  $("btn-export-all").addEventListener("click", async () => {
    toggleFileMenu(false);
    ui.captureActiveTab();
    let liste = [];
    try { liste = await docs.listDocs(); } catch (e) { console.warn("Dateien:", e); }
    // Offene, noch nicht gespeicherte Tabs kommen mit ihrem Arbeitsstand dazu.
    const alle = liste.map((d) => ({ name: d.name, data: d.data }));
    for (const tab of tabs) {
      if (tab.docId && !tab.dirty) continue;
      const i = alle.findIndex((x) => x.name === tab.name);
      const eintrag = { name: tab.name, data: tab.model };
      if (i >= 0) alle[i] = eintrag; else alle.push(eintrag);
    }
    if (!alle.length) { flash(t("flash_export_all_empty")); return; }
    const texte = alle.map((d) => {
      const m2 = new (model.constructor)();
      m2.loadJSON(d.data);
      return { name: dateiName(d.name), text: buildQDF(m2).text };
    });

    if (window.showDirectoryPicker) {
      try {
        const ordner = await window.showDirectoryPicker({ mode: "readwrite" });
        for (const f of texte) {
          const handle = await ordner.getFileHandle(`${f.name}.qdf`, { create: true });
          const w = await handle.createWritable();
          await w.write(f.text);
          await w.close();
        }
        flash(t("flash_exported_all", texte.length));
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return;      // Dialog abgebrochen
        console.warn("Ordner-Export:", e);
      }
    }
    for (const f of texte) storage.exportText(f.text, `${f.name}.qdf`);
    flash(t("flash_exported_all", texte.length));
  });

  $("own-import").addEventListener("click", () => $("file-import").click());
  $("file-import").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      // Importiertes landet in einem EIGENEN Tab -- das offene Modell bleibt,
      // wie es ist. Der Dateiname wird zum Modellnamen.
      let daten = null, info = "";
      if (/\.qdf$/i.test(f.name)) {
        const text = await f.text();
        const data = parseQDF(text, {
          tubes: buildableTubes(),
          panels: panels(),
          connectorSize: geometry().connectorSize,
          mergeEps: 2,
        });
        if (!data.nodes.length) throw new Error(t("qdf_no_parts"));
        daten = data;
        const st = data.stats;
        const skip = Object.entries(st.skipped || {});
        const skipTxt = skip.length
          ? t("qdf_skipped", skip.map(([k, v]) => `${v}× ${k.replace(/2$|-new2$|-end2$/, "")}`).join(", "))
          : "";
        const panelTxt = st.panels ? `, ${st.panels} ${t("bom_panels").toLowerCase()}` : "";
        const clampTxt = st.clamps ? `, ${st.clamps} ${t("btn_clamp").toLowerCase()}` : "";
        const stats = `${st.nodes} ${t("bom_connectors").split(" ")[0].toLowerCase()}, ${st.tubes} ${t("bom_tubes").toLowerCase()}${panelTxt}${clampTxt}`;
        info = t("qdf_imported", stats, skipTxt);
      } else {
        daten = await storage.importFile(f);
        info = t("flash_imported_json");
      }
      const name = f.name.replace(/\.[^.]+$/, "").trim() || t("doc_untitled");
      openTab({ name, data: daten, dirty: true });
      scene.resetCamera();
      flash(info);
    } catch (err) {
      alert(err.message);
    }
    e.target.value = "";
  });

  // --- Dateien: Neu, Öffnen, Speichern, Speichern unter ------------------
  // Ein Tab zeigt entweder eine gespeicherte Datei (docId gesetzt) oder einen
  // noch namenlosen Stand. Gespeichert wird in dieselbe Datei; "Speichern
  // unter" legt eine neue an.
  const AUTOSAVE_MODE_KEY = "quadro.autosaveMode.v1";
  let autosaveOn = localStorage.getItem(AUTOSAVE_MODE_KEY) !== "0";
  let docSaveTimer = null;

  function isAutosaveOn() { return autosaveOn; }
  function setAutosaveOn(on) {
    autosaveOn = !!on;
    localStorage.setItem(AUTOSAVE_MODE_KEY, autosaveOn ? "1" : "0");
    if (autosaveOn) scheduleDocSave();
  }

  async function refreshDocList() {
    // Die Kopfzeile hat keine Auswahlliste mehr -- die Modelle stehen in der
    // Seitenleiste. Bleibt für den Fall, dass die Liste wieder auftaucht.
    const sel = $("doc-select");
    if (!sel) { if (currentPanel === "own") renderOwnModels(); return; }
    const alt = sel.value;
    sel.innerHTML = "";
    let liste = [];
    try { liste = await docs.listDocs(); } catch (e) { console.warn("Dateien:", e); }
    if (!liste.length) {
      const o = el("option", null, t("saves_empty"));
      o.value = ""; sel.appendChild(o);
      return;
    }
    for (const d of liste) {
      const o = el("option", null, d.name); o.value = d.id; sel.appendChild(o);
    }
    if (alt && liste.some((d) => d.id === alt)) sel.value = alt;
  }

  /**
   * Namen abfragen und auf Kollision prüfen. Liefert { name, doc } -- `doc` ist
   * die vorhandene Datei, wenn überschrieben werden soll -- oder null bei
   * Abbruch.
   */
  async function askName(vorschlag, { eigeneId = null } = {}) {
    const name = (prompt(t("prompt_save_name"), vorschlag || "") || "").trim();
    if (!name) return null;
    const vorhanden = await docs.docByName(name);
    if (vorhanden && vorhanden.id !== eigeneId) {
      if (!confirm(t("confirm_overwrite", name))) return null;
      return { name, doc: vorhanden };
    }
    return { name, doc: null };
  }

  /** Laufenden Tab in seine Datei schreiben (oder in eine neue). */
  async function saveActiveTab({ name = null, docId = undefined, nurBeiAenderung = false } = {}) {
    const tab = ui.captureActiveTab();
    if (!tab) return null;
    const ziel = docId !== undefined ? docId : tab.docId;
    // Automatisches Speichern soll das Datum nur anfassen, wenn sich am Modell
    // wirklich etwas geändert hat -- sonst rutscht eine Datei allein durchs
    // Öffnen in der Liste nach oben.
    if (nurBeiAenderung && ziel) {
      const alt = await docs.getDoc(ziel);
      if (alt && JSON.stringify(alt.data) === JSON.stringify(tab.model)) {
        tab.dirty = false;
        renderTabs();
        return alt;
      }
    }
    try {
      const doc = await docs.saveDoc({ docId: ziel, name: name || tab.name, data: tab.model });
      tab.docId = doc.id;
      tab.name = doc.name;
      tab.dirty = false;
      renderTabs();
      refreshDocList();
      return doc;
    } catch (e) {
      flash(t("flash_save_failed", e.message));
      return null;
    }
  }

  function scheduleDocSave() {
    if (!autosaveOn) return;
    clearTimeout(docSaveTimer);
    docSaveTimer = setTimeout(() => {
      const tab = activeTab();
      if (tab && tab.dirty) saveActiveTab({ nurBeiAenderung: true });
    }, 800);
  }

  // Ein neues Modell heißt erst einmal "Unbenannt" und gehört zu keiner Datei.
  // Nach dem Namen wird gefragt, wenn gespeichert wird -- nicht vorher.
  $("btn-doc-new").addEventListener("click", () => { openTab({ name: freierName() }); });

  // "Öffnen" hat keine eigene Liste mehr: es zeigt den Seitenleisten-Tab
  // "Meine Modelle", dort steht jedes Modell mit Öffnen, Umbenennen, Löschen.
  $("btn-doc-open").addEventListener("click", () => {
    showSidebarPanel("own");
    renderOwnModels();
  });

  /** Datei in einem Tab öffnen -- ist sie schon offen, wird der Tab gewählt. */
  async function openDocById(docId) {
    const offen = tabs.find((x) => x.docId === docId);
    if (offen) { activateTab(offen.tabId); return offen; }
    const doc = await docs.getDoc(docId);
    if (!doc) { flash(t("load_error_data")); return null; }
    const tab = openTab({ name: doc.name, data: doc.data, docId: doc.id });
    flash(t("flash_loaded", doc.name));
    return tab;
  }


  $("btn-doc-save").addEventListener("click", async () => {
    const tab = ui.activeTab;
    if (!tab) return;
    toggleFileMenu(false);
    if (!tab.docId) {
      const gewaehlt = await askName(tab.name);
      if (!gewaehlt) return;
      await saveActiveTab({ name: gewaehlt.name, docId: gewaehlt.doc ? gewaehlt.doc.id : null });
    } else {
      await saveActiveTab();
    }
    flash(t("flash_saved", ui.activeTab.name));
  });

  $("btn-doc-saveas").addEventListener("click", async () => {
    const tab = ui.activeTab;
    if (!tab) return;
    const gewaehlt = await askName(tab.name);
    if (!gewaehlt) return;
    toggleFileMenu(false);
    await saveActiveTab({ name: gewaehlt.name, docId: gewaehlt.doc ? gewaehlt.doc.id : null });
    flash(t("flash_saved", gewaehlt.name));
  });

  // --- Hilfe-Overlay -----------------------------------------------------
  $("btn-help").addEventListener("click", () => { $("help-overlay").hidden = false; });
  $("help-close").addEventListener("click", () => { $("help-overlay").hidden = true; });

  // --- Modell-Bibliothek -------------------------------------------------
  // Eigene QDF-Sammlung: einmal einlesen, danach durchsuchen, gegen den
  // Bestand filtern und mit einem Klick oeffnen. Die Dateien liegen in
  // IndexedDB (localStorage waere mit ~3 MB Sammlung zu klein).
  let libEntries = [];        // { id, name, file, qdf, meta }
  let libLoaded = false;

  function libStatus(msg) { $("lib-status").textContent = msg || ""; }

  async function loadLibrary() {
    try {
      libEntries = await storage.libAll();
    } catch (e) {
      console.warn("Bibliothek nicht lesbar:", e);
      libEntries = [];
    }
    libLoaded = true;
    renderLibrary();
  }

  // Dateien einlesen. Laeuft in Haeppchen, damit die Oberflaeche bei einem
  // ganzen Ordner (mehrere hundert Dateien) nicht einfriert.
  async function addToLibrary(fileList) {
    const files = [...fileList].filter((f) => /\.qdf$/i.test(f.name));
    if (!files.length) return;
    const fresh = [];
    let skipped = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (i % 10 === 0) {
        libStatus(t("lib_reading", i, files.length));
        await new Promise((r) => setTimeout(r, 0));
      }
      let entry = null;
      try {
        entry = designEntry(`${f.name}|${f.size}`, f.name, await f.text());
      } catch (err) {
        console.warn("QDF nicht lesbar:", f.name, err);
      }
      if (entry) fresh.push(entry); else skipped++;
    }
    if (fresh.length) {
      try {
        await storage.libPut(fresh);
      } catch (e) {
        console.warn("Bibliothek nicht speicherbar:", e);
      }
    }
    await loadLibrary();
    libStatus(t("lib_added", fresh.length, skipped));
    flash(t("lib_added", fresh.length, skipped));
  }

  function libVisible() {
    const q = $("lib-search").value.trim().toLowerCase();
    const onlyFeasible = $("lib-only-feasible").checked;
    const rows = [];
    for (const e of libEntries) {
      if (q && !e.name.toLowerCase().includes(q)) continue;
      const check = checkAgainstInventory(e.meta, inventory);
      if (onlyFeasible && !check.ok) continue;
      rows.push({ entry: e, check });
    }
    return rows;
  }

  function renderLibrary() {
    const list = $("lib-list");
    list.innerHTML = "";
    if (!libLoaded) return;
    if (!libEntries.length) {
      list.appendChild(el("p", "hint", t("lib_empty")));
      libStatus("");
      return;
    }
    const rows = libVisible();
    libStatus(t("lib_count", rows.length, libEntries.length));
    if (!rows.length) {
      list.appendChild(el("p", "hint", t("lib_no_match")));
      return;
    }
    for (const { entry, check } of rows) {
      const m = entry.meta;
      const row = el("button", "lib-row" + (check.ok ? " ok" : ""));
      row.type = "button";
      row.title = check.ok ? t("lib_feasible_title") : t("lib_infeasible_title");
      const head = el("div", "lib-row-head");
      head.appendChild(el("span", "lib-name", entry.name));
      const badge = el("span", "lib-badge", check.ok ? "✓" : String(missingCount(check)));
      head.appendChild(badge);
      row.appendChild(head);
      row.appendChild(el("span", "lib-meta", t("lib_parts", m.connectors, m.tubes, m.panels)));
      row.appendChild(el("span", "lib-meta", t("lib_size", m.size[0], m.size[1], m.size[2])));
      row.addEventListener("click", () => openFromLibrary(entry));
      list.appendChild(row);
    }
  }

  /** Meine Modelle: gespeicherte Dateien, Klick öffnet sie in einem Tab. */
  let ownRenderLauf = 0;
  async function renderOwnModels() {
    const box = $("own-list");
    if (!box) return;
    // Mehrere Aufrufe können sich überholen (Klick + update + Panel-Wechsel).
    // Nur der jüngste darf die Liste schreiben, sonst hängen die Einträge
    // mehrfach untereinander.
    const lauf = ++ownRenderLauf;
    let liste = [];
    try { liste = await docs.listDocs(); } catch (e) { console.warn("Dateien:", e); }
    if (lauf !== ownRenderLauf) return;
    box.innerHTML = "";
    if (!liste.length) { box.appendChild(el("div", "muted", t("saves_empty"))); return; }
    const iconKnopf = (svg, titel, fn) => {
      const b2 = el("button", "btn ghost icon-sq small");
      b2.innerHTML = svg;
      b2.title = titel;
      b2.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
      return b2;
    };
    const STIFT = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M11.2 2.4 13.6 4.8 5.6 12.8 2.4 13.6 3.2 10.4z"/></svg>`;
    const PFEIL = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v8"/><path d="M5 7.2 8 10.4l3-3.2"/><path d="M2.6 12.6h10.8"/></svg>`;
    const MUELL = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.6h10"/><path d="M4.6 4.6 5.2 13h5.6l.6-8.4"/><path d="M6.4 4.6V3h3.2v1.6"/></svg>`;
    for (const d of liste) {
      const offen = tabs.some((x) => x.docId === d.id);
      const row = el("div", "lib-row own-row" + (offen ? " active" : ""));
      const links = el("div", "own-main");
      const kopf = el("div", "lib-head");
      kopf.appendChild(el("span", "lib-name", d.name));
      const knoten = (d.data && d.data.nodes) ? d.data.nodes.length : 0;
      const rohre = (d.data && d.data.tubes) ? d.data.tubes.length : 0;
      kopf.appendChild(el("span", "lib-badge", `${knoten}/${rohre}`));
      links.appendChild(kopf);
      links.appendChild(el("span", "lib-meta", new Date(d.updatedAt || Date.now()).toLocaleString()));
      row.appendChild(links);

      const werkzeuge = el("div", "own-tools");
      werkzeuge.appendChild(iconKnopf(STIFT, t("btn_doc_rename"), async () => {
        const gewaehlt = await askName(d.name, { eigeneId: d.id });
        if (!gewaehlt) return;
        await docs.renameDoc(d.id, gewaehlt.name);
        for (const tab of tabs) if (tab.docId === d.id) tab.name = gewaehlt.name;
        renderTabs(); renderOwnModels();
      }));
      werkzeuge.appendChild(iconKnopf(PFEIL, t("btn_export_qdf"), () => {
        // Offener Tab? Dann den Arbeitsstand nehmen, sonst die Datei.
        const tab = tabs.find((x) => x.docId === d.id);
        if (tab && tab.tabId === activeTabId) captureActiveTab();
        exportiereModell(d.name, tab ? tab.model : d.data);
      }));
      werkzeuge.appendChild(iconKnopf(MUELL, t("btn_doc_delete_title"), async () => {
        if (!confirm(t("confirm_delete_save", d.name))) return;
        await docs.removeDoc(d.id);
        for (const tab of tabs) if (tab.docId === d.id) { tab.docId = null; tab.dirty = true; }
        renderTabs(); renderOwnModels();
      }));
      row.appendChild(werkzeuge);
      row.addEventListener("click", () => openDocById(d.id));
      box.appendChild(row);
    }
  }

  function openFromLibrary(entry) {
    const data = parseDesign(entry.qdf);
    if (!data) { flash(t("lib_load_failed")); return; }
    // Die Sammlung bleibt, wie sie ist: geöffnet wird eine KOPIE in einem
    // eigenen Tab, die noch zu keiner Datei gehört.
    openTab({ name: entry.name, data, dirty: true });
    scene.resetCamera();
    flash(t("lib_loaded", entry.name));
  }


  $("lib-add-folder").addEventListener("click", () => $("lib-file-folder").click());
  $("lib-add-files").addEventListener("click", () => $("lib-file-list").click());
  for (const id of ["lib-file-folder", "lib-file-list"]) {
    $(id).addEventListener("change", async (e) => {
      // FileList ist LEBENDIG: das Zuruecksetzen von value leert sie sofort
      // wieder. Deshalb erst kopieren, dann das Feld freigeben (sonst laesst
      // sich derselbe Ordner nicht ein zweites Mal waehlen).
      const files = [...e.target.files];
      e.target.value = "";
      await addToLibrary(files);
    });
  }
  $("lib-clear").addEventListener("click", async () => {
    if (!libEntries.length || !confirm(t("lib_confirm_clear"))) return;
    await storage.libClear();
    await loadLibrary();
  });
  $("lib-search").addEventListener("input", renderLibrary);
  $("lib-only-feasible").addEventListener("change", (e) => {
    if (e.target.checked && inventoryEmpty()) {
      e.target.checked = false;
      flash(t("lib_no_inventory"));
    }
    renderLibrary();
  });

  // Ohne eingetragenen Bestand ist der Machbarkeits-Filter sinnlos.
  function inventoryEmpty() {
    for (const bucket of Object.values(inventory)) {
      if (bucket && Object.values(bucket).some((v) => v > 0)) return false;
    }
    return true;
  }

  // --- Seitenleiste: EIN Panel auf Abruf (Stückliste / Bestand) ----------
  // Die Leiste ist standardmäßig zu (body.sidebar-hidden im HTML). Die
  // Menüband-Buttons "Stückliste" und "Bestand" öffnen je genau ihr Panel;
  // erneuter Klick schließt wieder. Der Aufbau-Modus zeigt das Aufbau-Panel.
  const SIDEBAR_W_KEY = "quadro.sidebarWidth.v1";
  const SIDEBAR_PANEL_KEY = "quadro.sidebarPanel.v1"; // '', 'bom', 'inventory', 'library'
  const root = document.documentElement;
  const savedW = parseInt(localStorage.getItem(SIDEBAR_W_KEY), 10);
  if (savedW >= 240 && savedW <= 640) root.style.setProperty("--sidebar-w", savedW + "px");

  let currentPanel = null;      // 'bom' | 'library' | 'assembly' | null
  let vorAufbauPanel = "bom";   // wohin die Leiste nach dem Aufbau zurückkehrt

  function applyPanelVisibility() {
    $("panel-bom").hidden = currentPanel !== "bom";
    $("panel-own").hidden = currentPanel !== "own";
    $("panel-library").hidden = currentPanel !== "library";
    $("panel-assembly").hidden = currentPanel !== "assembly";
    document.body.classList.toggle("sidebar-hidden", currentPanel === null);
    $("toggle-sidebar").classList.toggle("active", currentPanel !== null);
    renderSideTabs();
    requestAnimationFrame(() => scene.onResize());
  }
  // name: 'bom' | 'inventory' | 'library' | 'assembly' | null.
  // Nur bom/inventory/library/zu wird gemerkt.
  function showSidebarPanel(name) {
    currentPanel = name;
    if (name === "own") renderOwnModels();
    if (name === "library" && !libLoaded) loadLibrary();
    if (name === "bom" || name === "own" || name === "library" || name === null)
      localStorage.setItem(SIDEBAR_PANEL_KEY, name || "");
    applyPanelVisibility();
  }
  function toggleSidebarPanel(name) {
    showSidebarPanel(currentPanel === name ? null : name);
  }

  // Tab-Leiste in der Seitenleiste: Stückliste & Bestand, Modelle, Aufbau.
  // "Aufbau" gibt es nur im Aufbau-Modus und wird dort automatisch gewählt.
  function renderSideTabs() {
    for (const b of $("side-tabs").querySelectorAll(".side-tab")) {
      const name = b.dataset.panel;
      b.classList.toggle("active", currentPanel === name);
      if (name === "assembly") b.hidden = builder.mode !== "assembly";
    }
  }
  for (const b of $("side-tabs").querySelectorAll(".side-tab")) {
    b.addEventListener("click", () => showSidebarPanel(b.dataset.panel));
  }

  // EIN Knopf oben rechts: Leiste auf oder zu. Welcher Inhalt zu sehen ist,
  // wählt die Tab-Leiste in der Seitenleiste selbst.
  let letzterPanel = localStorage.getItem(SIDEBAR_PANEL_KEY) || "bom";
  $("toggle-sidebar").addEventListener("click", () => {
    if (currentPanel) { letzterPanel = currentPanel; showSidebarPanel(null); }
    else showSidebarPanel(letzterPanel || "bom");
  });

  // Szene (Gras, Baeume, Himmel) ein-/ausblenden via Canvas-Icon. Der Zustand
  // wird gemerkt; Standard beim allerersten Start ist aus.
  const SCENE_KEY = "quadro.scene.v1";
  let grassOn = false;
  const sceneIcon = $("scene-toggle");
  const applyScene = (on, save = true) => {
    grassOn = on;
    scene.setScene(on);
    sceneIcon.classList.toggle("off", !on);
    if (save) localStorage.setItem(SCENE_KEY, on ? "1" : "0");
  };
  sceneIcon.addEventListener("click", () => applyScene(!grassOn));
  applyScene(localStorage.getItem(SCENE_KEY) === "1", false);

  // Startzustand: zuletzt gewähltes Panel. Beim allerersten Aufruf steht noch
  // nichts im Speicher -- dann ist die Leiste offen und zeigt die Stückliste.
  const gemerktesPanel = localStorage.getItem(SIDEBAR_PANEL_KEY);
  showSidebarPanel(gemerktesPanel === null ? "bom" : (gemerktesPanel || null));

  (function initResizer() {
    const res = $("sidebar-resizer");
    if (!res) return;
    let dragging = false;
    const onMove = (e) => {
      if (!dragging) return;
      const w = Math.min(640, Math.max(240, window.innerWidth - e.clientX));
      root.style.setProperty("--sidebar-w", w + "px");
      scene.onResize();
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("resizing");
      const w = parseInt(getComputedStyle(root).getPropertyValue("--sidebar-w"), 10);
      if (w) localStorage.setItem(SIDEBAR_W_KEY, String(w));
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    res.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      dragging = true;
      document.body.classList.add("resizing");
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  })();

  // --- Aufbaumodus (Stepper + Drucken) -----------------------------------
  // Farben in der Aufbauliste zusammenfassen (Zustand ueberlebt den Reload).
  const ASM_COLOR_KEY = "quadro.asmColors.v1";
  let asmIgnoreColors = localStorage.getItem(ASM_COLOR_KEY) === "1";
  let asmShownStep = -1;
  const asmNoColor = $("asm-nocolor");
  if (asmNoColor) {
    asmNoColor.checked = asmIgnoreColors;
    asmNoColor.addEventListener("change", () => {
      asmIgnoreColors = asmNoColor.checked;
      localStorage.setItem(ASM_COLOR_KEY, asmIgnoreColors ? "1" : "0");
      // Zusammengefasste und getrennte Zeilen haben verschiedene Schluessel.
      if (asmHighlightKey) { asmHighlightKey = null; builder.setHighlight(null); }
      renderAssembly();
    });
  }

  $("asm-prev").addEventListener("click", () => builder.setAssemblyStep(builder.assemblyStep - 1));
  $("asm-next").addEventListener("click", () => builder.setAssemblyStep(builder.assemblyStep + 1));
  $("asm-print").addEventListener("click", () => printPlan());

  // Aufbaurichtung: je nach Modell und Platz im Raum ist eine andere Reihenfolge
  // praktischer als die Standard-Reihenfolge von unten nach oben.
  const ORDER_KEYS = { "y+": "asm_order_yp", "x+": "asm_order_xp", "x-": "asm_order_xm",
                       "z+": "asm_order_zp", "z-": "asm_order_zm" };
  const ORDER_KEY = "quadro.asmOrder.v1";
  const orderSel = $("asm-order");
  // Gewaehlte Reihenfolge ueberlebt den Reload; sie gehoert zum Arbeitsstand,
  // nicht zum Modell.
  const storedOrder = localStorage.getItem(ORDER_KEY);
  if (storedOrder && BUILD_ORDERS.includes(storedOrder)) builder.setAssemblyOrder(storedOrder);
  function renderOrderOptions() {
    if (!orderSel) return;
    orderSel.innerHTML = "";
    for (const [value, key] of Object.entries(ORDER_KEYS)) {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = t(key);
      if (value === builder.assemblyOrder) o.selected = true;
      orderSel.appendChild(o);
    }
  }
  renderOrderOptions();
  if (orderSel) orderSel.addEventListener("change", () => {
    builder.setAssemblyOrder(orderSel.value);
    localStorage.setItem(ORDER_KEY, orderSel.value);
    renderAssembly();
  });

  function asmRow(container, name, colorId, count, badge, sel) {
    const row = el("div", "asm-row");
    const label = el("span", "asm-name");
    if (colorId) {
      const dot = el("span", "dot"); dot.style.background = colorHex(colorId);
      label.appendChild(dot);
    }
    label.appendChild(document.createTextNode(name));
    if (badge) label.appendChild(el("span", "asm-badge", badge));
    row.appendChild(label);
    row.appendChild(el("span", "asm-count", `${count}×`));
    if (sel) {
      const key = asmRowKey(sel);
      row.dataset.asmKey = key;
      if (key === asmHighlightKey) row.classList.add("marked");
      // Klick hebt genau diese Teile des Schrittes im Modell hervor; ein
      // zweiter Klick nimmt die Hervorhebung wieder zurueck.
      row.addEventListener("click", () => {
        setAssemblyHighlight(key === asmHighlightKey ? null : sel);
      });
    }
    container.appendChild(row);
  }

  // --- Hervorhebung aus der Aufbau-Liste ---------------------------------
  // Wie in der Bestandsliste: eine Zeile anklicken faerbt die zugehoerigen
  // Teile lila, alle uebrigen treten zurueck. Gesucht wird nur INNERHALB des
  // aktuellen Schritts -- gleiche Teile spaeterer Lagen bleiben unberuehrt.
  let asmHighlightKey = null;

  function asmRowKey(sel) {
    return [sel.kind, sel.type || sel.tubeId || sel.panelId || "", sel.color || ""].join(":");
  }

  function partsForAssemblyRow(step, sel) {
    const ids = new Set();
    if (!step) return ids;
    if (sel.kind === "connector" || sel.kind === "openEnds") {
      for (const id of step.nodeIds || []) {
        const n = model.nodes.get(id);
        if (!n) continue;
        const types = connectorsForNode(model, n);
        if (sel.kind === "connector" ? types.includes(sel.type)
          : (types.length === 0 && model.degree(id) >= 1)) ids.add(id);
      }
    } else if (sel.kind === "tube") {
      for (const id of step.tubeIds || []) {
        const t = model.tubes.get(id);
        if (t && t.tubeId === sel.tubeId && (sel.color == null || t.color === sel.color)) ids.add(id);
      }
    } else if (sel.kind === "panel") {
      for (const id of step.panelIds || []) {
        const p = model.panels.get(id);
        if (p && p.panelId === sel.panelId && (sel.color == null || p.color === sel.color)) ids.add(id);
      }
    }
    return ids;
  }

  function setAssemblyHighlight(sel) {
    const step = builder.buildPlan.steps[builder.assemblyStep];
    asmHighlightKey = sel ? asmRowKey(sel) : null;
    builder.setHighlight(sel ? partsForAssemblyRow(step, sel) : null);
    for (const r of $("asm-body").querySelectorAll(".asm-row"))
      r.classList.toggle("marked", !!asmHighlightKey && r.dataset.asmKey === asmHighlightKey);
  }

  // Rohr-/Plattenzeilen ohne Farbe zusammenfassen. Die Zaehlung im Aufbauplan
  // trennt nach Farbe -- beim Bauen ist oft nur wichtig, WELCHES Teil und wie
  // viele davon.
  function mergeByPart(rows, idKey) {
    const map = new Map();
    for (const r of rows) {
      const k = r[idKey];
      if (!map.has(k)) map.set(k, { ...r, color: null, colorName: null, count: 0 });
      map.get(k).count += r.count;
    }
    return [...map.values()];
  }

  function renderAssembly() {
    const plan = builder.buildPlan;
    const total = plan.steps.length;
    const i = builder.assemblyStep;
    // Wurde die Hervorhebung von aussen aufgehoben (Klick auf ein Teil im
    // Modell), darf keine Zeile mehr markiert bleiben.
    if (!builder.highlight) asmHighlightKey = null;
    // Die Hervorhebung gilt immer nur fuer den gezeigten Schritt.
    if (i !== asmShownStep) {
      asmShownStep = i;
      if (asmHighlightKey) { asmHighlightKey = null; builder.setHighlight(null); }
    }
    $("asm-counter").textContent = total ? t("asm_counter", i, total) : "–";
    $("asm-prev").disabled = i <= 0;
    $("asm-next").disabled = i >= total - 1;
    $("asm-progress-bar").style.width = total ? `${((i + 1) / total) * 100}%` : "0%";

    const title = $("asm-title"), body = $("asm-body");
    body.innerHTML = "";
    const step = plan.steps[i];
    if (!step) {
      title.textContent = t("asm_empty_title");
      body.appendChild(el("div", "muted", t("asm_empty_body")));
      return;
    }
    title.textContent = step.title;
    const plain = asmIgnoreColors;
    if (step.connectors.length || step.openEnds) {
      body.appendChild(el("h4", "asm-cat", t("asm_cat_connectors")));
      for (const c of step.connectors)
        asmRow(body, c.name, null, c.count, c.code, { kind: "connector", type: c.type });
      if (step.openEnds) asmRow(body, t("asm_open_ends"), null, step.openEnds, "", { kind: "openEnds" });
    }
    if (step.tubes.length) {
      body.appendChild(el("h4", "asm-cat", t("asm_cat_tubes")));
      for (const tube of (plain ? mergeByPart(step.tubes, "tubeId") : step.tubes))
        asmRow(body, plain ? tube.name : `${tube.name} · ${tube.colorName}`,
          tube.color, tube.count, "", { kind: "tube", tubeId: tube.tubeId, color: tube.color });
    }
    if (step.panels.length) {
      body.appendChild(el("h4", "asm-cat", t("asm_cat_panels")));
      for (const p of (plain ? mergeByPart(step.panels, "panelId") : step.panels))
        asmRow(body, plain ? p.name : `${p.name} · ${p.colorName}`,
          p.color, p.count, "", { kind: "panel", panelId: p.panelId, color: p.color });
    }
  }

  function printPlan() {
    const plan = computeBuildPlan(model);
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    let html = `<h1>${esc(t("print_title"))}</h1>`;
    if (!plan.steps.length) {
      html += `<p>${esc(t("print_empty"))}</p>`;
    } else {
      plan.steps.forEach((step, idx) => {
        html += `<section class="p-step"><h2>${idx + 1}. ${esc(step.title)}</h2>`;
        const parts = [];
        for (const c of step.connectors) parts.push(`${c.count}× ${esc(c.name)}${c.code ? " (" + esc(c.code) + ")" : ""}`);
        if (step.openEnds) parts.push(`${step.openEnds}× ${esc(t("print_open_end"))}`);
        for (const tube of step.tubes) parts.push(`${tube.count}× ${esc(tube.name)} · ${esc(tube.colorName)}`);
        for (const p of step.panels) parts.push(`${p.count}× ${esc(p.name)} · ${esc(p.colorName)}`);
        html += `<ul>` + parts.map((p) => `<li>${p}</li>`).join("") + `</ul></section>`;
      });
    }
    $("print-area").innerHTML = html;
    window.print();
  }



  // Meldungen bleiben stehen, bis die naechste kommt -- eine Meldung, die man
  // gerade nicht angesehen hat, war sonst weg.
  function flash(msg) {
    $("status").textContent = msg;
  }

  // --- Tastatur ----------------------------------------------------------
  window.addEventListener("keydown", (e) => {
    const tgt = e.target;
    if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "SELECT" || tgt.tagName === "TEXTAREA" || tgt.isContentEditable)) return;

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) builder.redo();
      else builder.undo();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      builder.redo();
      return;
    }
    // Strg+A: alles auswaehlen -- nur im Cursor-Modus, sonst gibt es keine
    // Auswahl, die es treffen koennte (und der Browser markiert die Seite).
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
      if (builder.mode !== "select") return;
      e.preventDefault();
      const n = builder.selectAll();
      flash(t("flash_selected_n", n));
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;

    if (builder.mode === "assembly") {
      if (k === "ArrowRight" || k === "ArrowUp" || k === "PageUp") {
        e.preventDefault(); builder.setAssemblyStep(builder.assemblyStep + 1); return;
      }
      if (k === "ArrowLeft" || k === "ArrowDown" || k === "PageDown") {
        e.preventDefault(); builder.setAssemblyStep(builder.assemblyStep - 1); return;
      }
    }

    // Die Pfeiltasten folgen dem Blickwinkel: schaut man frontal auf das Modell,
    // baut Pfeil-hoch nach OBEN, aus der Aufsicht nach hinten. So zeigt die
    // Taste immer dorthin, wo das Rohr auf dem Bildschirm auch erscheint. Fuer
    // die dritte Achse dreht man die Ansicht -- eigene Tasten braucht es nicht.
    const axes = scene.getHorizontalAxes();
    const frontal = scene.isFrontalView();
    let dir = null;
    if (k === "ArrowUp") dir = frontal ? [0, 1, 0] : axes.forward;
    else if (k === "ArrowDown") dir = frontal ? [0, -1, 0] : neg(axes.forward);
    else if (k === "ArrowRight") dir = axes.right;
    else if (k === "ArrowLeft") dir = neg(axes.right);
    if (dir) {
      e.preventDefault();
      // Cursor-Modus mit Auswahl: die Pfeiltasten schieben sie im Raster,
      // statt in den Bau-Modus zu springen.
      if (builder.mode === "select" && builder.selection.size) {
        builder.moveSelectionBy(dir);
        return;
      }
      if (builder.mode !== "add") setMode("add");
      builder.buildStep(dir);
      return;
    }

    if (k >= "1" && k <= "9") {
      const idx = parseInt(k, 10) - 1;
      if (idx < tubes.length) { builder.setTube(tubes[idx].id); syncPartHighlights(); }
      return;
    }

    switch (k.toLowerCase()) {
      case "b": setMode("add"); break;
      case "p": setMode("panel"); break;
      case "s": setMode("select"); break;
      case "v": setMode("reinforce"); break;
      case "a": setMode("assembly"); break;
      case "k": setMode("clamp"); break;
      case "d": toggleDiagonal(); break;
      case "n": toggleLabels(); break;
      case "h": toggleHints(); break;
      case "c": scene.resetCamera(); break;
      // Escape fuehrt zurueck in den Cursor-Modus -- ausser im Aufbau-Modus:
      // dort ist die Auswahl nur zum Nachschlagen da, Escape raeumt sie weg und
      // laesst den Modus stehen (ihn zu verlassen waere ein Verlust an
      // Fortschritt fuer eine Taste, die man beilaeufig drueckt).
      case "escape":
        closePopup();
        // Offene Overlays zuerst: Escape schliesst sie, statt den Modus zu wechseln.
        if (!$("help-overlay").hidden) { $("help-overlay").hidden = true; break; }
        // Erst aufraeumen, dann den Modus wechseln: ein Escape, das eine
        // Markierung wegnimmt, soll einen nicht gleichzeitig aus dem Modus
        // werfen. Im Aufbau-Modus wird der Modus nie verlassen.
        if (builder.clearMarks()) { update(); break; }
        if (builder.mode !== "assembly") setMode("select");
        break;
      case "delete":
      case "backspace":
        if (builder.mode === "select") {
          if (!builder.selection.size) break;
          e.preventDefault();
          flash(t("flash_deleted_n", builder.deleteSelection()));
          syncDeleteButton();
        } else if (builder.selectedNodeId) {
          e.preventDefault();
          const id = builder.selectedNodeId;
          builder.selectedNodeId = null;
          builder.recordHistory(() => model.removeNode(id));
          builder.refresh();
        }
        break;
    }
  });

  // --- Stueckliste + Bestand ---------------------------------------------
  function colorHex(id) {
    const c = tubeColors().find((x) => x.id === id);
    return c ? c.hex : "#888";
  }

  /**
   * Eine Zeile der Stückliste.
   * `invKey` ("gruppe:id") verbindet sie mit dem Bestand: dann steht statt der
   * blossen Anzahl "vorhanden/benötigt", und reicht der Bestand nicht, ist die
   * Zeile rot hinterlegt. Im Bearbeiten-Modus wird daraus ein Eingabefeld.
   * `hl` beschreibt, welche Teile ein Klick im Modell hervorhebt.
   */
  function bomRow(container, name, colorId, count, subtotal, invKey = null, hl = null) {
    const inv = invKey ? invIndex.get(invKey) : null;
    const bedarf = inv ? inv.need : count;
    const marke = hl ? hlKey(hl) : null;
    const row = el("div", "bom-row" + (inv && !inv.ok && !bomEditMode ? " bad" : "")
      + (marke && marke === bomHighlightKey ? " marked" : ""));
    const label = el("span", "bom-name");
    if (colorId) {
      const dot = el("span", "dot"); dot.style.background = colorHex(colorId);
      label.appendChild(dot);
    }
    label.appendChild(document.createTextNode(name));
    row.appendChild(label);

    if (bomEditMode && invKey) {
      // Bearbeiten: benötigte Anzahl links, eigener Bestand als Eingabe.
      const [bucket, id] = invKey.split(/:(.+)/);
      row.appendChild(el("span", "bom-count", bedarf ? `${bedarf}×` : ""));
      const inp = document.createElement("input");
      inp.type = "number"; inp.min = "0"; inp.className = "inv-input";
      inp.value = (inventory[bucket] && inventory[bucket][id]) || 0;
      inp.addEventListener("click", (e) => e.stopPropagation());
      inp.addEventListener("change", () => {
        const v = Math.max(0, parseInt(inp.value || "0", 10) || 0);
        if (v) inventory[bucket][id] = v; else delete inventory[bucket][id];
      });
      row.appendChild(inp);
    } else {
      // Anzeigen: entweder "vorhanden/benötigt" oder nur die Anzahl.
      row.appendChild(el("span", "bom-count", inv ? `${inv.owned}/${inv.need}` : `${count}×`));
      if (inv) row.title = t("inv_have", inv.owned, inv.need);
    }
    if (bomShowPrice) row.appendChild(el("span", "bom-sub", subtotal == null ? "" : eur(subtotal)));
    if (marke && !bomEditMode) {
      // Anklickbar: hebt die Teile dieser Zeile im Modell hervor.
      row.classList.add("clickable");
      row.addEventListener("click", () => setBomHighlight(marke === bomHighlightKey ? null : hl));
    }
    container.appendChild(row);
  }

  // Hervorhebung aus der Stückliste: welche Zeile ist markiert?
  let bomHighlightKey = null;
  const hlKey = (hl) => `${hl.kind}:${hl.id}:${hl.color || ""}`;

  /** Teile im Modell, die zu einer Stücklisten-Zeile gehören. */
  function partsForBomRow(hl) {
    const ids = new Set();
    const farbePasst = (el2) => !hl.color || el2.color === hl.color;
    if (hl.kind === "tubes") {
      for (const tb of model.tubes.values())
        if (!tb.arm && !tb.link && tb.tubeId === hl.id && farbePasst(tb)) ids.add(tb.id);
    } else if (hl.kind === "panels") {
      for (const p of model.panels.values())
        if (p.panelId === hl.id && farbePasst(p)) ids.add(p.id);
    } else if (hl.kind === "connectors") {
      for (const n of model.nodes.values()) {
        if (n.unused) continue;
        for (const typ of connectorsForNode(model, n)) if (typ === hl.id) { ids.add(n.id); break; }
      }
    } else if (hl.kind === "fittings") {
      for (const f of model.fittings.values()) {
        const def = partForFitting(f.kind, f.mask);
        if (def && def.id === hl.id) ids.add(f.id);
      }
    } else if (hl.kind === "reinforcements") {
      for (const tb of model.tubes.values()) if (tb.reinforced) ids.add(tb.id);
    } else if (hl.kind === "textiles") {
      for (const tx of model.textiles.values()) if (farbePasst(tx)) ids.add(tx.id);
    } else if (hl.kind === "slides") {
      for (const sl of model.slides.values()) if (sl.kind === hl.id) ids.add(sl.id);
    }
    return ids;
  }

  function setBomHighlight(hl) {
    bomHighlightKey = hl ? hlKey(hl) : null;
    builder.setHighlight(hl ? partsForBomRow(hl) : null);
    update();
  }

  // Wohin ein Zubehörteil in Stückliste und Bestand gehört. Textilien und
  // Räder haben eigene Abschnitte, der Rest bleibt "Anbauteile".
  const TEXTIL_ARTEN = new Set(["textil2", "lattice2", "textil-round2", "bag2", "roof-large2"]);
  const RAD_ARTEN = new Set(["multi-wheel2", "floating-wheel2", "hub-cap2", "casters2",
    "adapter2", "bearing2", "steering-lock2"]);
  function zubehoerGruppe(art) {
    if (TEXTIL_ARTEN.has(art)) return "textiles";
    if (RAD_ARTEN.has(art)) return "wheels";
    return "fittings";
  }

  // Bestand je Katalogteil, aufgeschlüsselt für die Stücklisten-Zeilen.
  let invIndex = new Map();

  /**
   * Bestand kann farbgenau geführt werden: neben "T35" steht dann "T35|red".
   * Für die Machbarkeit zählt die Summe über alle Farben eines Teils.
   */
  function bestandSumme(bucket, id) {
    const topf = inventory[bucket] || {};
    let summe = topf[id] || 0;
    for (const [k, v] of Object.entries(topf)) {
      const [teil, farbe] = k.split("|");
      if (farbe && teil === id) summe += v || 0;
    }
    return summe;
  }

  /** Bestandsobjekt, in dem die Farbvarianten je Teil zusammengezählt sind. */
  function flacherBestand() {
    const out = {};
    for (const [bucket, topf] of Object.entries(inventory)) {
      out[bucket] = {};
      for (const [k, v] of Object.entries(topf || {})) {
        const teil = k.split("|")[0];
        out[bucket][teil] = (out[bucket][teil] || 0) + (v || 0);
      }
    }
    return out;
  }
  const round2Preis = (v) => Math.round(v * 100) / 100;

  // Nach Farben getrennte Zeilen? Merkt sich die Wahl über Sitzungen hinweg.
  let bomEditMode = false;      // Bestand bearbeiten statt nur anzeigen
  const BOM_PRICE_KEY = "quadro.bomShowPrice.v1";
  let bomShowPrice = localStorage.getItem(BOM_PRICE_KEY) === "1";
  const bomPriceBox = $("bom-show-price");
  if (bomPriceBox) {
    bomPriceBox.checked = bomShowPrice;
    bomPriceBox.addEventListener("change", () => {
      bomShowPrice = bomPriceBox.checked;
      localStorage.setItem(BOM_PRICE_KEY, bomShowPrice ? "1" : "0");
      update();
    });
  }
  const BOM_COLOR_KEY = "quadro.bomByColor.v1";
  let bomByColor = localStorage.getItem(BOM_COLOR_KEY) === "1";
  const bomColorBox = $("bom-by-color");
  if (bomColorBox) {
    bomColorBox.checked = bomByColor;
    bomColorBox.addEventListener("change", () => {
      bomByColor = bomColorBox.checked;
      localStorage.setItem(BOM_COLOR_KEY, bomByColor ? "1" : "0");
      bomHighlightKey = null;
      builder.setHighlight(null);
      update();
    });
  }


  function update() {
    syncDeleteButton();
    // Der Builder kann den Schraeg-Schalter selbst umlegen (zweiter Klick auf
    // die gewaehlte Kupplung) -- die Toolbar muss das nachziehen.
    syncPartHighlights();
    const bom = computeBOM(model);
    // Stückliste und Bestand stehen in EINER Liste: erst rechnen, welche Teile
    // reichen, dann jede Zeile damit beschriften.
    const cmp = compareInventory(bom, flacherBestand());
    invIndex = new Map(cmp.rows.map((r) => [r.group + ":" + r.key, r]));
    lastInvRows = cmp.rows;
    // Nach Farben getrennt: je Farbe eine eigene Bedarfs-/Bestandszeile.
    if (bomByColor) {
      const farbig = (bucket, rows, idFeld) => {
        for (const r of rows) {
          if (!r.color) continue;
          const key = `${bucket}:${r[idFeld]}|${r.color}`;
          const owned = (inventory[bucket] || {})[`${r[idFeld]}|${r.color}`] || 0;
          invIndex.set(key, { group: bucket, key: `${r[idFeld]}|${r.color}`,
            name: r.name, need: r.count, owned, ok: owned >= r.count });
        }
      };
      farbig("tubes", bom.tubes, "tubeId");
      farbig("panels", bom.panels, "panelId");
    }

    // Nach Farben getrennt oder zusammengefasst? Der Preis hängt nicht an der
    // Farbe, deshalb lassen sich die Zeilen einfach addieren.
    const nachFarbe = bomByColor;
    const fasseZusammen = (rows, idFeld) => {
      if (nachFarbe) return rows;
      const map = new Map();
      for (const r of rows) {
        const id = r[idFeld];
        if (!map.has(id)) map.set(id, { ...r, color: null, colorName: null, count: 0, subtotal: 0 });
        const z = map.get(id);
        z.count += r.count;
        z.subtotal = round2Preis(z.subtotal + (r.subtotal || 0));
      }
      return [...map.values()];
    };

    // Bearbeiten: jede Kategorie zeigt den ganzen Katalog, damit sich auch
    // Bestand für Teile eintragen lässt, die im Modell (noch) nicht vorkommen.
    if (bomEditMode) { renderBestand(); return; }

    const tb = $("bom-tubes"); tb.innerHTML = "";
    const rohre = fasseZusammen(bom.tubes, "tubeId");
    if (rohre.length === 0) tb.appendChild(el("div", "muted", "–"));
    for (const r of rohre) {
      bomRow(tb, r.color ? `${r.name} · ${r.colorName}` : r.name, r.color, r.count, r.subtotal,
        "tubes:" + r.tubeId + (r.color ? "|" + r.color : ""),
        { kind: "tubes", id: r.tubeId, color: r.color });
    }

    const cb = $("bom-connectors"); cb.innerHTML = "";
    if (bom.connectors.length === 0) cb.appendChild(el("div", "muted", "–"));
    for (const r of bom.connectors) {
      bomRow(cb, r.name, null, r.count, r.subtotal, "connectors:" + r.type,
        { kind: "connectors", id: r.type });
    }
    if (bom.openEnds > 0) {
      // Hinweiszeile, kein Teil: die Zahl steht in derselben Spalte wie die
      // Mengen der übrigen Zeilen, nur ohne "x".
      const row = el("div", "bom-row muted");
      row.appendChild(el("span", "bom-name", t("bom_open_ends")));
      row.appendChild(el("span", "bom-count", String(bom.openEnds)));
      if (bomShowPrice) row.appendChild(el("span", "bom-sub", ""));
      cb.appendChild(row);
    }

    const pb = $("bom-panels"); pb.innerHTML = "";
    const platten = fasseZusammen(bom.panels, "panelId");
    if (platten.length === 0) pb.appendChild(el("div", "muted", "–"));
    for (const r of platten) {
      bomRow(pb, r.color ? `${r.name} · ${r.colorName}` : r.name, r.color, r.count, r.subtotal,
        "panels:" + r.panelId + (r.color ? "|" + r.color : ""),
        { kind: "panels", id: r.panelId, color: r.color });
    }

    const xb = $("bom-textiles"); xb.innerHTML = "";
    const textiles = bom.textiles || [];
    for (const r of textiles) {
      const name = `${t("bom_textile")} ${r.w}×${r.h} cm` + (nachFarbe ? ` · ${r.colorName}` : "");
      bomRow(xb, name, nachFarbe ? r.color : null, r.count, null, null,
        { kind: "textiles", id: `${r.w}x${r.h}`, color: nachFarbe ? r.color : null });
    }

    const slb = $("bom-slides"); slb.innerHTML = "";
    const slides = bom.slides || [];
    if (slides.length === 0) slb.appendChild(el("div", "muted", "–"));
    for (const r of slides) {
      bomRow(slb, r.name || slideKindName(r.kind), null, r.count, r.subtotal || null,
        r.id ? "fittings:" + r.id : null, { kind: "slides", id: r.kind });
    }

    // Zubehör auf Textilien, Räder und Anbauteile verteilen.
    const fits = bom.fittings || [];
    const rad = $("bom-wheels"); rad.innerHTML = "";
    const fb = $("bom-fittings"); fb.innerHTML = "";
    const ziele = { textiles: xb, wheels: rad, fittings: fb };
    const zaehler = { textiles: textiles.length, wheels: 0, fittings: 0 };
    for (const r of fits) {
      const gruppe = zubehoerGruppe(r.kind);
      zaehler[gruppe]++;
      bomRow(ziele[gruppe], r.name, null, r.count, r.subtotal || null, "fittings:" + r.id,
        { kind: "fittings", id: r.id });
    }
    for (const [gruppe, box] of Object.entries(ziele)) {
      if (!zaehler[gruppe]) box.appendChild(el("div", "muted", "–"));
    }

    const rb = $("bom-reinforcements"); rb.innerHTML = "";
    const reinf = bom.reinforcements || [];
    if (reinf.length === 0) rb.appendChild(el("div", "muted", "–"));
    for (const r of reinf) bomRow(rb, r.name, null, r.count, r.subtotal, "reinforcements:" + r.id, { kind: "reinforcements", id: r.id });

    $("sum-tubes").textContent = bom.totals.tubes;
    $("sum-conn").textContent = bom.totals.connectors;
    $("sum-panels").textContent = bom.totals.panels;
    $("sum-reinf").textContent = bom.totals.reinforcements || 0;
    $("sum-price").textContent = eur(bom.totals.price);

    renderInventory(bom);
    // Die Bibliothek zeigt je Modell, ob der Bestand reicht -- nach einer
    // Bestandsaenderung muessen die Haken neu gerechnet werden.
    if (currentPanel === "library") renderLibrary();
    if (currentPanel === "own") renderOwnModels();
    if (builder.mode === "assembly") renderAssembly();
  }

  /** Aussenmasse des Modells (Hoehe/Breite/Tiefe) ueber der Bestandsliste. */
  function renderModelSize() {
    const box = $("model-size");
    if (!box) return;
    // Halbe Kupplung an jeder Seite: die Wuerfel stehen ueber die Eckknoten
    // hinaus, das Mass waere sonst um eine Kupplungslaenge zu klein.
    const b = model.bounds(geometry().connectorSize / 2);
    if (!b) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    box.innerHTML = "";
    const dims = [["dim_height", b.size[1]], ["dim_width", b.size[0]], ["dim_depth", b.size[2]]];
    for (const [key, v] of dims) {
      const cell = el("div", "dim");
      cell.appendChild(el("span", "dim-label", t(key)));
      cell.appendChild(el("span", "dim-value", `${Math.round(v)} cm`));
      box.appendChild(cell);
    }
  }

  // Welche Bestandszeile ist gerade hervorgehoben ("group:key" oder null)?
  let invHighlightKey = null;

  /** Teile im Modell, die zu einer Bestandszeile gehoeren. */
  function partsForInventoryRow(r) {
    const ids = new Set();
    if (r.group === "tubes") {
      for (const t of model.tubes.values())
        if (!t.arm && !t.link && t.tubeId === r.key) ids.add(t.id);
    } else if (r.group === "panels") {
      for (const p of model.panels.values()) if (p.panelId === r.key) ids.add(p.id);
    } else if (r.group === "connectors") {
      for (const n of model.nodes.values())
        if (connectorsForNode(model, n).includes(r.key)) ids.add(n.id);
      // Doppelrohrverbinder haengen nicht an Knoten, sondern sind eigene Teile.
      for (const c of (model.clamps ? model.clamps.values() : []))
        if ((c.connectorId || "double_tube") === r.key) ids.add(c.id);
    } else if (r.group === "reinforcements") {
      for (const t of model.tubes.values()) if (t.reinforced) ids.add(t.id);
    }
    return ids;
  }

  // Die Bestandsliste ist Teil der Stückliste; die Hervorhebung läuft über
  // setBomHighlight. Bleibt für den Aufruf aus der Machbarkeitsprüfung.
  function setInventoryHighlight(r) {
    invHighlightKey = r ? r.group + ":" + r.key : null;
    builder.setHighlight(r ? partsForInventoryRow(r) : null);
  }

  let lastInvRows = [];

  /**
   * Bearbeiten-Ansicht: dieselben Abschnitte, aber der volle Katalog und je
   * Zeile ein Eingabefeld für den eigenen Bestand.
   */
  function renderBestand() {
    const zubehoer = accessories();
    const istRutsche = (a) => typeof a.qdf === "string" && /slide/.test(a.qdf);
    const ausGruppe = (name) => zubehoer.filter((a) => !istRutsche(a) && zubehoerGruppe(a.qdf) === name);
    const abschnitte = [
      ["bom-tubes", "tubes", allTubes()],
      ["bom-connectors", "connectors", allConnectors()],
      ["bom-panels", "panels", panels()],
      ["bom-textiles", "fittings", ausGruppe("textiles")],
      ["bom-slides", "fittings", zubehoer.filter(istRutsche)],
      ["bom-wheels", "fittings", ausGruppe("wheels")],
      ["bom-fittings", "fittings", ausGruppe("fittings")],
      ["bom-reinforcements", "reinforcements", reinforcements()],
    ];
    // Farbige Teile bekommen je Farbe eine eigene Zeile, sobald die Liste nach
    // Farben getrennt ist -- sonst ließe sich der Bestand nicht farbgenau
    // eintragen. Farbig sind Rohre und Platten (Platten zusätzlich schwarz).
    const farbigeToepfe = { tubes: tubeColors(), panels: [...tubeColors(), ...PANEL_EXTRA_COLORS] };
    for (const [boxId, bucket, teile] of abschnitte) {
      const box = $(boxId);
      box.innerHTML = "";
      if (!teile.length) { box.appendChild(el("div", "muted", "–")); continue; }
      const farben = bomByColor ? farbigeToepfe[bucket] : null;
      for (const it of teile) {
        const name = partName(it) + (it.code ? ` (${it.code})` : "");
        if (farben) {
          for (const f of farben) {
            const farbName = (getLang() === "en" && f.name_en) ? f.name_en : f.name;
            bomRow(box, `${name} · ${farbName}`, f.id, 0, null, `${bucket}:${it.id}|${f.id}`);
          }
        } else {
          bomRow(box, name, null, 0, null, `${bucket}:${it.id}`);
        }
      }
    }
  }

  /** Kopf des vereinten Panels: Modellmaße und Machbarkeit. */
  function renderInventory(bom) {
    renderModelSize();
    const banner = $("feasibility-banner");
    if (bom.totals.tubes === 0 && bom.totals.connectors === 0 && bom.totals.panels === 0) {
      banner.className = "feasibility";
      banner.textContent = "";
      lastInvRows = [];
      if (invHighlightKey) { invHighlightKey = null; builder.setHighlight(null); }
      return;
    }
    const cmp = compareInventory(bom, inventory);
    // Hervorhebung nachziehen: das Modell kann sich geändert haben.
    const nochDa = cmp.rows.find((r) => r.group + ":" + r.key === invHighlightKey);
    if (invHighlightKey) {
      if (nochDa) builder.highlight = partsForInventoryRow(nochDa);
      else { invHighlightKey = null; builder.highlight = null; }
    }
    banner.className = "feasibility " + (cmp.feasible ? "ok" : "no");
    banner.textContent = cmp.feasible ? t("inv_feasible") : t("inv_infeasible");
  }



  function exportInventory() {
    storage.exportFile(
      { format: "quadro-inventory", version: 1,
        tubes: inventory.tubes, connectors: inventory.connectors,
        panels: inventory.panels, reinforcements: inventory.reinforcements },
      "quadro-bestand.json",
    );
    flash(t("flash_inv_exported"));
  }

  function sanitizeInventory(data) {
    if (!data || typeof data !== "object") throw new Error(t("inv_invalid"));
    const out = { tubes: {}, connectors: {}, panels: {}, reinforcements: {} };
    for (const bucket of ["tubes", "connectors", "panels", "reinforcements"]) {
      const src = data[bucket];
      if (src && typeof src === "object") {
        for (const [k, raw] of Object.entries(src)) {
          const n = Math.max(0, parseInt(raw, 10) || 0);
          if (n) out[bucket][k] = n;
        }
      }
    }
    return out;
  }

  async function importInventory(file) {
    try {
      const data = await storage.importFile(file);
      const next = sanitizeInventory(data);
      inventory.tubes = next.tubes;
      inventory.connectors = next.connectors;
      inventory.panels = next.panels;
      inventory.reinforcements = next.reinforcements;
      saveInv(inventory);
      update();
      flash(t("flash_inv_imported"));
    } catch (err) { alert(err.message); }
  }

  $("btn-inv-toggle").addEventListener("click", () => {
    if (bomEditMode) {
      // Speichern: Eingaben stehen schon im Bestand, jetzt festschreiben.
      saveInv(inventory);
      bomEditMode = false;
      flash(t("flash_inv_saved"));
    } else {
      bomEditMode = true;
      bomHighlightKey = null;
      builder.setHighlight(null);
    }
    const knopf = $("btn-inv-toggle");
    knopf.textContent = t(bomEditMode ? "btn_inv_save" : "btn_inv_edit");
    knopf.classList.toggle("active", bomEditMode);
    update();
  });

  $("btn-inv-export").addEventListener("click", exportInventory);
  $("btn-inv-import").addEventListener("click", () => $("inv-file-import").click());
  $("inv-file-import").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) importInventory(f);
    e.target.value = "";
  });

  // Die Datei-Handler oben greifen auf diese Sammlung zu; sie wird unten
  // gefüllt (Tabs, aktiver Tab, Sichern).
  const ui = {};

  // --- Dateien in Tabs ---------------------------------------------------
  // Ein Tab hält ein Modell samt seiner Werkzeugleiste, Ansicht und Schritt-
  // speicher. Umgeschaltet wird über EIN Modell und EINEN Builder: der Stand
  // des alten Tabs wird gesichert, der des neuen eingesetzt.
  let tabs = [];            // { tabId, docId, name, dirty, model, view }
  let activeTabId = null;
  let sessionTimer = null;
  // Während ein Tab eingesetzt wird, laufen Änderungsmeldungen des Builders
  // auf -- die gehören nicht zum Bearbeiten und dürfen den Tab nicht als
  // geändert markieren (sonst blitzt beim Wechsel kurz der Punkt auf).
  let ladeVorgang = false;

  function activeTab() { return tabs.find((x) => x.tabId === activeTabId) || null; }

  /** Ansicht und Werkzeugleiste des laufenden Tabs einsammeln. */
  function viewState() {
    return {
      ...builder.uiState(),
      slice: JSON.parse(JSON.stringify(slice)),
      camera: scene.cameraState() || null,
      projection: scene.projection,
    };
  }

  function applyViewState(v = {}) {
    builder.setUiState(v);
    if (v.slice && ["x", "y", "z"].includes(v.slice.axis)) {
      Object.assign(slice, { on: !!v.slice.on, axis: v.slice.axis, value: v.slice.value || 0,
        flip: !!v.slice.flip, values: { ...slice.values, ...(v.slice.values || {}) } });
    } else {
      slice.on = false;
    }
    setMode(v.mode || "select");     // setzt auch die Knöpfe
    if (v.projection && v.projection !== scene.projection) {
      scene.setProjection(v.projection);
      syncProjectionButton();
    }
    applySlice();
    syncPartHighlights();
    if (v.camera) scene.restoreCameraState(v.camera); else scene.resetCamera();
    $("btn-labels").classList.toggle("active", builder.showLabels);
    $("btn-hints").classList.toggle("active", builder.showHints);
    $("btn-diagonal").classList.toggle("active", builder.mode === "add" && builder.diagonal);
    renderColorButtons();
    updateUndoButton();
  }

  /** Stand des laufenden Tabs festhalten (vor jedem Wechsel und vor dem Sichern). */
  function captureActiveTab() {
    const tab = activeTab();
    if (!tab) return null;
    tab.model = model.toJSON();
    tab.view = viewState();
    return tab;
  }

  // --- Tabs umsortieren (nur waagerecht) ---------------------------------
  // Gezogen wird mit Zeigerereignissen, damit es auch auf dem Touchscreen
  // funktioniert. Die Reihenfolge ändert sich schon während des Ziehens: sobald
  // der Zeiger die Mitte eines Nachbarn überschreitet, tauschen die beiden.
  let zieh = null;   // { tabId, startX, gestartet, gezogen }

  function beginneZiehen(tabId, startX) {
    zieh = { tabId, startX, gestartet: false, gezogen: false };
    document.addEventListener("pointermove", beimZiehen);
    document.addEventListener("pointerup", beendeZiehen, { once: true });
    document.addEventListener("pointercancel", beendeZiehen, { once: true });
  }

  function beimZiehen(e) {
    if (!zieh) return;
    if (!zieh.gestartet) {
      if (Math.abs(e.clientX - zieh.startX) < 5) return;   // noch ein Klick
      zieh.gestartet = true;
      zieh.gezogen = true;
      document.body.classList.add("tab-dragging");
      renderTabs();
    }
    const list = $("tab-list");
    const elemente = [...list.querySelectorAll(".tab")];
    const von = tabs.findIndex((x) => x.tabId === zieh.tabId);
    if (von < 0) return;
    // Ziel: der Tab, über dessen Mitte der Zeiger steht.
    let nach = von;
    elemente.forEach((el2, i) => {
      const r = el2.getBoundingClientRect();
      if (e.clientX > r.left + r.width / 2 && i > nach) nach = i;
      if (e.clientX < r.left + r.width / 2 && i < nach) nach = i;
    });
    if (nach !== von) {
      const [tab] = tabs.splice(von, 1);
      tabs.splice(nach, 0, tab);
      renderTabs();
    }
  }

  function beendeZiehen() {
    document.removeEventListener("pointermove", beimZiehen);
    document.body.classList.remove("tab-dragging");
    if (zieh && zieh.gestartet) {
      renderTabs();
      scheduleSessionSave();
      // Der Klick nach dem Loslassen gehört noch zum Ziehen -- erst danach
      // zählen Klicks wieder als Tab-Wechsel.
      const beendet = zieh;
      setTimeout(() => { if (zieh === beendet) zieh = null; }, 0);
    } else {
      zieh = null;
    }
  }

  function renderTabs() {
    const list = $("tab-list");
    if (!list) return;
    list.innerHTML = "";
    for (const tab of tabs) {
      const item = el("div", "tab" + (tab.tabId === activeTabId ? " active" : "")
        + (zieh && zieh.gestartet && zieh.tabId === tab.tabId ? " dragging" : ""));
      item.dataset.tabId = tab.tabId;
      item.title = tab.name;
      if (tab.dirty) item.appendChild(el("span", "tab-dirty"));
      item.appendChild(el("span", "tab-name", tab.name));
      const zu = el("button", "tab-close", "×");
      zu.title = t("btn_doc_close");
      zu.addEventListener("click", (e) => { e.stopPropagation(); closeTab(tab.tabId); });
      item.appendChild(zu);
      item.addEventListener("click", () => {
        if (zieh && zieh.gezogen) return;    // war ein Umsortieren, kein Klick
        activateTab(tab.tabId);
      });
      item.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || e.target.closest(".tab-close")) return;
        beginneZiehen(tab.tabId, e.clientX);
      });
      list.appendChild(item);
    }
    // Ohne offenes Modell tritt der Einstieg an die Stelle der Szene.
    document.body.classList.toggle("no-doc", tabs.length === 0);
    const leer = $("empty-state");
    if (leer) leer.hidden = tabs.length > 0;
  }

  function activateTab(tabId) {
    if (tabId === activeTabId) return;
    captureActiveTab();
    const tab = tabs.find((x) => x.tabId === tabId);
    if (!tab) return;
    activeTabId = tabId;
    ladeVorgang = true;
    builder.modelReplaced();
    model.loadJSON(tab.model || { format: 1, nodes: [], tubes: [] });
    applyViewState(tab.view || {});
    builder.refresh();
    ladeVorgang = false;
    renderTabs();
    update();
    scheduleSessionSave();
  }

  /**
   * Neuen Tab anlegen und öffnen. `view` gibt den Startzustand vor -- ein neues
   * Modell startet im Bau-Modus mit einem 35er Rohr, ein geöffnetes oder
   * importiertes im Auswahl-Modus.
   */
  function openTab({ name, data, docId = null, view = null, dirty = false }) {
    captureActiveTab();
    const tab = {
      tabId: docs.newTabId(), docId, name: name || t("doc_untitled"), dirty,
      model: data || { format: 1, nodes: [], tubes: [] },
      view: view || defaultView(!data),
    };
    tabs.push(tab);
    activeTabId = tab.tabId;
    ladeVorgang = true;
    builder.modelReplaced();
    model.loadJSON(tab.model);
    applyViewState(tab.view);
    builder.refresh();
    ladeVorgang = false;
    renderTabs();
    update();
    scheduleSessionSave();
    return tab;
  }

  /** Startzustand: leeres Modell -> bauen mit 35er Rohr und zufälliger Farbe. */
  function defaultView(leer) {
    const st = builder.uiState();
    st.undo = []; st.redo = [];
    st.slice = { on: false, axis: "z", value: 0, flip: false, values: { x: null, y: null, z: null } };
    st.camera = null;
    if (leer) {
      st.mode = "add";
      st.tubeId = geometry().defaultTube;
      st.color = RANDOM_COLOR;
    } else {
      st.mode = "select";
    }
    return st;
  }

  /**
   * Rückfrage vor dem Schließen: Speichern, Verwerfen oder Abbrechen.
   * Liefert "save" | "discard" | "cancel".
   */
  function askUnsaved(name) {
    return new Promise((resolve) => {
      const box = $("ask-overlay");
      $("ask-text").textContent = t("ask_close_text", name);
      box.hidden = false;
      const fertig = (antwort) => {
        box.hidden = true;
        $("ask-save").onclick = null;
        $("ask-discard").onclick = null;
        $("ask-cancel").onclick = null;
        resolve(antwort);
      };
      $("ask-save").onclick = () => fertig("save");
      $("ask-discard").onclick = () => fertig("discard");
      $("ask-cancel").onclick = () => fertig("cancel");
    });
  }

  async function closeTab(tabId) {
    const i = tabs.findIndex((x) => x.tabId === tabId);
    if (i < 0) return;
    const tab = tabs[i];
    // Ungespeicherte Änderungen: nachfragen. Bei eingeschaltetem Auto-Save gilt
    // ein Tab mit Datei als gespeichert -- dort läuft der Stand ohnehin mit.
    const offen = tab.dirty && !(autosaveOn && tab.docId);
    if (offen) {
      if (tabId !== activeTabId) activateTab(tabId);
      const antwort = await askUnsaved(tab.name);
      if (antwort === "cancel") return;
      if (antwort === "save") {
        if (!tab.docId) {
          const gewaehlt = await askName(tab.name);
          if (!gewaehlt) return;
          await saveActiveTab({ name: gewaehlt.name, docId: gewaehlt.doc ? gewaehlt.doc.id : null });
        } else {
          await saveActiveTab();
        }
      }
    }
    if (tabId === activeTabId) captureActiveTab();
    tabs.splice(i, 1);
    if (tabId === activeTabId) {
      activeTabId = null;
      const naechster = tabs[i] || tabs[i - 1] || null;
      ladeVorgang = true;
      if (naechster) {
        activeTabId = naechster.tabId;
        builder.modelReplaced();
        model.loadJSON(naechster.model || { format: 1, nodes: [], tubes: [] });
        applyViewState(naechster.view || {});
        builder.refresh();
      } else {
        builder.modelReplaced();
        model.loadJSON({ format: 1, nodes: [], tubes: [] });
        builder.refresh();
      }
      ladeVorgang = false;
    }
    renderTabs();
    update();
    scheduleSessionSave();
  }

  /** Der laufende Tab hat sich geändert: Markierung setzen, Sitzung sichern. */
  function touchActiveTab() {
    if (ladeVorgang) return;
    const tab = activeTab();
    if (!tab) return;
    tab.dirty = true;
    renderTabs();
    scheduleSessionSave();
    // Auto-Save schreibt direkt in die Datei; ist er aus, bleibt der Stand
    // nur in der Sitzung (überlebt einen Reload, gilt aber als ungespeichert).
    if (tab.docId) scheduleDocSave();
  }

  function scheduleSessionSave() {
    clearTimeout(sessionTimer);
    sessionTimer = setTimeout(() => {
      captureActiveTab();
      docs.saveSession({ tabs, activeTabId }).catch((e) => console.warn("Sitzung:", e));
    }, 600);
  }

  /** Beim Start: Migration, Sitzung wiederherstellen, sonst leerer Zustand. */
  async function start() {
    try { await docs.migrateOldDrafts(); } catch (e) { console.warn("Migration:", e); }
    let sitzung = null;
    try { sitzung = await docs.loadSession(); } catch (e) { console.warn("Sitzung:", e); }
    if (sitzung && sitzung.tabs.length) {
      tabs = sitzung.tabs;
      activeTabId = sitzung.activeTabId && tabs.some((x) => x.tabId === sitzung.activeTabId)
        ? sitzung.activeTabId : tabs[0].tabId;
      const tab = activeTab();
      ladeVorgang = true;
      builder.modelReplaced();
      model.loadJSON(tab.model || { format: 1, nodes: [], tubes: [] });
      applyViewState(tab.view || {});
      builder.refresh();
      ladeVorgang = false;
    } else {
      const alt = storage.loadAutosave();
      openTab({ name: t("doc_untitled"), data: alt && alt.nodes && alt.nodes.length ? alt : null });
    }
    renderTabs();
    update();
  }

  $("tab-new").addEventListener("click", () => openTab({ name: freierName() }));
  $("empty-new").addEventListener("click", () => $("btn-doc-new").click());

  $("empty-open").addEventListener("click", () => { showSidebarPanel("own"); renderOwnModels(); });
  $("empty-import").addEventListener("click", () => $("file-import").click());

  /** "Unbenannt", "Unbenannt 2", ... -- der erste Name, den kein Tab trägt. */
  function freierName() {
    const belegt = new Set(tabs.map((x) => x.name));
    const basis = t("doc_untitled");
    if (!belegt.has(basis)) return basis;
    for (let i = 2; ; i++) if (!belegt.has(`${basis} ${i}`)) return `${basis} ${i}`;
  }

  Object.assign(ui, {
    update, start, touchActiveTab, openTab, closeTab, activateTab, captureActiveTab,
    openDocById, saveActiveTab, refreshDocList, isAutosaveOn, setAutosaveOn,
  });
  // Als echte Zugriffsfunktionen anlegen: Object.assign würde einen Getter
  // sofort auswerten und den damaligen Stand einfrieren.
  Object.defineProperties(ui, {
    tabs: { get: () => tabs },
    activeTab: { get: () => activeTab() },
  });

  // Auto-Save-Schalter in den Einstellungen
  const autosaveBox = $("opt-autosave");
  if (autosaveBox) {
    autosaveBox.checked = autosaveOn;
    autosaveBox.addEventListener("change", () => setAutosaveOn(autosaveBox.checked));
  }

  refreshDocList();
  updateUndoButton();
  return ui;
}
