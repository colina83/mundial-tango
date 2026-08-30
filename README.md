# PULSO · Mundial de Tango

Unofficial fan companion for **Tango BA Mundial de Baile 2026** results, published under the **PULSO** brand.

Always **Fuente: Tango BA**. Not affiliated with Tango BA or the championship.

v1 tracks **Tango de pista** and **Tango escenario**, 2024–2026. Each category has the same screens (dashboard, rankings, stats, couple dossier). The pipeline is multi-stage: as Tango BA publishes cuartos, semifinal, and final results, the app detects and ingests them automatically — no manual code changes required for each new stage.

Official sources: [Pista clasificatoria 2026](https://tangoba.org/resultados-clasificatoria-tango-de-pista-2026/) · [Escenario clasificatoria 2026](https://tangoba.org/resultados-clasificatoria-tango-escenario-2026/)

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
| `npm test` | Run ingest and anonymous Top 3 validation/aggregation tests |

## Ingest

### Multi-stage pipeline

The ingest pipeline supports all four stages: `clasificatoria`, `cuartos`, `semifinal`, and `final`. Source URLs are configured in `STAGE_SOURCES` in `scripts/ingest.ts`. Placeholder URLs for cuartos/semifinal/final follow the same URL pattern as clasificatoria — update them once Tango BA publishes the real links.

`npm run ingest` for each configured stage:

1. Fetches the stage's source page to discover PDF links
2. If the page returns 404 or has no PDFs, **skips the stage gracefully** (logs and continues)
3. Logs **"detected for the first time"** the first time a new stage's results appear
4. Downloads PDFs identified by SHA-256 hash into `data/raw/{stage}/` (pista) or `data/raw/escenario/{stage}/` (escenario)
5. Parses PDFs and writes:
   - Pista: `public/data/{year}/results-{stage}.json` (plus legacy `public/data/results-*.json` for 2026)
   - Escenario: `public/data/{year}/escenario/results-{stage}.json`
6. Updates each category's `manifest.json` and `catalog.json` (year + category entries)
7. Fits **separate** survival models — pista odds never reuse escenario data, and vice versa

### Stage-awareness in the frontend

The frontend loads `manifest.json` on startup to discover which stages are available. A stage-switching tab bar appears at the top; stages with no data yet are shown as disabled. Switching stages reloads the corresponding dataset.

### Source index caching

`data/processed/source-index.json` uses namespaced keys (`{stage}::{url}`) to track downloaded PDFs per stage, avoiding hash collisions between stages.

`npm run ingest`:

- Checks each stage's source page — cheap HEAD/link discovery before any heavy parsing
- Identifies itself with a project User-Agent, caches by SHA-256, waits between requests

A GitHub Action (`.github/workflows/ingest.yml`) refreshes results every 15 minutes after you enable Actions on the repo. The workflow logs a summary of which stages were checked, unchanged, or had new data.

## Scoring

*Puntuación recortada*: drop one highest and one lowest judge mark, average the rest. Qualification is the **official PDF row highlight** (rosa / violeta) in each block A–D, not a global ranking. Dropped high/low marks use a different cell tint and are ignored. Spread is max − min of the five marks.

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

### Community Top 3 setup

The 2026 Pista and Escenario pages include separate, anonymous community Top 3 ballots. This feature needs Vercel Functions, Upstash Redis, and Cloudflare Turnstile; the static GitHub Pages build can display the rest of the site but cannot accept ballots.

1. Add an Upstash Redis integration to the Vercel project. No schema or migration is required.
2. Create a Turnstile widget for the production domain.
3. Configure these Vercel environment variables:

```text
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
PICKS_HASH_SECRET=<at least 32 random characters>
TURNSTILE_SECRET_KEY=<server-side Turnstile secret>
VITE_TURNSTILE_SITE_KEY=<public Turnstile site key>
PICKS_IP_DAILY_LIMIT=3
PICKS_CLOSE_AT_PISTA=2026-08-30T23:00:00-03:00
PICKS_CLOSE_AT_ESCENARIO=2026-08-31T23:00:00-03:00
```

Close times are optional ISO timestamps and are independent by category. Set `PICKS_ENABLED=false` and `VITE_ENABLE_TOP3=false` for an emergency rollback, then redeploy.

Ballots are immutable JSON objects containing the submitted name, country, and optional tango community. Public API responses expose only aggregate couple totals; raw IP addresses are never stored. The server stores an HMAC of the IP for a 24-hour rate limit and an HMAC of the normalized identity for duplicate detection. An HttpOnly browser token lets the original browser see its submitted ballot, but submitted ballots cannot be changed. After the event, delete the `top3:*` Redis keys according to the desired retention policy.

## License

[MIT](LICENSE). Competition results remain © Tango BA; this repo only redistributes public PDFs for an unofficial companion.

## Disclaimer

Compañero extraoficial de fans. No afiliado a Tango BA ni al Mundial de Baile. Fuente: [Tango BA](https://tangoba.org/).
