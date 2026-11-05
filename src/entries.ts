import type { Entry, Route } from "./types.js";

/** A date as a site's data usually has it: "2026-11-04", an ISO timestamp, a Date, or milliseconds. */
export type DateLike = string | Date | number;

/** Values for a dynamic route's segments, e.g. { slug: "hello" }, with its own date if known. */
export type ParamRow = { lastmod?: DateLike } & Record<string, string | string[] | DateLike | undefined>;

const W3C_DATE = /^(\d{4}-\d{2}-\d{2})(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/;

/**
 * A lastmod as YYYY-MM-DD, or undefined when the value is not a real date:
 * an invalid lastmod makes Search Console reject the whole file.
 */
export function dateOf(value: DateLike | undefined | null): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string") {
    // The date as written, so a timestamp keeps the day its author meant.
    const day = value.trim().match(W3C_DATE)?.[1];
    return day && !Number.isNaN(Date.parse(day)) ? day : undefined;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

export type Locales = {
  /** Every published language, as it appears in the URL. */
  list: readonly string[];
  /** The language x-default points to. */
  default: string;
  /** The route segment that carries the language. Defaults to "locale", then "lang". */
  segment?: string;
  /** Every route is served under /{language}/ by middleware, with no [locale] folder in the routes. */
  prefix?: boolean;
};

/** With prefix routing, "/pricing" is really "/[locale]/pricing". */
const withPrefix = (pattern: string, locales?: Locales) =>
  locales?.prefix && localeSegment(pattern, locales) === null ? `/[${locales.segment ?? "locale"}]${pattern === "/" ? "" : pattern}` : pattern;

export type ExpandOptions = {
  site: string;
  locales?: Locales;
  params?: Record<string, () => ParamRow[] | Promise<ParamRow[]>>;
  exclude?: (string | RegExp)[];
  trailingSlash?: boolean;
  /** The path the site is mounted under, e.g. "/docs". `exclude` is matched without it. */
  basePath?: string;
};

const SEGMENT = /\[\[?(?:\.\.\.)?([^\]]+)\]\]?/g;
/** A segment with a parameter anywhere in it: "[slug]", and also "v[version]" or "[lang]-docs" (Astro, SvelteKit). */
const isDynamic = (part: string) => /\[[^\]]+\]/.test(part);

function fill(pattern: string, row: ParamRow): string | null {
  let missing = false;
  const path = pattern.replace(SEGMENT, (whole, name: string) => {
    const value = row[name];
    if (value === undefined || value === "") {
      // An optional catch-all may be empty; anything else is a gap.
      if (whole.startsWith("[[")) return "";
      missing = true;
      return "";
    }
    return (Array.isArray(value) ? value : [value]).map((v) => encodeURIComponent(String(v))).join("/");
  });
  return missing ? null : path.replace(/\/{2,}/g, "/").replace(/(.)\/$/, "$1") || "/";
}

function localeSegment(pattern: string, locales?: Locales): string | null {
  if (!locales) return null;
  const first = pattern.split("/")[1] ?? "";
  const names = locales.segment ? [locales.segment] : ["locale", "lang"];
  return names.find((n) => first === `[${n}]`) ?? null;
}

export const matches = (path: string, rules: (string | RegExp)[]) =>
  rules.some((r) => (typeof r === "string" ? path === r || path.startsWith(r.endsWith("/") ? r : `${r}/`) : r.test(path)));

/** Dynamic routes that would be left out because nothing supplies their values. */
export function unfilled(routes: Route[], options: Pick<ExpandOptions, "locales" | "params">): string[] {
  return routes
    .filter((r) => {
      const pattern = withPrefix(r.pattern, options.locales);
      const seg = localeSegment(pattern, options.locales);
      const rest = seg ? pattern.replace(`/[${seg}]`, "") : pattern;
      return rest.split("/").some(isDynamic) && !options.params?.[r.pattern];
    })
    .map((r) => r.pattern);
}

export async function expand(routes: Route[], options: ExpandOptions): Promise<Entry[]> {
  const site = options.site.replace(/\/+$/, "");
  const base = options.basePath?.replace(/\/+$/, "") ?? "";
  const url = (path: string) => {
    // Under a basePath the home page is "/docs", never "/docs/" (which redirects).
    const full = base ? (path === "/" ? base : `${base}${path}`) : path;
    return `${site}${options.trailingSlash && full !== "/" ? `${full}/` : full}`;
  };
  const out: Entry[] = [];

  for (const route of routes) {
    const pattern = withPrefix(route.pattern, options.locales);
    const seg = localeSegment(pattern, options.locales);
    const rest = seg ? pattern.replace(`/[${seg}]`, "") || "/" : pattern;
    // Params are keyed by the route as the project names it.
    const supplier = options.params?.[route.pattern];
    if (rest.split("/").some(isDynamic) && !supplier) continue;
    const rows: ParamRow[] = supplier ? await supplier() : [{}];

    if (!seg || !options.locales) {
      for (const row of rows) {
        const path = fill(pattern, row);
        if (path && !matches(path, options.exclude ?? [])) out.push({ loc: url(path), lastmod: dateOf(row.lastmod) ?? route.lastmod });
      }
      continue;
    }

    // One page in several languages: each language version is its own entry,
    // and every version names all the others.
    const { list, default: fallback } = options.locales;
    const groups = new Map<string, { locale: string; lastmod?: string }[]>();
    for (const row of rows) {
      const tail = fill(rest, row);
      if (tail === null) continue;
      const own = row[seg];
      const langs = typeof own === "string" ? [own] : list;
      const group = groups.get(tail) ?? [];
      for (const locale of langs) group.push({ locale, lastmod: dateOf(row.lastmod) ?? route.lastmod });
      groups.set(tail, group);
    }
    for (const [tail, versions] of groups) {
      const pathOf = (locale: string) => `/${locale}${tail === "/" ? "" : tail}`;
      const present = versions.map((v) => v.locale);
      const alternates = [
        ...present.map((l) => ({ hreflang: l, href: url(pathOf(l)) })),
        ...(present.includes(fallback) ? [{ hreflang: "x-default", href: url(pathOf(fallback)) }] : []),
      ];
      for (const v of versions) {
        const path = pathOf(v.locale);
        if (matches(path, options.exclude ?? [])) continue;
        out.push({ loc: url(path), lastmod: v.lastmod, lang: v.locale, alternates: present.length > 1 ? alternates : undefined });
      }
    }
  }

  // Each address once, whatever produced it.
  const seen = new Set<string>();
  return out.filter((e) => (seen.has(e.loc) ? false : (seen.add(e.loc), true)));
}
