import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
const env = {};
try { for (const line of (await readFile('.env', 'utf8')).split('\n')) { const match = line.match(/^([A-Z_]+)=(.*)$/); if (match) env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, ''); } } catch {}
const url = process.env.SUPABASE_URL || env.SUPABASE_URL || '';
const key = process.env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || '';
if (Boolean(url) !== Boolean(key)) throw new Error('Set both SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.');
if (url && !/^https:\/\/[^/]+(?:\/)?$/.test(url)) throw new Error('SUPABASE_URL must be an HTTPS origin.');
if (key.startsWith('sb_secret_')) throw new Error('Never put a Supabase secret in browser configuration.');
if (key.startsWith('eyJ')) { const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url')); if (payload.role !== 'anon') throw new Error('Only a publishable or legacy anon key is allowed.'); }
await build({ entryPoints: ['src/app.js', 'src/moderation.js'], outdir: 'dist/assets', bundle: true, splitting: true, format: 'esm', minify: true, target: 'es2022', plugins: [{ name: 'public-config', setup(builder) { builder.onLoad({ filter: /src\/config\.js$/ }, () => ({ contents: `export const config = ${JSON.stringify({ url, key })}`, loader: 'js' })); } }] });
console.log(`Built article and moderation scripts. Supabase ${url ? 'configured' : 'not configured; sign-in and saving remain unavailable'}.`);
