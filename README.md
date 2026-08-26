# PULSO · Mundial de Tango

Unofficial fan companion for **Tango BA Mundial de Baile 2026** results, published under the **PULSO** brand.

Always **Fuente: Tango BA**. Not affiliated with Tango BA or the championship.

v1 tracks **Tango de pista · clasificatorias** (blocks A–D). The pipeline is now multi-stage: as Tango BA publishes cuartos, semifinal, and final results, the app detects and ingests them automatically — no manual code changes required for each new stage.

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

Seed PDFs (`data/raw/clasificatoria/`) and processed JSON (`public/data/results.json`, `public/data/results-clasificatoria.json`, `public/data/manifest.json`) are in the repo, so **`npm install && npm run dev` is enough**. You do not have to ingest before the first run.

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
| `npm run survival` | Fit stage-survival odds from 2024–2025 clasificatoria JSON into `public/data/survival.json` |
| `npm run lint` | oxlint |

## Ingest

### Multi-stage pipeline

The ingest pipeline supports all four stages: `clasificatoria`, `cuartos`, `semifinal`, and `final`. Source URLs are configured in `STAGE_SOURCES` in `scripts/ingest.ts`. Placeholder URLs for cuartos/semifinal/final follow the same URL pattern as clasificatoria — update them once Tango BA publishes the real links.

`npm run ingest` for each configured stage:

1. Fetches the stage's source page to discover PDF links
2. If the page returns 404 or has no PDFs, **skips the stage gracefully** (logs and continues)
3. Logs **"detected for the first time"** the first time a new stage's results appear
4. Downloads PDFs identified by SHA-256 hash into `data/raw/{stage}/` (no re-downloads of unchanged files)
5. Parses PDFs and writes:
   - `data/processed/results-{stage}.json`
   - `public/data/results-{stage}.json`
6. Updates `public/data/manifest.json` listing which stages have data and their timestamps
7. Keeps `public/data/results.json` / `data/processed/results.json` as the backward-compatible clasificatoria file

### Stage-awareness in the frontend

The frontend loads `manifest.json` on startup to discover which stages are available. A stage-switching tab bar appears at the top; stages with no data yet are shown as disabled. Switching stages reloads the corresponding dataset.

### Source index caching

`data/processed/source-index.json` uses namespaced keys (`{stage}::{url}`) to track downloaded PDFs per stage, avoiding hash collisions between stages.

`npm run ingest`:

- Checks each stage's source page — cheap HEAD/link discovery before any heavy parsing
- Identifies itself with a project User-Agent, caches by SHA-256, waits between requests

A GitHub Action (`.github/workflows/ingest.yml`) refreshes results every 15 minutes after you enable Actions on the repo. The workflow logs a summary of which stages were checked, unchanged, or had new data.

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

## Deploy (Vercel)

This app is a **static Vite SPA**. Host it on **Vercel** as its own project so it does not mix with other PULSO/Railway apps.

**Project name:** `pulso-mundial-tango` (new, isolated — not linked to any existing Vercel or Railway service).

Railway is **not** used here: there is no Node server or worker to run. A Railway service would be unused and could collide with other work.

On **Windows PowerShell**, `npx` may fail with `PSSecurityException` (scripts disabled). Do not change the machine ExecutionPolicy. Use `cmd` or `npx.cmd`:

```bat
cmd /c "npx vercel whoami"
cmd /c "npx vercel login"
cmd /c "npx vercel --yes --prod"
```

Or:

```bat
"C:\Program Files\nodejs\npx.cmd" vercel whoami
"C:\Program Files\nodejs\npx.cmd" vercel login
"C:\Program Files\nodejs\npx.cmd" vercel --yes --prod
```

That creates/uses the isolated **pulso-mundial-tango** project. Do not `vercel link` this folder to another existing app.

`vercel.json` builds with `npm run build` and serves `dist/`, with SPA rewrites so client routes (rankings, couple dossiers) do not 404.

GitHub auto-deploy: in the Vercel dashboard, import **this** repo (`colina83/mundial-tango`) into the **pulso-mundial-tango** project only. Do not attach it to another existing project.

## License

[MIT](LICENSE). Competition results remain © Tango BA; this repo only redistributes public PDFs for an unofficial companion.

## Disclaimer

Compañero extraoficial de fans. No afiliado a Tango BA ni al Mundial de Baile. Fuente: [Tango BA](https://tangoba.org/).
