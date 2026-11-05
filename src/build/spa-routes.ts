import { readPackage } from "./detect.js";
import { sourceFiles } from "./project.js";
import { privateOf, read } from "./route-rules.js";

/** Client-side routers whose route tables live in code, which a single-page app's build output never shows. */
export const CLIENT_ROUTERS = ["react-router", "react-router-dom", "vue-router", "@tanstack/react-router", "@tanstack/vue-router", "@tanstack/solid-router", "@solidjs/router", "wouter", "preact-router", "svelte-spa-router"];

export function clientRouter(root: string): string | undefined {
  const pkg = readPackage(root);
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  return CLIENT_ROUTERS.find((r) => deps[r]);
}

const join = (parent: string, path: string) => (path.startsWith("/") ? path : `${parent.replace(/\/$/, "")}/${path}`).replace(/\/{2,}/g, "/");

/**
 * Every route path a file declares, joined to the paths of the routes it is
 * nested in: `{ path: "docs", children: [{ path: "setup" }] }` and
 * `<Route path="docs"><Route path="setup" /></Route>` both give /docs/setup.
 * One pass that skips strings and comments, so it runs in linear time.
 */
export function routePaths(source: string): string[] {
  type Frame = { kind: "brace" | "route"; path?: string; inTag?: boolean };
  const stack: Frame[] = [];
  const found: string[] = [];
  const pathOfStack = () => stack.reduce((p, f) => (f.path === undefined ? p : join(p, f.path)), "/");
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
            found.push(pathOfStack());
          }
          continue;
        }
      }
      i += 4;
      continue;
    }
    if (c === "<" && source.startsWith("<Route", i) && !/[\w$]/.test(source[i + 6] ?? "")) {
      stack.push({ kind: "route", inTag: true });
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
      if (source[i - 1] === "/") stack.pop();
      else top.inTag = false;
      i++;
      continue;
    }
    if (c === "{") stack.push({ kind: "brace" });
    else if (c === "}") {
      while (stack.length && stack.pop()!.kind !== "brace");
    }
    i++;
  }
  return found;
}

export type SpaRoutes = { router: string; paths: string[]; skipped: { path: string; reason: string }[] };

/** The public pages a single-page app's router declares, from the files that import it. */
export function spaRoutes(root: string): SpaRoutes | null {
  const router = clientRouter(root);
  if (!router) return null;
  const files = sourceFiles(root).filter((f) => /\.(?:[cm]?[jt]sx?|vue|svelte)$/.test(f) && !/[\\/](?:test|tests|__tests__)[\\/]/.test(f) && !/\.(?:test|spec)\./.test(f));
  const paths = new Set<string>();
  const skipped: SpaRoutes["skipped"] = [];
  for (const file of files) {
    const source = read(file);
    if (!CLIENT_ROUTERS.some((r) => source.includes(`"${r}"`) || source.includes(`'${r}'`))) continue;
    for (const raw of routePaths(source)) {
      const path = raw === "/" ? "/" : raw.replace(/\/$/, "");
      if (paths.has(path) || skipped.some((s) => s.path === path)) continue;
      const segments = path.split("/").filter(Boolean);
      const dynamic = segments.find((s) => /^[:$]|[*[(]/.test(s));
      const privateSegment = privateOf(segments);
      if (dynamic) skipped.push({ path, reason: "dynamic: list its pages with --add" });
      else if (privateSegment) skipped.push({ path, reason: `private page (${privateSegment})` });
      else if (segments[0] === "api") skipped.push({ path, reason: "API" });
      else paths.add(path);
    }
  }
  return { router, paths: [...paths].sort(), skipped };
}
