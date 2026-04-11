// Web Search utilities extracted from lecture-rehearsal for reuse across all modules

export type WebSource = { 
  term: string; 
  title: string; 
  url: string; 
  extract: string; 
  provider?: string 
};

function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  return Promise.race([
    fetch(url),
    new Promise<Response>((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), timeoutMs)
    ),
  ]);
}

function stripHtmlToText(html: string): string {
  let s = html || '';
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<\/(p|div|br|li|h\d|pre|code)>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/g, ' ');
  s = s.replace(/&amp;/g, '&');
  s = s.replace(/&lt;/g, '<');
  s = s.replace(/&gt;/g, '>');
  s = s.replace(/&quot;/g, '"');
  s = s.replace(/&#39;/g, "'");
  s = s.replace(/\n{3,}/g, '\n\n');
  s = s.replace(/[ \t]{2,}/g, ' ');
  return s.trim();
}

const ALLOWED_HOSTS = new Set<string>([
  'developer.mozilla.org',
  'developer.chrome.com',
  'learn.microsoft.com',
  'nodejs.org',
  'typescriptlang.org',
  'react.dev',
  'nextjs.org',
  'docs.python.org',
  'docs.oracle.com',
  'pkg.go.dev',
  'doc.rust-lang.org',
  'en.wikipedia.org',
  'zh.wikipedia.org',
]);

function isAllowedUrl(u: string): boolean {
  try {
    const url = new URL(u);
    const host = url.hostname.toLowerCase();
    return ALLOWED_HOSTS.has(host);
  } catch {
    return false;
  }
}

async function fetchPageExtract(url: string): Promise<{ title: string; extract: string } | null> {
  if (!isAllowedUrl(url)) return null;
  const res = await fetchWithTimeout(url, 7000);
  if (!res.ok) return null;
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (!(ct.includes('text/html') || ct.includes('text/plain'))) return null;
  const html = (await res.text().catch(() => '')).slice(0, 220_000);
  if (!html) return null;
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripHtmlToText(titleMatch[1]).slice(0, 120) : url;
  const metaDesc =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1] ||
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1] ||
    '';
  let extract = metaDesc ? stripHtmlToText(metaDesc) : '';
  if (!extract) {
    extract = stripHtmlToText(html);
  }
  extract = extract
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^skip to /i.test(l) && !/^skip to main content/i.test(l) && !/^skip to search/i.test(l))
    .join('\n');
  extract = extract.slice(0, 900);
  if (!extract) return null;
  return { title, extract };
}

function decodeDuckDuckGoRedirect(href: string): string {
  try {
    const u = new URL(href);
    if (u.hostname !== 'duckduckgo.com' && u.hostname !== 'www.duckduckgo.com') return href;
    const uddg = u.searchParams.get('uddg');
    if (!uddg) return href;
    return decodeURIComponent(uddg);
  } catch {
    return href;
  }
}

async function duckDuckGoSearch(query: string): Promise<Array<{ title: string; url: string }>> {
  const q = (query || '').trim();
  if (!q) return [];
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
  const res = await fetchWithTimeout(url, 7000);
  if (!res.ok) return [];
  const html = (await res.text().catch(() => '')).slice(0, 250_000);
  if (!html) return [];

  const out: Array<{ title: string; url: string }> = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && out.length < 8) {
    const href = decodeDuckDuckGoRedirect(m[1]);
    const title = stripHtmlToText(m[2]).slice(0, 140);
    if (!href || !title) continue;
    out.push({ title, url: href });
  }
  return out;
}

async function googleCseSearch(query: string): Promise<Array<{ title: string; url: string; snippet?: string }>> {
  const key = process.env.GOOGLE_CSE_API_KEY;
  const cx = process.env.GOOGLE_CSE_ID;
  const q = (query || '').trim();
  if (!key || !cx || !q) return [];
  const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(q)}`;
  const res = await fetchWithTimeout(url, 7000);
  if (!res.ok) return [];
  const json: any = await res.json().catch(() => ({}));
  const items = Array.isArray(json?.items) ? json.items : [];
  return items
    .map((it: any) => ({
      title: typeof it?.title === 'string' ? it.title : '',
      url: typeof it?.link === 'string' ? it.link : '',
      snippet: typeof it?.snippet === 'string' ? it.snippet : '',
    }))
    .filter((x: any) => x.title && x.url);
}

async function searchWeb(query: string): Promise<Array<{ title: string; url: string }>> {
  // Use DuckDuckGo as primary search engine (no API key required)
  return await duckDuckGoSearch(query);
}

async function mdnLookup(query: string): Promise<WebSource | null> {
  const q = (query || '').trim();
  if (!q) return null;
  const apiUrl = `https://developer.mozilla.org/api/v1/search?q=${encodeURIComponent(q)}`;
  const res = await fetchWithTimeout(apiUrl, 7000);
  if (!res.ok) return null;
  const json: any = await res.json().catch(() => ({}));
  const docs = Array.isArray(json?.documents) ? json.documents : [];
  const doc = docs[0];
  const mdnUrlRaw = typeof doc?.mdn_url === 'string' ? doc.mdn_url : typeof doc?.url === 'string' ? doc.url : '';
  const url = mdnUrlRaw
    ? mdnUrlRaw.startsWith('http')
      ? mdnUrlRaw
      : `https://developer.mozilla.org${mdnUrlRaw.startsWith('/') ? '' : '/'}${mdnUrlRaw}`
    : '';
  if (!url || !isAllowedUrl(url)) return null;

  const excerptRaw = typeof doc?.excerpt === 'string' ? doc.excerpt : '';
  const excerpt = excerptRaw ? stripHtmlToText(excerptRaw) : '';
  if (excerpt) {
    return {
      term: q,
      title: typeof doc?.title === 'string' ? doc.title : 'MDN',
      url,
      extract: excerpt.slice(0, 900),
      provider: 'mdn',
    };
  }
  const page = await fetchPageExtract(url);
  if (!page) return null;
  return { term: q, title: page.title, url, extract: page.extract, provider: 'mdn' };
}

function pickWikiLang(primaryLanguage: string): string {
  const langMap: Record<string, string> = {
    'English': 'en',
    '繁體中文': 'zh-tw',
    '简体中文': 'zh-cn',
    '日本語': 'ja',
    '한국어': 'ko',
  };
  return langMap[primaryLanguage] || 'en';
}

async function wikiLookup(term: string, lang: string): Promise<WebSource | null> {
  const q = (term || '').trim();
  if (!q) return null;
  const host = lang === 'zh-tw' ? 'zh.wikipedia.org' : lang === 'zh-cn' ? 'zh.wikipedia.org' : 'en.wikipedia.org';
  const apiUrl = `https://${host}/api/rest_v1/page/summary/${encodeURIComponent(q.replace(/ /g, '_'))}`;
  const res = await fetchWithTimeout(apiUrl, 7000);
  if (!res.ok) return null;
  const json: any = await res.json().catch(() => ({}));
  const title = typeof json?.title === 'string' ? json.title : q;
  const extract = typeof json?.extract === 'string' ? json.extract : '';
  if (!extract) return null;
  const wikiUrl = `https://${host}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
  return { term: q, title, url: wikiUrl, extract, provider: 'wikipedia' } satisfies WebSource;
}

export async function gatherWebSources(params: { 
  queries: string[]; 
  primaryLanguage: string 
}): Promise<WebSource[]> {
  const { queries, primaryLanguage } = params;
  const wikiLang = pickWikiLang(primaryLanguage);
  const sources: WebSource[] = [];

  const unique = Array.from(new Set((queries || []).map((q) => q.trim()).filter(Boolean))).slice(0, 6);
  for (const term of unique) {
    if (sources.length >= 8) break;

    // 1) MDN first (for web/dev terms)
    const mdn = await mdnLookup(term).catch(() => null);
    if (mdn) sources.push(mdn);

    if (sources.length >= 8) break;

    // 2) Google/DDG search -> allowlisted pages -> extract
    const results = await searchWeb(term).catch(() => []);
    const candidates = results
      .map((r) => ({ ...r, url: decodeDuckDuckGoRedirect(r.url) }))
      .filter((r) => r.url && isAllowedUrl(r.url))
      .slice(0, 2);

    for (const c of candidates) {
      if (sources.length >= 8) break;
      if (sources.some((s) => s.url === c.url)) continue;
      const page = await fetchPageExtract(c.url).catch(() => null);
      if (!page) continue;
      sources.push({ term, title: page.title || c.title, url: c.url, extract: page.extract, provider: 'web' });
    }

    if (sources.length >= 8) break;

    // 3) Wikipedia fallback
    const wiki = await wikiLookup(term, wikiLang).catch(() => null);
    if (wiki && !sources.some((s) => s.url === wiki.url)) sources.push(wiki);
  }

  return sources;
}
