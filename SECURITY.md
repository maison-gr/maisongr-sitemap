# Security

## Reporting a problem

Please report security problems privately, through GitHub: **Security → Report a vulnerability** on this repository. Don't open a public issue.

Say what you found, how to reproduce it, and what it lets someone do. You'll get a reply within a week, and a fix or a plan once the problem is confirmed. Reports are credited in the release notes unless you'd rather not be named.

## Supported versions

Security fixes go into the latest release.

## What the package does that matters here

- **At build time**, `maisongr-sitemap build` reads your project's files and Git history, and may download font files from Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`). `--offline` skips every download. It writes these files and no others:
  - `init`: the sitemap route file, its manifest, `public/_sitemap/` (or `static/_sitemap/`), and the `build` script in `package.json`;
  - `build`: the manifest and `_sitemap/`;
  - `static <dir>`: `sitemap.xml`, `sitemap.css` and `sitemap/` inside `<dir>`.
- **At runtime**, the route serves only what the manifest and your `params` and `entries` return, escaped as XML and HTML. It reads one request header, `Sec-Fetch-Dest`, and the request's address. It sends nothing anywhere.
