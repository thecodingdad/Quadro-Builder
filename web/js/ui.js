// Verkabelt die Bedienoberflaeche (Toolbar, Tastatur, Stueckliste, Bestand).

import { buildableTubes, buildableCurvedTubes, buildablePanels, tubeColors, geometry, allTubes, allConnectors, panels, reinforcements, slideKindName, partName } from "./catalog.js";
import { computeBOM, compareInventory, connectorsForNode } from "./bom.js";
import { computeBuildPlan } from "./buildplan.js";
import { parseQDF } from "./qdfimport.js";
import { QUALITY_LEVELS } from "./scene.js";
import * as storage from "./storage.js";
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
  let slideBtn = null;
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
      renderOrderOptions();
      renderPartButtons();
      renderQualityOptions();
      syncProjectionButton();
      // Dynamische UI-Texte aktualisieren
      setMode(builder.mode);
      update();
    });
  }

  // --- Hinweise + Undo-Verfuegbarkeit ------------------------------------
  builder.onNotice = (msg) => flash(msg);
  builder.onHistoryChange = () => updateUndoButton();
  function updateUndoButton() {
    $("btn-undo").disabled = !builder.canUndo();
    $("btn-redo").disabled = !builder.canRedo();
  }

  // --- Autosave-Anzeige --------------------------------------------------
  let savedTimer = null;
  function showSaved() {
    const dot = $("autosave-status");
    if (!dot) return;
    dot.classList.add("saving");
    dot.title = t("saving");
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => {
      dot.classList.remove("saving");
      dot.title = t("autosaved");
    }, 350);
  }

  // --- Entwuerfe/Datei-Menue ---------------------------------------------
  const fileMenu = $("file-menu");
  function toggleFileMenu(open) {
    const pop = $("file-pop");
    const show = open == null ? pop.hidden : open;
    pop.hidden = !show;
    $("btn-file").classList.toggle("active", show);
    // #toolbar-left scrollt waagerecht (overflow-x) und schneidet damit auch
    // senkrecht ab -- ein absolut positioniertes Popup waere unsichtbar.
    // Deshalb fixed unter dem Button platzieren.
    if (show) placePopupUnder(pop, $("btn-file"));
  }

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
  $("btn-file").addEventListener("click", (e) => { e.stopPropagation(); toggleFileMenu(); });
  document.addEventListener("click", (e) => {
    if (fileMenu && !fileMenu.contains(e.target)) toggleFileMenu(false);
  });

  // --- Schnittebene ------------------------------------------------------
  // Schneidet das Modell entlang einer Achse auf, damit man hineinsehen und
  // weiter innen bauen kann. Kein eigener Modus: laeuft parallel zu Bauen,
  // Platten setzen usw. weiter.
  const SLICE_KEY = "quadro.slice.v1";
  const sliceBar = $("slice-bar");
  const sliceRange = $("slice-range");
  const slice = { on: false, axis: "z", value: 0, flip: false };
  try {
    const st = JSON.parse(localStorage.getItem(SLICE_KEY));
    if (st && ["x", "y", "z"].includes(st.axis) && typeof st.value === "number")
      Object.assign(slice, { on: !!st.on, axis: st.axis, value: st.value, flip: !!st.flip });
  } catch { /* kaputter Eintrag -> Standard */ }

  function sliceLimits() {
    const b = model.bounds(geometry().connectorSize / 2);
    if (!b) return { min: -100, max: 100 };
    const i = slice.axis === "x" ? 0 : slice.axis === "y" ? 1 : 2;
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
    sliceRange.value = slice.value;
    $("slice-value").textContent = `${Math.round(slice.value)} cm`;
    for (const b of $("slice-axes").querySelectorAll("button"))
      b.classList.toggle("active", b.dataset.axis === slice.axis);
    scene.setClip(slice.axis, slice.value, slice.flip);
    builder.refresh();   // Handles neu: verdeckte sind nicht mehr anklickbar
  }

  function saveSlice() {
    localStorage.setItem(SLICE_KEY, JSON.stringify(slice));
  }

  if (sliceBar) {
    $("btn-slice").addEventListener("click", () => {
      slice.on = !slice.on;
      if (slice.on) {
        // Beim Einschalten in die Mitte der aktuellen Achse legen.
        const lim = sliceLimits();
        slice.value = Math.round((lim.min + lim.max) / 2);
      }
      applySlice(); saveSlice();
    });
    $("slice-close").addEventListener("click", () => { slice.on = false; applySlice(); saveSlice(); });
    $("slice-flip").addEventListener("click", () => { slice.flip = !slice.flip; applySlice(); saveSlice(); });
    for (const b of $("slice-axes").querySelectorAll("button")) {
      b.addEventListener("click", () => {
        slice.axis = b.dataset.axis;
        const lim = sliceLimits();
        slice.value = Math.round((lim.min + lim.max) / 2);
        applySlice(); saveSlice();
      });
    }
    sliceRange.addEventListener("input", () => {
      slice.value = parseFloat(sliceRange.value);
      $("slice-value").textContent = `${Math.round(slice.value)} cm`;
      scene.setClip(slice.axis, slice.value, slice.flip);
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
  $("mode-collision").addEventListener("click", () => {
    const on = builder.mode !== "collision";
    setMode(on ? "collision" : "select");
    if (on) {
      const n = builder.collisionCount();
      flash(n ? t("flash_collisions_n", n) : t("flash_collisions_0"));
    }
  });
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
    const inAdd = builder.mode === "add";
    const inPanel = builder.mode === "panel";
    // Die Buttons zeigen die Auswahl (auch wenn sie per Tastatur kam) und
    // markieren per .active, welcher der beiden Bau-Modi gerade laeuft.
    renderPartButtons();
    const curved = isCurved(builder.tubeId);
    tubeBtn.classList.toggle("active", inAdd && !curved);
    if (bowBtn) bowBtn.classList.toggle("active", inAdd && curved);
    panelBtn.classList.toggle("active", inPanel);
    if (slideBtn) slideBtn.classList.toggle("active", builder.mode === "slide");
    $("btn-diagonal").classList.toggle("active", inAdd && builder.diagonal);
    syncPartColors();
  }

  /** Loeschen-Button: nur sichtbar, wenn im Cursor-Modus etwas ausgewaehlt ist. */
  function syncDeleteButton() {
    const on = builder.mode === "select" && builder.selection.size > 0;
    $("mode-delete").hidden = !on;
  }

  function setMode(m) {
    builder.setMode(m);
    // Der Cursor-Modus gehoert zum Bauen (nicht zum Aufbau-Modus), deshalb
    // bleibt "Bauen" oben mit markiert.
    $("mode-add").classList.toggle("active", m === "add" || m === "panel" || m === "slide" || m === "select");
    $("mode-select").classList.toggle("active", m === "select");
    $("mode-clamp").classList.toggle("active", m === "clamp");
    $("mode-reinforce").classList.toggle("active", m === "reinforce");
    $("mode-collision").classList.toggle("active", m === "collision");
    $("mode-assembly").classList.toggle("active", m === "assembly");
    $("toolbar-ctx").hidden = m === "assembly";
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
      collision: "status_collision",
      clamp: "status_clamp",
      assembly: "status_assembly",
    };
    $("status").textContent = t(statusMap[m] || "status_add");
    if (m === "assembly") renderAssembly();
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
    const hex = colorHexFor(builder.color);
    const ink = needsDarkInk(hex) ? "var(--ink)" : "#fff";
    document.querySelectorAll(".btn.part[data-tube], .btn.part[data-panel]").forEach((b) => {
      if (b.classList.contains("active")) {
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
    document.removeEventListener("click", onPopupOutsideClick);
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
    setTimeout(() => document.addEventListener("click", onPopupOutsideClick), 0);
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
    tubeBtn.innerHTML = tubeIcon(tube) + `<span></span>`;
    tubeBtn.lastChild.textContent = tubeShortLabel(tube);
    tubeBtn.title = `${t("label_tube")}: ${partName(tube)} – ${eur(tube.price)}`;

    if (bowBtn) {
      const bow = curvedTubes.find((x) => x.id === builder.tubeId) || curvedTubes[0];
      bowBtn.innerHTML = tubeIcon(bow) + `<span></span>`;
      bowBtn.lastChild.textContent = t("part_bow");
      bowBtn.title = `${partName(bow)} – ${eur(bow.price)}`;
    }

    const pan = panelList.find((x) => x.id === builder.panelId) || panelList[0];
    panelBtn.innerHTML = panelIcon(pan) + `<span></span>`;
    panelBtn.lastChild.textContent = `${pan.w}×${pan.h}`;
    panelBtn.title = `${t("label_panel")}: ${partName(pan)} – ${eur(pan.price)}`;
  }

  // --- Rutschen-Button ---------------------------------------------------
  // Rutschen sind keine Rohre/Platten: sie werden an zwei senkrechten,
  // parallelen Rohren eingehaengt. Der Modus zeigt die passenden Felder an.
  {
    const b = el("button", "btn part");
    b.dataset.slide = "slide-new2";
    b.title = t("part_slide");
    b.innerHTML =
      `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">` +
      `<path d="M3 13 C7 13 5 4 13 3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>` +
      `<span data-i18n="part_slide">${t("part_slide")}</span>`;
    b.addEventListener("click", () => setMode(builder.mode === "slide" ? "add" : "slide"));
    $("slide-buttons").appendChild(b);
    slideBtn = b;
  }

  // --- Aktionen ----------------------------------------------------------
  $("btn-undo").addEventListener("click", () => builder.undo());
  $("btn-redo").addEventListener("click", () => builder.redo());
  const camBtn = $("btn-camera");
  if (camBtn) camBtn.addEventListener("click", () => scene.resetCamera());
  $("btn-clear").addEventListener("click", () => {
    if (!model.isEmpty() && !confirm(t("confirm_clear"))) return;
    builder.recordHistory(() => model.clear());
    builder.selectedNodeId = null;
    builder.refresh();
    toggleFileMenu(false);
  });
  $("btn-export").addEventListener("click", () => {
    storage.exportFile(model.toJSON(), "quadro-entwurf.json");
    flash(t("flash_exported"));
    toggleFileMenu(false);
  });

  $("btn-import").addEventListener("click", () => $("file-import").click());
  $("file-import").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      let info = "";
      if (/\.qdf$/i.test(f.name)) {
        const text = await f.text();
        const data = parseQDF(text, {
          tubes: buildableTubes(),
          panels: panels(),
          connectorSize: geometry().connectorSize,
          mergeEps: 2,
        });
        if (!data.nodes.length) throw new Error(t("qdf_no_parts"));
        let loadRes;
        builder.modelReplaced();
        builder.recordHistory(() => { loadRes = model.loadJSON(data); });
        if (!loadRes.ok) throw new Error(t(loadRes.reason === "format" ? "load_error_format" : "load_error_data"));
        builder.selectedNodeId = null;
        builder.refresh();
        scene.resetCamera();
        const s = data.stats;
        const skip = Object.entries(s.skipped || {});
        const skipTxt = skip.length
          ? t("qdf_skipped", skip.map(([k, v]) => `${v}× ${k.replace(/2$|-new2$|-end2$/, "")}`).join(", "))
          : "";
        const panelTxt = s.panels ? `, ${s.panels} ${t("bom_panels").toLowerCase()}` : "";
        const clampTxt = s.clamps ? `, ${s.clamps} ${t("btn_clamp").toLowerCase()}` : "";
        const stats = `${s.nodes} ${t("bom_connectors").split(" ")[0].toLowerCase()}, ${s.tubes} ${t("bom_tubes").toLowerCase()}${panelTxt}${clampTxt}`;
        info = t("qdf_imported", stats, skipTxt);
      } else {
        const data = await storage.importFile(f);
        let loadRes;
        builder.modelReplaced();
        builder.recordHistory(() => { loadRes = model.loadJSON(data); });
        if (!loadRes.ok) throw new Error(t(loadRes.reason === "format" ? "load_error_format" : "load_error_data"));
        builder.selectedNodeId = null;
        builder.refresh();
        info = t("flash_imported_json");
      }
      // Import als NEUEN Entwurf ablegen (Name = Datei + Datum/Zeit), damit alte
      // Staende erhalten bleiben; auf diesem Entwurf wird weitergearbeitet.
      const base = f.name.replace(/\.[^.]+$/, "").trim() || "Import";
      const draftName = `${base} ${importStamp()}`;
      try {
        storage.saveNamed(draftName, model.toJSON());
        refreshSavedList();
        $("load-select").value = draftName;
        flash(`${info} · ${t("flash_import_draft", draftName)}`);
      } catch (err) {
        // Import selbst war erfolgreich (das Modell ist geladen) – nur die
        // zusaetzliche Entwurfs-Sicherung ist fehlgeschlagen.
        flash(`${info} · ${err.name === "QuotaError" ? t("flash_save_quota") : t("flash_save_failed", err.message)}`);
      }
    } catch (err) {
      alert(err.name === "QuotaError" ? t("flash_save_quota") : err.message);
    }
    e.target.value = "";
  });

  $("btn-save").addEventListener("click", () => {
    const name = prompt(t("prompt_save_name"));
    if (!name) return;
    try {
      storage.saveNamed(name, model.toJSON());
    } catch (err) {
      flash(err.name === "QuotaError" ? t("flash_save_quota") : t("flash_save_failed", err.message));
      return;
    }
    refreshSavedList();
    $("load-select").value = name;
    toggleFileMenu(false);
    flash(t("flash_saved", name));
  });
  $("btn-load").addEventListener("click", () => {
    const name = $("load-select").value;
    if (!name) return;
    const data = storage.loadNamed(name);
    if (!data) return;
    let loadRes;
    builder.modelReplaced();
        builder.recordHistory(() => { loadRes = model.loadJSON(data); });
    if (!loadRes.ok) {
      flash(t(loadRes.reason === "format" ? "load_error_format" : "load_error_data"));
      toggleFileMenu(false);
      return;
    }
    builder.selectedNodeId = null;
    builder.refresh();
    toggleFileMenu(false);
    flash(t("flash_loaded", name));
  });
  $("btn-delete-save").addEventListener("click", () => {
    const name = $("load-select").value;
    if (!name) return;
    if (!confirm(t("confirm_delete_save", name))) return;
    storage.deleteNamed(name);
    refreshSavedList();
  });

  // --- Hilfe-Overlay -----------------------------------------------------
  $("btn-help").addEventListener("click", () => { $("help-overlay").hidden = false; });
  $("help-close").addEventListener("click", () => { $("help-overlay").hidden = true; });

  // --- Seitenleiste: EIN Panel auf Abruf (Stückliste / Bestand) ----------
  // Die Leiste ist standardmäßig zu (body.sidebar-hidden im HTML). Die
  // Menüband-Buttons "Stückliste" und "Bestand" öffnen je genau ihr Panel;
  // erneuter Klick schließt wieder. Der Aufbau-Modus zeigt das Aufbau-Panel.
  const SIDEBAR_W_KEY = "quadro.sidebarWidth.v1";
  const SIDEBAR_PANEL_KEY = "quadro.sidebarPanel.v1"; // '', 'bom', 'inventory'
  const root = document.documentElement;
  const savedW = parseInt(localStorage.getItem(SIDEBAR_W_KEY), 10);
  if (savedW >= 240 && savedW <= 640) root.style.setProperty("--sidebar-w", savedW + "px");

  let currentPanel = null; // 'bom' | 'inventory' | 'assembly' | null

  function applyPanelVisibility() {
    $("panel-bom").hidden = currentPanel !== "bom";
    $("panel-inventory").hidden = currentPanel !== "inventory";
    $("panel-assembly").hidden = currentPanel !== "assembly";
    document.body.classList.toggle("sidebar-hidden", currentPanel === null);
    $("toggle-bom").classList.toggle("active", currentPanel === "bom");
    $("toggle-inventory").classList.toggle("active", currentPanel === "inventory");
    requestAnimationFrame(() => scene.onResize());
  }
  // name: 'bom' | 'inventory' | 'assembly' | null. Nur bom/inventory/zu wird gemerkt.
  function showSidebarPanel(name) {
    currentPanel = name;
    if (name === "bom" || name === "inventory" || name === null)
      localStorage.setItem(SIDEBAR_PANEL_KEY, name || "");
    applyPanelVisibility();
  }
  function toggleSidebarPanel(name) {
    showSidebarPanel(currentPanel === name ? null : name);
  }

  $("toggle-bom").addEventListener("click", () => toggleSidebarPanel("bom"));
  $("toggle-inventory").addEventListener("click", () => toggleSidebarPanel("inventory"));

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

  // Startzustand: zuletzt gewähltes Panel (Standard: zu)
  showSidebarPanel(localStorage.getItem(SIDEBAR_PANEL_KEY) || null);

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
  $("asm-prev").addEventListener("click", () => builder.setAssemblyStep(builder.assemblyStep - 1));
  $("asm-next").addEventListener("click", () => builder.setAssemblyStep(builder.assemblyStep + 1));
  $("asm-print").addEventListener("click", () => printPlan());

  // Aufbaurichtung: je nach Modell und Platz im Raum ist eine andere Reihenfolge
  // praktischer als die Standard-Reihenfolge von unten nach oben.
  const ORDER_KEYS = { "y+": "asm_order_yp", "x+": "asm_order_xp", "x-": "asm_order_xm",
                       "z+": "asm_order_zp", "z-": "asm_order_zm" };
  const orderSel = $("asm-order");
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
    renderAssembly();
  });

  function asmRow(container, name, colorId, count, badge) {
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
    container.appendChild(row);
  }

  function renderAssembly() {
    const plan = builder.buildPlan;
    const total = plan.steps.length;
    const i = builder.assemblyStep;
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
    if (step.connectors.length || step.openEnds) {
      body.appendChild(el("h4", "asm-cat", t("asm_cat_connectors")));
      for (const c of step.connectors) asmRow(body, c.name, null, c.count, c.code);
      if (step.openEnds) asmRow(body, t("asm_open_ends"), null, step.openEnds, "");
    }
    if (step.tubes.length) {
      body.appendChild(el("h4", "asm-cat", t("asm_cat_tubes")));
      for (const tube of step.tubes) asmRow(body, `${tube.name} · ${tube.colorName}`, tube.color, tube.count, "");
    }
    if (step.panels.length) {
      body.appendChild(el("h4", "asm-cat", t("asm_cat_panels")));
      for (const p of step.panels) asmRow(body, `${p.name} · ${p.colorName}`, p.color, p.count, "");
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

  function refreshSavedList() {
    const sel = $("load-select");
    sel.innerHTML = "";
    const names = storage.listNames();
    if (names.length === 0) {
      const o = el("option", null, t("saves_empty"));
      o.value = ""; sel.appendChild(o);
      return;
    }
    for (const n of names) {
      const o = el("option", null, n); o.value = n; sel.appendChild(o);
    }
  }

  let flashTimer = null;
  function flash(msg) {
    $("status").textContent = msg;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      $("status").textContent = "";
    }, 2500);
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
      case "x": $("mode-collision").click(); break;
      case "a": setMode("assembly"); break;
      case "k": setMode("clamp"); break;
      case "d": toggleDiagonal(); break;
      case "n": toggleLabels(); break;
      case "h": toggleHints(); break;
      case "c": scene.resetCamera(); break;
      // Escape fuehrt immer zurueck in den Cursor-Modus.
      case "escape":
        closePopup();
        setMode("select");
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

  function bomRow(container, name, colorId, count, subtotal) {
    const row = el("div", "bom-row");
    const label = el("span", "bom-name");
    if (colorId) {
      const dot = el("span", "dot"); dot.style.background = colorHex(colorId);
      label.appendChild(dot);
    }
    label.appendChild(document.createTextNode(name));
    row.appendChild(label);
    row.appendChild(el("span", "bom-count", `${count}×`));
    row.appendChild(el("span", "bom-sub", subtotal == null ? "" : eur(subtotal)));
    container.appendChild(row);
  }


  function update() {
    syncDeleteButton();
    // Der Builder kann den Schraeg-Schalter selbst umlegen (zweiter Klick auf
    // die gewaehlte Kupplung) -- die Toolbar muss das nachziehen.
    syncPartHighlights();
    const bom = computeBOM(model);

    const tb = $("bom-tubes"); tb.innerHTML = "";
    if (bom.tubes.length === 0) tb.appendChild(el("div", "muted", "–"));
    for (const r of bom.tubes) bomRow(tb, `${r.name} · ${r.colorName}`, r.color, r.count, r.subtotal);

    const cb = $("bom-connectors"); cb.innerHTML = "";
    if (bom.connectors.length === 0) cb.appendChild(el("div", "muted", "–"));
    for (const r of bom.connectors) bomRow(cb, r.name, null, r.count, r.subtotal);
    if (bom.openEnds > 0) {
      const row = el("div", "bom-row muted");
      row.appendChild(el("span", "bom-name", t("bom_open_ends")));
      row.appendChild(el("span", "bom-count", `${bom.openEnds}×`));
      row.appendChild(el("span", "bom-sub", ""));
      cb.appendChild(row);
    }

    const pb = $("bom-panels"); pb.innerHTML = "";
    if (bom.panels.length === 0) pb.appendChild(el("div", "muted", "–"));
    for (const r of bom.panels) bomRow(pb, `${r.name} · ${r.colorName}`, r.color, r.count, r.subtotal);

    const xb = $("bom-textiles"); xb.innerHTML = "";
    const textiles = bom.textiles || [];
    if (textiles.length === 0) xb.appendChild(el("div", "muted", "–"));
    for (const r of textiles) bomRow(xb, `${t("bom_textile")} ${r.w}×${r.h} cm · ${r.colorName}`, r.color, r.count, null);

    const slb = $("bom-slides"); slb.innerHTML = "";
    const slides = bom.slides || [];
    if (slides.length === 0) slb.appendChild(el("div", "muted", "–"));
    for (const r of slides) bomRow(slb, slideKindName(r.kind), null, r.count, null);

    const rb = $("bom-reinforcements"); rb.innerHTML = "";
    const reinf = bom.reinforcements || [];
    if (reinf.length === 0) rb.appendChild(el("div", "muted", "–"));
    for (const r of reinf) bomRow(rb, r.name, null, r.count, r.subtotal);

    $("sum-tubes").textContent = bom.totals.tubes;
    $("sum-conn").textContent = bom.totals.connectors;
    $("sum-panels").textContent = bom.totals.panels;
    $("sum-reinf").textContent = bom.totals.reinforcements || 0;
    $("sum-price").textContent = eur(bom.totals.price);

    renderInventory(bom);
    if (!$("inventory-editor").hidden) renderInventoryEditor();
    if (builder.mode === "assembly") renderAssembly();
    showSaved();
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

  function setInventoryHighlight(r) {
    invHighlightKey = r ? r.group + ":" + r.key : null;
    builder.setHighlight(r ? partsForInventoryRow(r) : null);
    for (const el2 of $("inventory-body").querySelectorAll(".inv-row"))
      el2.classList.remove("marked");
    if (!r) return;
    const rows = [...$("inventory-body").querySelectorAll(".inv-row")];
    const idx = lastInvRows.findIndex((x) => x.group === r.group && x.key === r.key);
    if (idx >= 0 && rows[idx]) rows[idx].classList.add("marked");
  }

  let lastInvRows = [];

  function renderInventory(bom) {
    renderModelSize();
    const body = $("inventory-body"); body.innerHTML = "";
    const banner = $("feasibility-banner");
    if (bom.totals.tubes === 0 && bom.totals.connectors === 0 && bom.totals.panels === 0) {
      body.appendChild(el("div", "muted", t("inv_empty_build")));
      banner.className = "feasibility";
      banner.textContent = "";
      lastInvRows = [];
      if (invHighlightKey) { invHighlightKey = null; builder.setHighlight(null); }
      return;
    }
    const cmp = compareInventory(bom, inventory);
    lastInvRows = cmp.rows;
    // Modell kann sich geaendert haben -> ids der markierten Zeile neu bestimmen,
    // sonst zeigt die Hervorhebung auf geloeschte oder veraltete Teile.
    const stillThere = cmp.rows.find((r) => r.group + ":" + r.key === invHighlightKey);
    if (invHighlightKey) {
      if (stillThere) builder.highlight = partsForInventoryRow(stillThere);
      else { invHighlightKey = null; builder.highlight = null; }
    }
    for (const r of cmp.rows) {
      const rowKey = r.group + ":" + r.key;
      const row = el("div", "inv-row" + (r.ok ? "" : " bad") + (rowKey === invHighlightKey ? " marked" : ""));
      // Klick auf die Zeile hebt die zugehoerigen Teile im Modell hervor.
      row.addEventListener("click", (e) => {
        if (e.target.tagName === "INPUT") return;   // Mengenfeld nicht abfangen
        setInventoryHighlight(rowKey === invHighlightKey ? null : r);
      });
      row.appendChild(el("span", "inv-name", r.name));
      row.appendChild(el("span", "inv-need", t("inv_need", r.need)));
      const inp = document.createElement("input");
      inp.type = "number"; inp.min = "0"; inp.className = "inv-input";
      inp.value = r.owned;
      inp.addEventListener("change", () => {
        const v = Math.max(0, parseInt(inp.value || "0", 10));
        // r.group ist jetzt direkt der Bucket-Schlüssel (tubes/connectors/...)
        const bucket = r.group;
        inventory[bucket][r.key] = v;
        saveInv(inventory);
        update();
      });
      row.appendChild(inp);
      row.appendChild(el("span", "inv-status", r.ok ? "✓" : t("inv_missing", r.need - r.owned)));
      body.appendChild(row);
    }
    banner.className = "feasibility " + (cmp.feasible ? "ok" : "no");
    banner.textContent = cmp.feasible ? t("inv_feasible") : t("inv_infeasible");
  }

  // --- Bestandseditor (vollständige Teileliste + JSON Export/Import) ------
  function renderInventoryEditor() {
    const box = $("inventory-editor");
    box.innerHTML = "";
    const groups = [
      [t("group_tubes"), "tubes", allTubes()],
      [t("group_connectors"), "connectors", allConnectors()],
      [t("group_panels"), "panels", panels()],
      [t("group_reinforcements"), "reinforcements", reinforcements()],
    ];
    for (const [title, bucket, items] of groups) {
      if (!items.length) continue;
      box.appendChild(el("h4", "inv-grp", title));
      for (const it of items) {
        const row = el("div", "inv-edit-row");
        const label = it.name + (it.code ? ` (${it.code})` : "");
        row.appendChild(el("span", "inv-name", label));
        const inp = document.createElement("input");
        inp.type = "number"; inp.min = "0"; inp.className = "inv-input";
        inp.value = inventory[bucket][it.id] || 0;
        inp.addEventListener("change", () => {
          const v = Math.max(0, parseInt(inp.value || "0", 10) || 0);
          if (v) inventory[bucket][it.id] = v;
          else delete inventory[bucket][it.id];
          inp.value = v;
          saveInv(inventory);
          update();
        });
        row.appendChild(inp);
        box.appendChild(row);
      }
    }
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
      renderInventoryEditor();
      update();
      flash(t("flash_inv_imported"));
    } catch (err) { alert(err.message); }
  }

  $("btn-inv-toggle").addEventListener("click", () => {
    const ed = $("inventory-editor");
    const show = ed.hidden;
    ed.hidden = !show;
    $("btn-inv-toggle").classList.toggle("active", show);
    if (show) renderInventoryEditor();
  });
  $("btn-inv-export").addEventListener("click", exportInventory);
  $("btn-inv-import").addEventListener("click", () => $("inv-file-import").click());
  $("inv-file-import").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) importInventory(f);
    e.target.value = "";
  });

  refreshSavedList();
  setMode("select");   // Start im Cursor-Modus, nicht mit einem Rohr in der Hand
  updateUndoButton();
  return { update };
}
