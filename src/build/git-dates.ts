import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const git = (root: string, args: string[]) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });

/**
 * The date of the last commit that changed each file (YYYY-MM-DD), keyed by
 * path relative to `root`.
 *
 * In a shallow clone (most CI builds), a file untouched since before the
 * clone's depth shows up in the boundary commit, as if it had just been
 * added. Those dates are not true, so they are left out: the caller keeps the
 * date it already had for that file.
 */
export function gitDates(root: string, paths: string[]): Map<string, string> {
  const dates = new Map<string, string>();
  if (!paths.length) return dates;
  let top: string;
  try {
    top = git(root, ["rev-parse", "--show-toplevel"]).trim();
  } catch {
    return dates; // not a Git repository
  }

  const shallowFile = join(top, ".git", "shallow");
  const boundary = new Set(existsSync(shallowFile) ? readFileSync(shallowFile, "utf8").split(/\s+/).filter(Boolean) : []);
  const prefix = relative(top, root).split(sep).join("/");
  const wanted = new Set(paths.map((p) => (prefix ? `${prefix}/${p}` : p)));

  let log = "";
  try {
    log = git(top, ["log", "--format=@%H %cs", "--name-only", "--no-renames", "--", ...[...wanted]]);
  } catch {
    return dates;
  }

  let commit = "";
  let date = "";
  for (const line of log.split("\n")) {
    if (line.startsWith("@")) {
      [commit = "", date = ""] = line.slice(1).split(" ");
      continue;
    }
    const file = line.trim();
    if (!file || !wanted.has(file)) continue;
    const key = prefix ? file.slice(prefix.length + 1) : file;
    if (dates.has(key) || boundary.has(commit)) {
      // Newest first: the first date seen is the last change. A boundary
      // commit's date is marked so an older real date is not taken instead.
      if (!dates.has(key)) dates.set(key, "");
      continue;
    }
    dates.set(key, date);
  }
  for (const [k, v] of dates) if (!v) dates.delete(k);
  return dates;
}
