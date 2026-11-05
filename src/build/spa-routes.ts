import { existsSync, statSync } from "node:fs";
import { dirname, join as joinFile, relative } from "node:path";
import { readPackage } from "./detect.js";
import { gitDates } from "./git-dates.js";
import { sourceFiles } from "./project.js";
import { privateOf, read, toPosix } from "./route-rules.js";

/** Client-side routers whose route tables live in code, which a single-page app's build output never shows. */
export const CLIENT_ROUTERS = ["react-router", "react-router-dom", "vue-router", "@tanstack/react-router", "@tanstack/vue-router", "@tanstack/solid-router", "@solidjs/router", "wouter", "preact-router", "svelte-spa-router"];

export function clientRouter(root: string): string | undefined {
  const pkg = readPackage(root);
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  return CLIENT_ROUTERS.find((r) => deps[r]);
}

const join = (parent: string, path: string) => (path.startsWith("/") ? path : `${parent.replace(/\/$/, "")}/${path}`).replace(/\/{2,}/g, "/");

/** A route as its file declares it: its full path, and what it renders when that can be read. */
export type DeclaredRoute = {
  path: string;
  /** The component it renders (<Services />, Component: Services), to find the file it comes from. */
  element?: string;
  /** A file it loads itself (lazy: () => import("./x"), component: () => import("./x.vue")). */
  importPath?: string;
  /** It only sends the visitor elsewhere (<Navigate>, redirect:). */
  redirect?: boolean;
};

/** What a route renders, from its own tag or object, before any nested children. */
function renderedBy(own: string): Omit<DeclaredRoute, "path"> {
  const head = own.split(/\bchildren\s*[:=]/)[0]!;
  const element = head.match(/\belement\s*[=:]\s*\{?\s*<\s*([A-Z][\w.]*)/)?.[1] ?? head.match(/\b[Cc]omponent\s*[:=]\s*\{?\s*([A-Z][\w$]*)/)?.[1];
  const importPath = head.match(/\b(?:lazy|component|Component)\s*:\s*(?:async\s*)?\(\s*\)\s*=>\s*import\(\s*["'`]([^"'`]+)/)?.[1];
  const redirect = element === "Navigate" || element === "Redirect" || /\bredirect\s*:/.test(head);
  return { ...(element && !redirect ? { element } : {}), ...(importPath ? { importPath } : {}), ...(redirect ? { redirect } : {}) };
}

/**
 * Every route a file declares, joined to the paths of the routes it is nested
 * in: `{ path: "docs", children: [{ path: "setup" }] }` and
 * `<Route path="docs"><Route path="setup" /></Route>` both give /docs/setup.
 * One pass that skips strings and comments, so it runs in linear time.
 */
export function routesIn(source: string): DeclaredRoute[] {
  type Frame = { kind: "brace" | "route"; start: number; path?: string; inTag?: boolean; route?: DeclaredRoute };
  const stack: Frame[] = [];
  const found: DeclaredRoute[] = [];
  const pathOfStack = () => stack.reduce((p, f) => (f.path === undefined ? p : join(p, f.path)), "/");
  /** A frame ends: what its route renders is read from the frame's own text. */
  const close = (frame: Frame | undefined, end: number) => {
    if (frame?.route) Object.assign(frame.route, renderedBy(source.slice(frame.start, end)));
  };
  let i = 0;
  const n = source.length;

  const readString = (): string => {
    const quote = source[i]!;
    let out = "";
    for (i++; i < n && source[i] !== quote; i++) {
      if (source[i] === "\\") i++;
      else out += source[i];
    }
    i++;
    return out;
  };

  while (i < n) {
    const c = source[i]!;
    if (c === "/" && source[i + 1] === "/") {
      const end = source.indexOf("\n", i);
      i = end < 0 ? n : end;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      readString();
      continue;
    }
    // path: "x" in a route object, or path="x" on a <Route>.
    if (c === "p" && source.startsWith("path", i) && !/[\w$]/.test(source[i - 1] ?? "") && !/[\w$]/.test(source[i + 4] ?? "")) {
      let j = i + 4;
      while (/\s/.test(source[j] ?? "")) j++;
      if (source[j] === ":" || source[j] === "=") {
        j++;
        while (/\s/.test(source[j] ?? "") || source[j] === "{") j++;
        if (source[j] === '"' || source[j] === "'" || source[j] === "`") {
          i = j;
          const value = readString();
          const top = stack[stack.length - 1];
          if (top && top.path === undefined && !value.includes("${")) {
            top.path = value;
            top.route = { path: pathOfStack() };
            found.push(top.route);
          }
          continue;
        }
      }
      i += 4;
      continue;
    }
    if (c === "<" && source.startsWith("<Route", i) && !/[\w$]/.test(source[i + 6] ?? "")) {
      stack.push({ kind: "route", start: i, inTag: true });
      i += 6;
      continue;
    }
    if (c === "<" && source.startsWith("</Route>", i)) {
      while (stack.length && stack.pop()!.kind !== "route");
      i += 8;
      continue;
    }
    const top = stack[stack.length - 1];
    if (c === ">" && top?.kind === "route" && top.inTag && source[i - 1] !== "=") {
      close(top, i);
      if (source[i - 1] === "/") stack.pop();
      else top.inTag = false;
      i++;
      continue;
    }
    if (c === "{") stack.push({ kind: "brace", start: i });
    else if (c === "}") {
      while (stack.length) {
        const frame = stack.pop()!;
        if (frame.kind === "brace") {
          close(frame, i);
          break;
        }
      }
    }
    i++;
  }
  return found;
}

/** Every route path a file declares (see routesIn). */
export const routePaths = (source: string) => routesIn(source).map((r) => r.path);

export type SpaRoutes = { router: string; paths: { path: string; lastmod?: string }[]; skipped: { path: string; reason: string }[] };

/** The src/ folder a file sits in, where "@/" points. */
function srcOf(file: string): string {
  const at = file.replace(/\\/g, "/").lastIndexOf("/src/");
  return at < 0 ? dirname(file) : file.slice(0, at + 4);
}

/** The file an import names, relative to the file that imports it, or through "@/" or "~/". */
function resolveImport(from: string, spec: string): string | undefined {
  const local = spec.startsWith(".");
  if (!local && !spec.startsWith("@/") && !spec.startsWith("~/")) return undefined;
  const base = local ? joinFile(dirname(from), spec) : joinFile(srcOf(from), spec.slice(2));
  for (const ext of ["", ".tsx", ".ts", ".jsx", ".js", ".vue", ".svelte", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"]) {
    const file = base + ext;
    if (existsSync(file) && statSync(file).isFile()) return file;
  }
  return undefined;
}

/** The file a component comes from: import X from "…", import { X } from "…", or X = lazy(() => import("…")). */
function componentFile(file: string, source: string, name: string): string | undefined {
  const id = name.replace(/\$/g, "\\$").split(".")[0]!;
  const spec =
    source.match(new RegExp(`import\\s+${id}\\s+from\\s*["'\`]([^"'\`]+)`))?.[1] ??
    source.match(new RegExp(`import\\s*\\{[^}]*\\b${id}\\b[^}]*\\}\\s*from\\s*["'\`]([^"'\`]+)`))?.[1] ??
    source.match(new RegExp(`\\b${id}\\s*=\\s*(?:React\\.)?lazy\\(\\s*\\(\\s*\\)\\s*=>\\s*import\\(\\s*["'\`]([^"'\`]+)`))?.[1];
  return spec ? resolveImport(file, spec) : undefined;
}

/**
 * The public pages a single-page app's router declares, from the files that
 * import it. Each is dated from Git by the file of the component it renders,
 * when that can be found: the page changes when that file does.
 */
export function spaRoutes(root: string): SpaRoutes | null {
  const router = clientRouter(root);
  if (!router) return null;
  const files = sourceFiles(root).filter((f) => /\.(?:[cm]?[jt]sx?|vue|svelte)$/.test(f) && !/[\\/](?:test|tests|__tests__)[\\/]/.test(f) && !/\.(?:test|spec)\./.test(f));
  const pages = new Map<string, string | undefined>();
  const skipped: SpaRoutes["skipped"] = [];
  for (const file of files) {
    const source = read(file);
    if (!CLIENT_ROUTERS.some((r) => source.includes(`"${r}"`) || source.includes(`'${r}'`))) continue;
    for (const route of routesIn(source)) {
      const path = route.path === "/" ? "/" : route.path.replace(/\/$/, "");
      if (pages.has(path) || skipped.some((s) => s.path === path)) continue;
      const segments = path.split("/").filter(Boolean);
      const last = segments[segments.length - 1] ?? "";
      const dynamic = segments.find((s) => /^[:$]|[*[(]/.test(s));
      const privateSegment = privateOf(segments);
      // "*" (React Router), "/:pathMatch(.*)*" (Vue Router): the page for addresses that exist nowhere.
      if (last === "*" || last === "**" || /^:\w*\(\.\*\)\*?$/.test(last)) skipped.push({ path, reason: "not-found page" });
      else if (route.redirect) skipped.push({ path, reason: "redirect" });
      else if (dynamic) skipped.push({ path, reason: "dynamic: list its pages with --add" });
      else if (privateSegment) skipped.push({ path, reason: `private page (${privateSegment})` });
      else if (segments[0] === "api") skipped.push({ path, reason: "API" });
      else pages.set(path, (route.importPath && resolveImport(file, route.importPath)) || (route.element && componentFile(file, source, route.element)) || undefined);
    }
  }
  const rel = (f: string) => toPosix(relative(root, f));
  const dated = gitDates(root, [...new Set([...pages.values()].filter((f): f is string => !!f))].map(rel));
  const paths = [...pages].map(([path, file]) => {
    const lastmod = file ? dated.get(rel(file)) : undefined;
    return { path, ...(lastmod ? { lastmod } : {}) };
  });
  return { router, paths: paths.sort((a, b) => a.path.localeCompare(b.path)), skipped };
}
