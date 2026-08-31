import type { Category, Stage } from "../types";
import type { SupportedLocale } from "./locale";

export const SITE_ORIGIN = "https://pulso-mundial-tango.vercel.app";
export const SITE_NAME = "PULSO · Mundial de Tango";

export type SeoView =
  | "landing"
  | "dashboard"
  | "rankings"
  | "stats"
  | "full"
  | "couple"
  | "picks"
  | "watchlist";

export interface SeoInput {
  lang: SupportedLocale;
  appPath: string;
  view: SeoView;
  year?: number;
  category?: Category;
  stage?: Stage;
  coupleId?: number;
  dancer1?: string;
  dancer2?: string;
}

export interface SeoMetadata {
  title: string;
  description: string;
  canonical: string;
  alternates: Record<SupportedLocale | "x-default", string>;
  robots: string;
  jsonLd: Record<string, unknown>[];
}

const stageNames: Record<SupportedLocale, Record<Stage, string>> = {
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

function categoryName(category: Category, lang: SupportedLocale): string {
  if (lang === "es") {
    return category === "pista" ? "Tango de Pista" : "Tango Escenario";
  }
  return category === "pista" ? "Tango de Pista" : "Tango Escenario (Stage Tango)";
}

export function normalizeAppPath(pathname: string): string {
  const withoutLocale = pathname.replace(/^\/(?:en|es)(?=\/|$)/, "");
  const clean = withoutLocale.split(/[?#]/, 1)[0]?.replace(/\/+/g, "/") || "/";
  return clean.startsWith("/") ? clean : `/${clean}`;
}

export function localizedSeoPath(
  appPath: string,
  lang: SupportedLocale,
): string {
  const clean = normalizeAppPath(appPath).replace(/^\/+/, "");
  return `/${lang}/${clean}`.replace(/\/+/g, "/");
}

export function parseSeoRoute(pathname: string): Omit<SeoInput, "lang"> {
  const appPath = normalizeAppPath(pathname);
  const parts = appPath.split("/").filter(Boolean);
  const year = /^\d{4}$/.test(parts[0] ?? "") ? Number(parts[0]) : undefined;
  const category =
    parts[1] === "pista" || parts[1] === "escenario" ? parts[1] : undefined;
  const tail = parts[2];
  const view: SeoView =
    tail === "rankings"
      ? "rankings"
      : tail === "stats"
        ? "stats"
        : tail === "full"
          ? "full"
          : tail === "pareja"
            ? "couple"
            : tail === "picks"
              ? "picks"
              : tail === "watchlist"
                ? "watchlist"
                : year && category
                  ? "dashboard"
                  : "landing";
  return {
    appPath,
    view,
    year,
    category,
    coupleId: view === "couple" ? Number(parts[4]) || undefined : undefined,
  };
}

function pageCopy(input: SeoInput): { title: string; description: string } {
  const { lang, year = 2026, category = "pista", stage, view } = input;
  const cat = categoryName(category, lang);
  const stageName = stage ? stageNames[lang][stage] : null;
  const context = stageName ? `${stageName} · ${cat} ${year}` : `${cat} ${year}`;

  if (view === "landing") {
    return lang === "es"
      ? {
          title: "Resultados Mundial de Tango 2026 y archivo | PULSO",
          description:
            "Resultados, rankings, puntajes y parejas del Mundial de Tango BA 2026, 2025 y 2024 para Tango de Pista y Tango Escenario.",
        }
      : {
          title: "Tango World Championship Results 2026 & Archive | PULSO",
          description:
            "Tango BA World Championship results, rankings, scores and couples for 2026, 2025 and 2024 in Tango de Pista and Stage Tango.",
        };
  }

  if (view === "couple" && input.dancer1 && input.dancer2) {
    const names = `${input.dancer1} & ${input.dancer2}`;
    return lang === "es"
      ? {
          title: `${names} · Pareja #${input.coupleId} · ${context}`,
          description: `Puntajes, puesto y recorrido de ${names}, pareja #${input.coupleId}, en ${context} del Mundial de Tango BA.`,
        }
      : {
          title: `${names} · Couple #${input.coupleId} · ${context}`,
          description: `Scores, ranking and stage history for ${names}, couple #${input.coupleId}, in the Tango BA World Championship ${context}.`,
        };
  }

  const labels: Record<Exclude<SeoView, "landing" | "couple">, [string, string]> = {
    dashboard: ["Resultados", "Results"],
    rankings: ["Ranking y puntajes", "Rankings and scores"],
    stats: ["Estadísticas de jurados", "Judge statistics"],
    full: ["Competencia completa", "Full competition"],
    picks: ["Top 3 de la comunidad", "Community Top 3"],
    watchlist: ["Parejas guardadas", "Saved couples"],
  };
  const label = labels[view === "couple" ? "dashboard" : view][lang === "es" ? 0 : 1];
  return lang === "es"
    ? {
        title: `${label} ${context} | Mundial de Tango`,
        description: `${label} de ${context}: parejas, puestos y puntajes del Mundial de Tango BA. Fuente Tango BA; sitio de fans no oficial.`,
      }
    : {
        title: `${context} ${label} | Tango World Championship`,
        description: `${context} ${label.toLowerCase()}: couples, placements and scores from the Tango BA World Championship. Unofficial fan tracker.`,
      };
}

export function buildSeoMetadata(input: SeoInput): SeoMetadata {
  const appPath = normalizeAppPath(input.appPath);
  const copy = pageCopy({ ...input, appPath });
  const en = `${SITE_ORIGIN}${localizedSeoPath(appPath, "en")}`;
  const es = `${SITE_ORIGIN}${localizedSeoPath(appPath, "es")}`;
  const canonical = input.lang === "es" ? es : en;
  const noindex = input.view === "picks" || input.view === "watchlist";
  const jsonLd: Record<string, unknown>[] = [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE_NAME,
      url: SITE_ORIGIN,
      inLanguage: ["en", "es"],
    },
  ];

  if (input.year && input.category && !noindex) {
    jsonLd.push({
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: copy.title,
      description: copy.description,
      url: canonical,
      inLanguage: input.lang,
      temporalCoverage: String(input.year),
      isBasedOn: "https://tangoba.org/category/resultados/",
      creator: {
        "@type": "Organization",
        name: "Tango BA",
        url: "https://tangoba.org/",
      },
      publisher: {
        "@type": "Organization",
        name: "PULSO",
        url: SITE_ORIGIN,
      },
    });
  }

  return {
    ...copy,
    canonical,
    alternates: { en, es, "x-default": en },
    robots: noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large",
    jsonLd,
  };
}
