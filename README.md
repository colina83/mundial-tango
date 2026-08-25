# Mundial Tango

Unofficial fan companion for **Tango BA Mundial de Baile 2026** results.

Always **Fuente: Tango BA**. Not affiliated with Tango BA or the championship.

v1 tracks **Tango de pista · clasificatorias** (blocks A–D). Quarterfinals, semifinal, final, and Escenario can land later when Tango BA publishes them.

Official source: [Resultados Clasificatoria Tango de Pista 2026](https://tangoba.org/resultados-clasificatoria-tango-de-pista-2026/)

## Requirements

- [Node.js](https://nodejs.org/) **20.11+** (22 LTS is a good default)
- npm (comes with Node)

## Quick start

```bash
git clone https://github.com/colina83/mundial-tango.git
cd mundial-tango
npm install
npm run dev
```

Then open [http://localhost:5173/](http://localhost:5173/).

Seed PDFs (`data/raw/`) and processed JSON (`public/data/results.json`) are in the repo, so **`npm install && npm run dev` is enough**. You do not have to ingest before the first run.

One-shot setup (install + re-parse the local PDFs):

```bash
npm run setup
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm install` | Install dependencies (`package-lock.json` is committed; `npm ci` also works) |
| `npm run setup` | `npm install` then parse the seed PDFs |
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck + production build into `dist/` |
| `npm run preview` or `npm start` | Serve the production build locally |
| `npm run ingest:offline` | Parse PDFs already in `data/raw/` (no network) |
| `npm run ingest` | Fetch [tangoba.org](https://tangoba.org/resultados-clasificatoria-tango-de-pista-2026/), download new **2026** PDFs by hash, then parse |
| `npm run lint` | oxlint |

## Ingest

Official PDFs for the four Pista clasificatoria blocks (A–D, 23–24 Aug 2026) live in `data/raw/`. The parser writes:

- `data/processed/results.json`
- `public/data/results.json` (what the UI loads)

`npm run ingest`:

- Reads the live clasificatorias page (and watches [category/resultados](https://tangoba.org/category/resultados/) for later 2026 posts)
- Collects `.pdf` hrefs from HTML — does not hardcode 2025 filenames; skips `2025` / `CBC25`
- Identifies itself with a project User-Agent, caches by SHA-256, waits between requests

A GitHub Action (`.github/workflows/ingest.yml`) can refresh results every 15 minutes after you enable Actions on the repo.

## Scoring

*Puntuación recortada*: drop one highest and one lowest judge mark, average the rest. Qualification is the **top 50% of each block A–D**, not a global ranking. Pink/red PDF colors cannot be recovered from text — classified flags come from that 50% rule. Spread is max − min of the five marks.

## GitHub Pages

This is a Vite SPA. For a project site at `https://<user>.github.io/mundial-tango/`:

```bash
# Unix
GITHUB_PAGES=true npm run build

# Windows PowerShell
$env:GITHUB_PAGES = "true"; npm run build
```

`vite.config.ts` sets `base` to `/mundial-tango/` when `GITHUB_PAGES=true`. `public/404.html` helps client-side routes on Pages.

## License

[MIT](LICENSE). Competition results remain © Tango BA; this repo only redistributes public PDFs for an unofficial companion.

## Disclaimer

Compañero extraoficial de fans. No afiliado a Tango BA ni al Mundial de Baile. Fuente: [Tango BA](https://tangoba.org/).
