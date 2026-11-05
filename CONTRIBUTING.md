# Contributing

Thank you for helping. Bug reports with a way to reproduce them are the most useful thing you can send. Pull requests are welcome too.

## Setup

Development needs Node 22.12 or later (the package itself runs on 20.9 and later).

```sh
npm ci
npm run typecheck
npm test
npm run build && node test/smoke.mjs
```

## What a change needs

- **A test that fails without it.** Bug fixes come with the test that reproduces the bug. Tests build small projects in a temporary folder (see `test/frameworks.test.ts`), so they need no fixtures on disk.
- **A check on a real project** when the change touches how a framework is read. Build a real project of that framework with the packed package (`npm pack`), and open its `/sitemap.xml` both ways: `curl` for the XML, a browser for the page.
- **No new runtime dependency.** The package has none, and every site that installs it benefits from keeping it that way.
- **The same addresses on both sides.** Whatever the XML lists, the page lists, and nothing more. That is what keeps it from being cloaking.

## Adding a framework

1. `src/build/detect.ts`: recognise it, and say whether it runs a server.
2. `src/build/<name>-routes.ts`: turn its route files into patterns in the manifest's syntax (`/blog/[slug]`, `[[...rest]]` for a rest parameter that may be empty), using the rules in `route-rules.ts`.
3. `src/build/framework-build.ts`: its config (site, base path, trailing slash), stylesheets, fonts, name and icon.
4. `src/cli/routes.ts`: the route file `init` writes, where the framework routes `/sitemap.xml`.
5. Tests for each step, and the real-project check above.

## Commits and pull requests

Small commits, each doing one thing, with a [conventional](https://www.conventionalcommits.org/) message: `feat(build): find Remix routes`, `fix: keep the port in the request's host`. Keep a pull request to one change, and describe what you checked.

## Security

Please don't open a public issue for a security problem. See [SECURITY.md](SECURITY.md).
