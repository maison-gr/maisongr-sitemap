/**
 * The CLI's voice: one symbol per kind of line, so a run reads at a glance.
 *
 *   ✓ done   ! needs a look   ✗ stopped   → do this next
 *
 * Colour only on a terminal that shows it: never when piped or in a file,
 * never with NO_COLOR, always with FORCE_COLOR. ASCII symbols where the
 * console can't draw the others (the old Windows console).
 */
export type Style = { color: boolean; unicode: boolean };

type Env = Record<string, string | undefined>;

export function styleFor(stream: { isTTY?: boolean } | undefined, env: Env = process.env, platform = process.platform): Style {
  const forced = env.FORCE_COLOR;
  const color = forced !== undefined ? forced !== "0" && forced !== "false" : !env.NO_COLOR && env.TERM !== "dumb" && (!!stream?.isTTY || !!env.GITHUB_ACTIONS);
  const unicode =
    platform !== "win32"
      ? env.TERM !== "linux"
      : !!(env.WT_SESSION || env.CI || env.TERM_PROGRAM === "vscode" || env.ConEmuTask || env.TERMINAL_EMULATOR === "JetBrains-JediTerm" || /^(xterm|alacritty)/.test(env.TERM ?? ""));
  return { color, unicode };
}

const SGR = { bold: [1, 22], dim: [2, 22], red: [31, 39], green: [32, 39], yellow: [33, 39], cyan: [36, 39] } as const;

export function createUi(write: (s: string) => void, style: Style) {
  const paint = (s: string, ...names: (keyof typeof SGR)[]) =>
    style.color ? names.reduce((out, n) => `\u001b[${SGR[n][0]}m${out}\u001b[${SGR[n][1]}m`, s) : s;
  const mark = style.unicode ? { ok: "✓", warn: "!", fail: "✗", next: "→", dot: "·" } : { ok: "+", warn: "!", fail: "x", next: ">", dot: "-" };
  let warnings = 0;
  const line = (s = "") => write(`${s}\n`);
  /** A note after the main text, quieter: "Wrote manifest.json  commit it". */
  const withNote = (text: string, note?: string) => (note ? `${text}  ${paint(note, "dim")}` : text);

  return {
    paint,
    line,
    /** A terminal that can rewrite a line in place, for progress. */
    live: style.color,
    get warnings() {
      return warnings;
    },
    /** The run's first line: which tool, which version, which command. */
    title(version: string, command: string) {
      line(`\n  ${paint("maisongr-sitemap", "bold")} ${paint(`${version} ${mark.dot} ${command}`, "dim")}`);
    },
    /** What was detected, the subject of everything below it. */
    subject(text: string) {
      line(`\n  ${paint(text, "bold")}`);
    },
    /** A group of lines, with how many there are. */
    heading(text: string, count?: number) {
      line(`\n  ${paint(text, "bold")}${count === undefined ? "" : ` ${paint(String(count), "dim")}`}`);
    },
    ok(text: string, note?: string) {
      line(`  ${paint(mark.ok, "green")} ${withNote(text, note)}`);
    },
    warn(text: string, note?: string) {
      warnings++;
      line(`  ${paint(mark.warn, "yellow", "bold")} ${withNote(text, note)}`);
    },
    next(text: string, note?: string) {
      line(`  ${paint(mark.next, "cyan")} ${withNote(text, note)}`);
    },
    /** A plain line under a heading, indented like the others. */
    text(text: string) {
      line(`    ${text}`);
    },
    /** Paths and why, in two columns. */
    list(rows: { path: string; reason?: string }[]) {
      const width = Math.min(44, Math.max(0, ...rows.map((r) => r.path.length)));
      for (const r of rows) line(`    ${r.reason ? `${r.path.padEnd(width)}  ${paint(r.reason, "dim")}` : r.path}`);
    },
    /** A command or a line of code to copy. */
    code(s: string) {
      return paint(s, "cyan");
    },
    /** The run's last line: done, or done with things to look at. */
    done(ms: number, what = "Done") {
      const time = paint(ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`, "dim");
      if (warnings) line(`\n  ${paint(mark.ok, "green")} ${what} ${paint(mark.dot, "dim")} ${paint(`${warnings} to look at above`, "yellow")} ${time}\n`);
      else line(`\n  ${paint(mark.ok, "green")} ${paint(what, "bold")} ${time}\n`);
    },
    /** A stop: the first line says what, the rest how to fix it. */
    error(message: string) {
      const [first = "", ...rest] = message.split("\n");
      line(`\n  ${paint(`${mark.fail} ${first}`, "red", "bold")}`);
      for (const r of rest) line(r ? `    ${r.trimStart() === r ? r : paint(r.trim(), "cyan")}` : "");
      line();
    },
    /** Rewrites one line in place, for progress on a terminal; nothing elsewhere. */
    progress(text: string) {
      if (style.color) write(`\r\u001b[2K  ${paint(text, "dim")}`);
    },
    endProgress() {
      if (style.color) write("\r\u001b[2K");
    },
  };
}

export type Ui = ReturnType<typeof createUi>;
