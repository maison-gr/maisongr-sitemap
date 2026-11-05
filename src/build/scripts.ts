export const COMMAND = "maisongr-sitemap build";

/**
 * The package.json scripts with the build step run first, and what changed.
 *
 * It goes into "build" itself, not "prebuild": pnpm and Yarn 2+ never run
 * pre scripts, so a prebuild would leave the manifest stale without a word.
 * A prebuild an earlier version wrote is taken out, so the step runs once.
 */
export function withBuildStep(scripts: Record<string, string> = {}, fallback = "next build"): { scripts: Record<string, string>; note: string } {
  const out = { ...scripts };
  const pre = out.prebuild;
  if (pre?.includes(COMMAND)) {
    const rest = pre.replace(new RegExp(`${COMMAND}\\s*(&&\\s*)?`), "").trim();
    if (rest) out.prebuild = rest;
    else delete out.prebuild;
  }
  if (out.build?.includes(COMMAND)) return { scripts: out, note: "already runs before each build" };
  out.build = out.build ? `${COMMAND} && ${out.build}` : `${COMMAND} && ${fallback}`;
  return { scripts: out, note: `added to the "build" script` };
}

/** For a static build: the sitemap is written into the output once the site's own build has finished. */
export function withStaticStep(scripts: Record<string, string> = {}, outDir: string, site: string, fallback: string): { scripts: Record<string, string>; note: string } {
  const out = { ...scripts };
  const step = `maisongr-sitemap static ${outDir} --site ${site}`;
  if (out.build?.includes("maisongr-sitemap static")) return { scripts: out, note: "already runs after each build" };
  out.build = `${out.build ?? fallback} && ${step}`;
  return { scripts: out, note: `added to the end of the "build" script` };
}
