import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { respond, TOOLS, type Run } from "../src/cli/mcp.js";

const calls: string[][] = [];
const run: Run = async (argv) => {
  calls.push(argv);
  return { code: argv.includes("--fail") ? 1 : 0, out: '{"ok":true}' };
};
const ask = (method: string, params?: object) => respond({ id: 1, method, params }, "9.9.9", run) as Promise<Record<string, any>>;

describe("the MCP server", () => {
  it("agrees on the version the client asks for, or offers its newest", async () => {
    expect((await ask("initialize", { protocolVersion: "2025-06-18" })).result).toMatchObject({ protocolVersion: "2025-06-18", serverInfo: { name: "maisongr-sitemap", version: "9.9.9" } });
    expect((await ask("initialize", { protocolVersion: "1999-01-01" })).result.protocolVersion).toBe("2025-11-25");
  });

  it("gives no answer to a notification", async () => {
    expect(await respond({ method: "notifications/initialized" }, "1", run)).toBeUndefined();
  });

  it("lists each tool with a schema", async () => {
    const { tools } = (await ask("tools/list")).result;
    expect(tools.map((t: { name: string }) => t.name)).toEqual(Object.keys(TOOLS));
    expect(tools.find((t: { name: string }) => t.name === "sitemap_static").inputSchema.required).toEqual(["dir", "site"]);
  });

  it("runs a tool as the command a person would type", async () => {
    calls.length = 0;
    const { result } = await ask("tools/call", { name: "sitemap_init", arguments: { site: "https://a.dev", replace: true, offline: false } });
    expect(calls).toEqual([["init", "--site", "https://a.dev", "--replace"]]);
    expect(result).toEqual({ content: [{ type: "text", text: '{"ok":true}' }], isError: false });
  });

  it("keeps server.json in step with the package, as the MCP registry requires", () => {
    const read = (f: string) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
    const [pkg, server] = [read("package.json"), read("server.json")];
    expect(server.name).toBe(pkg.mcpName);
    expect(server.description.length).toBeLessThanOrEqual(100);
    expect([server.version, server.packages[0].version]).toEqual([pkg.version, pkg.version]);
  });

  it("keeps the Claude Code plugin in step with the package, and starts the server of that same version", () => {
    const read = (f: string) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
    const [pkg, plugin] = [read("package.json"), read(".claude-plugin/plugin.json")];
    expect(plugin.name).toBe(pkg.name);
    expect(plugin.version).toBe(pkg.version);
    expect(plugin.mcpServers.sitemap).toEqual({ command: "npx", args: ["-y", `maisongr-sitemap@${pkg.version}`, "mcp"] });
    expect(readFileSync(new URL("../skills/maisongr-sitemap/SKILL.md", import.meta.url), "utf8")).toMatch(/^---\nname: maisongr-sitemap\n/);
  });

  it("does not offer indexnow, which sends to outside services", () => {
    expect(Object.keys(TOOLS).join()).not.toContain("indexnow");
  });

  it("answers a missing argument as a tool error and an unknown tool or method as a protocol error", async () => {
    expect((await ask("tools/call", { name: "sitemap_static", arguments: { dir: "dist" } })).result).toMatchObject({ isError: true });
    expect((await ask("tools/call", { name: "nope" })).error.code).toBe(-32602);
    expect((await ask("resources/list")).error.code).toBe(-32601);
  });
});
