import { describe, expect, it } from "vitest";
import { withBuildStep, withStaticStep } from "../src/build/scripts.js";

describe("withBuildStep", () => {
  it("runs first in the build script, which every package manager runs", () => {
    expect(withBuildStep({ build: "next build", dev: "next dev" }).scripts).toEqual({ build: "maisongr-sitemap build && next build", dev: "next dev" });
  });

  it("adds a build script when there is none", () => {
    expect(withBuildStep({}).scripts.build).toBe("maisongr-sitemap build && next build");
    expect(withBuildStep(undefined).scripts.build).toBe("maisongr-sitemap build && next build");
  });

  it("changes nothing the second time", () => {
    const once = withBuildStep({ build: "next build" }).scripts;
    expect(withBuildStep(once)).toEqual({ scripts: once, note: "already runs before each build" });
  });

  it("runs static mode last for a static build, once", () => {
    const once = withStaticStep({ build: "astro build" }, "dist", "https://a.dev", "astro build").scripts;
    expect(once.build).toBe("astro build && maisongr-sitemap static dist --site https://a.dev");
    expect(withStaticStep(once, "dist", "https://a.dev", "astro build")).toEqual({ scripts: once, note: "already runs after each build" });
    expect(withStaticStep({}, "build", "https://a.dev", "vite build").scripts.build).toBe("vite build && maisongr-sitemap static build --site https://a.dev");
  });

  it("moves an earlier prebuild step into build, keeping the rest of that prebuild", () => {
    expect(withBuildStep({ prebuild: "maisongr-sitemap build", build: "next build" }).scripts).toEqual({ build: "maisongr-sitemap build && next build" });
    expect(withBuildStep({ prebuild: "maisongr-sitemap build && node gen.js", build: "next build" }).scripts).toEqual({
      prebuild: "node gen.js",
      build: "maisongr-sitemap build && next build",
    });
  });
});
