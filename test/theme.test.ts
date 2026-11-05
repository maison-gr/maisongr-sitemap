import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { blocks, scopes } from "../src/build/css.js";
import { cssFonts } from "../src/build/css-fonts.js";
import { isWoff2, nextFonts } from "../src/build/fonts.js";
import { contrast, palette } from "../src/build/palette.js";

const dirs: string[] = [];
function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "mgr-fonts-"));
  dirs.push(root);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const read = (css: string) => scopes(blocks(css));

describe("theme from the site's stylesheet", () => {
  it("reads shadcn tokens, light and dark", () => {
    const { light, dark } = read(`
      @tailwind base;
      @layer base {
        :root { --background: 220 20% 97%; --foreground: 225 17% 9%; --card: 220 30% 99.5%; --muted: 220 16% 93%;
                --muted-foreground: 222 10% 37%; --primary: 222 42% 20%; --border: 220 16% 88%; }
        .dark { --background: 225 16% 6%; --foreground: 220 20% 92%; --muted-foreground: 220 10% 68%; --primary: 221 38% 74%; }
      }`);
    expect(palette(light)).toEqual({
      background: "hsl(220 20% 97%)",
      foreground: "hsl(225 17% 9%)",
      muted: "hsl(222 10% 37%)",
      border: "hsl(220 16% 88%)",
      accent: "hsl(222 42% 20%)",
      surface: "hsl(220 30% 99.5%)",
    });
    const d = palette(dark, light)!;
    expect(d.background).toBe("hsl(225 16% 6%)");
    expect(d.border).toBe("hsl(220 16% 88%)"); // not redefined for dark: the light one carries over
  });

  it("reads Tailwind v4 @theme tokens through var()", () => {
    const { light } = read(`@theme { --color-background: var(--paper); --color-foreground: #0e0e0c; } :root { --paper: #efece5; --signal: #ff4d1f; }`);
    const p = palette(light)!;
    expect(p.background).toBe("#efece5");
    expect(p.foreground).toBe("#0e0e0c");
    expect(p.accent).toBe("#ff4d1f");
  });

  it("reads a dark scheme set by prefers-color-scheme", () => {
    const { dark } = read(`:root{--bg:#fff;--fg:#000} @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#000; --fg:#fff } }`);
    expect(palette(dark)).toMatchObject({ background: "#000", foreground: "#fff" });
  });

  it("has no dark palette for a light-only site", () => {
    const { dark } = read(`:root{--background:#fff;--foreground:#111}`);
    expect(dark.size).toBe(0);
  });

  it("replaces a muted colour that fails AA with one mixed from the site's own pair", () => {
    const { light } = read(`:root{--background:#ffffff;--foreground:#111111;--muted-foreground:#cccccc}`);
    expect(contrast("#cccccc", "#ffffff")).toBeLessThan(4.5);
    expect(palette(light)!.muted).toBe("color-mix(in srgb, #111111 68%, #ffffff)");
  });

  it("ignores comments and strings", () => {
    const { light } = read(`/* :root { --background: red } */ :root { --background: #fafafa; --foreground: #101010; content: "}"; }`);
    expect(palette(light)!.background).toBe("#fafafa");
  });
});

describe("fonts from next/font", () => {
  it("finds Google fonts and their roles from the variable names", () => {
    const layout = `import { Newsreader, Atkinson_Hyperlegible_Next as Body, IBM_Plex_Mono } from "next/font/google";
      const display = Newsreader({ subsets: ["latin"], variable: "--font-display" });
      const body = Body({ subsets: ["latin"], variable: "--font-body" });
      const mono = IBM_Plex_Mono({ weight: ["400"], variable: "--font-mono" });`;
    expect(nextFonts(layout, "/app")).toEqual([
      { kind: "google", family: "Newsreader", role: "display" },
      { kind: "google", family: "Atkinson Hyperlegible Next", role: "body" },
      { kind: "google", family: "IBM Plex Mono", role: "mono" },
    ]);
  });

  it("writes a downloaded font only when it really is a WOFF2 file", () => {
    expect(isWoff2(new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0x00, 0x01]))).toBe(true);
    expect(isWoff2(new TextEncoder().encode("<!doctype html><title>Error</title>"))).toBe(false);
    expect(isWoff2(new Uint8Array([0x77, 0x4f, 0x46]))).toBe(false);
  });

  it("finds local next/font fonts", () => {
    const layout = `import localFont from "next/font/local";
      const brand = localFont({ src: "./fonts/Brand.woff2", variable: "--font-brand" });`;
    const [font] = nextFonts(layout, "/proj/app");
    expect(font).toMatchObject({ kind: "local", family: "Brand", role: "body" });
  });

  it("names a local font after its file, not the variable that names its role", () => {
    const layout = `import localFont from "next/font/local";
      const display = localFont({ src: "../../fonts/instrument-sans.woff2", variable: "--app-font-display" });`;
    expect(nextFonts(layout, "/proj/src/app/[lang]")[0]).toMatchObject({ family: "Instrument Sans", role: "display" });
  });
});

describe("fonts from CSS, Fontsource and Astro's Fonts API", () => {
  it("takes the site's own @font-face files first, with the role its tokens give them", () => {
    const root = project({
      "src/styles/fonts/Satoshi.woff2": "x",
      "public/fonts/plex-mono.woff2": "x",
      "src/styles/global.css": "",
    });
    const css = `@font-face { font-family: "Satoshi"; src: url("./fonts/Satoshi.woff2") format("woff2"); font-weight: 300 900; }
      @font-face { font-family: "Satoshi"; src: url("./fonts/Satoshi-Italic.woff2"); font-style: italic; }
      @font-face { font-family: Plex Mono; src: url(/fonts/plex-mono.woff2); }
      @font-face { font-family: "Remote"; src: url(https://cdn.example.com/r.woff2); }
      @theme { --font-display: "Satoshi", sans-serif; --font-mono: "Plex Mono", monospace; --font-weight-bold: 700; }`;
    const fonts = cssFonts({ root, stylesheets: [{ file: join(root, "src/styles/global.css"), css }], sources: [], publicDir: join(root, "public") });
    expect(fonts.map((f) => [f.kind, f.family, f.role])).toEqual([
      ["local", "Satoshi", "display"],
      ["local", "Plex Mono", "mono"],
    ]);
    expect(fonts[0]).toMatchObject({ files: [{ path: join(root, "src/styles/fonts/Satoshi.woff2"), weight: "300 900" }] });
  });

  it("takes the Latin files of an imported Fontsource package from node_modules", () => {
    const pkg = "node_modules/@fontsource-variable/inter";
    const root = project({
      [`${pkg}/index.css`]: `/* inter-latin-ext-wght-normal */ @font-face { font-family: 'Inter Variable'; src: url(./files/inter-latin-ext-wght-normal.woff2) format('woff2-variations'); font-weight: 100 900; }
        /* inter-latin-wght-normal */ @font-face { font-family: 'Inter Variable'; src: url(./files/inter-latin-wght-normal.woff2) format('woff2-variations'); font-weight: 100 900; }`,
      [`${pkg}/files/inter-latin-wght-normal.woff2`]: "x",
      [`${pkg}/files/inter-latin-ext-wght-normal.woff2`]: "x",
    });
    const fonts = cssFonts({ root, stylesheets: [], sources: ['import "@fontsource-variable/inter";'], publicDir: join(root, "public") });
    expect(fonts).toEqual([
      { kind: "local", family: "Inter Variable", role: "body", files: [{ path: join(root, pkg, "files/inter-latin-wght-normal.woff2"), weight: "100 900", style: undefined }] },
    ]);
  });

  it("reads Astro's Fonts API, then falls back to the families the CSS asks for", () => {
    const astroConfig = `export default defineConfig({ fonts: [{ provider: fontProviders.google(), name: "Fraunces", cssVariable: "--font-heading" }] });`;
    const css = `body { font-family: "Atkinson Hyperlegible", system-ui, sans-serif } code, pre { font-family: ui-monospace, "JetBrains Mono", monospace } h1 { font-family: var(--font-heading) }`;
    const fonts = cssFonts({ root: project({}), stylesheets: [{ file: "/x.css", css }], sources: [], publicDir: "/public", astroConfig });
    expect(fonts.map((f) => [f.kind, f.family, f.role])).toEqual([
      ["google", "Fraunces", "display"],
      ["google", "Atkinson Hyperlegible", "body"],
      ["google", "JetBrains Mono", "mono"],
    ]);
  });

  it("does not mistake a system font stack for a font to download", () => {
    const css = `body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif }`;
    expect(cssFonts({ root: project({}), stylesheets: [{ file: "/x.css", css }], sources: [], publicDir: "/p" })).toEqual([]);
  });
});
