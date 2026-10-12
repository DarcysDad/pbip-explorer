# PBIP Explorer

Explore a Power BI semantic model from its project files (PBIP / TMDL, plus PBIR report definitions):
table profiles and relationships, DAX lineage down to source, report visual tracing, and a measure audit.

**Everything runs in the browser.** Files are read locally with the File System Access API (or a standard
folder input as a fallback). There is no server, and the Content Security Policy sets `connect-src 'none'`,
so the page cannot send model contents anywhere.

Not affiliated with or endorsed by Microsoft. Power BI is a trademark of Microsoft Corporation.

## Layout

```
src/                 the site; deploy this folder as-is
  index.html
  css/app.css
  js/theme-init.js   applies the saved theme before first paint
  js/parser.js       pure TMDL / DAX / M parsing; no DOM, unit tested
  js/app.js          UI
  js/demo-model.js   synthetic "Northwind Coffee" project (generated)
  vendor/            pinned, self-hosted Mermaid 10.9.3
  _headers           CSP and security headers (Cloudflare Pages / Netlify)
tests/               node --test suite for the parser
tools/gen_demo.py    regenerates the demo model
build.mjs            dist/site + a single-file standalone build
```

## Develop

```
npm test             # parser tests, no dependencies
npm run serve        # http://localhost:5173 (folder picker needs http(s), not file://)
npm run build        # dist/site/ and dist/pbip-explorer.html
```

## Deploy (Cloudflare Pages)

1. Push this repo to GitHub.
2. Cloudflare dashboard → Workers & Pages → Create → Pages → connect the repo.
3. Build command: *(none)*. Output directory: `src`.
4. Add a custom domain such as `tools.example.com`, or route a path on your existing site.

Netlify works the same way (publish directory `src`; it reads `_headers`).
GitHub Pages works too but cannot send the headers; add the CSP as a `<meta http-equiv>` tag instead
(`frame-ancestors` is ignored in meta tags).

Don't embed the tool in a cross-origin `<iframe>`: browsers block the folder picker there. Link to it instead.

## Verify the privacy claim

Open DevTools → Network, load a model, and confirm no requests leave the page after the initial load.
The Console shows a CSP violation if anything ever tries.
