import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSeoMetadata,
  localizedSeoPath,
  SITE_ORIGIN,
  type SeoInput,
  type SeoView,
} from "../src/lib/seo.ts";
import type {
  CatalogYear,
  Category,
  Dataset,
  ScoreRow,
  Stage,
  YearCatalog,
} from "../src/types.ts";
import type { SupportedLocale } from "../src/lib/locale.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const DATA = join(ROOT, "public", "data");
const LANGS: readonly SupportedLocale[] = ["en", "es"];

export type GeneratedRoute = {
  path: string;
  appPath: string;
  lang: SupportedLocale;
  view: SeoView;
  lastmod: string;
  metadata: ReturnType<typeof buildSeoMetadata>;
  body: string;
};

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeXml(value: string): string {
  return escapeHtml(value);
}

function categoryLabel(category: Category, lang: SupportedLocale): string {
  if (lang === "es") return category === "pista" ? "Tango de Pista" : "Tango Escenario";
  return category === "pista" ? "Tango de Pista" : "Tango Escenario (Stage Tango)";
}

function stageLabel(stage: Stage, lang: SupportedLocale): string {
  const labels: Record<SupportedLocale, Record<Stage, string>> = {
    en: {
      clasificatoria: "Qualifying",
      cuartos: "Quarterfinals",
      semifinal: "Semifinals",
      final: "Final",
    },
    es: {
      clasificatoria: "Clasificatoria",
      cuartos: "Cuartos de final",
      semifinal: "Semifinal",
      final: "Final",
    },
  };
  return labels[lang][stage];
}

function resultPath(entry: CatalogYear, stage: Stage): string {
  const category = entry.category ?? "pista";
  return category === "escenario"
    ? join(DATA, String(entry.year), "escenario", `results-${stage}.json`)
    : join(DATA, String(entry.year), `results-${stage}.json`);
}

async function loadDataset(entry: CatalogYear, stage: Stage): Promise<Dataset> {
  return JSON.parse(await readFile(resultPath(entry, stage), "utf8")) as Dataset;
}

function latestStage(entry: CatalogYear): Stage {
  const stages = entry.stages.filter((stage) => (entry.rowCounts?.[stage] ?? 0) > 0);
  return stages[stages.length - 1] ?? "clasificatoria";
}

function couplePath(row: ScoreRow): string {
  return `pareja/${row.blockId}/${row.coupleId}`;
}

function snapshotHeader(metadata: GeneratedRoute["metadata"], lang: SupportedLocale): string {
  return `<header><strong>PULSO</strong><p>${escapeHtml(metadata.description)}</p><nav><a href="/${lang}/">${lang === "es" ? "Ediciones" : "Editions"}</a></nav></header>`;
}

function rowList(
  rows: ScoreRow[],
  basePath: string,
  lang: SupportedLocale,
  limit = 25,
): string {
  return `<ol>${[...rows]
    .sort((a, b) => a.rankOverall - b.rankOverall)
    .slice(0, limit)
    .map(
      (row) =>
        `<li><a href="${localizedSeoPath(`${basePath}/${couplePath(row)}`, lang)}">${escapeHtml(row.dancer1)} &amp; ${escapeHtml(row.dancer2)}</a> — #${row.coupleId}, ${lang === "es" ? "puesto" : "rank"} ${row.rankOverall}, ${lang === "es" ? "promedio" : "average"} ${row.average.toFixed(3)}</li>`,
    )
    .join("")}</ol>`;
}

function breadcrumbJsonLd(
  input: SeoInput,
  category: Category,
): Record<string, unknown> {
  const lang = input.lang;
  const appPath = `/${input.year}/${category}`;
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: lang === "es" ? "Ediciones" : "Editions",
        item: `${SITE_ORIGIN}/${lang}/`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: `${categoryLabel(category, lang)} ${input.year}`,
        item: `${SITE_ORIGIN}${localizedSeoPath(appPath, lang)}`,
      },
    ],
  };
}

function routeHead(route: GeneratedRoute): string {
  const metadata = route.metadata;
  const jsonLd = JSON.stringify(metadata.jsonLd).replaceAll("<", "\\u003c");
  return [
    `<meta name="robots" content="${metadata.robots}">`,
    `<link rel="canonical" href="${metadata.canonical}">`,
    `<link rel="alternate" hreflang="en" href="${metadata.alternates.en}">`,
    `<link rel="alternate" hreflang="es" href="${metadata.alternates.es}">`,
    `<link rel="alternate" hreflang="x-default" href="${metadata.alternates["x-default"]}">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="PULSO">',
    `<meta property="og:title" content="${escapeHtml(metadata.title)}">`,
    `<meta property="og:description" content="${escapeHtml(metadata.description)}">`,
    `<meta property="og:url" content="${metadata.canonical}">`,
    `<meta property="og:image" content="${SITE_ORIGIN}/social-card.png">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${escapeHtml(metadata.title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(metadata.description)}">`,
    `<meta name="twitter:image" content="${SITE_ORIGIN}/social-card.png">`,
    `<script type="application/ld+json" id="seo-json-ld">${jsonLd}</script>`,
  ].join("\n    ");
}

export function renderSeoHtml(template: string, route: GeneratedRoute): string {
  return template
    .replace(/<html lang="[^"]*">/, `<html lang="${route.lang}">`)
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(route.metadata.title)}</title>`)
    .replace(
      /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/m,
      `<meta name="description" content="${escapeHtml(route.metadata.description)}" />`,
    )
    .replace(
      /<!-- SEO_DEFAULTS_START -->[\s\S]*?<!-- SEO_DEFAULTS_END -->/,
      routeHead(route),
    )
    .replace(
      '<div id="root"></div>',
      `<div id="root"><main class="seo-snapshot">${snapshotHeader(route.metadata, route.lang)}${route.body}</main></div>`,
    );
}

async function writeRoute(template: string, route: GeneratedRoute): Promise<void> {
  const target = join(DIST, route.path.replace(/^\/+|\/+$/g, ""), "index.html");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, renderSeoHtml(template, route));
}

function makeRoute(
  lang: SupportedLocale,
  appPath: string,
  view: SeoView,
  lastmod: string,
  body: string,
  extra: Partial<SeoInput> = {},
): GeneratedRoute {
  const input: SeoInput = { lang, appPath, view, ...extra };
  return {
    path: localizedSeoPath(appPath, lang),
    appPath,
    lang,
    view,
    lastmod,
    metadata: buildSeoMetadata(input),
    body,
  };
}

async function routesFromData(catalog: YearCatalog): Promise<GeneratedRoute[]> {
  const routes: GeneratedRoute[] = [];
  for (const lang of LANGS) {
    const landingBody = `<section><h1>${lang === "es" ? "Resultados del Mundial de Tango" : "Tango World Championship Results"}</h1><p>${lang === "es" ? "Rankings y puntajes de Tango de Pista y Tango Escenario para 2026, 2025 y 2024." : "Tango de Pista and Stage Tango rankings and scores for 2026, 2025 and 2024."}</p><ul>${catalog.years
      .map((entry) => {
        const category = entry.category ?? "pista";
        return `<li><a href="${localizedSeoPath(`/${entry.year}/${category}`, lang)}">${categoryLabel(category, lang)} ${entry.year}</a></li>`;
      })
      .join("")}</ul></section>`;
    routes.push(makeRoute(lang, "/", "landing", catalog.updatedAt, landingBody));

    for (const entry of catalog.years) {
      const category = entry.category ?? "pista";
      const stage = latestStage(entry);
      const dataset = await loadDataset(entry, stage);
      const appBase = `/${entry.year}/${category}`;
      const labels = entry.stages
        .filter((item) => (entry.rowCounts?.[item] ?? 0) > 0)
        .map((item) => stageLabel(item, lang))
        .join(", ");
      const common = {
        year: entry.year,
        category,
        stage,
      } satisfies Partial<SeoInput>;
      const heading = `${categoryLabel(category, lang)} ${entry.year}`;
      const dashboardBody = `<article><h1>${escapeHtml(heading)} — ${stageLabel(stage, lang)} ${lang === "es" ? "resultados" : "results"}</h1><p>${lang === "es" ? "Resultados disponibles" : "Available results"}: ${escapeHtml(labels)}. ${dataset.rows.length} ${lang === "es" ? "parejas en la instancia actual" : "couples in the current stage"}.</p><nav><a href="${localizedSeoPath(`${appBase}/rankings`, lang)}">${lang === "es" ? "Ranking y puntajes" : "Rankings and scores"}</a> · <a href="${localizedSeoPath(`${appBase}/full`, lang)}">${lang === "es" ? "Competencia completa" : "Full competition"}</a> · <a href="${localizedSeoPath(`${appBase}/stats`, lang)}">${lang === "es" ? "Estadísticas" : "Statistics"}</a></nav><h2>${lang === "es" ? "Primeras posiciones" : "Top placements"}</h2>${rowList(dataset.rows, appBase, lang, 10)}<p><a href="${escapeHtml(dataset.sourcePage)}" rel="nofollow">${lang === "es" ? "Fuente oficial: Tango BA" : "Official source: Tango BA"}</a></p></article>`;
      routes.push(
        makeRoute(lang, appBase, "dashboard", dataset.generatedAt, dashboardBody, common),
      );

      const ranked = [...dataset.rows].sort((a, b) => a.rankOverall - b.rankOverall);
      const rankingBody = `<article><h1>${lang === "es" ? "Ranking y puntajes" : "Rankings and scores"} — ${escapeHtml(heading)} ${stageLabel(stage, lang)}</h1><p>${ranked.length} ${lang === "es" ? "parejas, ordenadas por resultado" : "couples ordered by result"}.</p>${rowList(ranked, appBase, lang)}</article>`;
      const rankingRoute = makeRoute(
        lang,
        `${appBase}/rankings`,
        "rankings",
        dataset.generatedAt,
        rankingBody,
        common,
      );
      rankingRoute.metadata.jsonLd.push(
        breadcrumbJsonLd({ lang, appPath: appBase, view: "rankings", ...common }, category),
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: rankingRoute.metadata.title,
          itemListElement: ranked.slice(0, 25).map((row, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: `${row.dancer1} & ${row.dancer2}`,
            url: `${SITE_ORIGIN}${localizedSeoPath(`${appBase}/${couplePath(row)}`, lang)}`,
          })),
        },
      );
      routes.push(rankingRoute);

      routes.push(
        makeRoute(
          lang,
          `${appBase}/stats`,
          "stats",
          dataset.generatedAt,
          `<article><h1>${lang === "es" ? "Estadísticas de puntajes y jurados" : "Scores and judge statistics"} — ${escapeHtml(heading)}</h1><p>${dataset.rows.length} ${lang === "es" ? "parejas evaluadas" : "evaluated couples"}; ${dataset.blocks.length} ${lang === "es" ? "bloques publicados" : "published blocks"}.</p></article>`,
          common,
        ),
        makeRoute(
          lang,
          `${appBase}/full`,
          "full",
          dataset.generatedAt,
          `<article><h1>${lang === "es" ? "Competencia completa" : "Full competition"} — ${escapeHtml(heading)}</h1><p>${lang === "es" ? "Recorrido de las parejas por clasificatoria, cuartos de final, semifinal y final." : "Couple journeys through qualifying, quarterfinals, semifinals and the final."}</p>${rowList(dataset.rows, appBase, lang)}</article>`,
          common,
        ),
      );

      const seen = new Set<string>();
      for (const row of ranked) {
        const key = `${row.blockId}:${row.coupleId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const path = `${appBase}/${couplePath(row)}`;
        const names = `${row.dancer1} & ${row.dancer2}`;
        routes.push(
          makeRoute(
            lang,
            path,
            "couple",
            dataset.generatedAt,
            `<article><h1>${escapeHtml(names)}</h1><p>${lang === "es" ? "Pareja" : "Couple"} #${row.coupleId} · ${escapeHtml(heading)} · ${stageLabel(stage, lang)}</p><dl><dt>${lang === "es" ? "Puesto" : "Rank"}</dt><dd>${row.rankOverall}</dd><dt>${lang === "es" ? "Promedio" : "Average"}</dt><dd>${row.average.toFixed(3)}</dd><dt>${lang === "es" ? "Estado" : "Status"}</dt><dd>${row.classified ? (lang === "es" ? "Clasificada" : "Qualified") : lang === "es" ? "No clasificada" : "Not qualified"}</dd></dl><p><a href="${localizedSeoPath(`${appBase}/rankings`, lang)}">${lang === "es" ? "Volver al ranking" : "Back to rankings"}</a></p></article>`,
            {
              ...common,
              coupleId: row.coupleId,
              dancer1: row.dancer1,
              dancer2: row.dancer2,
            },
          ),
        );
      }
    }
  }
  return routes;
}

export function renderSitemap(routes: GeneratedRoute[]): string {
  const urls = routes
    .map(
      (route) =>
        `  <url><loc>${escapeXml(`${SITE_ORIGIN}${route.path}`)}</loc><lastmod>${escapeXml(route.lastmod)}</lastmod><changefreq>${route.view === "landing" ? "daily" : "hourly"}</changefreq></url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export async function generateSeo(): Promise<GeneratedRoute[]> {
  const [template, catalog] = await Promise.all([
    readFile(join(DIST, "index.html"), "utf8"),
    readFile(join(DATA, "catalog.json"), "utf8").then(
      (value) => JSON.parse(value) as YearCatalog,
    ),
  ]);
  const routes = await routesFromData(catalog);
  await Promise.all(routes.map((route) => writeRoute(template, route)));
  await writeFile(join(DIST, "sitemap.xml"), renderSitemap(routes));
  await writeFile(
    join(DIST, "robots.txt"),
    `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /data/\nDisallow: /*?*\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`,
  );
  console.log(`Generated ${routes.length} localized SEO pages.`);
  return routes;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateSeo().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
