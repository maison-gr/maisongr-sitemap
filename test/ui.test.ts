import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../src/cli/main.js";
import { createUi, styleFor } from "../src/cli/ui.js";

const dirs: string[] = [];
function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "mgr-ui-"));
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

async function run(args: string[], root: string, style = { color: false, unicode: true }) {
  let out = "";
  let err = "";
  const code = await main(args, root, { out: (s) => (out += s), err: (s) => (err += s), style, errStyle: style });
  return { code, out, err };
}

const NEXT = { "package.json": '{"name":"demo","scripts":{"build":"next build"},"dependencies":{"next":"16"}}', "app/page.tsx": "", "app/globals.css": ":root{--background:#fff;--foreground:#111}" };
const ESC = "\u001b[";

describe("when to use colour and which symbols", () => {
  it("colours a terminal, never a pipe or a file, and follows NO_COLOR, FORCE_COLOR and TERM=dumb", () => {
    expect(styleFor({ isTTY: true }, {}, "linux").color).toBe(true);
    expect(styleFor({ isTTY: false }, {}, "linux").color).toBe(false);
    expect(styleFor(undefined, {}, "linux").color).toBe(false);
    expect(styleFor({ isTTY: true }, { NO_COLOR: "1" }, "linux").color).toBe(false);
    expect(styleFor({ isTTY: true }, { TERM: "dumb" }, "linux").color).toBe(false);
    expect(styleFor({ isTTY: false }, { FORCE_COLOR: "1" }, "linux").color).toBe(true);
    expect(styleFor({ isTTY: true }, { FORCE_COLOR: "0" }, "linux").color).toBe(false);
    expect(styleFor({ isTTY: false }, { GITHUB_ACTIONS: "true" }, "linux").color).toBe(true); // its log shows colour
  });

  it("draws ✓ ! ✗ → where the console can, and plain ASCII in the old Windows console", () => {
    expect(styleFor({ isTTY: true }, {}, "darwin").unicode).toBe(true);
    expect(styleFor({ isTTY: true }, {}, "win32").unicode).toBe(false);
    expect(styleFor({ isTTY: true }, { WT_SESSION: "x" }, "win32").unicode).toBe(true);
    expect(styleFor({ isTTY: true }, { TERM_PROGRAM: "vscode" }, "win32").unicode).toBe(true);

    let out = "";
    const ascii = createUi((s) => (out += s), { color: false, unicode: false });
    ascii.ok("done");
    ascii.warn("look");
    ascii.next("then");
    ascii.error("stopped");
    expect(out).toContain("  + done\n");
    expect(out).toContain("  ! look\n");
    expect(out).toContain("  > then\n");
    expect(out).toContain("  x stopped\n");
    expect(out).not.toMatch(/[✓✗→]/);
  });
});

describe("each kind of line", () => {
  const capture = (color: boolean) => {
    let out = "";
    return { ui: createUi((s) => (out += s), { color, unicode: true }), out: () => out };
  };

  it("success, warning, next step and note, plain when there is no colour", () => {
    const { ui, out } = capture(false);
    ui.ok("Wrote route.ts", "commit it");
    ui.warn("No robots.txt");
    ui.next("Open /sitemap.xml");
    expect(out()).toBe("  ✓ Wrote route.ts  commit it\n  ! No robots.txt\n  → Open /sitemap.xml\n");
  });

  it("colours each symbol on a terminal: green success, yellow warning, red error, cyan next step", () => {
    const { ui, out } = capture(true);
    ui.ok("a");
    ui.warn("b");
    ui.next("c");
    ui.error("d");
    expect(out()).toContain(`${ESC}32m✓${ESC}39m a`);
    expect(out()).toContain(`${ESC}33m`);
    expect(out()).toContain(`${ESC}36m→${ESC}39m c`);
    expect(out()).toContain(`${ESC}31m`);
  });

  it("lines up paths and reasons in two columns", () => {
    const { ui, out } = capture(false);
    ui.list([{ path: "/login", reason: "private page" }, { path: "/admin/users", reason: "private page" }]);
    expect(out()).toBe("    /login        private page\n    /admin/users  private page\n");
  });

  it("ends with Done, or with how many lines need a look", () => {
    const clean = capture(false);
    clean.ui.done(420);
    expect(clean.out()).toBe("\n  ✓ Done 420ms\n\n");
    const flagged = capture(false);
    flagged.ui.warn("one");
    flagged.ui.warn("two");
    flagged.ui.done(1500);
    expect(flagged.out()).toContain("✓ Done · 2 to look at above 1.5s");
  });

  it("puts an error's cause first, and the fix under it, a command set apart", () => {
    const { ui, out } = capture(false);
    ui.error("No site found.\nRun it from your project's folder:\n  maisongr-sitemap init");
    expect(out()).toBe("\n  ✗ No site found.\n    Run it from your project's folder:\n    maisongr-sitemap init\n\n");
  });

  it("shows progress only where a line can be rewritten", () => {
    const plain = capture(false);
    plain.ui.progress("Reading… 3 pages");
    plain.ui.endProgress();
    expect(plain.out()).toBe("");
    const live = capture(true);
    live.ui.progress("Reading… 3 pages");
    expect(live.out()).toContain("\r");
  });
});

describe("what a person sees from each command", () => {
  it("success: title, sections, and Done", async () => {
    const root = project({ ...NEXT, "public/robots.txt": "Sitemap: https://a.dev/sitemap.xml" });
    const { code, out, err } = await run(["init", "--offline", "--site", "https://a.dev"], root);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toMatch(/^\n {2}maisongr-sitemap \d+\.\d+\.\d+ · init\n/);
    for (const section of ["\n  Found\n", "\n  Wrote\n", "\n  Next\n", "\n  You can also\n"]) expect(out).toContain(section);
    expect(out).toContain("→ npx maisongr-sitemap build  re-read pages");
    expect(out).toContain("→ npx maisongr-sitemap --help  every command and option");
    expect(out.indexOf("You can also")).toBeLessThan(out.indexOf("✓ Done"));
    expect(out).toContain("  ✓ 1 page found  0 dated from Git");
    expect(out).toContain("  ✓ Site: https://a.dev");
    expect(out).toMatch(/\n {2}✓ Done \d+m?s\n/);
  });

  it("init run again keeps the route, and adds a --site it was missing instead of claiming to write it", async () => {
    const root = project(NEXT);
    await run(["init", "--offline"], root);
    const again = await run(["init", "--offline"], root);
    expect(again.out).toContain("✓ app/sitemap.xml/route.js  kept: already there");
    const sited = await run(["init", "--offline", "--site", "https://a.dev"], root);
    expect(sited.out).toContain("✓ app/sitemap.xml/route.js  updated: site set to https://a.dev");
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(join(root, "app/sitemap.xml/route.js"), "utf8")).toContain('  manifest,\n  site: "https://a.dev",\n');
    const other = await run(["init", "--offline", "--site", "https://b.dev"], root);
    expect(other.out).toContain("! app/sitemap.xml/route.js  kept: it names https://a.dev; change its site line to use https://b.dev");
  });

  it("warnings: each one marked, and counted at the end", async () => {
    const { code, out } = await run(["init", "--offline"], project(NEXT));
    expect(code).toBe(0); // a warning never fails the command
    expect(out).toContain("  ! Site address not found");
    expect(out).toContain("  ! No robots.txt names the sitemap.");
    // One route is "its", several are "their".
    const one = await run(["init", "--offline"], project({ ...NEXT, "app/blog/[slug]/page.tsx": "" }));
    expect(one.out).toContain("1 dynamic route not listed yet  give its values in the route file's params");
    expect(out).toContain("✓ Done · 2 to look at above");
  });

  it("errors: exit 1, on stderr, the cause and then the fix", async () => {
    const { code, out, err } = await run(["init"], project({}));
    expect(code).toBe(1);
    expect(out).not.toContain("Done");
    expect(err).toContain("  ✗ No site found in this folder.");
    expect(err).toContain("    npx maisongr-sitemap crawl http://localhost:8000 --out public --site https://your.site");
  });

  it("a mistyped command suggests the one meant", async () => {
    const { code, err } = await run(["inti"], project({}));
    expect(code).toBe(1);
    expect(err).toContain('✗ Unknown command "inti".');
    expect(err).toContain("Did you mean init?");
  });

  it("a wrong option says what it takes", async () => {
    expect((await run(["crawl", "localhost:8000"], project({}))).err).toContain("✗ Usage: maisongr-sitemap crawl <url> --out <public dir>");
    expect((await run(["crawl", "http://localhost:1", "--out", "nowhere"], project({}))).err).toContain("✗ nowhere does not exist.");
    expect((await run(["static", "dist", "--site", "https://a.dev"], project({}))).err).toContain("✗ Usage: maisongr-sitemap static");
    expect((await run(["indexnow", "--site", "a.dev", "--key", "x"], project({}))).err).toContain("✗ Give the address the site is served at");
    expect((await run(["init", "--site", "a.dev"], project(NEXT))).err).toContain("✗ --site takes the full address");
  });

  it("a site that can't be reached is an error, not an empty sitemap", async () => {
    const root = project({ "public/.keep": "" });
    const { code, err } = await run(["crawl", "http://127.0.0.1:9", "--out", "public"], root);
    expect(code).toBe(1);
    expect(err).toContain("✗ No page could be listed from http://127.0.0.1:9.");
  });

  it("build stays short in a build log: no title, one line", async () => {
    const root = project(NEXT);
    await run(["init", "--offline"], root);
    const { code, out } = await run(["build", "--offline"], root);
    expect(code).toBe(0);
    expect(out.trim().split("\n")).toHaveLength(1);
    expect(out).toMatch(/^ {2}✓ maisongr-sitemap: 1 page, 0 dated {2}→ app\/sitemap\.xml\/manifest\.json\n$/);
  });

  it("--no-color turns colour off even on a terminal", async () => {
    const { out } = await run(["init", "--offline", "--no-color"], project(NEXT), { color: true, unicode: true });
    expect(out).not.toContain(ESC);
    const coloured = await run(["init", "--offline"], project(NEXT), { color: true, unicode: true });
    expect(coloured.out).toContain(ESC);
  });

  it("an unexpected failure says it is a bug, with where to report it, and exits 2", async () => {
    const root = project({ "package.json": "{}", "index.html": "" });
    mkdirSync(join(root, "dist"));
    writeFileSync(join(root, "dist", "index.html"), "<html></html>");
    // A file where the output folder should be makes writing the page throw.
    writeFileSync(join(root, "dist", "sitemap"), "");
    const { code, err } = await run(["static", "dist", "--site", "https://a.dev"], root);
    expect(code).toBe(2);
    expect(err).toContain("✗ maisongr-sitemap stopped on an unexpected error:");
    expect(err).toContain("https://github.com/maison-gr/sitemap/issues");
  });
});
