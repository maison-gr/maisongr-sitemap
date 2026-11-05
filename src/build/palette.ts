import { asColor, resolve } from "./css.js";
import type { Palette } from "../types.js";

/** Token names sites use for each role, most specific first. */
const NAMES: Record<keyof Palette, string[]> = {
  background: ["--background", "--color-background", "--bg", "--color-bg", "--page", "--paper", "--stage", "--canvas", "--mist"],
  foreground: ["--foreground", "--color-foreground", "--fg", "--text", "--color-text", "--ink", "--text-primary"],
  muted: ["--muted-foreground", "--color-muted-foreground", "--text-muted", "--color-text-muted", "--muted-text", "--ink-2", "--dim"],
  border: ["--border", "--color-border", "--rule", "--hair", "--line", "--divider", "--border-color"],
  accent: ["--primary", "--color-primary", "--brand", "--color-brand", "--color-action", "--action", "--signal", "--accent", "--color-accent"],
  surface: ["--card", "--color-card", "--surface", "--color-surface", "--sheet", "--panel"],
};

export const DEFAULT_PALETTE: Palette = {
  background: "#fbfaf7",
  foreground: "#141414",
  muted: "#5c5c58",
  border: "#e3e1db",
  accent: "#141414",
  surface: "#ffffff",
};

function pick(role: keyof Palette, ...maps: Map<string, string>[]): string | null {
  for (const name of NAMES[role]) {
    for (const m of maps) {
      const raw = m.get(name);
      if (raw === undefined) continue;
      const color = asColor(resolve(raw, ...maps));
      if (color) return color;
    }
  }
  return null;
}

/** sRGB of hex, rgb() and hsl() colours; null for formats this does not compute (oklch…). */
export function rgbOf(color: string): [number, number, number] | null {
  const hex = color.match(/^#([\da-f]{3,8})$/i)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex.slice(0, 3)].map((c) => c + c).join("") : hex.slice(0, 6);
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
  }
  const rgb = color.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const hsl = color.match(/^hsla?\(\s*(-?[\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/i);
  if (hsl) {
    const h = ((Number(hsl[1]) % 360) + 360) % 360, s = Number(hsl[2]) / 100, l = Number(hsl[3]) / 100;
    const k = (n: number) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return [f(0), f(8), f(4)].map((v) => Math.round(v * 255)) as [number, number, number];
  }
  return null;
}

const luminance = ([r, g, b]: [number, number, number]) => {
  const c = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};

/** WCAG contrast ratio, or null when either colour is in a format not computed here. */
export function contrast(a: string, b: string): number | null {
  const x = rgbOf(a), y = rgbOf(b);
  if (!x || !y) return null;
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The palette for one scheme, or null when the site defines no background and text colour for it. */
export function palette(...maps: Map<string, string>[]): Palette | null {
  const background = pick("background", ...maps);
  const foreground = pick("foreground", ...maps);
  if (!background || !foreground) return null;
  const mix = (pct: number) => `color-mix(in srgb, ${foreground} ${pct}%, ${background})`;

  let muted = pick("muted", ...maps) ?? mix(68);
  // Secondary text must still read: below AA on the page background, mix one from the site's own pair.
  const ratio = contrast(muted, background);
  if (ratio !== null && ratio < 4.5) muted = mix(68);

  return {
    background,
    foreground,
    muted,
    border: pick("border", ...maps) ?? mix(14),
    accent: pick("accent", ...maps) ?? foreground,
    surface: pick("surface", ...maps) ?? background,
  };
}
