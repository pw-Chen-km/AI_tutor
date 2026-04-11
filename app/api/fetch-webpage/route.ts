import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import prisma from '@/lib/db/client';
import { PLAN_CONFIG } from '@/lib/db/schema';

export const runtime = 'nodejs';

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local')) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const parts = host.split('.').map((n) => Number(n));
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
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

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const subscription = await prisma.subscription.findUnique({
      where: { userId: session.user.id },
    });
    if (!subscription) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
    }
    const planConfig = PLAN_CONFIG[subscription.plan as keyof typeof PLAN_CONFIG];
    if (!planConfig?.features?.webSearch) {
      return NextResponse.json({ error: 'Web search not available' }, { status: 403 });
    }

    const body = await req.json();
    const urlRaw = (body?.url || '').toString().trim();
    if (!urlRaw) {
      return NextResponse.json({ error: 'url is required' }, { status: 400 });
    }
    let url: URL;
    try {
      url = new URL(urlRaw);
    } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      return NextResponse.json({ error: 'Only http/https are supported' }, { status: 400 });
    }
    if (isPrivateHost(url.hostname)) {
      return NextResponse.json({ error: 'Private or local URL is not allowed' }, { status: 400 });
    }

    const res = await fetchWithTimeout(url.toString(), 8000);
    if (!res.ok) {
      return NextResponse.json({ error: `Fetch failed (${res.status})` }, { status: 400 });
    }
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!(ct.includes('text/html') || ct.includes('text/plain'))) {
      return NextResponse.json({ error: 'Unsupported content type' }, { status: 400 });
    }
    const html = (await res.text().catch(() => '')).slice(0, 250_000);
    if (!html) {
      return NextResponse.json({ error: 'Empty response' }, { status: 400 });
    }

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? stripHtmlToText(titleMatch[1]).slice(0, 120) : url.toString();
    let extract = '';
    const metaDesc =
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1] ||
      html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1] ||
      '';
    if (metaDesc) {
      extract = stripHtmlToText(metaDesc);
    }
    if (!extract) {
      extract = stripHtmlToText(html);
    }
    extract = extract
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !/^skip to /i.test(l) && !/^skip to main content/i.test(l) && !/^skip to search/i.test(l))
      .join('\n')
      .slice(0, 1200);

    return NextResponse.json({ title, url: url.toString(), extract });
  } catch (error: any) {
    console.error('Fetch webpage error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to fetch webpage' }, { status: 500 });
  }
}
