import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const forwardedRequestHeaders = ["accept", "accept-language", "range", "user-agent"];
const passthroughResponseHeaders = [
  "accept-ranges",
  "cache-control",
  "content-range",
  "content-type",
  "date",
  "etag",
  "expires",
  "last-modified",
];

function buildProxyUrl(url: string) {
  return `/api/stream?url=${encodeURIComponent(url)}`;
}

function resolveUrl(value: string, baseUrl: string) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}

function rewriteM3uPlaylist(text: string, baseUrl: string) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      if (trimmed.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (_match, value: string) => {
          const resolved = resolveUrl(value, baseUrl);
          return resolved ? `URI="${buildProxyUrl(resolved)}"` : `URI="${value}"`;
        });
      }

      const resolved = resolveUrl(trimmed, baseUrl);
      return resolved ? buildProxyUrl(resolved) : line;
    })
    .join("\n");
}

function rewriteDashManifest(text: string, baseUrl: string) {
  return text
    .replace(/(<BaseURL[^>]*>)([^<]+)(<\/BaseURL>)/gi, (_match, open, value: string, close) => {
      const resolved = resolveUrl(value.trim(), baseUrl);
      return resolved ? `${open}${buildProxyUrl(resolved)}${close}` : `${open}${value}${close}`;
    })
    .replace(/\b(href|media|initialization|sourceURL)=("([^"]*)"|'([^']*)')/gi, (_match, attr, quoted, doubleValue, singleValue) => {
      const value = doubleValue ?? singleValue ?? "";
      const resolved = resolveUrl(value, baseUrl);
      if (!resolved) return `${attr}=${quoted}`;

      const quote = quoted[0];
      return `${attr}=${quote}${buildProxyUrl(resolved)}${quote}`;
    });
}

function isM3uContent(url: string, contentType: string | null) {
  const normalizedUrl = url.toLowerCase();
  const normalizedType = (contentType || "").toLowerCase();

  return (
    normalizedUrl.includes(".m3u8") ||
    normalizedType.includes("application/vnd.apple.mpegurl") ||
    normalizedType.includes("application/x-mpegurl")
  );
}

function isDashContent(url: string, contentType: string | null) {
  const normalizedUrl = url.toLowerCase();
  const normalizedType = (contentType || "").toLowerCase();

  return normalizedUrl.includes(".mpd") || normalizedType.includes("application/dash+xml");
}

export async function GET(request: NextRequest) {
  const target = request.nextUrl.searchParams.get("url");
  if (!target) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  let parsedTarget: URL;
  try {
    parsedTarget = new URL(target);
  } catch {
    return NextResponse.json({ error: "Invalid target URL" }, { status: 400 });
  }

  if (!["http:", "https:"].includes(parsedTarget.protocol)) {
    return NextResponse.json({ error: "Unsupported protocol" }, { status: 400 });
  }

  const headers = new Headers();
  for (const name of forwardedRequestHeaders) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  let upstream: Response;
  try {
    upstream = await fetch(parsedTarget.toString(), {
      headers,
      cache: "no-store",
      redirect: "follow",
    });
  } catch {
    return NextResponse.json({ error: "Upstream stream request failed" }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return new NextResponse(upstream.body, {
      status: upstream.status || 502,
      statusText: upstream.statusText,
    });
  }

  const contentType = upstream.headers.get("content-type");
  const responseHeaders = new Headers();
  for (const name of passthroughResponseHeaders) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }

  responseHeaders.set("access-control-allow-origin", "*");
  responseHeaders.set("x-robots-tag", "noindex");

  if (isM3uContent(parsedTarget.toString(), contentType)) {
    const text = await upstream.text();
    const body = rewriteM3uPlaylist(text, parsedTarget.toString());
    responseHeaders.set("content-type", "application/vnd.apple.mpegurl");
    responseHeaders.delete("content-range");
    return new NextResponse(body, { status: upstream.status, headers: responseHeaders });
  }

  if (isDashContent(parsedTarget.toString(), contentType)) {
    const text = await upstream.text();
    const body = rewriteDashManifest(text, parsedTarget.toString());
    responseHeaders.set("content-type", "application/dash+xml");
    responseHeaders.delete("content-range");
    return new NextResponse(body, { status: upstream.status, headers: responseHeaders });
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
