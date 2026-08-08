// Verkabelt die Bedienoberflaeche (Toolbar, Tastatur, Stueckliste, Bestand).

import { buildableTubes, buildableCurvedTubes, buildablePanels, tubeColors, geometry, allTubes, allConnectors, panels, reinforcements, slideKindName, partName } from "./catalog.js";
import { computeBOM, compareInventory } from "./bom.js";
import { computeBuildPlan } from "./buildplan.js";
import { parseQDF } from "./qdfimport.js";
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
  }
  $("btn-file").addEventListener("click", (e) => { e.stopPropagation(); toggleFileMenu(); });
  document.addEventListener("click", (e) => {
    if (fileMenu && !fileMenu.contains(e.target)) toggleFileMenu(false);
  });

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
  $("mode-clamp").addEventListener("click", () => setMode("clamp"));
  $("mode-delete").addEventListener("click", () => setMode("delete"));
  $("mode-reinforce").addEventListener("click", () => setMode(builder.mode === "reinforce" ? "add" : "reinforce"));
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
    tubeWrap.querySelectorAll("button").forEach((x) =>
      x.classList.toggle("active", inAdd && x.dataset.tube === builder.tubeId));
    panelWrap.querySelectorAll("button").forEach((x) =>
      x.classList.toggle("active", inPanel && x.dataset.panel === builder.panelId));
    if (slideBtn) slideBtn.classList.toggle("active", builder.mode === "slide");
    $("btn-diagonal").classList.toggle("active", inAdd && builder.diagonal);
    syncPartColors();
  }

  function setMode(m) {
    builder.setMode(m);
    $("mode-add").classList.toggle("active", m === "add" || m === "panel" || m === "slide");
    $("mode-clamp").classList.toggle("active", m === "clamp");
    $("mode-delete").classList.toggle("active", m === "delete");
    $("mode-reinforce").classList.toggle("active", m === "reinforce");
    $("mode-assembly").classList.toggle("active", m === "assembly");
    $("toolbar-ctx").hidden = m === "assembly";
    // Aufbau-Modus zeigt das Aufbau-Panel; beim Verlassen zurück zum zuletzt
    // gewählten Panel (oder zu). Andere Modi lassen das Panel unberührt.
    if (m === "assembly") {
      // Szene beim Wechsel in den Aufbau-Modus ausblenden.
      scene.setScene(false);
      grassOn = false;
      $("scene-toggle").classList.add("off");
      showSidebarPanel("assembly");
    }
    else if (currentPanel === "assembly")
      showSidebarPanel(localStorage.getItem(SIDEBAR_PANEL_KEY) || null);
    $("btn-labels").classList.toggle("active", builder.showLabels);
    syncPartHighlights();
    const statusMap = {
      add: "status_add",
      panel: "status_panel",
      reinforce: "status_reinforce",
      clamp: "status_clamp",
      assembly: "status_assembly",
      delete: "status_delete",
    };
    $("status").textContent = t(statusMap[m] || "status_add");
    if (m === "assembly") renderAssembly();
  }

  // --- Farb-Popup (erscheint beim 2. Klick auf den bereits aktiven Part-Button) ---
  const PANEL_EXTRA_COLORS = [{ id: "black", name: "Schwarz", name_en: "Black", hex: "#2b2b2b" }];

  let activeColorPopup = null;
  let colorPopupAnchor = null; // Button, der das Popup geöffnet hat

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

  function closeColorPopup() {
    if (!activeColorPopup) return;
    activeColorPopup.remove();
    activeColorPopup = null;
    colorPopupAnchor = null;
    document.removeEventListener("click", onPopupOutsideClick);
  }

  function onPopupOutsideClick(e) {
    // Klick auf den Anker-Button selbst (oder dessen Kinder) → Popup bleibt offen;
    // der Button-Handler togglet das Popup dann selbst.
    if (colorPopupAnchor && colorPopupAnchor.contains(e.target)) return;
    if (activeColorPopup && !activeColorPopup.contains(e.target)) closeColorPopup();
  }

  /**
   * Öffnet ein kleines Farbwahl-Popup unter dem Anker-Button.
   * Zweiter Klick auf denselben Button schließt es wieder (Toggle).
   * partType: "tube" → 4 Farben; "panel" → 4 + Schwarz.
   */
  function showColorPopup(anchorBtn, partType) {
    // Toggle: Popup für denselben Button bereits offen → schließen
    if (activeColorPopup && colorPopupAnchor === anchorBtn) {
      closeColorPopup();
      return;
    }
    closeColorPopup();

    const colors = tubeColors();
    const list = partType === "panel" ? [...colors, ...PANEL_EXTRA_COLORS] : colors;

    const pop = document.createElement("div");
    pop.className = "color-popup";

    list.forEach((c) => {
      const sw = el("button", "swatch" + (c.id === builder.color ? " active" : ""));
      sw.style.background = c.hex;
      sw.title = c.name;
      sw.dataset.color = c.id;
      sw.addEventListener("click", (e) => {
        e.stopPropagation();
        builder.setColor(c.id);
        syncPartColors();
        closeColorPopup();
      });
      pop.appendChild(sw);
    });

    document.body.appendChild(pop);

    // Popup unter dem Anker-Button positionieren (fixed, damit kein Clipping)
    const rect = anchorBtn.getBoundingClientRect();
    pop.style.position = "fixed";
    pop.style.top = (rect.bottom + 5) + "px";
    pop.style.left = rect.left + "px";

    // Rechts am Viewport-Rand ausrichten wenn nötig
    requestAnimationFrame(() => {
      const pw = pop.offsetWidth;
      const maxLeft = window.innerWidth - pw - 8;
      if (parseFloat(pop.style.left) > maxLeft) pop.style.left = maxLeft + "px";
    });

    activeColorPopup = pop;
    colorPopupAnchor = anchorBtn;
    // Leicht verzögert registrieren, damit der auslösende Klick nicht sofort schließt
    setTimeout(() => document.addEventListener("click", onPopupOutsideClick), 0);
  }

  // --- Rohr-Buttons ------------------------------------------------------
  // Kern-Tubes: auf schmalen Screens sichtbar; der Rest bekommt hide-narrow
  const ESSENTIAL_TUBES  = new Set(["T15", "T35", "T75"]);
  // Kern-Platten: auf schmalen Screens sichtbar
  const ESSENTIAL_PANELS = new Set(["panel_40x40", "panel_40x20"]);

  const tubeWrap = $("tube-buttons");
  const tubes = buildableTubes();
  tubes.forEach((tube, i) => {
    const narrow = ESSENTIAL_TUBES.has(tube.id) ? "" : " hide-narrow";
    const b = el("button", "btn part" + narrow);
    b.dataset.tube = tube.id;
    b.title = `${tube.name} – ${eur(tube.price)} (${i + 1})`;
    const w = Math.round(8 + Math.min(tube.length_cm, 75) / 75 * 18);
    b.innerHTML =
      `<svg viewBox="0 0 28 16" width="28" height="16" aria-hidden="true">` +
      `<line x1="${14 - w / 2}" y1="8" x2="${14 + w / 2}" y2="8" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/></svg>` +
      `<span>${tube.length_cm}</span>`;
    if (tube.id === builder.tubeId) b.classList.add("active");
    b.addEventListener("click", () => {
      builder.setTube(tube.id);
      if (builder.mode !== "add") setMode("add");
      else syncPartHighlights();
    });
    tubeWrap.appendChild(b);
  });

  // --- Bogenrohr-Buttons -------------------------------------------------
  // Bogenrohre haben keine gerade Laenge und stehen deshalb nicht in
  // buildableTubes(); sie bauen ueber dieselben Richtungs-Handles wie ein
  // gerades Rohr, setzen dort aber einen Viertelkreis.
  for (const cv of buildableCurvedTubes()) {
    const b = el("button", "btn part");
    b.dataset.tube = cv.id;
    b.title = `${partName(cv)} – ${eur(cv.price)}`;
    b.innerHTML =
      `<svg viewBox="0 0 28 16" width="28" height="16" aria-hidden="true">` +
      `<path d="M5 14 A9 9 0 0 1 14 5 L23 5" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/></svg>` +
      `<span data-i18n="part_bow">${t("part_bow")}</span>`;
    if (cv.id === builder.tubeId) b.classList.add("active");
    b.addEventListener("click", () => {
      builder.setTube(cv.id);
      if (builder.mode !== "add") setMode("add");
      else syncPartHighlights();
    });
    tubeWrap.appendChild(b);
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

  // --- Platten-Buttons ---------------------------------------------------
  const panelWrap = $("panel-buttons");
  for (const p of buildablePanels()) {
    const narrow = ESSENTIAL_PANELS.has(p.id) ? "" : " hide-narrow";
    const b = el("button", "btn part" + narrow);
    b.dataset.panel = p.id;
    b.title = `${p.name} – ${eur(p.price)}`;
    b.innerHTML =
      `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">` +
      `<rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill="currentColor" opacity="0.18" stroke="currentColor" stroke-width="1.4"/></svg>` +
      `<span>${p.w}×${p.h}</span>`;
    if (p.id === builder.panelId) b.classList.add("active");
    b.addEventListener("click", () => {
      builder.setPanel(p.id);
      setMode("panel");
    });
    panelWrap.appendChild(b);
  }

  // --- Rutschen-Button ---------------------------------------------------
  // Rutschen sind keine Rohre/Platten: sie werden an zwei senkrechten,
  // parallelen Rohren eingehaengt. Der Modus zeigt die passenden Felder an.
  {
    const b = el("btn-slide" && "button", "btn part");
    b.dataset.slide = "slide-new2";
    b.title = t("part_slide");
    b.innerHTML =
      `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">` +
      `<path d="M3 13 C7 13 5 4 13 3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>` +
      `<span data-i18n="part_slide">${t("part_slide")}</span>`;
    b.addEventListener("click", () => setMode(builder.mode === "slide" ? "add" : "slide"));
    panelWrap.appendChild(b);
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

  // Szene ein-/ausblenden via Canvas-Icon (Standard: aus).
  let grassOn = false;
  const sceneIcon = $("scene-toggle");
  const applyScene = (on) => {
    grassOn = on;
    scene.setScene(on);
    sceneIcon.classList.toggle("off", !on);
  };
  sceneIcon.addEventListener("click", () => applyScene(!grassOn));
  applyScene(false); // Startzustand: Szene aus

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

    const axes = scene.getHorizontalAxes();
    let dir = null;
    if (k === "ArrowUp") dir = axes.forward;
    else if (k === "ArrowDown") dir = neg(axes.forward);
    else if (k === "ArrowRight") dir = axes.right;
    else if (k === "ArrowLeft") dir = neg(axes.right);
    else if (k === "PageUp" || k === "+" || k === "=") dir = [0, 1, 0];
    else if (k === "PageDown" || k === "-" || k === "_") dir = [0, -1, 0];
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
      case "x": setMode("delete"); break;
      case "v": setMode("reinforce"); break;
      case "a": setMode("assembly"); break;
      case "k": setMode("clamp"); break;
      case "d": toggleDiagonal(); break;
      case "n": toggleLabels(); break;
      case "h": toggleHints(); break;
      case "c": scene.resetCamera(); break;
      case "escape": builder.selectedNodeId = null; builder.refresh(); break;
      case "delete":
      case "backspace":
        if (builder.selectedNodeId) {
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

  function renderInventory(bom) {
    const body = $("inventory-body"); body.innerHTML = "";
    const banner = $("feasibility-banner");
    if (bom.totals.tubes === 0 && bom.totals.connectors === 0 && bom.totals.panels === 0) {
      body.appendChild(el("div", "muted", t("inv_empty_build")));
      banner.className = "feasibility";
      banner.textContent = "";
      return;
    }
    const cmp = compareInventory(bom, inventory);
    for (const r of cmp.rows) {
      const row = el("div", "inv-row" + (r.ok ? "" : " bad"));
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
  setMode("add");
  updateUndoButton();
  return { update };
}
