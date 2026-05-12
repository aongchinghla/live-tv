"use client";

import Hls from "hls.js";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type HlsPlayerProps = {
  src: string;
  title: string;
};

type DashModule = {
  MediaPlayer: () => {
    create: () => {
      initialize: (video: HTMLVideoElement, url: string, autoPlay: boolean) => void;
      on: (event: string, listener: () => void, scope?: unknown) => void;
      reset: () => void;
    };
  };
};

function getProxyUrl(src: string) {
  return `/api/stream?url=${encodeURIComponent(src)}`;
}

function getStreamType(src: string) {
  const normalized = src.split("?")[0].toLowerCase();

  if (normalized.endsWith(".mpd")) return "dash";
  if (normalized.endsWith(".ts") || normalized.endsWith(".mp4") || normalized.endsWith(".m4v") || normalized.endsWith(".webm")) {
    return "direct";
  }

  return "hls";
}

export default function HlsPlayer({ src, title }: HlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("Loading stream...");

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    let hls: Hls | null = null;
    let dashPlayer: any = null;
    let cancelled = false;
    const streamType = getStreamType(src);
    const isSecureUrl = src.startsWith("https://");
    const httpsPage = typeof window !== "undefined" && window.location.protocol === "https:";
    const proxyUrl = getProxyUrl(src);
    const attemptUrls =
      httpsPage && !isSecureUrl
        ? [proxyUrl]
        : isSecureUrl
          ? [src, proxyUrl]
          : [src];
    let attemptIndex = 0;

    setStatus("loading");
    setMessage("Loading stream...");

    const markReady = () => {
      if (!cancelled) {
        setStatus("ready");
        setMessage("Loading stream...");
      }
    };

    const markError = (nextMessage?: string) => {
      if (!cancelled) {
        setStatus("error");
        setMessage(
          nextMessage ??
            "This stream could not be loaded. It may be offline, blocked by CORS, region restricted, or unsupported by the source.",
        );
      }
    };

    const cleanupPlayback = () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
      if (hls) {
        hls.destroy();
        hls = null;
      }
      if (dashPlayer) {
        dashPlayer.reset();
        dashPlayer = null;
      }
    };

    const retryOrFail = (fallbackMessage?: string) => {
      if (cancelled) return;

      attemptIndex += 1;
      if (attemptIndex < attemptUrls.length) {
        cleanupPlayback();
        setStatus("loading");
        setMessage("Trying backup playback path...");
        startPlayback(attemptUrls[attemptIndex]);
        return;
      }

      markError(fallbackMessage);
    };

    const handleNativeError = () => {
      retryOrFail();
    };

    video.addEventListener("loadedmetadata", markReady);
    video.addEventListener("error", handleNativeError);

    const loadDashModule = async (): Promise<DashModule> => {
      // Dash.js 5 exposes ESM by default; using its UMD bundle avoids browser/runtime export parsing issues here.
      // @ts-expect-error Dash.js does not publish typings for this UMD bundle path.
      const dashModule = await import("../node_modules/dashjs/dist/modern/umd/dash.all.min.js");
      return ((dashModule as { default?: DashModule }).default ?? dashModule) as DashModule;
    };

    const startPlayback = (playbackUrl: string) => {
      if (streamType === "dash") {
        void loadDashModule()
          .then((dashjs) => {
            if (cancelled) return;

            dashPlayer = dashjs.MediaPlayer().create();
            dashPlayer.initialize(video, playbackUrl, true);
            dashPlayer.on("streamInitialized", markReady, undefined);
            dashPlayer.on(
              "error",
              () => {
                retryOrFail("The DASH stream could not be loaded. It may be offline, blocked, expired, or unsupported by the source.");
              },
              undefined,
            );
            dashPlayer.on(
              "playbackError",
              () => {
                retryOrFail();
              },
              undefined,
            );
          })
          .catch(() => {
            retryOrFail("This DASH stream could not be started in the browser.");
          });
        return;
      }

      if (streamType === "direct") {
        video.src = playbackUrl;
        video.play().catch(() => undefined);
        return;
      }

      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = playbackUrl;
        video.play().catch(() => undefined);
        return;
      }

      if (!Hls.isSupported()) {
        markError("Your browser does not support HLS playback for this stream.");
        return;
      }

      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
      });

      hls.loadSource(playbackUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        markReady();
        video.play().catch(() => undefined);
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;

        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls?.recoverMediaError();
          return;
        }

        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          retryOrFail("The stream server did not respond. It may be down, blocked, or refusing playback requests.");
          return;
        }

        retryOrFail();
      });
    };

    cleanupPlayback();
    startPlayback(attemptUrls[attemptIndex]);

    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", markReady);
      video.removeEventListener("error", handleNativeError);
      cleanupPlayback();
    };
  }, [src]);

  return (
    <div className="relative aspect-video h-full min-h-[220px] w-full overflow-hidden bg-black sm:min-h-[260px]">
      <video
        ref={videoRef}
        title={title}
        controls
        autoPlay
        muted
        playsInline
        className="h-full w-full object-contain"
      />

      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-black/70 to-black/50">
          <div className="flex max-w-[calc(100%-2rem)] flex-col items-center gap-4 rounded-xl border border-slate-700/50 bg-slate-900/80 px-5 py-5 text-center shadow-2xl backdrop-blur-xl sm:px-8 sm:py-6">
            <Loader2 className="h-6 w-6 animate-spin text-red-500" />
            <p className="text-sm font-medium text-slate-300">{message}</p>
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/55 p-6">
          <div className="w-full max-w-sm rounded-[22px] border border-white/10 bg-slate-950/72 px-5 py-6 text-center shadow-[0_18px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
              <AlertTriangle className="h-4.5 w-4.5 text-slate-200" />
            </div>

            <h2 className="mt-4 text-lg font-semibold tracking-tight text-white sm:text-xl">
              Stream unavailable
            </h2>

            <p className="mt-1.5 text-xs text-slate-400">
              {title}
            </p>

            <p className="mt-4 text-sm leading-6 text-slate-300">
              {message}
            </p>

            <div className="mx-auto mt-5 h-px w-12 bg-white/10" />

            <p className="mt-5 text-[11px] font-medium uppercase tracking-[0.24em] text-slate-500">
              Try another channel
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
