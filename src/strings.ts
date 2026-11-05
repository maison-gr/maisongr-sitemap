/**
 * The page's words, in the site's own language. English and French for now;
 * any other language gets English. A language is chosen by its primary code,
 * so "fr-CA" and "fr" both get French.
 */
export type Strings = {
  lang: string;
  title: string;
  indexTitle: string;
  heading: (name: string) => string;
  pages: (n: number) => string;
  files: (n: number) => string;
  pagesSection: string;
  filesSection: string;
  filterPlaceholder: string;
  filterLabel: string;
  languageGroup: string;
  all: string;
  sectionsNav: string;
  noMatch: string;
  empty: string;
  /** When the newest page last changed: "Updated 5 November 2026". */
  updated: (date: Date) => string;
  footer: string;
  /** The credit, around the tool's and the studio's links. */
  credit: (tool: string, studio: string) => string;
  /** The XML file's own view in a browser: its eyebrow, what it is, and where the page for people is. */
  xmlEyebrow: string;
  xmlNote: string;
  xmlPage: (path: string) => string;
  /** For the filter's live count: {shown} and {total} are filled in by the page's script. */
  tally: string;
};

const en: Strings = {
  lang: "en",
  title: "Sitemap",
  indexTitle: "Sitemap index",
  heading: (name) => `Every page on ${name}`,
  pages: (n) => (n === 1 ? "page" : "pages"),
  files: (n) => (n === 1 ? "file" : "files"),
  pagesSection: "Pages",
  filesSection: "Files",
  filterPlaceholder: "Filter by path",
  filterLabel: "Filter pages by path",
  languageGroup: "Language",
  all: "All",
  sectionsNav: "Sections",
  noMatch: "No page matches this filter.",
  empty: "No pages are listed yet. They appear here, and in the XML, once the site publishes them.",
  updated: (date) => `Updated ${new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" }).format(date)}`,
  footer: "Search engines read the same list as XML.",
  credit: (tool, studio) => `Made with ${tool}, open source, by ${studio}`,
  tally: "{shown} of {total} pages",
  xmlEyebrow: "Sitemap · XML",
  xmlNote: "This is the file search engines read.",
  xmlPage: (path) => `The page for people is at ${path}`,
};

const fr: Strings = {
  lang: "fr",
  title: "Plan du site",
  indexTitle: "Index du plan du site",
  // "d’Atelier", "d’Orbit", but "de Maison GR": de elides before a vowel.
  heading: (name) => `Toutes les pages ${/^[aeiouyàâäéèêëîïôöùûüæœ]/i.test(name) ? "d’" : "de "}${name}`,
  // French takes the singular for 0 and 1.
  pages: (n) => (n < 2 ? "page" : "pages"),
  files: (n) => (n < 2 ? "fichier" : "fichiers"),
  pagesSection: "Pages",
  filesSection: "Fichiers",
  filterPlaceholder: "Filtrer par adresse",
  filterLabel: "Filtrer les pages par adresse",
  languageGroup: "Langue",
  all: "Toutes",
  sectionsNav: "Sections",
  noMatch: "Aucune page ne correspond à ce filtre.",
  empty: "Aucune page n’est encore listée. Elles apparaîtront ici, et dans le XML, dès que le site les publiera.",
  // "le 1er novembre", but "le 5 novembre".
  updated: (date) => `Mis à jour le ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" }).format(date).replace(/^1 /, "1er ")}`,
  footer: "Les moteurs de recherche lisent la même liste en XML.",
  credit: (tool, studio) => `Réalisé avec ${tool}, outil open source de ${studio}`,
  tally: "{shown} sur {total} pages",
  xmlEyebrow: "Plan du site · XML",
  xmlNote: "Ce fichier est celui que lisent les moteurs de recherche.",
  xmlPage: (path) => `La page à lire est à l’adresse ${path}`,
};

const LANGUAGES: Record<string, Strings> = { en, fr };

export function stringsFor(lang: string | undefined): Strings {
  return LANGUAGES[(lang ?? "en").toLowerCase().split(/[-_]/)[0]!] ?? en;
}
