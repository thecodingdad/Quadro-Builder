<div align="center">

# 🏗️ Quadro Builder

**3D-Planungstool für QUADRO-Klettergerüste · 3D planning tool for QUADRO climbing frames**

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Vanilla JS](https://img.shields.io/badge/built%20with-Vanilla%20JS-f7df1e?logo=javascript&logoColor=black)](web/js/)
[![Three.js](https://img.shields.io/badge/Three.js-r160-049ef4?logo=threedotjs&logoColor=white)](web/vendor/three/)
[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-ready-2ea44f?logo=github)](https://pages.github.com)

[🇩🇪 Deutsch](#-deutsch) · [🇬🇧 English](#-english)

</div>

---

## 🇩🇪 Deutsch

### Was ist das?

Quadro Builder ist eine moderne, **offline-fähige Web-App** zum Planen von [QUADRO-Klettergerüsten](https://quadroshop.com) – entstanden als Nachbau der alten Windows-Software „Quadro 3D".

Der Anlass: Die originale Software wirkt heute sehr altmodisch, die Kamerasteuerung ist umständlich und eine saubere Schritt-für-Schritt-Aufbauanleitung fehlt dort ganz. Genau das sollte der Quadro Builder besser machen.

Man baut ein Gerüst frei im **3D-Raum** aus Kupplungen und Rohren und bekommt sofort:
- eine **Live-Stückliste** mit geschätztem Materialpreis
- einen automatischen **Machbarkeitscheck** gegen den eigenen Teile-Bestand
- einen ebenenweisen **Aufbauplan** zum tatsächlichen Zusammenbauen

Keine Installation, kein Account, keine Cloud – alles läuft lokal im Browser.

### Vorschau


### Features

- **3D-Editor** – frei im Raum bauen mit Kupplungen, Rohren und Platten
- **Tastatursteuerung** – Pfeiltasten, Shortcuts für alle Aktionen (sieh `⌨ Tasten` in der App)
- **Live-Stückliste** – Kupplungstyp-Heuristik, Materialpreise, Gesamtkosten
- **Bestand & Machbarkeit** – eintragen was man hat, sofort sehen ob's reicht
- **Aufbaumodus** – Lage für Lage durch den Bauplan navigieren, drucken
- **Platten** – an zwei parallelen Rohren einsetzen, alle Katalogformate von 30×30 bis 80×80
- **Rutschen, Bögen und Anbauteile** – Rutsche einhängen, Bogenrohre drehen, Räder, Rollen, Lager, Netze, Rundabdeckung und großes Dach setzen
- **Schräge Streben** – 45°-Elemente für Rampen und Verstrebungen
- **Alu-Verstärkungen** – Profile in Rohre einsetzen, kollineare Läufe zusammenfassen
- **Modell-Bibliothek** – die eigene QDF-Sammlung einlesen, durchsuchen und filtern: „nur mit meinem Bestand baubar"
- **QDF-Import und -Export** – Entwürfe mit der Original-QUADRO-Software austauschen
- **Autosave + benannte Entwürfe** – Daten bleiben im Browser erhalten
- **JSON-Export/Import** – echte Offline-Sicherung als Datei
- **Zweisprachig** – Deutsch und Englisch (Sprache wechseln mit dem DE/EN-Button)
- **Installierbar (PWA)** – als eigenes Fenster einrichten und offline weiterbauen
- **Mobil bedienbar** – im Hochformat wandert die Bauteil-Leiste nach unten, Werkzeuge klappen bei Platzmangel zusammen, und der Aufbau läuft als Karte über der Szene
- **Optionaler Server** – wer mag, stellt Modelle und Bibliothek über mehrere Rechner bereit (siehe unten); ohne Server bleibt alles wie gehabt im Browser
- **GitHub Pages ready** – läuft ohne Server direkt aus dem Repository

### Schnellstart

Die App ist direkt unter der GitHub-Pages-URL erreichbar – einfach den [Link](https://thecodingdad.github.io/Quadro-Builder/) aufrufen, fertig. Alternativ kann sie auch selbst gehostet werden.

> Für eigene Änderungen: Fork erstellen → Pages aktivieren (Settings → Pages → Branch `main`, Ordner `/`) → fertig.

### Optional: gemeinsamer Speicher (Server)

Wer an mehreren Rechnern plant, kann die gespeicherten Modelle, den eigenen
Bestand und die QDF-Sammlung auf einen kleinen Server legen. Am einfachsten mit
Docker:

```bash
docker compose up --build      # App: http://localhost:8000/web/index.html
```

Oder direkt mit Python (`pip install -r requirements.txt`):

```bash
python server.py 8000          # App + API aus einem Ursprung
QUADRO_DATA=/pfad/zu/daten python server.py
```

Der Server legt alles als gewöhnliche Dateien ab (`data-store/docs/*.json`,
`data-store/inventory.json`, `data-store/library/*.qdf`) – eine Sicherung ist ein
simples Kopieren.

Wissenswertes:

- **Der Browser bleibt der Arbeitsplatz.** Er hält weiterhin den ganzen
  Bestand; der Server ist die gemeinsame Ablage, mit der abgeglichen wird.
  Offene Tabs, ungespeicherte Stände und Einstellungen bleiben rein lokal.
- **Live:** speichert ein Rechner, laden die anderen das Modell sofort nach –
  sofern sie darin nichts Ungespeichertes haben. Sonst wird gefragt.
- **Ohne Server** (GitHub Pages, `serve.py`, oder Server gerade aus) läuft alles
  weiter; Änderungen gehen beim nächsten Verbinden hoch. Nur ein Eintrag der
  Sammlung, von dem noch kein QDF-Text im Browser liegt, lässt sich dann nicht
  öffnen – das sagt die App auch.
- **Wo man ihn sieht:** im Seitenleisten-Tab „Meine Modelle" steht eine Zeile mit
  dem Zustand – aber erst, sobald einmal eine Verbindung stand. Ohne Server sagt
  die App nichts, sie verhält sich einfach wie immer.

> ⚠️ **Nur im eigenen Netz betreiben.** Der Server hat **keine Anmeldung, keine
> Rechte und keine Verschlüsselung**: wer ihn erreicht, darf alle Modelle lesen,
> ändern und löschen. Den Port also **nicht** im Router freigeben und nicht ins
> Internet stellen. Soll er von unterwegs erreichbar sein, gehört ein VPN davor
> oder ein Reverse-Proxy, der HTTPS und eine Anmeldung mitbringt (`/api/ws`
> muss dabei als WebSocket durchgereicht werden). Ausgeliefert werden bewusst
> nur die Dateien der App (`/web`, `/data`, `/icons` und die drei Dateien im
> Wurzelverzeichnis) – das Datenverzeichnis und der Rest des Projekts bleiben
> außen vor.


### Lizenz

[MIT](LICENSE) – frei verwendbar, auch kommerziell.

---

## 🇬🇧 English

TODO