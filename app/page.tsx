"use client";

import DarkVeil from "@/components/DarkVeil";
import HlsPlayer from "@/components/HlsPlayer";
import { channels } from "@/lib/channels";
import type { Channel } from "@/lib/types";
import { MonitorPlay, Users, WifiOff } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

const preferredCategoryOrder = [
  "All",
  "Bangla",
  "English",
  "Hindi",
  "Urdu",
  "Islamic",
  "Kids",
  "Sports",
  "News",
  "Movies",
  "Music",
  "Documentary",
  "Other",
];

function getInitialChannel(): Channel {
  const banglaChannels = channels.filter((channel) => channel.category === "Bangla");
  return banglaChannels[0] ?? channels[0];
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function createSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `viewer-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

function ChannelTile({
  channel,
  isActive,
  onSelect,
}: {
  channel: Channel;
  isActive: boolean;
  onSelect: () => void;
}) {
  const [logoFailed, setLogoFailed] = useState(false);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group relative aspect-square overflow-hidden rounded-lg border-2 transition-all duration-300 ${
        isActive
          ? "border-red-500 bg-white shadow-xl shadow-red-500/30 scale-105"
          : "border-slate-700/50 bg-white hover:border-slate-600"
      }`}
      title={channel.name}
    >
      <div className="flex h-full w-full items-center justify-center bg-white p-2 transition-colors duration-300">
        {channel.logo && !logoFailed ? (
          <img
            src={channel.logo}
            alt={channel.name}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="max-h-full max-w-full object-contain transition-all duration-300 group-hover:scale-110"
            onError={() => setLogoFailed(true)}
          />
        ) : (
          <span className={`text-center text-xs font-bold transition-colors duration-300 ${
            isActive ? "text-red-400" : "text-slate-400"
          }`}>{getInitials(channel.name)}</span>
        )}
      </div>
    </button>
  );
}

export default function HomePage() {
  const [activeCategory, setActiveCategory] = useState("All");
  const [selectedChannel, setSelectedChannel] = useState<Channel>(() => getInitialChannel());
  const [viewerSessionId, setViewerSessionId] = useState("");
  const [siteViewerCount, setSiteViewerCount] = useState(0);
  const [siteViewerCountLoading, setSiteViewerCountLoading] = useState(true);
  const currentChannelIdRef = useRef(selectedChannel.slug);
  const previousChannelIdRef = useRef<string | null>(null);

  const categories = useMemo(() => {
    const unique = Array.from(new Set(channels.map((channel) => channel.category))).filter(Boolean);
    return preferredCategoryOrder.filter((category) => category === "All" || unique.includes(category));
  }, []);

  const filteredChannels = useMemo(() => {
    return channels.filter((channel) => {
      return activeCategory === "All" || channel.category === activeCategory;
    });
  }, [activeCategory]);

  useEffect(() => {
    if (filteredChannels.length === 0) return;

    const selectedStillVisible = filteredChannels.some((channel) => channel.id === selectedChannel.id);
    if (!selectedStillVisible) {
      setSelectedChannel(filteredChannels[0]);
    }
  }, [filteredChannels, selectedChannel.id]);

  useEffect(() => {
    const storageKey = "live-tv-viewer-session";
    const existingSessionId = window.sessionStorage.getItem(storageKey);
    if (existingSessionId) {
      setViewerSessionId(existingSessionId);
      return;
    }

    const nextSessionId = createSessionId();
    window.sessionStorage.setItem(storageKey, nextSessionId);
    setViewerSessionId(nextSessionId);
  }, []);

  useEffect(() => {
    if (!viewerSessionId) return;

    currentChannelIdRef.current = selectedChannel.slug;
  }, [selectedChannel.slug]);

  useEffect(() => {
    if (!viewerSessionId) return;

    let cancelled = false;
    const channelId = selectedChannel.slug;
    const previousChannelId = previousChannelIdRef.current;
    previousChannelIdRef.current = channelId;

    const syncPresence = async (action: "heartbeat" | "leave") => {
      try {
        const response = await fetch("/api/viewers", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            action,
            channelId,
            previousChannelId: action === "heartbeat" ? previousChannelId : undefined,
            sessionId: viewerSessionId,
          }),
          cache: "no-store",
          keepalive: action === "leave",
        });

        if (!response.ok || cancelled) return;

        const data: { siteCount?: number } = await response.json();
        if (typeof data.siteCount === "number") {
          setSiteViewerCount(data.siteCount);
          setSiteViewerCountLoading(false);
        }
      } catch {
        if (!cancelled && action !== "leave") {
          setSiteViewerCountLoading(false);
        }
      }
    };

    setSiteViewerCountLoading(true);
    void syncPresence("heartbeat");

    const intervalId = window.setInterval(() => {
      const activeChannelId = currentChannelIdRef.current;

      void fetch("/api/viewers", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "heartbeat",
          channelId: activeChannelId,
          sessionId: viewerSessionId,
        }),
        cache: "no-store",
      })
        .then(async (response) => {
          if (!response.ok || cancelled) return;

          const data: { siteCount?: number } = await response.json();
          if (typeof data.siteCount === "number") {
            setSiteViewerCount(data.siteCount);
            setSiteViewerCountLoading(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSiteViewerCountLoading(false);
          }
        });
    }, 15_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [selectedChannel.slug, viewerSessionId]);

  useEffect(() => {
    if (!viewerSessionId) return;

    const sendLeaveBeacon = () => {
      const channelId = currentChannelIdRef.current;
      if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") {
        void fetch("/api/viewers", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            action: "leave",
            channelId,
            sessionId: viewerSessionId,
          }),
          cache: "no-store",
          keepalive: true,
        });
        return;
      }

      const payload = new Blob(
        [
          JSON.stringify({
            action: "leave",
            channelId,
            sessionId: viewerSessionId,
          }),
        ],
        { type: "application/json" },
      );

      navigator.sendBeacon("/api/viewers", payload);
    };

    const handleBeforeUnload = () => {
      sendLeaveBeacon();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      sendLeaveBeacon();
    };
  }, [viewerSessionId]);

  function handleCategoryChange(category: string) {
    setActiveCategory(category);

    const nextChannel = channels.find((channel) => {
      return category === "All" || channel.category === category;
    });

    if (nextChannel) setSelectedChannel(nextChannel);
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-white">
      <div className="pointer-events-none absolute inset-0">
        <DarkVeil
          hueShift={0}
          noiseIntensity={0.03}
          scanlineIntensity={0.06}
          speed={0.55}
          scanlineFrequency={1.2}
          warpAmount={0.24}
          resolutionScale={1}
          className="h-full w-full opacity-100"
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(96,165,250,0.16),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(244,114,182,0.1),transparent_28%),linear-gradient(180deg,rgba(2,6,23,0.1),rgba(2,6,23,0.56))]" />
      </div>

      <section className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1920px] flex-col gap-3 p-3 sm:gap-4 sm:p-4 lg:flex-row lg:gap-5 lg:p-6">
        <div className="flex min-h-[320px] flex-1 flex-col gap-3 sm:gap-4 lg:min-h-[calc(100vh-48px)]">
          {/* Header */}
          <div className="glass rounded-xl px-4 py-4 shadow-2xl sm:px-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3 sm:items-center sm:gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl sm:h-14 sm:w-14">
                  <Image
                    src="/logo.png"
                    alt="LalShaluk TV logo"
                    width={48}
                    height={48}
                    className="h-10 w-10 object-contain sm:h-12 sm:w-12"
                    priority
                  />
                </div>
                <div className="min-w-0">
                  <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">LalShaluk TV</h1>
                  <div className="mt-1 flex flex-col gap-2 sm:mt-0 sm:flex-row sm:flex-wrap sm:items-center">
                    <p className="min-w-0 truncate text-sm text-slate-400">{selectedChannel.name}</p>
                    <div className="inline-flex w-fit items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-300">
                      <Users className="h-3.5 w-3.5" />
                      <span>{siteViewerCountLoading ? "Counting..." : `${siteViewerCount} watching now`}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex w-full items-center justify-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-slate-300 sm:w-auto">
                <MonitorPlay className="h-4 w-4 text-red-400" />
                <span>{channels.length} Channels</span>
              </div>
            </div>
          </div>

          {/* Player */}
          <div className="glass min-h-[220px] flex-1 overflow-hidden rounded-xl border border-slate-700/50 shadow-2xl sm:min-h-[280px] lg:min-h-0">
            <HlsPlayer src={selectedChannel.streamUrl} title={selectedChannel.name} />
          </div>
        </div>

        {/* Sidebar */}
        <aside className="glass w-full rounded-xl border border-slate-700/50 p-3 shadow-2xl sm:p-4 lg:h-[calc(100vh-48px)] lg:w-[36%] xl:w-[34%] 2xl:w-[32%]">
          <div className="flex h-full flex-col">
            {/* Categories Header */}
            <div className="flex flex-col gap-3 border-b border-slate-700/40 pb-4">
              <div>
                <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400">Categories</h2>
              </div>

              {/* Category Buttons */}
              <div className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3">
                {categories.map((category) => (
                  <button
                    key={category}
                    type="button"
                    onClick={() => handleCategoryChange(category)}
                    className={`min-h-10 rounded-md px-3 py-2 text-xs font-semibold transition-all duration-300 ${
                      activeCategory === category
                        ? "bg-gradient-to-r from-red-500 to-red-600 text-white shadow-lg shadow-red-500/30"
                        : "bg-slate-800/50 text-slate-300 hover:bg-slate-700/50 hover:text-slate-100"
                    }`}
                  >
                    {category}
                  </button>
                ))}
              </div>
            </div>

            {/* Channel Count */}
            <div className="mt-3 flex items-center justify-between px-1 text-xs text-slate-500">
              <span className="font-medium">{filteredChannels.length} channel{filteredChannels.length === 1 ? "" : "s"}</span>
              <span className="text-slate-600">{activeCategory}</span>
            </div>

            {/* Channels Grid */}
            <div className="mt-3 flex-1 overflow-y-auto pr-1">
              {filteredChannels.length > 0 ? (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-5 xl:grid-cols-6">
                  {filteredChannels.map((channel) => (
                    <ChannelTile
                      key={`${channel.id}-${channel.slug}`}
                      channel={channel}
                      isActive={selectedChannel.id === channel.id}
                      onSelect={() => setSelectedChannel(channel)}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex min-h-[280px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-700/40 bg-slate-900/40 p-6 text-center">
                  <WifiOff className="h-8 w-8 text-slate-600" />
                  <h3 className="mt-3 text-sm font-semibold text-slate-300">No channels found</h3>
                  <p className="mt-1 max-w-sm text-xs text-slate-500">Try selecting another category.</p>
                </div>
              )}
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
