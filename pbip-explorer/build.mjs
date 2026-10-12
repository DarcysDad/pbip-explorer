// Build:  node build.mjs
//   dist/site/                  — deploy this folder (multi-file, works with the strict CSP in _headers)
//   dist/pbip-explorer.html     — single-file standalone copy for offline/local use (open from disk)
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const src = 'src', out = 'dist', site = join(out, 'site');
rmSync(out, { recursive: true, force: true });
mkdirSync(site, { recursive: true });
cpSync(src, site, { recursive: true });

// Standalone: inline stylesheet and scripts. No CSP applies to a file opened from disk.
let html = readFileSync(join(src, 'index.html'), 'utf8');
const read = p => readFileSync(join(src, p), 'utf8');
const safe = js => js.replace(/<\/script/gi, '<\\/script');
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, p) => `<style>\n${read(p)}</style>`);
html = html.replace(/<link rel="icon"[^>]*>/, () => `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(read('favicon.svg'))}">`);
html = html.replace(/<script src="([^"]+)"( defer)?><\/script>/g, (_, p) => `<script>\n${safe(read(p))}\n</script>`);
// Mermaid is loaded dynamically from vendor/; embed it so the standalone file needs nothing beside it.
html = html.replace('</head>', () => `<script>\n${safe(read('vendor/mermaid.min.js'))}\n</script>\n</head>`);   // function form: the minified code contains $` and $' patterns
writeFileSync(join(out, 'pbip-explorer.html'), html);
console.log('built dist/site/ and dist/pbip-explorer.html');
