/** One address in the sitemap. */
export type Entry = {
  /** Absolute URL. */
  loc: string;
  /** The date the content really changed, as YYYY-MM-DD. Omitted when unknown. */
  lastmod?: string;
  /** The same page in other languages, including x-default. */
  alternates?: { hreflang: string; href: string }[];
  /** Language of this address, when the site has more than one. */
  lang?: string;
};

/** The colours the page is set in, taken from the site's own tokens. */
export type Palette = {
  background: string;
  foreground: string;
  muted: string;
  border: string;
  accent: string;
  surface: string;
};

export type FontRole = "display" | "body" | "mono";

export type Font = {
  role: FontRole;
  family: string;
  /** Files served from the site's own origin, so a strict CSP allows them. */
  files: { url: string; weight?: string; style?: string }[];
};

export type Theme = {
  name: string;
  light: Palette;
  /** Absent when the site has no dark mode: the page then stays light, as the site does. */
  dark?: Palette;
  fonts: Font[];
  /** Path of the site's icon, if it has one. */
  icon?: string;
};

/** A page route found in the project, before dynamic segments are filled in. */
export type Route = {
  /** URL pattern, e.g. "/[locale]/blog/[slug]". */
  pattern: string;
  /** Date of the last commit that changed the route's files. */
  lastmod?: string;
};

/** What the build step writes, and the route reads at runtime. */
export type Manifest = {
  version: 1;
  framework: string;
  site?: string;
  /** Read from the project on every build, so a new language is never missed. */
  locales?: { list: string[]; default: string; prefix?: boolean };
  routes: Route[];
  theme: Theme;
};
