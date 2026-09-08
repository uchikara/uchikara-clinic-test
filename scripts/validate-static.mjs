import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const ignoredDirectories = new Set(['node_modules', 'scripts']);

async function findIndexFiles(directory) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...(await findIndexFiles(fullPath)));
    if (entry.isFile() && entry.name === 'index.html') results.push(fullPath);
  }
  return results;
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

const pages = await findIndexFiles(root);
const errors = [];
const assetPattern = /\/assets\/[^\s"'<>),]+/gi;
let staticFormCount = 0;

for (const page of pages) {
  const html = await readFile(page, 'utf8');
  const label = path.relative(root, page) || 'index.html';
  if (!/<html\s+lang=["']ja["']/i.test(html)) errors.push(`${label}: lang=jaなし`);
  if (!/<title>[^<]+<\/title>/i.test(html)) errors.push(`${label}: titleなし`);
  if (!/<meta[^>]+name=["']robots["'][^>]+noindex/i.test(html)) errors.push(`${label}: noindexなし`);
  if (!/<link[^>]+rel=["']canonical["']/i.test(html)) errors.push(`${label}: canonicalなし`);
  if (/(?:wp-content|wp-includes)/i.test(html)) {
    errors.push(`${label}: WordPressアセットパスあり`);
  }
  if (/wp-hooks-js|wp-i18n-js|cloudflare-turnstile-js|my_ajax_object/i.test(html)) {
    errors.push(`${label}: WordPress実行時JSあり`);
  }
  const forms = html.match(/<form\b[^>]*\buchikara-static-form\b[^>]*>/gi) ?? [];
  staticFormCount += forms.length;
  for (const form of forms) {
    if (!/action=["']\/forms\/submit\.php["']/i.test(form)) errors.push(`${label}: フォーム送信先不一致`);
    if (!/method=["']post["']/i.test(form)) errors.push(`${label}: フォームがPOSTではない`);
  }
  if (forms.length && !/class=["'][^"']*cf-turnstile/i.test(html)) errors.push(`${label}: Turnstileなし`);
  if (/\/wp-json\/contact-form-7|wpcf7\.api/i.test(html)) {
    errors.push(`${label}: Contact Form 7実行時参照あり`);
  }
  for (const match of html.matchAll(assetPattern)) {
    const relative = match[0].replace(/&#038;.*$/, '').replace(/\?.*$/, '');
    if (relative.includes('*')) continue;
    const local = path.join(root, ...decodeURIComponent(relative).replace(/^\//, '').split('/'));
    if (!(await exists(local))) errors.push(`${label}: アセット欠落 ${relative}`);
  }
}

if (pages.length !== 42) errors.push(`ページ数不一致: ${pages.length}/42`);
if (staticFormCount !== 2) errors.push(`静的フォーム数不一致: ${staticFormCount}/2`);
for (const requiredFile of ['forms/bootstrap.php', 'forms/submit.php', 'forms/config.example.php']) {
  if (!(await exists(path.join(root, ...requiredFile.split('/'))))) errors.push(`フォームファイル欠落: ${requiredFile}`);
}

if (errors.length) {
  process.stderr.write(`${errors.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(`OK pages=${pages.length}\n`);
