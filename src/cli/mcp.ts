import { createInterface } from "node:readline";

/**
 * `maisongr-sitemap mcp`: the commands as tools for an AI agent, over the Model
 * Context Protocol's stdio transport (one JSON-RPC message per line). Each tool
 * runs the same command a person runs, in the folder the server started in, and
 * returns its --json report. `indexnow` is left out: it sends to outside services.
 */

/** Newest first. A client asking for another version gets the newest, as the protocol's handshake expects. */
const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

type Input = Record<string, unknown>;
type Tool = { description: string; properties: Record<string, { type: string; description: string }>; required?: string[]; argv: (i: Input) => string[] };

const str = (type = "string", description = "") => ({ type, description });
/** Flags for the values that were given: { site: "…" } gives --site …, { offline: true } gives --offline. */
const flags = (input: Input, names: Record<string, string>) =>
  Object.entries(names).flatMap(([key, flag]) => {
    const v = input[key];
    if (v === undefined || v === false) return [];
    return v === true ? [`--${flag}`] : [`--${flag}`, String(v)];
  });

const SITE = str("string", "The address the site is served at, such as https://www.example.com");

export const TOOLS: Record<string, Tool> = {
  sitemap_init: {
    description: "Set the sitemap up in this project: detects the framework, finds the pages, dates them from Git, reads the theme, writes the route and adds the build step. Stops without changing anything when another sitemap exists, unless replace is true.",
    properties: { site: SITE, replace: str("boolean", "Move another sitemap tool's files aside and take it out of the scripts and config. Nothing is deleted."), offline: str("boolean", "Don't download fonts") },
    argv: (i) => ["init", ...flags(i, { site: "site", replace: "replace", offline: "offline" })],
  },
  sitemap_build: {
    description: "Read the pages, dates and theme again, after routes or the design changed. Needs sitemap_init first.",
    properties: { offline: str("boolean", "Don't download fonts") },
    argv: (i) => ["build", ...flags(i, { offline: "offline" })],
  },
  sitemap_static: {
    description: "Write sitemap.xml and the designed page at /sitemap/ into a built static site.",
    properties: { dir: str("string", "The build folder, such as dist"), site: SITE, add: str("string", "More addresses, comma separated: /press,/jobs"), images: str("boolean", "List each page's images") },
    required: ["dir", "site"],
    argv: (i) => ["static", String(i.dir), ...flags(i, { site: "site", add: "add", images: "images" })],
  },
  sitemap_crawl: {
    description: "Read a running site along its links, as a search engine does, and write the sitemap files. For sites in any language (PHP, Python, Ruby, a CMS).",
    properties: { url: str("string", "The address to read, such as http://localhost:8000"), out: str("string", "The folder the server serves files from"), site: SITE, max: str("number", "Stop after this many pages") },
    required: ["url", "out"],
    argv: (i) => ["crawl", String(i.url), ...flags(i, { out: "out", site: "site", max: "max" })],
  },
  sitemap_connect: {
    description: "Make robots.txt name the sitemap. Without yes it only says what it would change.",
    properties: { site: SITE, public: str("string", "The folder the site serves files from at its root"), yes: str("boolean", "Create or change robots.txt") },
    argv: (i) => ["connect", ...flags(i, { site: "site", public: "public", yes: "yes" })],
  },
  sitemap_llms: {
    description: "Write llms.txt from the sitemap, with the title and description each page gives.",
    properties: { site: SITE, from: str("string", "Read a running copy instead of the live site, such as http://localhost:3000"), out: str("string", "The folder the site serves files from") },
    argv: (i) => ["llms", ...flags(i, { site: "site", from: "from", out: "out" })],
  },
};

type Message = { id?: string | number | null; method?: string; params?: Record<string, any> };
export type Run = (argv: string[]) => Promise<{ code: number; out: string }>;

const reply = (id: Message["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const failure = (id: Message["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/** The answer to one message; undefined for a notification, which gets none. */
export async function respond(message: Message, version: string, run: Run): Promise<object | undefined> {
  const { id, method, params } = message;
  if (id === undefined) return undefined;
  if (method === "initialize") {
    const asked = params?.protocolVersion;
    return reply(id, { protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0], capabilities: { tools: {} }, serverInfo: { name: "maisongr-sitemap", version } });
  }
  if (method === "ping") return reply(id, {});
  if (method === "tools/list") {
    const tools = Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: { type: "object", properties: t.properties, required: t.required ?? [] } }));
    return reply(id, { tools });
  }
  if (method === "tools/call") {
    const tool = TOOLS[params?.name];
    if (!tool) return failure(id, -32602, `Unknown tool: ${params?.name}`);
    const input: Input = params?.arguments ?? {};
    const missing = (tool.required ?? []).filter((k) => input[k] === undefined);
    if (missing.length) return reply(id, { content: [{ type: "text", text: `Missing: ${missing.join(", ")}` }], isError: true });
    const { code, out } = await run(tool.argv(input));
    return reply(id, { content: [{ type: "text", text: out }], isError: code !== 0 });
  }
  return failure(id, -32601, `Unknown method: ${method}`);
}

/** Serves until the client closes stdin. One message at a time: each command runs to its end before the next. */
export async function serve(version: string, run: Run): Promise<void> {
  for await (const line of createInterface({ input: process.stdin })) {
    if (!line.trim()) continue;
    let message: Message;
    try {
      message = JSON.parse(line);
    } catch {
      process.stdout.write(`${JSON.stringify(failure(null, -32700, "Parse error"))}\n`);
      continue;
    }
    const answer = await respond(message, version, run);
    if (answer) process.stdout.write(`${JSON.stringify(answer)}\n`);
  }
}
