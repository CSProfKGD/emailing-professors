import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
for (const dir of ['src','scripts','tests']) for (const file of await readdir(dir)) if (/\.m?js$/.test(file)) execFileSync(process.execPath, ['--check', `${dir}/${file}`], { stdio: 'inherit' });
for (const file of ['dist/index.html','dist/moderation.html']) { const html = await readFile(file,'utf8'); if (!html.includes('lang="en"') || !html.includes('name="viewport"')) throw new Error(`Missing document metadata: ${file}`); }
console.log('JavaScript syntax and document metadata checks passed.');
