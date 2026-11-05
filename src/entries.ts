import type { Entry, Route } from "./types.js";

/** A date as a site's data usually has it: "2026-11-04", an ISO timestamp, a Date, or milliseconds. */
export type DateLike = string | Date | number;

/** Values for a dynamic route's segments, e.g. { slug: "hello" }, with its own date if known. */
export type ParamRow = { lastmod?: DateLike; images?: readonly string[] } & Record<string, string | readonly string[] | DateLike | undefined>;

/** A row's images, when it gives any: the page's own, for the image sitemap. */
const imagesOf = (row: ParamRow) => (Array.isArray(row.images) && row.images.length ? { images: row.images } : {});

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
  /** The default language has a prefix too ("/en/about"). Set false when it is served at "/about". Default true. */
  prefixDefault?: boolean;
  /**
   * Each language version is its own page file, in a folder named for it
   * (Astro's src/pages/fr/about.astro): pages with the same path once the
   * language is taken off are versions of one page.
   */
  folders?: boolean;
  /**
   * The hreflang each language is announced with, when it isn't the code in the
   * URL: { fr: "fr-CA", en: "en-CA" } for /fr and /en pages that declare
   * fr-CA and en-CA. It must match what the pages themselves declare.
   */
  hreflang?: Record<string, string>;
};

/** The hreflang a language is announced with: its regional code if the site gives one. */
const hreflangOf = (locale: string, locales?: Locales) => locales?.hreflang?.[locale] ?? locale;

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

/**
 * An address or path without its trailing slashes. A loop, not /\/+$/: that
 * regex takes quadratic time on a long run of slashes that isn't at the end.
 */
export function trimSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end--;
  return value.slice(0, end);
}

// A parameter's name holds neither "[" nor "]", so each match can be read only one way.
const SEGMENT = /\[\[?(?:\.\.\.)?([^[\]]+)\]\]?/g;
/** A segment with a parameter anywhere in it: "[slug]", and also "v[version]" or "[lang]-docs" (Astro, SvelteKit). */
const isDynamic = (part: string) => /\[[^[\]]+\]/.test(part);

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
    // A catch-all takes its path as an array or as "a/b": either way each part is
    // encoded on its own, so the slashes stay slashes and never become %2F.
    const parts = Array.isArray(value) ? value : whole.includes("...") ? String(value).split("/").filter(Boolean) : [value];
    return parts.map((v) => encodeURIComponent(String(v))).join("/");
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
  const site = trimSlashes(options.site);
  const base = options.basePath ? trimSlashes(options.basePath) : "";
  const url = (path: string) => {
    // Under a basePath the home page is "/docs", never "/docs/" (which redirects).
    const full = base ? (path === "/" ? base : `${base}${path}`) : path;
    return `${site}${options.trailingSlash && full !== "/" ? `${full}/` : full}`;
  };
  const out: Entry[] = [];
  /** Entries of routes with no language segment, by path, for languages kept in folders. */
  const plain: { path: string; entry: Entry }[] = [];

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
        if (!path || matches(path, options.exclude ?? [])) continue;
        const entry: Entry = { loc: url(path), lastmod: dateOf(row.lastmod) ?? route.lastmod, ...imagesOf(row) };
        out.push(entry);
        plain.push({ path, entry });
      }
      continue;
    }

    // One page in several languages: each language version is its own entry,
    // and every version names all the others.
    const { list, default: fallback } = options.locales;
    const groups = new Map<string, { locale: string; lastmod?: string; images?: string[] }[]>();
    for (const row of rows) {
      const tail = fill(rest, row);
      if (tail === null) continue;
      const own = row[seg];
      const langs = typeof own === "string" ? [own] : list;
      const group = groups.get(tail) ?? [];
      for (const locale of langs) group.push({ locale, lastmod: dateOf(row.lastmod) ?? route.lastmod, ...imagesOf(row) });
      groups.set(tail, group);
    }
    for (const [tail, versions] of groups) {
      const pathOf = (locale: string) =>
        locale === fallback && options.locales!.prefixDefault === false ? tail : `/${locale}${tail === "/" ? "" : tail}`;
      const present = versions.map((v) => v.locale);
      const alternates = [
        ...present.map((l) => ({ hreflang: hreflangOf(l, options.locales), href: url(pathOf(l)) })),
        ...(present.includes(fallback) ? [{ hreflang: "x-default", href: url(pathOf(fallback)) }] : []),
      ];
      for (const v of versions) {
        const path = pathOf(v.locale);
        if (matches(path, options.exclude ?? [])) continue;
        out.push({ loc: url(path), lastmod: v.lastmod, lang: v.locale, alternates: present.length > 1 ? alternates : undefined, ...(v.images ? { images: v.images } : {}) });
      }
    }
  }

  if (options.locales?.folders) linkFolders(plain, options.locales);

  // Each address once, whatever produced it.
  const seen = new Set<string>();
  return out.filter((e) => (seen.has(e.loc) ? false : (seen.add(e.loc), true)));
}

/**
 * Languages kept in folders: "/fr/about" is the French "/about" (or
 * "/en/about", when the default language has a prefix too). Each page gets
 * its language, and every version of a page names all the others.
 */
export function linkFolders(plain: { path: string; entry: Entry }[], locales: Locales) {
  const versions = new Map<string, { lang: string; entry: Entry }[]>();
  for (const { path, entry } of plain) {
    const first = path.split("/")[1] ?? "";
    const lang = locales.list.includes(first) ? first : locales.prefixDefault === false ? locales.default : null;
    if (!lang) continue;
    const tail = first === lang ? path.slice(lang.length + 1) || "/" : path;
    versions.set(tail, [...(versions.get(tail) ?? []), { lang, entry }]);
  }
  for (const group of versions.values()) {
    // In the site's own order of languages, as the [locale] routes list them.
    group.sort((a, b) => locales.list.indexOf(a.lang) - locales.list.indexOf(b.lang));
    const fallback = group.find((v) => v.lang === locales.default);
    const alternates = [
      ...group.map((v) => ({ hreflang: hreflangOf(v.lang, locales), href: v.entry.loc })),
      ...(fallback ? [{ hreflang: "x-default", href: fallback.entry.loc }] : []),
    ];
    for (const v of group) {
      v.entry.lang = v.lang;
      if (group.length > 1) v.entry.alternates = alternates;
    }
  }
}
