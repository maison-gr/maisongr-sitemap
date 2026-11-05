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
  /** Images on the page, as absolute URLs or paths. Google reads up to 1,000 per page. */
  images?: string[];
  /** Videos on the page, in Google's video sitemap fields. */
  videos?: Video[];
  /** For a news publisher's articles from the last two days. */
  news?: News;
};

/** The fields Google's video sitemaps still read. */
export type Video = {
  thumbnail: string;
  title: string;
  /** Up to 2,048 characters. */
  description: string;
  /** The video file, or else `player`: a page or embed that plays it. */
  content?: string;
  player?: string;
  /** Seconds. */
  duration?: number;
  /** As YYYY-MM-DD or an ISO timestamp. */
  publicationDate?: string;
  familyFriendly?: boolean;
  live?: boolean;
};

/** Google News: the publication and the article. */
export type News = {
  publication: { name: string; language: string };
  /** As YYYY-MM-DD or an ISO timestamp. */
  publicationDate: string;
  title: string;
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
  /** The path the site is mounted under (Next.js basePath), e.g. "/docs". */
  basePath?: string;
  /** The site serves "/about/" rather than "/about". */
  trailingSlash?: boolean;
  /** Read from the project on every build, so a new language is never missed. */
  locales?: { list: string[]; default: string; prefix?: boolean; prefixDefault?: boolean; folders?: boolean };
  routes: Route[];
  theme: Theme;
};
