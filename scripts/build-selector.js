// Build a standalone selection page. Game sessions remain on the chosen server.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist-selector');
const defaultServers = 'https://phone-controller-games.onrender.com,https://phone-controller-games-2.onrender.com';
const configured = process.env.RENDER_GAME_SERVERS || defaultServers;
const servers = [...new Set(configured.split(',').map((s) => {
  const value = s.trim();
  let url;
  try { url = new URL(value); } catch { throw new Error(`Invalid Render server URL: ${value}`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`Render server must be an HTTPS origin without a path: ${value}`);
  }
  return url.origin;
}))];
if (!servers.length) throw new Error('At least one Render server is required');

const source = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
// Keep links usable when JavaScript is disabled. The chosen Render origin then
// serves the game, its QR code, and its sockets for the whole room lifetime.
let count = 0;
const html = source.replace(/(<a class="card [^"]+" href=")\/(\w+)\/("\s*>)/g, (_, before, game, after) => {
  count++;
  return `${before}${servers[0]}/${game}/${after}`;
});
if (!count) throw new Error('No game cards found in public/index.html');
const config = JSON.stringify(servers).replace(/</g, '\\u003c');
const router = `<script>window.PCG_RENDER_SERVERS = ${config};</script>\n<script src="/selector-router.js" defer></script>\n`;
if (!html.includes('</body>')) throw new Error('Selection page is missing </body>');

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'index.html'), html.replace('</body>', `${router}</body>`));
fs.copyFileSync(path.join(root, 'scripts/selector-router.js'), path.join(output, 'selector-router.js'));
fs.cpSync(path.join(root, 'public/previews'), path.join(output, 'previews'), { recursive: true });
const fontRoot = path.join(output, 'vendor');
fs.mkdirSync(path.join(fontRoot, 'pretendard/variable'), { recursive: true });
fs.cpSync(path.join(root, 'node_modules/pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'), path.join(fontRoot, 'pretendard/variable/pretendardvariable-dynamic-subset.css'));
fs.cpSync(path.join(root, 'node_modules/pretendard/dist/web/variable/woff2-dynamic-subset'), path.join(fontRoot, 'pretendard/variable/woff2-dynamic-subset'), { recursive: true });
fs.cpSync(path.join(root, 'node_modules/@fontsource/anton'), path.join(fontRoot, 'anton'), { recursive: true });
console.log(`Built ${count} game cards for ${servers.length} configured server(s).`);
