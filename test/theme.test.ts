import { describe, expect, it } from "vitest";
import { blocks, scopes } from "../src/build/css.js";
import { contrast, palette } from "../src/build/palette.js";
import { nextFonts } from "../src/build/fonts.js";

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

  it("finds local fonts", () => {
    const layout = `import localFont from "next/font/local";
      const brand = localFont({ src: "./fonts/Brand.woff2", variable: "--font-brand" });`;
    const [font] = nextFonts(layout, "/proj/app");
    expect(font).toMatchObject({ kind: "local", family: "brand", role: "body" });
  });
});
