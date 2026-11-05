/** A rule's custom properties, with the at-rules it sits inside. */
export type Block = { selector: string; context: string[]; vars: Map<string, string> };

/** Splits a stylesheet into rules and collects the custom properties of each. Comments are dropped; nesting is followed. */
export function blocks(css: string): Block[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Block[] = [];
  const stack: { selector: string; start: number }[] = [];
  let i = 0;
  let segmentStart = 0;

  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      const end = src.indexOf(ch, i + 1);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    if (ch === "{") {
      const head = src.slice(segmentStart, i);
      // The selector is what follows the last declaration or brace.
      const selector = head.slice(head.lastIndexOf(";") + 1).trim();
      stack.push({ selector, start: i + 1 });
      segmentStart = i + 1;
    } else if (ch === "}") {
      const open = stack.pop();
      if (open) {
        const body = src.slice(open.start, i);
        const vars = new Map<string, string>();
        // Only this rule's own declarations: nested rules are removed first.
        let own = body;
        for (let prev = ""; prev !== own; ) {
          prev = own;
          own = own.replace(/[^{};]*\{[^{}]*\}/g, "");
        }
        for (const m of own.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) vars.set(m[1]!, m[2]!.trim());
        if (vars.size) out.push({ selector: open.selector, context: stack.map((s) => s.selector), vars });
      }
      segmentStart = i + 1;
    }
    i++;
  }
  return out;
}

const DARK = /\.dark\b|\[data-theme=["']?dark|\[data-mode=["']?dark|prefers-color-scheme:\s*dark|@variant\s+dark/;
const ROOTISH = /(^|[\s,]):root\b|(^|[\s,])html\b|^@theme\b|^:host\b|\.light\b|\[data-theme=["']?light|^body\b/;

export function scopes(list: Block[]) {
  const light = new Map<string, string>();
  const dark = new Map<string, string>();
  for (const b of list) {
    const where = [...b.context, b.selector].join(" ");
    const target = DARK.test(where) ? dark : ROOTISH.test(b.selector) || /^@theme/.test(where) ? light : null;
    if (!target) continue;
    for (const [k, v] of b.vars) target.set(k, v);
  }
  return { light, dark };
}

/** Follows var(--x, fallback) references until a real value is reached. */
export function resolve(value: string, ...maps: Map<string, string>[]): string {
  let out = value;
  for (let depth = 0; depth < 8 && out.includes("var("); depth++) {
    out = out.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (_, name: string, fallback?: string) => {
      for (const m of maps) {
        const v = m.get(name);
        if (v !== undefined) return v;
      }
      return fallback?.trim() ?? "";
    });
  }
  return out.trim();
}

/** "220 20% 97%" (shadcn's channels) becomes hsl(220 20% 97%); real colours pass through. */
export function asColor(value: string): string | null {
  const v = value.replace(/\s*!important$/, "").trim();
  if (!v) return null;
  if (/^-?[\d.]+(deg)?\s*,?\s+[\d.]+%\s*,?\s+[\d.]+%(\s*\/\s*[\d.]+%?)?$/.test(v)) return `hsl(${v.replace(/,/g, " ").replace(/\s+/g, " ")})`;
  if (/^#[\da-f]{3,8}$/i.test(v) || /^(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color|color-mix|hwb)\(/i.test(v)) return v;
  if (/^[a-z]+$/i.test(v) && !["inherit", "initial", "unset", "transparent", "currentcolor"].includes(v.toLowerCase())) return v;
  return null;
}
