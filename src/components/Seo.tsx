import { useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useI18n } from "../context/I18nContext";
import {
  buildSeoMetadata,
  parseSeoRoute,
  SITE_ORIGIN,
  type SeoInput,
} from "../lib/seo";

type SeoProps = Partial<
  Pick<SeoInput, "view" | "year" | "category" | "stage" | "coupleId" | "dancer1" | "dancer2">
>;

function upsertMeta(selector: string, attributes: Record<string, string>, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement("meta");
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    document.head.append(element);
  }
  element.content = content;
}

function upsertLink(
  selector: string,
  attributes: Record<string, string>,
  href: string,
) {
  let element = document.head.querySelector<HTMLLinkElement>(selector);
  if (!element) {
    element = document.createElement("link");
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    document.head.append(element);
  }
  element.href = href;
}

export function Seo(props: SeoProps = {}) {
  const location = useLocation();
  const { lang } = useI18n();
  const { view, year, category, stage, coupleId, dancer1, dancer2 } = props;
  const metadata = useMemo(() => {
    const route = parseSeoRoute(location.pathname);
    return buildSeoMetadata({
      ...route,
      view: view ?? route.view,
      year: year ?? route.year,
      category: category ?? route.category,
      stage,
      coupleId: coupleId ?? route.coupleId,
      dancer1,
      dancer2,
      lang,
    });
  }, [category, coupleId, dancer1, dancer2, lang, location.pathname, stage, view, year]);

  useEffect(() => {
    document.title = metadata.title;
    document.documentElement.lang = lang;
    upsertMeta('meta[name="description"]', { name: "description" }, metadata.description);
    upsertMeta('meta[name="robots"]', { name: "robots" }, metadata.robots);
    upsertMeta('meta[property="og:type"]', { property: "og:type" }, "website");
    upsertMeta('meta[property="og:site_name"]', { property: "og:site_name" }, "PULSO");
    upsertMeta('meta[property="og:title"]', { property: "og:title" }, metadata.title);
    upsertMeta(
      'meta[property="og:description"]',
      { property: "og:description" },
      metadata.description,
    );
    upsertMeta('meta[property="og:url"]', { property: "og:url" }, metadata.canonical);
    upsertMeta(
      'meta[property="og:image"]',
      { property: "og:image" },
      `${SITE_ORIGIN}/social-card.png`,
    );
    upsertMeta('meta[name="twitter:card"]', { name: "twitter:card" }, "summary_large_image");
    upsertMeta('meta[name="twitter:title"]', { name: "twitter:title" }, metadata.title);
    upsertMeta(
      'meta[name="twitter:description"]',
      { name: "twitter:description" },
      metadata.description,
    );
    upsertMeta(
      'meta[name="twitter:image"]',
      { name: "twitter:image" },
      `${SITE_ORIGIN}/social-card.png`,
    );
    upsertLink('link[rel="canonical"]', { rel: "canonical" }, metadata.canonical);
    for (const [hreflang, href] of Object.entries(metadata.alternates)) {
      upsertLink(
        `link[rel="alternate"][hreflang="${hreflang}"]`,
        { rel: "alternate", hreflang },
        href,
      );
    }
    let script = document.head.querySelector<HTMLScriptElement>("#seo-json-ld");
    if (!script) {
      script = document.createElement("script");
      script.id = "seo-json-ld";
      script.type = "application/ld+json";
      document.head.append(script);
    }
    script.textContent = JSON.stringify(metadata.jsonLd).replaceAll("<", "\\u003c");
  }, [lang, metadata]);

  return null;
}
