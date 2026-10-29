# WaveDrop Chrome Extension – Code Change Prompt

Dieses Dokument beschreibt drei präzise Änderungen am WaveDrop YouTube Downloader Chrome Extension Projekt. Die Dateipfade beziehen sich auf das Projekt-Root (das Verzeichnis mit `manifest.json`).

---

## Änderung 1 – Popup UI neu designen (an das Haupt-Window-Design angleichen)

### Hintergrund
Das Popup (`popup/popup.html` + `popup/popup.css`) verwendet aktuell ein flaches, rechteckiges UI (dunkler Hintergrund `#07090f`, keine Rundungen, kein Glassmorphismus). Das „manuelle" Fenster – also die App wenn sie direkt geöffnet wird – verwendet das Design aus `shared/theme.css`, das deutlich reichhaltiger ist: gerundete Ecken, Glassmorphismus, Radialgradienten mit Pink/Blau/Lila, macOS-Fensterpunkte (rot/gelb/grün), die Display-Schrift Baskerville für Überschriften und Inter für Fließtext.

Das Ziel ist es, den **Popup** optisch mit dem Haupt-Window gleichzuziehen, sodass beide ein konsistentes Look & Feel teilen.

### Was geändert werden soll in `popup/popup.css` und `popup/popup.html`

**A) Hintergrund & Shell**
- Ersetze den flachen Hintergrund `#07090f` durch das Radialgradienten-Hintergrundmuster aus `shared/theme.css`:
  ```css
  background:
    radial-gradient(circle at 16% 18%, rgba(255, 94, 189, 0.26), transparent 22%),
    radial-gradient(circle at 84% 14%, rgba(73, 182, 255, 0.24), transparent 24%),
    radial-gradient(circle at 70% 68%, rgba(217, 72, 255, 0.24), transparent 28%),
    radial-gradient(circle at 18% 88%, rgba(100, 243, 255, 0.18), transparent 24%),
    linear-gradient(180deg, #04020a 0%, #07030d 42%, #020104 100%);
  ```
- Wende auf `.wd-popup-surface` Glassmorphismus an: `backdrop-filter: blur(24px)`, `background: var(--wd-glass)` (Wert aus theme.css: `rgba(18, 11, 30, 0.76)`), `border: 1px solid rgba(255,255,255,0.12)`.
- Runde den Popup-Container ab: `border-radius: 24px` (nutze `--wd-radius-card`).

**B) Header – macOS-Fensterpunkte ergänzen**
- Füge links im Header (`.wd-popup-header`) die drei macOS-Fensterdots ein, analog zu `.wd-window-bar` aus theme.css:
  ```html
  <div class="wd-window-controls">
    <button class="wd-window-dot wd-window-dot-red"  aria-label="Close"></button>
    <button class="wd-window-dot wd-window-dot-yellow" aria-label="Minimize"></button>
    <button class="wd-window-dot wd-window-dot-green"  aria-label="Expand"></button>
  </div>
  ```
- Entferne dafür den leeren `.wd-popup-header-spacer` oder integriere die Dots dort hinein.
- Die Dots sind bereits in `shared/theme.css` als `.wd-window-dot`, `.wd-window-dot-red`, `.wd-window-dot-yellow`, `.wd-window-dot-green` definiert – keine eigenen CSS-Regeln nötig.

**C) Schriftart & Typografie**
- Ändere den Popup-Titel (`JUICE WRLD`, `.wd-popup-title`) von `var(--wd-font-brand)` (Impact) zu `var(--wd-font-display)` (Baskerville). Das entspricht dem Wordmark-Stil im Hauptfenster (`.wd-header-wordmark`).
- Setze `font-size: 24px`, `letter-spacing: 0.05em`, `font-weight: 700`, `text-shadow: 0 0 18px rgba(217, 72, 255, 0.18), 0 0 40px rgba(73, 182, 255, 0.12)` – identisch mit `.wd-header-wordmark`.
- Entferne `text-transform: uppercase` vom Titel; Baskerville wirkt mit normalem Case eleganter.
- Lass die Kicker-Zeile (`Download Console`) in `var(--wd-font-body)` (Inter), uppercase, kleiner Schrift – das passt zur bestehenden Überlinien-Logik.

**D) Buttons**
- Ersetze die rechteckigen Download-Buttons durch Pill-Buttons: `border-radius: var(--wd-radius-button)` (= 20px).
- Wende auf den MP4-Button den Stil `.wd-primary-button-video` und auf den MP3-Button `.wd-primary-button-audio` aus theme.css an (die Klassen sind bereits in theme.css definiert).

**E) Trennlinien & Cards**
- Ersetze die flat section dividers durch `.wd-section-card`-ähnliche Karten (aus theme.css): `border-radius: var(--wd-radius-card)`, `background: var(--wd-glass-strong)`, `border: 1px solid rgba(255,255,255,0.08)`, `box-shadow: var(--wd-shadow-md)`.

**F) Progressbar**
- Ersetze den 2 px flachen Track durch die runde Progressbar aus theme.css: `height: 12px`, `border-radius: 999px`, Gradient-Fill von `--wd-blue` über `--wd-magenta` zu `--wd-cyan`.

---

## Änderung 2 – SVG-Icons sichtbar machen (Lemonade-Carton & 999)

### Problem
Die beiden SVGs (`assets/juice-carton.svg` und `assets/icon-999.svg`) verwenden **schwarze** Strokes und Fills (`stroke="#000"`, `fill` mit Gradients von `#000` zu `#A5A5A5`). Da der Popup-Hintergrund dunkel ist, sind sie **unsichtbar** (schwarz auf schwarz).

### Was zu ändern ist

**In `assets/juice-carton.svg`:**
- Ändere alle `stroke="#000"` zu `stroke="#ffffff"` (oder `stroke="currentColor"` wenn das SVG in einem Element mit weißer Textfarbe liegt).
- Füge dem SVG-Root `fill="none"` hinzu falls noch nicht vorhanden – alle Pfade sollen nur gestroked sein.

**In `assets/icon-999.svg`:**
- Die drei Zeichen (drei „9"er-Buchstaben) haben `fill="url(#paint0_linear_...)"` Gradienten, die von `#000` (schwarz) zu `#A5A5A5` (grau) gehen – auf dunklem Hintergrund kaum sichtbar.
- Ändere die Gradient-Stops auf **helle Farben**, die zum Farbschema passen:
  ```xml
  <stop offset="0" stop-color="#ffffff"/>
  <stop offset="1" stop-color="rgba(200,180,255,0.85)"/>
  ```
  Alternativ: einen Pink-zu-Cyan Verlauf für mehr Charakter:
  ```xml
  <stop offset="0" stop-color="#ff5ebd"/>
  <stop offset="1" stop-color="#64f3ff"/>
  ```

**Einbindung im Popup (popup.html):**
- Prüfe wo im Popup die SVGs verwendet werden (als `<img src="../assets/...">` oder inline). Stelle sicher dass `<img>` durch inline SVG ersetzt wird, damit `currentColor` und CSS-`filter` greifen können, **oder** verwende CSS `filter: invert(1)` auf den `<img>`-Tags als schnelle Lösung:
  ```css
  .wd-carton-symbol, .wd-nine-nine-nine-img {
    filter: invert(1);
  }
  ```
  Die sauberere Lösung ist jedoch die direkte SVG-Farbanpassung in den SVG-Dateien wie oben beschrieben.

**Inszenierung (Sichtbarkeit im Layout):**
- Stelle sicher dass die Artwork-Sektion (`.wd-atmosphere-art` aus theme.css oder equivalent im Popup) genug Platz bekommt.
- Das `.wd-nine-nine-nine`-Element verwendet aktuell `background-clip: text` mit einem dunklen Gradienten – ändere das zu:
  ```css
  background: linear-gradient(180deg, rgba(255,255,255,0.9), rgba(200,180,255,0.4), rgba(255,255,255,0.06));
  -webkit-background-clip: text;
  color: transparent;
  ```
- Setze auf `.wd-carton-symbol` einen farbigen `drop-shadow`:
  ```css
  filter: drop-shadow(0 0 16px rgba(255, 94, 189, 0.45)) drop-shadow(0 16px 28px rgba(15, 0, 32, 0.5));
  ```

---

## Änderung 3 – Bridge: Download-Ordner auf Desktop fixieren

### Was zu ändern ist in `bridge/server.js`

Ersetze die aktuelle `DOWNLOAD_DIR`-Definition:
```js
// VORHER:
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(os.tmpdir(), 'wavedrop-downloads');
```

durch einen festen Pfad auf den Desktop des aktuellen Benutzers:
```js
// NACHHER:
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR
  || path.join(os.homedir(), 'Desktop', 'Youtube Songs');
```

Außerdem soll der Ordner beim Server-Start **automatisch erstellt werden**, falls er noch nicht existiert (das macht der bestehende Code bereits – stelle sicher dass es weiterhin gilt):
```js
if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}
```

Das `os.homedir()` liefert auf macOS `/Users/<username>` und auf Windows `C:\Users\<username>`, sodass der Pfad systemunabhängig korrekt aufgelöst wird.

**Hinweis:** Wenn der User den Pfad trotzdem überschreiben will, kann er weiterhin die Umgebungsvariable `DOWNLOAD_DIR` setzen – die Logik bleibt unverändert; nur der Fallback-Wert ändert sich.

---

## Änderung 4 – Eingangsanimation verbessern

### Aktueller Zustand
Die Popup-Eingangsanimation (`@keyframes wdPopupEnter`) ist sehr minimal:
```css
@keyframes wdPopupEnter {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to   { opacity: 1; transform: none; }
}
```

### Option A – Verbesserte CSS-Animation (empfohlen)
Ersetze `wdPopupEnter` durch eine mehrstufige Animation mit Tiefe:

```css
@keyframes wdPopupEnter {
  0%   {
    opacity: 0;
    transform: translateY(18px) scale(0.93);
    filter: blur(6px);
  }
  55%  {
    opacity: 1;
    filter: blur(0px);
  }
  72%  {
    transform: translateY(-4px) scale(1.012);
  }
  88%  {
    transform: translateY(2px) scale(0.997);
  }
  100% {
    opacity: 1;
    transform: none;
    filter: blur(0px);
  }
}
```

Passe die Duration auf `480ms` und nutze `cubic-bezier(0.16, 1, 0.3, 1)` (Spring-Kurve):
```css
.wd-popup-surface {
  animation: wdPopupEnter 480ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
```

Ergänze zusätzlich eine gestaffelte Einblendung für Header und Content:
```css
.wd-popup-header {
  animation: wdFadeUp 380ms cubic-bezier(0.16, 1, 0.3, 1) 120ms both;
}
#wd-popup-root {
  animation: wdFadeUp 380ms cubic-bezier(0.16, 1, 0.3, 1) 220ms both;
}

@keyframes wdFadeUp {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: none; }
}
```

### Option B – Externe Animation einfügen (falls selbst erstellt)
Falls du eine Animation mit einem externen Tool (z.B. einer KI) als GIF, WebP-Animation oder CSS-Keyframe-Datei erstellst, kann sie so eingebunden werden:

**Als animiertes GIF/WebP (Ladescreen):**
```html
<!-- In popup.html, vor dem Haupt-Content -->
<div id="wd-splash" class="wd-splash">
  <img src="../assets/splash.gif" alt="" class="wd-splash-img" />
</div>
```
```css
.wd-splash {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: #04020a;
  z-index: 9999;
  animation: wdSplashOut 300ms ease 1.2s forwards;
}
@keyframes wdSplashOut {
  to { opacity: 0; pointer-events: none; }
}
```

**Als externe CSS-Keyframe-Datei:**
```html
<!-- In popup.html im <head> -->
<link rel="stylesheet" href="../assets/splash-animation.css" />
```
Dann kannst du in `splash-animation.css` beliebige `@keyframes` definieren und auf `.wd-popup-surface` anwenden.

---

## Zusammenfassung der geänderten Dateien

| Datei | Was ändert sich |
|---|---|
| `popup/popup.css` | Shell-Background, Glassmorphismus, Schriftart Titel, Button-Radien, Progressbar, Eingangsanimation |
| `popup/popup.html` | macOS Fensterdots im Header, Klassen für neue Buttons |
| `assets/juice-carton.svg` | `stroke="#000"` → `stroke="#ffffff"` |
| `assets/icon-999.svg` | Gradient-Stops von schwarz/grau → weiß/pink-cyan |
| `bridge/server.js` | `DOWNLOAD_DIR` Fallback: `os.tmpdir()/wavedrop-downloads` → `os.homedir()/Desktop/Youtube Songs` |
