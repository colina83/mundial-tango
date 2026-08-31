export type SupportedLocale = "en" | "es";

export const DEFAULT_LOCALE: SupportedLocale = "en";
export const SUPPORTED_LOCALES: readonly SupportedLocale[] = ["en", "es"];

function basePath(baseUrl: string): string {
  const normalized = `/${baseUrl}`.replace(/\/+/g, "/").replace(/\/$/, "");
  return normalized === "" || normalized === "/" ? "" : normalized;
}

function pathWithoutBase(pathname: string, baseUrl: string): string {
  const base = basePath(baseUrl);
  if (!base) return pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (pathname === base) return "/";
  if (pathname.startsWith(`${base}/`)) return pathname.slice(base.length);
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

export function localeFromPath(
  pathname: string,
  baseUrl = "/",
): SupportedLocale | null {
  const relative = pathWithoutBase(pathname, baseUrl);
  const match = relative.match(/^\/(en|es)(?:\/|$)/);
  return (match?.[1] as SupportedLocale | undefined) ?? null;
}

export function localizedPath(
  pathname: string,
  locale: SupportedLocale,
  baseUrl = "/",
): string {
  const base = basePath(baseUrl);
  const relative = pathWithoutBase(pathname, baseUrl)
    .replace(/^\/(?:en|es)(?=\/|$)/, "")
    .replace(/^\/+/, "");
  return `${base}/${locale}/${relative}`.replace(/\/+/g, "/");
}

export function localizedBasename(baseUrl: string, pathname: string): string | undefined {
  const base = basePath(baseUrl);
  const locale = localeFromPath(pathname, baseUrl);
  const combined = `${base}${locale ? `/${locale}` : ""}`;
  return combined || undefined;
}
