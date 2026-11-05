import type { Entry, Route } from "./types.js";

/** Values for a dynamic route's segments, e.g. { slug: "hello" }, with its own date if known. */
export type ParamRow = { lastmod?: string } & Record<string, string | string[] | undefined>;

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
};

const SEGMENT = /\[\[?(?:\.\.\.)?([^\]]+)\]\]?/g;
const isDynamic = (part: string) => /^\[.*\]$/.test(part);

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
    return (Array.isArray(value) ? value : [value]).map(encodeURIComponent).join("/");
  });
  return missing ? null : path.replace(/\/{2,}/g, "/").replace(/(.)\/$/, "$1") || "/";
}

function localeSegment(pattern: string, locales?: Locales): string | null {
  if (!locales) return null;
  const first = pattern.split("/")[1] ?? "";
  const names = locales.segment ? [locales.segment] : ["locale", "lang"];
  return names.find((n) => first === `[${n}]`) ?? null;
}

const matches = (path: string, rules: (string | RegExp)[]) =>
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
  const url = (path: string) => `${site}${options.trailingSlash && path !== "/" ? `${path}/` : path}`;
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
        if (path && !matches(path, options.exclude ?? [])) out.push({ loc: url(path), lastmod: row.lastmod ?? route.lastmod });
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
      for (const locale of langs) group.push({ locale, lastmod: row.lastmod ?? route.lastmod });
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
