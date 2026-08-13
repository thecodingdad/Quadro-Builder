// Internationalisierung: Deutsch + Englisch.
// t(key) gibt den String der aktuellen Sprache zurück.
// t(key, arg1, ...) ruft den String als Funktion auf (für Template-Strings).

const de = {
  // Toolbar-Buttons
  btn_build: 'Bauen',
  btn_build_title: 'Bauen (B)',
  btn_delete: 'Löschen',
  btn_delete_title: 'Auswahl löschen (Entf)',
  btn_select: 'Auswahl',
  btn_select_title: 'Cursor: vorhandene Teile auswählen (S / Esc)',
  btn_assembly: 'Aufbau',
  btn_assembly_title: 'Aufbaumodus (A)',
  btn_clamp: 'Doppelrohr',
  btn_clamp_title: 'Doppelrohrverbinder setzen (K) – auf ein Rohr klicken',
  btn_reinforce: 'Verstärken',
  btn_reinforce_title: 'Rohr verstärken (V) – Alu-Profil einschieben',
  btn_collision: 'Kollision',
  btn_collision_title: 'Kollisionen prüfen (X) – sich überlagernde Rohre',
  btn_labels: 'Namen',
  btn_labels_title: 'Kupplungs-Namen anzeigen (N)',
  btn_hints: 'Hinweise',
  btn_hints_title: 'Verstärkungs-Vorschläge anzeigen (H)',
  label_part: 'Bauteil',
  label_tube: 'Rohr wählen',
  label_panel: 'Platte wählen',
  label_color: 'Farbe',
  color_random: 'Zufallsfarbe',
  btn_diagonal: 'Schräg',
  btn_diagonal_title: 'Schräge Strebe (45°) – Rampen',
  part_bow: 'Bogen',
  part_slide: 'Rutsche',
  asm_order: 'Reihenfolge',
  asm_order_yp: 'von unten nach oben',
  asm_order_xp: 'von links nach rechts',
  asm_order_xm: 'von rechts nach links',
  asm_order_zp: 'von hinten nach vorne',
  asm_order_zm: 'von vorne nach hinten',
  notice_slide_exists: 'Hier hängt schon eine Rutsche.',
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
  btn_settings_title: 'Einstellungen',
  btn_slice_title: 'Schnittebene – ins Modell hineinsehen',
  slice_flip_title: 'Sichtbare Seite umdrehen',
  slice_close_title: 'Schnitt aufheben',
  btn_projection_title: 'Kamera: perspektivisch / orthogonal',
  btn_projection_persp: 'Perspektivisch',
  btn_projection_ortho: 'Orthogonal (ohne Fluchtpunkte)',
  settings_quality: 'Render-Qualität',
  settings_quality_hint: 'Betrifft die Rundung der Kupplungen und Rohre.',
  quality_low: 'Niedrig (kantig)',
  quality_medium: 'Mittel',
  quality_high: 'Hoch (rund)',
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

  // Generator
  menu_generate: 'Generator',
  btn_generate: '✨ Modell generieren…',
  btn_generate_title: 'Ein fertiges Modell erzeugen – auf Wunsch passend zum eigenen Bestand',
  gen_title: 'Modell generieren',
  gen_theme: 'Art',
  gen_random: 'Überraschung',
  gen_burg: 'Burg',
  gen_hoehle: 'Höhle',
  gen_turm: 'Turm',
  gen_spielhaus: 'Spielhaus',
  gen_size: 'Größe',
  gen_size_auto: 'Automatisch',
  gen_size_s: 'Klein',
  gen_size_m: 'Mittel',
  gen_size_l: 'Groß',
  gen_size_xl: 'Sehr groß',
  gen_only_inventory: 'Nur aus meinem Bestand',
  gen_parts: 'Bauteile',
  gen_part_t35: 'Rohre 35 cm',
  gen_part_panels: 'Platten',
  gen_part_diagonals: '45°-Schrägen',
  gen_part_bows: 'Bogenrohre',
  gen_part_slide: 'Rutsche',
  gen_part_t15: 'Rohre 15 cm',
  gen_part_t25: 'Rohre 25 cm',
  gen_part_t75: 'Rohre 75 cm',
  gen_part_reinforce: 'Verstärkungsprofile',
  gen_connectors_hint: 'Kupplungen und 35-cm-Rohre werden immer verwendet. Im Bestands-Modus entscheidet der Bestand, welche Bauteile vorkommen.',
  gen_roll: '🎲 Würfeln',
  gen_result: (theme, levels, tubes) => `${theme} erzeugt · ${levels} Ebenen · ${tubes} Rohre`,
  gen_fail_inventory: 'Der Bestand reicht nicht für ein Modell.',
  gen_fail: 'Es ließ sich kein Modell erzeugen.',
  gen_replace_confirm: 'Das aktuelle Modell wird ersetzt. Fortfahren?',

  // Hilfe-Overlay
  help_title: 'Tastenkürzel',
  help_close: 'Schließen',
  help_shortcuts: [
    ['Pfeiltasten', 'Rohr verlegen – folgt dem Blickwinkel'],
    ['Pfeiltasten (Auswahl)', 'Auswahl im 20-cm-Raster verschieben'],
    ['Ziehen (Auswahl)', 'Auswahl mit der Maus verschieben'],
    ['Strg/Cmd + A', 'alles auswählen'],
    ['1 … 8', 'Rohrlänge wählen'],
    ['B / S', 'Bauen / Auswahl'],
    ['D', 'Schräge Strebe (45°) ein/aus'],
    ['V / X', 'Verstärken / Kollisionen'],
    ['A', 'Aufbaumodus (Lage für Lage)'],
    ['N', 'Kupplungs-Namen ein/aus'],
    ['Strg/Cmd + Z', 'Rückgängig'],
    ['Entf', 'ausgewählte Teile löschen'],
    ['C', 'Ansicht zurücksetzen'],
    ['Esc', 'zurück in den Auswahl-Modus'],
  ],

  // Seitenleiste – Stückliste
  bom_title: 'Stückliste',
  bom_tubes: 'Rohre',
  bom_connectors: 'Kupplungen',
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
  dim_height: 'Höhe',
  dim_width: 'Breite',
  dim_depth: 'Tiefe',
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
  status_collision: 'Kollision: rot markierte Rohre überlagern sich (gleiche Achse oder Kreuzung im Rohrinneren).',
  status_clamp: 'Doppelrohr: auf ein Rohr klicken, um einen Doppelrohrverbinder zu setzen (bestehenden anklicken = entfernen).',
  status_assembly: 'Aufbau: mit ‹ › oder Pfeiltasten Schritt für Schritt durch den Bauplan.',
  status_select: 'Auswahl: Teile anklicken (Strg/Shift = mehrere) oder mit Strg ein Rechteck aufziehen – das ergänzt. Klick ins Leere hebt auf.',

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
  asm_ignore_colors: 'Farben zusammenfassen',
  cube_right: 'Rechts',
  cube_left: 'Links',
  cube_top: 'Oben',
  cube_bottom: 'Unten',
  cube_front: 'Vorn',
  cube_back: 'Hinten',
  notice_ground: 'Unter dem Boden wird nicht gebaut.',
  notice_move_collision: 'Verschieben nicht möglich: Rohre würden sich überlagern.',
  notice_move_ground: 'Verschieben nicht möglich: unter dem Boden.',
  notice_move_connector: 'Verschieben nicht möglich: dafür gibt es keine passende Kupplung.',
  notice_move_empty: 'Nichts Verschiebbares ausgewählt.',
  notice_move_merged: (n) => `${n} Kupplung(en) zusammengelegt.`,
  notice_move_detached: (n) => `${n} Verbindung(en) getrennt.`,

  // Flash-Meldungen (Funktionen für Vorlagen)
  flash_hints_n: (n) => `${n} Rohr(e) könnten ein Alu-Profil gebrauchen (orange).`,
  flash_hints_0: 'Keine frei tragenden Ebenen gefunden.',
  flash_collisions_n: (n) => `${n} Rohr(e) überlagern sich (rot).`,
  flash_collisions_0: 'Keine Kollisionen gefunden.',
  flash_saved: (name) => `Gespeichert: ${name}`,
  flash_loaded: (name) => `Geladen: ${name}`,
  flash_exported: 'Entwurf exportiert.',
  flash_imported_json: 'Entwurf importiert.',
  flash_import_draft: (name) => `neuer Entwurf „${name}"`,
  flash_inv_exported: 'Bestand exportiert.',
  flash_inv_imported: 'Bestand importiert.',
  flash_deleted_n: (n) => `${n} Teil(e) gelöscht.`,
  flash_selected_n: (n) => `${n} Teil(e) ausgewählt.`,

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
  btn_delete_title: 'Delete selection (Del)',
  btn_select: 'Select',
  btn_select_title: 'Cursor: select existing parts (S / Esc)',
  btn_assembly: 'Assembly',
  btn_assembly_title: 'Assembly mode (A)',
  btn_clamp: 'Double tube',
  btn_clamp_title: 'Place double-tube connector (K) – click a tube',
  btn_reinforce: 'Reinforce',
  btn_reinforce_title: 'Reinforce tube (V) – insert aluminium profile',
  btn_collision: 'Collision',
  btn_collision_title: 'Check collisions (X) – overlapping tubes',
  btn_labels: 'Labels',
  btn_labels_title: 'Show connector labels (N)',
  btn_hints: 'Hints',
  btn_hints_title: 'Show reinforcement suggestions (H)',
  label_part: 'Part',
  label_tube: 'Select tube',
  label_panel: 'Select panel',
  label_color: 'Color',
  color_random: 'Random colour',
  btn_diagonal: 'Diagonal',
  btn_diagonal_title: 'Diagonal brace (45°) – ramps',
  part_bow: 'Arc',
  part_slide: 'Slide',
  asm_order: 'Order',
  asm_order_yp: 'bottom to top',
  asm_order_xp: 'left to right',
  asm_order_xm: 'right to left',
  asm_order_zp: 'back to front',
  asm_order_zm: 'front to back',
  notice_slide_exists: 'A slide is already mounted here.',
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
  btn_settings_title: 'Settings',
  btn_slice_title: 'Section plane – look inside the model',
  slice_flip_title: 'Flip visible side',
  slice_close_title: 'Clear section',
  btn_projection_title: 'Camera: perspective / orthographic',
  btn_projection_persp: 'Perspective',
  btn_projection_ortho: 'Orthographic (no vanishing points)',
  settings_quality: 'Render quality',
  settings_quality_hint: 'Affects how round connectors and tubes are drawn.',
  quality_low: 'Low (angular)',
  quality_medium: 'Medium',
  quality_high: 'High (round)',
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

  // Generator
  menu_generate: 'Generator',
  btn_generate: '✨ Generate model…',
  btn_generate_title: 'Create a finished model – optionally matching your own inventory',
  gen_title: 'Generate model',
  gen_theme: 'Kind',
  gen_random: 'Surprise me',
  gen_burg: 'Castle',
  gen_hoehle: 'Cave',
  gen_turm: 'Tower',
  gen_spielhaus: 'Playhouse',
  gen_size: 'Size',
  gen_size_auto: 'Automatic',
  gen_size_s: 'Small',
  gen_size_m: 'Medium',
  gen_size_l: 'Large',
  gen_size_xl: 'Very large',
  gen_only_inventory: 'Only from my inventory',
  gen_parts: 'Parts',
  gen_part_t35: 'Tubes 35 cm',
  gen_part_panels: 'Panels',
  gen_part_diagonals: '45° diagonals',
  gen_part_bows: 'Curved tubes',
  gen_part_slide: 'Slide',
  gen_part_t15: 'Tubes 15 cm',
  gen_part_t25: 'Tubes 25 cm',
  gen_part_t75: 'Tubes 75 cm',
  gen_part_reinforce: 'Reinforcement profiles',
  gen_connectors_hint: 'Connectors and 35 cm tubes are always used. In inventory mode the inventory decides which parts appear.',
  gen_roll: '🎲 Roll',
  gen_result: (theme, levels, tubes) => `${theme} created · ${levels} levels · ${tubes} tubes`,
  gen_fail_inventory: 'Your inventory is not enough for a model.',
  gen_fail: 'No model could be generated.',
  gen_replace_confirm: 'This replaces the current model. Continue?',
  btn_clear_title: 'Delete everything',

  // Help overlay
  help_title: 'Keyboard Shortcuts',
  help_close: 'Close',
  help_shortcuts: [
    ['Arrow keys', 'Place tube – follows the view angle'],
    ['Arrow keys (selection)', 'Move selection on the 20 cm grid'],
    ['Drag (selection)', 'Move selection with the mouse'],
    ['Ctrl/Cmd + A', 'Select everything'],
    ['1 … 8', 'Select tube length'],
    ['B / S', 'Build / Select'],
    ['D', 'Toggle diagonal brace (45°)'],
    ['V / X', 'Reinforce / Collisions'],
    ['A', 'Assembly mode (layer by layer)'],
    ['N', 'Toggle connector labels'],
    ['Ctrl/Cmd + Z', 'Undo'],
    ['Del', 'Delete selected parts'],
    ['C', 'Reset camera'],
    ['Esc', 'back to select mode'],
  ],

  // Sidebar – BOM
  bom_title: 'Bill of Materials',
  bom_tubes: 'Tubes',
  bom_connectors: 'Connectors',
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
  dim_height: 'Height',
  dim_width: 'Width',
  dim_depth: 'Depth',
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
  status_collision: 'Collision: tubes marked red overlap (same axis or crossing inside a tube).',
  status_clamp: 'Double tube: click a tube to place a double-tube connector (click existing = remove).',
  status_assembly: 'Assembly: use ‹ › or arrow keys to step through the build plan.',
  status_select: 'Select: click parts (Ctrl/Shift = multiple) or hold Ctrl and drag a rectangle – it adds. Click empty space to clear.',

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
  asm_ignore_colors: 'Merge colours',
  cube_right: 'Right',
  cube_left: 'Left',
  cube_top: 'Top',
  cube_bottom: 'Bottom',
  cube_front: 'Front',
  cube_back: 'Back',
  notice_ground: 'Nothing is built below ground.',
  notice_move_collision: 'Cannot move: tubes would overlap.',
  notice_move_ground: 'Cannot move: below ground.',
  notice_move_connector: 'Cannot move: there is no connector for that.',
  notice_move_empty: 'Nothing movable selected.',
  notice_move_merged: (n) => `${n} connector(s) merged.`,
  notice_move_detached: (n) => `${n} connection(s) separated.`,

  // Flash messages
  flash_hints_n: (n) => `${n} tube(s) could use an aluminium profile (orange).`,
  flash_hints_0: 'No free-spanning levels found.',
  flash_collisions_n: (n) => `${n} tube(s) overlap (red).`,
  flash_collisions_0: 'No collisions found.',
  flash_saved: (name) => `Saved: ${name}`,
  flash_loaded: (name) => `Loaded: ${name}`,
  flash_exported: 'Design exported.',
  flash_imported_json: 'Design imported.',
  flash_import_draft: (name) => `new draft “${name}”`,
  flash_inv_exported: 'Inventory exported.',
  flash_inv_imported: 'Inventory imported.',
  flash_deleted_n: (n) => `${n} part(s) deleted.`,
  flash_selected_n: (n) => `${n} part(s) selected.`,

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
