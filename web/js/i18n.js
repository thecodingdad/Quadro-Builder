// Internationalisierung: Deutsch + Englisch.
// t(key) gibt den String der aktuellen Sprache zurück.
// t(key, arg1, ...) ruft den String als Funktion auf (für Template-Strings).

const de = {
  // Toolbar-Buttons
  btn_build: 'Bauen',
  btn_build_title: 'Bauen (B)',
  btn_delete: 'Löschen',
  btn_delete_title: 'Löschen (X)',
  btn_assembly: 'Aufbau',
  btn_assembly_title: 'Aufbaumodus (A)',
  btn_clamp: 'Doppelrohr',
  btn_clamp_title: 'Doppelrohrverbinder setzen (K) – auf ein Rohr klicken',
  btn_reinforce: 'Verstärken',
  btn_reinforce_title: 'Rohr verstärken (V) – Alu-Profil einschieben',
  btn_labels: 'Namen',
  btn_labels_title: 'Kupplungs-Namen anzeigen (N)',
  btn_hints: 'Hinweise',
  btn_hints_title: 'Verstärkungs-Vorschläge anzeigen (H)',
  label_part: 'Bauteil',
  label_color: 'Farbe',
  btn_diagonal: 'Schräg',
  btn_diagonal_title: 'Schräge Strebe (45°) – Rampen',
  part_bow: 'Bogen',
  btn_undo: '↶ Zurück',
  btn_undo_short: 'Zurück',
  btn_undo_title: 'Rückgängig (Strg/Cmd+Z)',
  btn_redo_short: 'Wieder',
  btn_redo_title: 'Wiederholen (Strg/Cmd+Shift+Z)',
  btn_camera: '↺ Ansicht',
  btn_camera_title: 'Ansicht zurücksetzen (C)',
  btn_grass: '🌿 Szene',
  btn_grass_title: 'Szene ein-/ausblenden (Gras, Bäume, Himmel, Licht)',
  btn_file: 'Entwürfe ▾',
  btn_file_title: 'Entwürfe & Dateien',
  btn_help: '⌨ Tasten',
  btn_help_title: 'Tastenkürzel',
  btn_bom: '≡ Stückliste',
  btn_bom_title: 'Stückliste ein-/ausblenden',
  btn_inventory: '▦ Bestand',
  btn_inventory_title: 'Bestand & Machbarkeit ein-/ausblenden',

  // Dateimenü
  menu_named: 'Benannter Entwurf',
  btn_save: 'Als Entwurf speichern…',
  btn_load: 'Laden',
  btn_delete_save_title: 'Gespeicherten Entwurf löschen',
  menu_file: 'Datei',
  btn_export: 'Export',
  btn_import: 'Import (JSON/QDF)',
  btn_import_title: 'JSON-Entwurf oder QDF-Datei (Original-QUADRO-Software) laden',
  btn_clear: 'Modell leeren',
  btn_clear_title: 'Alles löschen',

  // Hilfe-Overlay
  help_title: 'Tastenkürzel',
  help_close: 'Schließen',
  help_shortcuts: [
    ['Pfeiltasten', 'Rohr in Blickrichtung verlegen'],
    ['Bild ↑ / Bild ↓', 'Rohr nach oben / unten'],
    ['+ / −', 'Rohr nach oben / unten'],
    ['1 … 8', 'Rohrlänge wählen'],
    ['B / X', 'Bauen / Löschen'],
    ['D', 'Schräge Strebe (45°) ein/aus'],
    ['A', 'Aufbaumodus (Lage für Lage)'],
    ['N', 'Kupplungs-Namen ein/aus'],
    ['Strg/Cmd + Z', 'Rückgängig'],
    ['Entf', 'ausgewählte Kupplung löschen'],
    ['C', 'Ansicht zurücksetzen'],
    ['Esc', 'Auswahl aufheben'],
  ],

  // Seitenleiste – Stückliste
  bom_title: 'Stückliste',
  bom_tubes: 'Rohre',
  bom_connectors: 'Kupplungen (geschätzt)',
  bom_panels: 'Platten',
  bom_textiles: 'Netze & Stoffe',
  bom_textile: 'Netz',
  bom_slides: 'Rutschen & Dächer',
  slide_slide: 'Rutsche',
  slide_end: 'Rutschen-Endstück',
  slide_curved: 'Bogenrutsche',
  slide_roof: 'Dach',
  bom_reinforcements: 'Verstärkungen',
  total_tubes: 'Rohre',
  total_connectors: 'Kupplungen',
  total_panels: 'Platten',
  total_reinforcements: 'Verstärkungen',
  total_price: 'Materialpreis ca.',

  // Seitenleiste – Bestand
  inv_title: 'Bestand & Machbarkeit',
  inv_hint: 'Trag ein, wie viele Teile du besitzt – der Editor prüft, ob dein Entwurf damit baubar ist.',
  inv_edit_title: 'Bestand bearbeiten',
  btn_inv_toggle: 'Bearbeiten',
  btn_inv_toggle_title: 'Vollständige Teileliste bearbeiten',
  btn_inv_export_title: 'Bestand als JSON sichern',
  btn_inv_import_title: 'Bestand aus JSON laden',

  // Seitenleiste – Aufbaumodus
  asm_title: 'Aufbau',
  btn_asm_print: '⎙ Drucken',
  btn_asm_print_title: 'Kompletten Bauplan drucken',
  asm_hint: 'Lage für Lage von unten nach oben. Orange = im aktuellen Schritt anbauen, blass = kommt später.',

  // Statuszeile
  status_add: 'Bauen: Kupplung wählen, dann grünen Punkt klicken. Oder Pfeiltasten. Ziehen = drehen.',
  status_panel: 'Platte: blau markiertes Feld anklicken, um die gewählte Platte einzusetzen.',
  status_reinforce: 'Verstärken: Rohr anklicken, um ein Alu-Profil ein-/auszuschieben (metallisch = verstärkt, orange = empfohlen).',
  status_clamp: 'Doppelrohr: auf ein Rohr klicken, um einen Doppelrohrverbinder zu setzen (bestehenden anklicken = entfernen).',
  status_assembly: 'Aufbau: mit ‹ › oder Pfeiltasten Schritt für Schritt durch den Bauplan.',
  status_delete: 'Löschen: Rohr, Kupplung oder Platte anklicken.',

  // Hinweise aus dem Builder (onNotice)
  notice_collision: 'Hier liegt schon ein Rohr – kein Platz.',
  notice_no_free_arm: 'Kein freier Arm für die Winkelkupplung – hier nicht möglich.',
  notice_clamp_placed: 'Doppelrohrverbinder gesetzt – grüner Punkt: zweites Rohr.',
  notice_second_tube_placed: 'Zweites Rohr im Doppelrohrverbinder gesetzt.',
  notice_reinforce_added: 'Verstärkung hinzugefügt.',
  notice_reinforce_removed: 'Verstärkung entfernt.',
  notice_clamp_removed: 'Doppelrohrverbinder entfernt.',
  notice_clamp_click_tube: 'Auf ein Rohr klicken, um einen Doppelrohrverbinder zu setzen.',
  notice_color_changed: 'Farbe geändert.',

  // Flash-Meldungen (Funktionen für Vorlagen)
  flash_hints_n: (n) => `${n} Rohr(e) könnten ein Alu-Profil gebrauchen (orange).`,
  flash_hints_0: 'Keine frei tragenden Ebenen gefunden.',
  flash_saved: (name) => `Gespeichert: ${name}`,
  flash_loaded: (name) => `Geladen: ${name}`,
  flash_exported: 'Entwurf exportiert.',
  flash_imported_json: 'Entwurf importiert.',
  flash_import_draft: (name) => `neuer Entwurf „${name}"`,
  flash_inv_exported: 'Bestand exportiert.',
  flash_inv_imported: 'Bestand importiert.',

  // Bestätigungs- und Eingabedialoge
  prompt_save_name: 'Name für diesen Entwurf:',
  confirm_clear: 'Gesamtes Modell löschen?',
  confirm_delete_save: (name) => `Gespeicherten Entwurf "${name}" löschen?`,

  // Aufbaumodus
  asm_counter: (i, total) => `Schritt ${i + 1} / ${total}`,
  asm_empty_title: 'Noch nichts gebaut',
  asm_empty_body: 'Baue zuerst etwas im Bauen-Modus.',
  asm_cat_connectors: 'Kupplungen',
  asm_cat_tubes: 'Rohre',
  asm_cat_panels: 'Platten',
  asm_open_ends: 'Offene Enden (Kappe/Kupplung nötig)',

  // Drucken
  print_title: 'QUADRO Bauplan',
  print_empty: 'Noch nichts gebaut.',
  print_open_end: 'offenes Ende',

  // Stückliste (dynamisch)
  bom_open_ends: 'Offene Enden (Kappe/Kupplung nötig)',

  // Bestand
  inv_empty_build: 'Baue etwas, um die Machbarkeit zu prüfen.',
  inv_need: (n) => `braucht ${n}`,
  inv_missing: (n) => `fehlt ${n}`,
  inv_feasible: '✓ Mit deinem Bestand baubar.',
  inv_infeasible: '✗ Nicht genug Teile – siehe rote Zeilen.',

  // Gruppenbezeichnungen im Bestandseditor
  group_tubes: 'Rohre',
  group_connectors: 'Kupplungen',
  group_panels: 'Platten',
  group_reinforcements: 'Verstärkungen',

  // Entwurfsliste
  saves_empty: '— keine —',

  // Autosave
  saving: 'Speichern…',
  autosaved: 'Automatisch gespeichert',

  // Teile-Katalog / Fehler
  catalog_load_error: (status) => `Teile-Katalog konnte nicht geladen werden (${status})`,
  catalog_not_loaded: 'Katalog noch nicht geladen',
  catalog_load_fail_hint: 'Bitte über einen lokalen Server oder GitHub Pages öffnen (siehe README).',

  // QDF-Import
  qdf_no_parts: 'Keine Kupplungen/Rohre in der QDF-Datei gefunden.',
  qdf_skipped: (skip) => ` – übersprungen: ${skip}`,
  qdf_imported: (stats, skipTxt) => `QDF importiert: ${stats}${skipTxt}.`,

  // Bestandsdatei
  inv_invalid: 'Bestand-Datei ist ungültig.',

  // Laden/Importieren von Modell-Daten
  load_error_data: 'Datei enthält kein gültiges Modell.',
  load_error_format: 'Unbekanntes Speicherformat – Datei kann nicht geladen werden.',

  // Speichern
  flash_save_quota: 'Speicher voll – Entwurf konnte nicht gespeichert werden. Bitte alte Entwürfe löschen.',
  flash_save_failed: (msg) => `Speichern fehlgeschlagen: ${msg}`,

  // Aufbauplan: Schritt-Titel
  buildplan_ground_frame: (h) => `Bodenebene – Rahmen (${h} cm)`,
  buildplan_level_frame: (level, h) => `Ebene ${level} – Rahmen (${h} cm)`,
  buildplan_risers: (from, to) => `Ebene ${from} → ${to} – Stützen`,

  // Sprach-Toggle
  lang_toggle_title: 'Sprache wechseln / Switch language',
};

const en = {
  // Toolbar buttons
  btn_build: 'Build',
  btn_build_title: 'Build (B)',
  btn_delete: 'Delete',
  btn_delete_title: 'Delete (X)',
  btn_assembly: 'Assembly',
  btn_assembly_title: 'Assembly mode (A)',
  btn_clamp: 'Double tube',
  btn_clamp_title: 'Place double-tube connector (K) – click a tube',
  btn_reinforce: 'Reinforce',
  btn_reinforce_title: 'Reinforce tube (V) – insert aluminium profile',
  btn_labels: 'Labels',
  btn_labels_title: 'Show connector labels (N)',
  btn_hints: 'Hints',
  btn_hints_title: 'Show reinforcement suggestions (H)',
  label_part: 'Part',
  label_color: 'Color',
  btn_diagonal: 'Diagonal',
  btn_diagonal_title: 'Diagonal brace (45°) – ramps',
  part_bow: 'Arc',
  btn_undo: '↶ Undo',
  btn_undo_short: 'Undo',
  btn_undo_title: 'Undo (Ctrl/Cmd+Z)',
  btn_redo_short: 'Redo',
  btn_redo_title: 'Redo (Ctrl/Cmd+Shift+Z)',
  btn_camera: '↺ View',
  btn_camera_title: 'Reset camera (C)',
  btn_grass: '🌿 Scene',
  btn_grass_title: 'Toggle scene (grass, trees, sky, lights)',
  btn_file: 'Designs ▾',
  btn_file_title: 'Designs & files',
  btn_help: '⌨ Keys',
  btn_help_title: 'Keyboard shortcuts',
  btn_bom: '≡ Parts list',
  btn_bom_title: 'Toggle parts list',
  btn_inventory: '▦ Inventory',
  btn_inventory_title: 'Toggle inventory & feasibility',

  // File menu
  menu_named: 'Named design',
  btn_save: 'Save as design…',
  btn_load: 'Load',
  btn_delete_save_title: 'Delete saved design',
  menu_file: 'File',
  btn_export: 'Export',
  btn_import: 'Import (JSON/QDF)',
  btn_import_title: 'Load JSON design or QDF file (original QUADRO software)',
  btn_clear: 'Clear model',
  btn_clear_title: 'Delete everything',

  // Help overlay
  help_title: 'Keyboard Shortcuts',
  help_close: 'Close',
  help_shortcuts: [
    ['Arrow keys', 'Place tube in view direction'],
    ['Page Up / Page Down', 'Tube up / down'],
    ['+ / −', 'Tube up / down'],
    ['1 … 8', 'Select tube length'],
    ['B / X', 'Build / Delete'],
    ['D', 'Toggle diagonal brace (45°)'],
    ['A', 'Assembly mode (layer by layer)'],
    ['N', 'Toggle connector labels'],
    ['Ctrl/Cmd + Z', 'Undo'],
    ['Del', 'Delete selected connector'],
    ['C', 'Reset camera'],
    ['Esc', 'Deselect'],
  ],

  // Sidebar – BOM
  bom_title: 'Bill of Materials',
  bom_tubes: 'Tubes',
  bom_connectors: 'Connectors (estimated)',
  bom_panels: 'Panels',
  bom_textiles: 'Nets & textiles',
  bom_textile: 'Net',
  bom_slides: 'Slides & roofs',
  slide_slide: 'Slide',
  slide_end: 'Slide end',
  slide_curved: 'Curved slide',
  slide_roof: 'Roof',
  bom_reinforcements: 'Reinforcements',
  total_tubes: 'Tubes',
  total_connectors: 'Connectors',
  total_panels: 'Panels',
  total_reinforcements: 'Reinforcements',
  total_price: 'Material price est.',

  // Sidebar – Inventory
  inv_title: 'Inventory & Feasibility',
  inv_hint: 'Enter how many parts you own – the editor checks if your design is buildable with them.',
  inv_edit_title: 'Edit inventory',
  btn_inv_toggle: 'Edit',
  btn_inv_toggle_title: 'Edit complete parts list',
  btn_inv_export_title: 'Export inventory as JSON',
  btn_inv_import_title: 'Import inventory from JSON',

  // Sidebar – Assembly
  asm_title: 'Assembly',
  btn_asm_print: '⎙ Print',
  btn_asm_print_title: 'Print complete build plan',
  asm_hint: 'Layer by layer, bottom to top. Orange = add in this step, pale = comes later.',

  // Status bar
  status_add: 'Build: select a connector, then click the green dot. Or use arrow keys. Drag = rotate.',
  status_panel: 'Panel: click the blue highlighted field to place the selected panel.',
  status_reinforce: 'Reinforce: click a tube to insert/remove an aluminium profile (metallic = reinforced, orange = recommended).',
  status_clamp: 'Double tube: click a tube to place a double-tube connector (click existing = remove).',
  status_assembly: 'Assembly: use ‹ › or arrow keys to step through the build plan.',
  status_delete: 'Delete: click a tube, connector or panel.',

  // Notices from the builder (onNotice)
  notice_collision: 'There is already a tube here – no room.',
  notice_no_free_arm: 'No free arm for the angle connector – not possible here.',
  notice_clamp_placed: 'Double-tube connector placed – green dot: second tube.',
  notice_second_tube_placed: 'Second tube placed in the double-tube connector.',
  notice_reinforce_added: 'Reinforcement added.',
  notice_reinforce_removed: 'Reinforcement removed.',
  notice_clamp_removed: 'Double-tube connector removed.',
  notice_clamp_click_tube: 'Click a tube to place a double-tube connector.',
  notice_color_changed: 'Colour changed.',

  // Flash messages
  flash_hints_n: (n) => `${n} tube(s) could use an aluminium profile (orange).`,
  flash_hints_0: 'No free-spanning levels found.',
  flash_saved: (name) => `Saved: ${name}`,
  flash_loaded: (name) => `Loaded: ${name}`,
  flash_exported: 'Design exported.',
  flash_imported_json: 'Design imported.',
  flash_import_draft: (name) => `new draft “${name}”`,
  flash_inv_exported: 'Inventory exported.',
  flash_inv_imported: 'Inventory imported.',

  // Confirm / prompt dialogs
  prompt_save_name: 'Name for this design:',
  confirm_clear: 'Delete the entire model?',
  confirm_delete_save: (name) => `Delete saved design "${name}"?`,

  // Assembly
  asm_counter: (i, total) => `Step ${i + 1} / ${total}`,
  asm_empty_title: 'Nothing built yet',
  asm_empty_body: 'Build something in Build mode first.',
  asm_cat_connectors: 'Connectors',
  asm_cat_tubes: 'Tubes',
  asm_cat_panels: 'Panels',
  asm_open_ends: 'Open ends (cap / connector needed)',

  // Print
  print_title: 'QUADRO Build Plan',
  print_empty: 'Nothing built yet.',
  print_open_end: 'open end',

  // BOM (dynamic)
  bom_open_ends: 'Open ends (cap / connector needed)',

  // Inventory
  inv_empty_build: 'Build something to check feasibility.',
  inv_need: (n) => `need ${n}`,
  inv_missing: (n) => `missing ${n}`,
  inv_feasible: '✓ Buildable with your inventory.',
  inv_infeasible: '✗ Not enough parts – see red rows.',

  // Group labels in inventory editor
  group_tubes: 'Tubes',
  group_connectors: 'Connectors',
  group_panels: 'Panels',
  group_reinforcements: 'Reinforcements',

  // Saved list
  saves_empty: '— none —',

  // Autosave
  saving: 'Saving…',
  autosaved: 'Automatically saved',

  // Catalogue / errors
  catalog_load_error: (status) => `Could not load parts catalogue (${status})`,
  catalog_not_loaded: 'Catalogue not loaded yet',
  catalog_load_fail_hint: 'Please open via a local server or GitHub Pages (see README).',

  // QDF import
  qdf_no_parts: 'No connectors/tubes found in the QDF file.',
  qdf_skipped: (skip) => ` – skipped: ${skip}`,
  qdf_imported: (stats, skipTxt) => `QDF imported: ${stats}${skipTxt}.`,

  // Inventory file
  inv_invalid: 'Inventory file is invalid.',

  // Loading/importing model data
  load_error_data: 'File does not contain a valid model.',
  load_error_format: 'Unknown save format – file cannot be loaded.',

  // Saving
  flash_save_quota: 'Storage full – design could not be saved. Please delete old drafts.',
  flash_save_failed: (msg) => `Save failed: ${msg}`,

  // Build plan: step titles
  buildplan_ground_frame: (h) => `Ground level – frame (${h} cm)`,
  buildplan_level_frame: (level, h) => `Level ${level} – frame (${h} cm)`,
  buildplan_risers: (from, to) => `Level ${from} → ${to} – uprights`,

  // Language toggle
  lang_toggle_title: 'Sprache wechseln / Switch language',
};

// -----------------------------------------------------------------------

const LANG_KEY = 'quadro.lang';
const translations = { de, en };

let _lang = (() => {
  const stored = localStorage.getItem(LANG_KEY);
  if (stored && translations[stored]) return stored;
  return (navigator.language || '').startsWith('de') ? 'de' : 'en';
})();

/** Übersetzung für `key` in der aktuellen Sprache.
 *  Ist der Wert eine Funktion, wird sie mit den restlichen Argumenten aufgerufen. */
export function t(key, ...args) {
  const dict = translations[_lang] ?? translations.de;
  const val = dict[key] ?? translations.de[key] ?? key;
  return typeof val === 'function' ? val(...args) : val;
}

export function getLang() { return _lang; }

export function setLang(lang) {
  if (!translations[lang]) return;
  _lang = lang;
  localStorage.setItem(LANG_KEY, lang);
}

/** Wendet alle data-i18n / data-i18n-title-Attribute auf das Dokument an. */
export function applyTranslations() {
  document.documentElement.lang = _lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const val = t(el.dataset.i18n);
    if (typeof val === 'string') el.textContent = val;
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
}
