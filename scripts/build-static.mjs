import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const origin = 'https://uchikara-clinic.com';
const root = process.cwd();
const routes = [
  '/',
  '/online/fever-clinic/',
  '/online/inter-medicine/',
  '/online/dermatology/',
  '/online/allergy-ent-pollen/',
  '/online/gynecology/',
  '/online/pediatrics/',
  '/online/lifestyle-disease/',
  '/online/urology/',
  '/online/psychosomatic-medicine/',
  '/concept/',
  '/online/',
  '/flow/',
  '/doctor/',
  '/faq/',
  '/pharmacy/',
  '/business/',
  '/recruit/doctor/',
  '/cordination/',
  '/cordination/hokkaido/',
  '/cordination/aomori/',
  '/cordination/fukushima/',
  '/cordination/miyagi/',
  '/cordination/tokyo/',
  '/cordination/kanagawa/',
  '/cordination/chiba/',
  '/cordination/saitama/',
  '/cordination/gunma/',
  '/cordination/aichi/',
  '/cordination/gifu/',
  '/cordination/nagano/',
  '/cordination/nigata/',
  '/cordination/osaka/',
  '/cordination/hyogo/',
  '/cordination/kyoto/',
  '/cordination/nara/',
  '/cordination/fukuoka/',
  '/cordination/nagasaki/',
  '/cordination/kagoshima/',
  '/cordination/okinawa/',
  '/privacy/',
  '/compliance/',
];

const staticRoutes = new Set(routes);
const queuedAssets = [];
const knownAssets = new Set();

function decodeEntities(value) {
  return value.replaceAll('&#038;', '&').replaceAll('&amp;', '&');
}

function normalizeRoute(pathname) {
  if (pathname === '/') return '/';
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

function outputPath(route) {
  return route === '/'
    ? path.join(root, 'index.html')
    : path.join(root, route.slice(1), 'index.html');
}

function removeWordPressRuntime(html) {
  const removableLink = [
    /<link[^>]+type=["']application\/rss\+xml["'][^>]*>\s*/gi,
    /<link[^>]+rel=["']EditURI["'][^>]*>\s*/gi,
    /<link[^>]+rel=["']wlwmanifest["'][^>]*>\s*/gi,
    /<link[^>]+href=["'][^"']*(?:wp-json|api\.w\.org)[^"']*["'][^>]*>\s*/gi,
    /<link[^>]+rel=["']shortlink["'][^>]*>\s*/gi,
    /<meta[^>]+name=["']generator["'][^>]*>\s*/gi,
  ];
  for (const pattern of removableLink) html = html.replace(pattern, '');

  html = html.replace(/<script\s+type=["']speculationrules["'][\s\S]*?<\/script>\s*/gi, '');
  html = html.replace(
    /<script[^>]+id=["'](?:wp-hooks-js|wp-i18n-js|wp-i18n-js-after|cloudflare-turnstile-js|cloudflare-turnstile-js-after|contact-form-7-js|contact-form-7-js-before)["'][\s\S]*?<\/script>\s*/gi,
    '',
  );
  html = html.replace(
    /<script[^>]+src=["']data:text\/javascript;base64,([^"']+)["'][^>]*><\/script>\s*/gi,
    (tag, encoded) => {
      try {
        const decoded = Buffer.from(encoded, 'base64').toString('utf8');
        return /increment_click_count|wpcf7submit|wpcf7mailsent|wpcf7spam|\bvar\s+wpcf7\b|wp\.i18n/.test(decoded) ? '' : tag;
      } catch {
        return tag;
      }
    },
  );
  return html;
}

function transformContactForm(html, route) {
  const formType = route === '/business/'
    ? 'business'
    : route === '/recruit/doctor/'
      ? 'doctor_recruit'
      : null;
  if (!formType) return html;

  const siteKey = html.match(/data-sitekey=["']([^"']+)["']/i)?.[1] ?? '';
  html = html.replace(
    /<form\s+action=["'][^"']*["']\s+method=["']post["']\s+class=["']([^"']*wpcf7-form[^"']*)["'][^>]*>/i,
    `<form action="/forms/submit.php" method="post" class="$1 uchikara-static-form" data-form-type="${formType}">\n`
      + `  <input type="hidden" name="form_type" value="${formType}">\n`
      + '  <div aria-hidden="true" class="uchikara-form-honeypot"><label>Webサイト<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>',
  );
  html = html.replace(/<fieldset\s+class=["']hidden-fields-container["'][\s\S]*?<\/fieldset>\s*/i, '');
  html = html.replace(/<div\s+class=["']wpcf7-turnstile[^"']*["'][^>]*><\/div>\s*/i, '');
  html = html.replace(/\s+novalidate=["']novalidate["']/gi, '');
  html = html.replace(/\s+data-status=["'][^"']*["']/gi, '');

  const requiredNames = formType === 'business'
    ? ['your-company', 'your-name', 'your-email', 'your-reason', 'your-acceptance']
    : ['your-name', 'your-email', 'your-region', 'your-acceptance'];
  for (const name of requiredNames) {
    const pattern = new RegExp(`(<(?:input|select|textarea)\\b[^>]*\\bname=["']${name}["'][^>]*)(>)`, 'gi');
    html = html.replace(pattern, (tag) => {
      if (/\brequired\b/i.test(tag)) return tag;
      return tag.replace(/\s*\/?>$/, (ending) => (ending.includes('/') ? ' required />' : ' required>'));
    });
  }

  if (siteKey) {
    const widget = `<div class="uchikara-form-turnstile"><div class="cf-turnstile" data-sitekey="${siteKey}"></div></div>`;
    html = html.replace(/(<input\b[^>]*\btype=["']submit["'][^>]*>)/i, `${widget}\n$1`);
  }
  return html;
}

function setNoIndex(html) {
  const robots = '<meta name="robots" content="noindex,nofollow,noarchive">';
  if (/<meta[^>]+name=["']robots["'][^>]*>/i.test(html)) {
    return html.replace(/<meta[^>]+name=["']robots["'][^>]*>/i, robots);
  }
  return html.replace(/<meta\s+name=["']viewport["'][^>]*>/i, (tag) => `${tag}\n${robots}`);
}

function rewriteInternalLinks(html) {
  return html.replace(
    /href=(["'])(https:\/\/uchikara-clinic\.com(?<target>\/[^"']*))\1/gi,
    (match, quote, _url, target) => {
      const parsed = new URL(decodeEntities(target), origin);
      if (!staticRoutes.has(normalizeRoute(parsed.pathname))) return match;
      return `href=${quote}${parsed.pathname}${parsed.search}${parsed.hash}${quote}`;
    },
  );
}

function assetPublicPath(pathname) {
  const mappings = [
    ['/wp-content/themes/template/assets/', '/assets/'],
    ['/wp-content/uploads/', '/assets/uploads/'],
    ['/wp-content/plugins/', '/assets/vendor/plugins/'],
    ['/wp-content/cache/', '/assets/vendor/cache/'],
    ['/wp-content/', '/assets/vendor/content/'],
    ['/wp-includes/', '/assets/vendor/core/'],
  ];
  for (const [source, destination] of mappings) {
    if (pathname.startsWith(source)) return pathname.replace(source, destination);
  }
  return pathname;
}

function rewriteLocalAssets(content) {
  return content
    .replaceAll(`${origin}/wp-content/themes/template/assets/`, '/assets/')
    .replaceAll(`${origin}/wp-content/uploads/`, '/assets/uploads/')
    .replaceAll(`${origin}/wp-content/plugins/`, '/assets/vendor/plugins/')
    .replaceAll(`${origin}/wp-content/cache/`, '/assets/vendor/cache/')
    .replaceAll(`${origin}/wp-content/`, '/assets/vendor/content/')
    .replaceAll(`${origin}/wp-includes/`, '/assets/vendor/core/')
    .replaceAll('/wp-content/themes/template/assets/', '/assets/')
    .replaceAll('/wp-content/uploads/', '/assets/uploads/')
    .replaceAll('/wp-content/plugins/', '/assets/vendor/plugins/')
    .replaceAll('/wp-content/cache/', '/assets/vendor/cache/')
    .replaceAll('/wp-content/', '/assets/vendor/content/')
    .replaceAll('/wp-includes/', '/assets/vendor/core/');
}

function addStaticRuntime(html) {
  const scripts = ['<script defer src="/assets/js/static-overrides.js"></script>'];
  if (html.includes('class="wpcf7-form') || html.includes('uchikara-static-form')) {
    html = html.replace(/<\/head>/i, '  <link rel="stylesheet" href="/assets/css/static-overrides.css">\n</head>');
    scripts.unshift('<script defer src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>');
  }
  return html.replace(/<\/body>/i, `  ${scripts.join('\n  ')}\n</body>`);
}

function queueAssetsFromHtml(html) {
  const pattern = /https:\/\/uchikara-clinic\.com\/(?:wp-content|wp-includes)\/[^\s"'<>),]+/gi;
  for (const match of html.matchAll(pattern)) {
    queueAsset(decodeEntities(match[0]));
  }
}

function queueAsset(value, base = origin) {
  let url;
  try {
    url = new URL(decodeEntities(value), base);
  } catch {
    return;
  }
  if (url.origin !== origin) return;
  if (!/^\/(?:wp-content|wp-includes)\//.test(url.pathname)) return;
  if (/\.php$/i.test(url.pathname) || url.pathname.includes('*')) return;
  url.hash = '';
  const key = `${url.origin}${url.pathname}`;
  if (knownAssets.has(key)) return;
  knownAssets.add(key);
  queuedAssets.push(url);
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function fetchPage(route) {
  const url = new URL(route, origin);
  const response = await fetch(url, {
    headers: { 'user-agent': 'UchikaraStaticMigration/1.0' },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
  const source = await response.text();
  queueAssetsFromHtml(source);
  let html = removeWordPressRuntime(source);
  html = transformContactForm(html, route);
  html = setNoIndex(html);
  html = rewriteInternalLinks(html);
  html = rewriteLocalAssets(html);
  html = addStaticRuntime(html);
  const destination = outputPath(route);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, html, 'utf8');
  process.stdout.write(`PAGE ${route}\n`);
}

function queueCssDependencies(css, cssUrl) {
  const pattern = /url\((?:["'])?(?<url>[^"')]+)(?:["'])?\)/gi;
  for (const match of css.matchAll(pattern)) {
    const value = match.groups?.url?.trim();
    if (!value || value.startsWith('data:') || value.startsWith('#')) continue;
    queueAsset(value, cssUrl);
  }
}

async function fetchAsset(url) {
  const relative = decodeURIComponent(assetPublicPath(url.pathname)).replace(/^\//, '');
  const destination = path.join(root, ...relative.split('/'));
  if (await exists(destination)) {
    if (/\.css$/i.test(destination)) {
      queueCssDependencies(await readFile(destination, 'utf8'), url);
    }
    return;
  }
  const response = await fetch(url, {
    headers: { 'user-agent': 'UchikaraStaticMigration/1.0' },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`${url.pathname}: HTTP ${response.status}`);
  let bytes = Buffer.from(await response.arrayBuffer());
  if (/\.css$/i.test(destination)) {
    bytes = Buffer.from(rewriteLocalAssets(bytes.toString('utf8')), 'utf8');
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
  if (/\.css$/i.test(destination)) queueCssDependencies(bytes.toString('utf8'), url);
}

async function runPool(items, concurrency, worker) {
  let cursor = 0;
  const runners = Array.from({ length: concurrency }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

await runPool(routes, 5, fetchPage);

let processed = 0;
while (processed < queuedAssets.length) {
  const batch = queuedAssets.slice(processed);
  processed = queuedAssets.length;
  await runPool(batch, 8, fetchAsset);
}

process.stdout.write(`DONE pages=${routes.length} assets=${knownAssets.size}\n`);
