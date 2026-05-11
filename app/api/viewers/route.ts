import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRESENCE_TTL_MS = 45_000;

type PresenceStore = {
  siteSessions: Map<string, number>;
  channelSessions: Map<string, Map<string, number>>;
};

declare global {
  // eslint-disable-next-line no-var
  var liveTvViewerPresence: PresenceStore | undefined;
}

function getPresenceStore() {
  if (!globalThis.liveTvViewerPresence) {
    globalThis.liveTvViewerPresence = {
      siteSessions: new Map(),
      channelSessions: new Map(),
    };
  }

  return globalThis.liveTvViewerPresence;
}

function cleanupExpiredSessions(store: PresenceStore, now: number) {
  for (const [sessionId, lastSeenAt] of store.siteSessions.entries()) {
    if (now - lastSeenAt > PRESENCE_TTL_MS) {
      store.siteSessions.delete(sessionId);
    }
  }

  for (const [channelId, sessions] of store.channelSessions.entries()) {
    for (const [sessionId, lastSeenAt] of sessions.entries()) {
      if (now - lastSeenAt > PRESENCE_TTL_MS || !store.siteSessions.has(sessionId)) {
        sessions.delete(sessionId);
      }
    }

    if (sessions.size === 0) {
      store.channelSessions.delete(channelId);
    }
  }
}

function getSiteCount() {
  const store = getPresenceStore();
  const now = Date.now();
  cleanupExpiredSessions(store, now);
  return store.siteSessions.size;
}

function getChannelCount(channelId: string) {
  const store = getPresenceStore();
  const now = Date.now();
  cleanupExpiredSessions(store, now);
  return store.channelSessions.get(channelId)?.size ?? 0;
}

function moveViewer(channelId: string, sessionId: string, previousChannelId?: string | null) {
  const store = getPresenceStore();
  const now = Date.now();
  cleanupExpiredSessions(store, now);
  store.siteSessions.set(sessionId, now);

  if (previousChannelId && previousChannelId !== channelId) {
    const previousSessions = store.channelSessions.get(previousChannelId);
    previousSessions?.delete(sessionId);
    if (previousSessions && previousSessions.size === 0) {
      store.channelSessions.delete(previousChannelId);
    }
  }

  const sessions = store.channelSessions.get(channelId) ?? new Map<string, number>();
  sessions.set(sessionId, now);
  store.channelSessions.set(channelId, sessions);

  return {
    channelCount: sessions.size,
    siteCount: store.siteSessions.size,
  };
}

function removeViewer(channelId: string, sessionId: string) {
  const store = getPresenceStore();
  const now = Date.now();
  cleanupExpiredSessions(store, now);
  store.siteSessions.delete(sessionId);

  const sessions = store.channelSessions.get(channelId);
  sessions?.delete(sessionId);

  if (sessions && sessions.size === 0) {
    store.channelSessions.delete(channelId);
  }

  return {
    channelCount: store.channelSessions.get(channelId)?.size ?? 0,
    siteCount: store.siteSessions.size,
  };
}

export async function GET(request: NextRequest) {
  const channelId = request.nextUrl.searchParams.get("channelId");
  if (!channelId) {
    return NextResponse.json({ count: getSiteCount() });
  }

  return NextResponse.json({
    count: getChannelCount(channelId),
    siteCount: getSiteCount(),
  });
}

export async function POST(request: NextRequest) {
  let body: {
    channelId?: string;
    sessionId?: string;
    previousChannelId?: string | null;
    action?: "heartbeat" | "leave";
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const channelId = body.channelId?.trim();
  const sessionId = body.sessionId?.trim();

  if (!channelId || !sessionId) {
    return NextResponse.json({ error: "channelId and sessionId are required" }, { status: 400 });
  }

  const counts =
    body.action === "leave"
      ? removeViewer(channelId, sessionId)
      : moveViewer(channelId, sessionId, body.previousChannelId?.trim());

  return NextResponse.json(counts);
}
