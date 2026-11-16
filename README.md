# EML-Rechner / EML Calculator

**DE** – Ein Taschenrechner mit nur **zwei Tasten** (`1` und `EML`) und einem LCD-Display. Du gibst eine Rechenaufgabe ein, sie erscheint als EML-Programm mehrzeilig im Display, die zwei Tasten „tippen“ es ab, und das Ergebnis steht darunter. PWA (offline nutzbar, installierbar), zweisprachig (Deutsch/Englisch).

**EN** – A calculator with just **two keys** (`1` and `EML`) and an LCD. Type a sum, it shows up as an EML program on the multi-line display, the two keys "type" it in, and the result appears below. PWA (works offline, installable), bilingual (German/English).

**Live:** https://j0hnhaas.github.io/eml-calculator/

## Die Idee / The idea

Nach dem Paper [*All elementary functions from a single operator*](https://arxiv.org/abs/2603.21852) von Andrzej Odrzywołek (arXiv:2603.21852) erzeugt der Operator

```
eml(x, y) = exp(x) − ln(y)
```

zusammen mit der Konstanten `1` die Funktionen eines wissenschaftlichen Taschenrechners. Jeder Ausdruck wird zu einem Binärbaum aus identischen Knoten (`S → 1 | eml(S, S)`), also zu einem Programm für eine Stack-Maschine mit zwei Befehlen:

| Taste | Wirkung |
|-------|---------|
| `1`   | legt eine 1 auf den Stapel |
| `EML` | nimmt `b`, dann `a` vom Stapel und legt `exp(a) − ln(b)` zurück |

Beispiel (aus dem Paper): `ln x = eml(1, eml(eml(1, x), 1))` ist das Programm `1 1 x E 1 E E`.

## Was der Rechner kann / Scope

Zahlen (bis 12 Ziffern, auch Dezimalzahlen), `+ − × ÷ ^`, Klammern, `e`, `ln( )`, `exp( )`. Zahlen werden nur aus `1` aufgebaut, jede Operation durch ihre EML-Formel ersetzt:

```
e      = eml(1, 1)               exp x  = eml(x, 1)
ln x   = eml(1, eml(eml(1, x), 1))
0      = ln 1                    −∞     = ln 0
x − y  = eml(ln x, exp y)        −y     = eml(ln 0, exp y)
x + y  = x − (−y)                1/y    = eml(eml(ln 0, y), 1)
x ÷ y  = eml(eml(ln ln x, y), 1) x × y  = x ÷ (1/y)
x ^ y  = exp(y · ln x)
```

Die Auswertung läuft in komplexer Arithmetik (Hauptwert) mit `ln 0 = −∞`. Extrem große oder kleine Zwischenwerte (`exp(y)` in der Subtraktion!) werden logarithmisch weitergeführt, damit nichts überläuft. Zur Kontrolle wird jede Aufgabe zusätzlich gewöhnlich gerechnet und verglichen.

## Bedienung / Usage

- **Eingabe:** `+ − × ÷ ^`, auch `* / : x`; unter dem Feld steht live, wie viele Tasten das Programm hat (oder was noch fehlt). / Also `* / : x`; a live line shows the program length or what is missing.
- **Tastatur:** `1` und `E` drücken die beiden Tasten (wenn das Eingabefeld nicht aktiv ist). / `1` and `E` press the two keys.
- **Schritt für Schritt:** Programm vor/zurück/automatisch durchgehen, Stapel und Erklärung pro Schritt; die nächste Taste leuchtet und kann selbst gedrückt werden, Pfeiltasten gehen vor und zurück. / Step through the program with the stack and an explanation per step; the next key glows and can be pressed yourself.

## URL-Parameter

| Parameter | Wirkung / Effect |
|-----------|------------------|
| `?lang=de` / `?lang=en` | Sprache / language (wird beim Umschalten automatisch in die URL geschrieben) |
| `?q=2%5E10` | Aufgabe direkt rechnen / run a sum on load |

Beispiel: https://j0hnhaas.github.io/eml-calculator/?lang=en&q=12*(5-2)

## Entwicklung / Development

Kein Build-Schritt, reine statische Dateien (ES-Module).

```bash
npm test                 # Unit- und Fuzz-Tests (Node >= 20)
python3 -m http.server   # dann http://localhost:8000 öffnen
```

| Datei | Inhalt |
|-------|--------|
| `src/eml.js` | Parser, Compiler (Ausdruck → `1`/`E`-Programm), Zwei-Tasten-Stack-Maschine, Formatierung |
| `src/app.js` | Oberfläche: LCD, Tasten, Animation, Eingabe |
| `src/i18n.js` | Deutsche und englische Texte |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA |

Beim Ausliefern einer neuen Version in `sw.js` die `VERSION` erhöhen. Deployment über GitHub Actions (`.github/workflows/pages.yml`): erst Tests, dann GitHub Pages.

## Statistik / Analytics

Die Seite bindet [GoatCounter](https://www.goatcounter.com/) (`j0hnhaas.goatcounter.com`) ein: anonyme, cookiefreie Besucherstatistik. / Anonymous, cookie-free visitor statistics.

## Quellen / Sources

- A. Odrzywołek, *All elementary functions from a single operator*, [arXiv:2603.21852](https://arxiv.org/abs/2603.21852)
- Video: https://youtu.be/LxVW3b8jVdE

Unabhängige Umsetzung, nicht vom Autor des Papers. / Independent implementation, not by the paper's author.

## Lizenz / License

MIT, siehe [LICENSE](LICENSE).
