import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LOCALE,
  localeFromPath,
  localizedBasename,
  localizedPath,
} from "../src/lib/locale.ts";
import {
  buildSeoMetadata,
  parseSeoRoute,
} from "../src/lib/seo.ts";
import {
  renderSeoHtml,
  renderSitemap,
  type GeneratedRoute,
} from "./generate-seo.ts";

test("localized routes preserve paths on Vercel and GitHub Pages", () => {
  assert.equal(DEFAULT_LOCALE, "en");
  assert.equal(localeFromPath("/es/2026/pista", "/"), "es");
  assert.equal(localeFromPath("/mundial-tango/en/2025/escenario", "/mundial-tango/"), "en");
  assert.equal(localizedBasename("/", "/es/2026/pista"), "/es");
  assert.equal(
    localizedBasename("/mundial-tango/", "/mundial-tango/en/2026/pista"),
    "/mundial-tango/en",
  );
  assert.equal(localizedPath("/en/2026/pista/rankings", "es"), "/es/2026/pista/rankings");
});

test("SEO metadata provides bilingual canonicals and useful search terms", () => {
  const route = parseSeoRoute("/es/2026/escenario/rankings?sort=average");
  const metadata = buildSeoMetadata({ ...route, lang: "es", stage: "semifinal" });
  assert.match(metadata.title, /Ranking y puntajes/);
  assert.match(metadata.title, /Tango Escenario/);
  assert.equal(
    metadata.canonical,
    "https://pulso-mundial-tango.vercel.app/es/2026/escenario/rankings",
  );
  assert.equal(
    metadata.alternates.en,
    "https://pulso-mundial-tango.vercel.app/en/2026/escenario/rankings",
  );
  assert.equal(metadata.robots, "index, follow, max-image-preview:large");
});

test("private picks and watchlists are excluded from indexing", () => {
  for (const view of ["picks", "watchlist"] as const) {
    const metadata = buildSeoMetadata({
      lang: "en",
      appPath: `/2026/pista/${view}`,
      view,
      year: 2026,
      category: "pista",
    });
    assert.equal(metadata.robots, "noindex, nofollow");
  }
});

test("static HTML includes escaped metadata, hreflang and JSON-LD", () => {
  const metadata = buildSeoMetadata({
    lang: "en",
    appPath: "/2026/pista/pareja/A/7",
    view: "couple",
    year: 2026,
    category: "pista",
    coupleId: 7,
    dancer1: "A <script>",
    dancer2: "B & C",
  });
  const route: GeneratedRoute = {
    path: "/en/2026/pista/pareja/A/7",
    appPath: "/2026/pista/pareja/A/7",
    lang: "en",
    view: "couple",
    lastmod: "2026-08-30T00:00:00Z",
    metadata,
    body: "<article><h1>Safe body</h1></article>",
  };
  const template =
    '<!doctype html><html lang="en"><head><meta name="description" content="old"><!-- SEO_DEFAULTS_START --><!-- SEO_DEFAULTS_END --><title>Old</title></head><body><div id="root"></div></body></html>';
  const html = renderSeoHtml(template, route);
  assert.match(html, /A &lt;script&gt; &amp; B &amp; C/);
  assert.match(html, /hreflang="es"/);
  assert.match(html, /application\/ld\+json/);
  assert.doesNotMatch(html, /<title>A <script>/);
});

test("sitemap contains canonical localized URLs and modification dates", () => {
  const metadata = buildSeoMetadata({
    lang: "en",
    appPath: "/2026/pista",
    view: "dashboard",
    year: 2026,
    category: "pista",
  });
  const xml = renderSitemap([
    {
      path: "/en/2026/pista",
      appPath: "/2026/pista",
      lang: "en",
      view: "dashboard",
      lastmod: "2026-08-30T00:00:00Z",
      metadata,
      body: "",
    },
  ]);
  assert.match(xml, /https:\/\/pulso-mundial-tango\.vercel\.app\/en\/2026\/pista/);
  assert.match(xml, /2026-08-30T00:00:00Z/);
});
