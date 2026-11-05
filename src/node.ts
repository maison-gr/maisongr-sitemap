import type { IncomingMessage, ServerResponse } from "node:http";
import { createSitemap, type SitemapOptions } from "./handler.js";

/** Node's request, plus what Express adds: the path before mounting, and the protocol and host behind a trusted proxy. */
type NodeRequest = IncomingMessage & { originalUrl?: string; protocol?: string; hostname?: string };

/**
 * For Express, Connect and plain node:http servers.
 *
 *   import { sitemap } from "maisongr-sitemap/node";
 *
 *   app.get("/sitemap.xml", sitemap({ site: "https://www.example.com", entries: async () => [...] }));
 *
 * Errors go to Express's `next` when there is one, and are a plain 500 otherwise.
 * `invalidate()` drops the cached list, e.g. when a post is published.
 */
export function sitemap(options: SitemapOptions = {}) {
  const handle = createSitemap(options);
  async function sitemapHandler(req: NodeRequest, res: ServerResponse, next?: (error?: unknown) => void): Promise<void> {
    try {
      const response = await handle(toRequest(req));
      res.statusCode = response.status;
      response.headers.forEach((value, name) => res.setHeader(name, value));
      res.end(req.method === "HEAD" ? undefined : await response.text());
    } catch (error) {
      if (next) return next(error);
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("The sitemap could not be built.");
    }
  }
  return Object.assign(sitemapHandler, { invalidate: handle.invalidate });
}

function toRequest(req: NodeRequest): Request {
  const protocol = req.protocol ?? ((req.socket as { encrypted?: boolean }).encrypted ? "https" : "http");
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    // HTTP/2 pseudo-headers (":path") are not headers a Request can carry.
    if (value !== undefined && !name.startsWith(":")) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  // Express's hostname follows X-Forwarded-Host under `trust proxy`; when it is just the Host header, keep that header's port.
  const host = req.headers.host ?? "localhost";
  const forwarded = req.hostname && req.hostname !== host.replace(/:\d+$/, "") ? req.hostname : null;
  return new Request(new URL(req.originalUrl ?? req.url ?? "/", `${protocol}://${forwarded ?? host}`), { headers });
}

export type { SitemapOptions };
