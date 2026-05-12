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
  const [showNativeControls, setShowNativeControls] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    let hls: Hls | null = null;
    let dashPlayer: ReturnType<ReturnType<DashModule["MediaPlayer"]>["create"]> | null = null;
    let cancelled = false;
    const streamType = getStreamType(src);
    const isSecureUrl = src.startsWith("https://");
    const httpsPage = typeof window !== "undefined" && window.location.protocol === "https:";
    const proxyUrl = getProxyUrl(src);
    const supportsNativeHls = video.canPlayType("application/vnd.apple.mpegurl") !== "";
    const shouldPreferProxy = streamType === "dash" || (streamType === "hls" && !supportsNativeHls);
    const attemptUrls =
      httpsPage && !isSecureUrl
        ? [proxyUrl]
        : shouldPreferProxy
          ? isSecureUrl
            ? [proxyUrl, src]
            : [proxyUrl]
          : isSecureUrl
            ? [src, proxyUrl]
            : [src];
    let attemptIndex = 0;
    let attemptTimeoutId: number | null = null;

    setStatus("loading");
    setMessage("Loading stream...");
    setShowNativeControls(false);

    const markReady = () => {
      if (attemptTimeoutId) {
        window.clearTimeout(attemptTimeoutId);
        attemptTimeoutId = null;
      }

      if (!cancelled) {
        setStatus("ready");
        setMessage("Loading stream...");
      }
    };

    const markError = (nextMessage?: string) => {
      if (!cancelled) {
        setStatus("error");
        setMessage(nextMessage ?? "This stream could not be loaded.");
      }
    };

    const cleanupPlayback = () => {
      if (attemptTimeoutId) {
        window.clearTimeout(attemptTimeoutId);
        attemptTimeoutId = null;
      }

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

    const readyEvents: Array<keyof HTMLMediaElementEventMap> = ["loadedmetadata", "loadeddata", "canplay", "playing"];
    for (const eventName of readyEvents) {
      video.addEventListener(eventName, markReady);
    }
    video.addEventListener("error", handleNativeError);

    const loadDashModule = async (): Promise<DashModule> => {
      // Dash.js 5 exposes ESM by default; using its UMD bundle avoids browser/runtime export parsing issues here.
      // @ts-expect-error Dash.js does not publish typings for this UMD bundle path.
      const dashModule = await import("../node_modules/dashjs/dist/modern/umd/dash.all.min.js");
      return ((dashModule as { default?: DashModule }).default ?? dashModule) as DashModule;
    };

    const startPlayback = (playbackUrl: string) => {
      attemptTimeoutId = window.setTimeout(() => {
        retryOrFail("The stream is taking too long to start.");
      }, 8000);

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
                retryOrFail("This DASH stream could not be loaded.");
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
            retryOrFail("This DASH stream could not start.");
          });
        return;
      }

      if (streamType === "direct") {
        video.src = playbackUrl;
        video.load();
        video.play().catch(() => undefined);
        return;
      }

      if (supportsNativeHls) {
        video.src = playbackUrl;
        video.load();
        video.play().catch(() => undefined);
        return;
      }

      if (!Hls.isSupported()) {
        markError("This browser does not support the stream.");
        return;
      }

      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 15,
        maxBufferLength: 12,
        maxMaxBufferLength: 20,
        capLevelToPlayerSize: true,
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
          retryOrFail("The stream server did not respond.");
          return;
        }

        retryOrFail();
      });
    };

    cleanupPlayback();
    startPlayback(attemptUrls[attemptIndex]);

    return () => {
      cancelled = true;
      for (const eventName of readyEvents) {
        video.removeEventListener(eventName, markReady);
      }
      video.removeEventListener("error", handleNativeError);
      cleanupPlayback();
    };
  }, [src]);

  const handleRevealControls = () => {
    if (status !== "ready") return;

    const video = videoRef.current;
    if (!video) return;

    video.controls = true;
    setShowNativeControls(true);
  };

  return (
    <div className="relative aspect-video h-full min-h-[220px] w-full overflow-hidden bg-black sm:min-h-[260px]">
      <video
        ref={videoRef}
        title={title}
        controls={showNativeControls}
        autoPlay
        muted
        playsInline
        preload="metadata"
        className="h-full w-full object-contain"
        onPointerUp={handleRevealControls}
        onTouchEnd={handleRevealControls}
      />

      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-gradient-to-b from-black/70 to-black/50">
          <div className="flex max-w-[calc(100%-2rem)] flex-col items-center gap-4 rounded-xl border border-slate-700/50 bg-slate-900/80 px-5 py-5 text-center shadow-2xl backdrop-blur-xl sm:px-8 sm:py-6">
            <Loader2 className="h-6 w-6 animate-spin text-red-500" />
            <p className="text-sm font-medium text-slate-300">{message}</p>
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 overflow-y-auto bg-black/55 p-2 sm:flex sm:items-center sm:justify-center sm:p-6">
          <div className="mx-auto my-2 w-full max-w-[18rem] rounded-[18px] border border-white/10 bg-slate-950/78 px-3.5 py-3.5 text-center shadow-[0_18px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:my-0 sm:max-w-sm sm:px-5 sm:py-6">
            <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04]">
              <AlertTriangle className="h-4 w-4 text-slate-200" />
            </div>

            <h2 className="mt-2.5 text-sm font-semibold tracking-tight text-white sm:mt-4 sm:text-xl">
              Stream unavailable
            </h2>

            <p className="mt-1 line-clamp-1 text-[10px] text-slate-400 sm:mt-1.5 sm:text-xs">
              {title}
            </p>

            <p className="mt-2.5 text-[11px] leading-[1.15rem] text-slate-300 sm:mt-4 sm:text-sm sm:leading-6">
              {message}
            </p>

            <div className="mx-auto mt-3 h-px w-10 bg-white/10 sm:mt-5 sm:w-12" />

            <p className="mt-3 text-[9px] font-medium uppercase tracking-[0.18em] text-slate-500 sm:mt-5 sm:text-[11px] sm:tracking-[0.24em]">
              Try another one
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
