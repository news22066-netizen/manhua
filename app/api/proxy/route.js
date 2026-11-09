/**
 * Image proxy: /api/proxy?url=<encoded remote image url>
 *
 * - Edge runtime: streams the body (no buffering), cheap on Vercel's free tier.
 * - Sends browser-like request headers, Referer inferred from the target origin.
 * - Aggressive immutable caching so Cloudflare / Vercel CDN serve repeat hits.
 * - Host allowlist: without it this would be an open proxy / SSRF hole.
 *   Only add hosts you are entitled to fetch from.
 *
 * Allowed upstreams:
 *   - uploads.mangadex.org      cover art (what the homepage grid uses)
 *   - api.mangadex.org          explicitly allowed; note that only image/* responses
 *                               are ever streamed back (JSON etc. gets a 415 below)
 *   - *.mangadex.network        MangaDex@Home nodes that serve chapter page images
 *                               (the reader page needs these, so they must stay allowed)
 */
export const runtime = 'edge';

// Exact hostnames (compared case-insensitively).
const ALLOWED_HOSTS = ['api.mangadex.org', 'uploads.mangadex.org'];

// Suffix matches for the rotating MangaDex@Home node hostnames used by the chapter reader.
const ALLOWED_HOST_SUFFIXES = ['.mangadex.network'];

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const IMMUTABLE = 'public, max-age=31536000, s-maxage=31536000, immutable';

function isAllowedHost(hostname) {
  const host = hostname.toLowerCase();
  return ALLOWED_HOSTS.includes(host) || ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export async function GET(request) {
  const raw = new URL(request.url).searchParams.get('url');
  if (!raw) return new Response('Missing "url" parameter', { status: 400 });

  let target;
  try {
    target = new URL(raw);
  } catch {
    return new Response('Invalid url', { status: 400 });
  }

  // Security host validation: HTTPS only, no embedded credentials, allowlisted hosts only.
  if (
    target.protocol !== 'https:' ||
    target.username ||
    target.password ||
    !isAllowedHost(target.hostname)
  ) {
    return new Response('Host not allowed', { status: 403 });
  }

  let upstream;
  try {
    upstream = await fetch(target.toString(), {
      // Modern browser User-Agent + Referer that matches the target domain.
      headers: { ...BROWSER_HEADERS, Referer: `${target.origin}/` },
      redirect: 'error', // never follow redirects to non-allowlisted hosts
    });
  } catch {
    return new Response('Upstream unreachable', { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }

  // Never let errors get cached as "immutable".
  if (!upstream.ok || !upstream.body) {
    return new Response(`Upstream error ${upstream.status}`, {
      status: upstream.status === 404 ? 404 : 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const type = upstream.headers.get('content-type') || '';
  if (!type.startsWith('image/')) {
    return new Response('Not an image', { status: 415, headers: { 'Cache-Control': 'no-store' } });
  }

  const headers = new Headers({
    'Content-Type': type,
    'Cache-Control': IMMUTABLE,
    'X-Content-Type-Options': 'nosniff',
  });
  const len = upstream.headers.get('content-length');
  if (len) headers.set('Content-Length', len);

  return new Response(upstream.body, { status: 200, headers });
}