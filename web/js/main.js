// Einstiegspunkt: Katalog laden, Szene/Modell/Builder/UI aufsetzen, Autosave.

import { loadCatalog } from "./catalog.js";
import { BuildModel } from "./model.js";
import { SceneManager } from "./scene.js";
import { Builder } from "./builder.js";
import { initUI } from "./ui.js";
import { t } from "./i18n.js";

async function boot() {
  try {
    await loadCatalog();
  } catch (e) {
    document.getElementById("status").textContent =
      e.message + " — " + t("catalog_load_fail_hint");
    return;
  }

  const scene = new SceneManager(document.getElementById("canvas"));
  const model = new BuildModel();
  const builder = new Builder(scene, model, { onChange: () => {} });
  const ui = initUI({ scene, model, builder });

  // Jede Änderung markiert den offenen Tab und wird von der UI gesichert --
  // je nach Einstellung in die Datei oder nur in die Sitzung.
  builder.onChange = () => {
    ui.update();
    ui.touchActiveTab();
  };

  // Offene Dateien wiederherstellen (oder die erste anlegen).
  await ui.start();

  // Ab hier steht die Oberfläche vollständig.
  document.body.classList.remove("booting");

  // Dev-Hook (nur mit ?dev im URL): erlaubt programmatischen QDF-Import fuer Tests.
  if (location.search.includes("dev")) {
    const { parseQDF } = await import("./qdfimport.js");
    const { buildableTubes, panels, geometry } = await import("./catalog.js");
    window.__qdf = {
      model, builder, scene, ui,
      import(text) {
        const data = parseQDF(text, {
          tubes: buildableTubes(), panels: panels(),
          connectorSize: geometry().connectorSize, mergeEps: 2,
        });
        builder.modelReplaced();
        model.loadJSON(data);
        builder.selectedNodeId = null;
        builder.refresh();
        scene.resetCamera();
        return data.stats;
      },
    };
  }
}

/**
 * Service Worker anmelden: damit läuft der Editor auch ohne Netz und lässt
 * sich installieren. Mit `?dev` bleibt er aus -- beim Entwickeln soll nichts
 * zwischen Datei und Browser stehen. Ohne sicheren Kontext (http:// auf einem
 * anderen Rechner als localhost) lehnt der Browser ab; das ist kein Fehler
 * der App und wird deshalb nur vermerkt.
 */
function registriereWorker() {
  if (!("serviceWorker" in navigator) || location.search.includes("dev")) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("../sw.js")
      .catch((e) => console.info("Kein Service Worker:", e.message));
  });
}

registriereWorker();
boot();
