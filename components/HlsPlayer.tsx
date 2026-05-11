"use client";

import Hls from "hls.js";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type HlsPlayerProps = {
  src: string;
  title: string;
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

    const startPlayback = (playbackUrl: string) => {
      if (streamType === "dash") {
        void import("dashjs")
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
    <div className="relative h-full min-h-[260px] w-full overflow-hidden bg-black">
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
          <div className="flex flex-col items-center gap-4 rounded-xl bg-slate-900/80 px-8 py-6 backdrop-blur-xl border border-slate-700/50 shadow-2xl">
            <Loader2 className="h-6 w-6 animate-spin text-red-500" />
            <p className="text-sm font-medium text-slate-300">{message}</p>
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-black/80 to-black/60 p-6 text-center">
          <div className="max-w-md rounded-xl border border-slate-700/50 bg-slate-900/90 p-6 backdrop-blur-xl shadow-2xl">
            <div className="flex justify-center">
              <div className="rounded-full bg-red-500/20 p-3">
                <AlertTriangle className="h-6 w-6 text-red-400" />
              </div>
            </div>
            <h2 className="mt-4 text-lg font-semibold text-white">Stream unavailable</h2>
            <p className="mt-3 text-sm leading-6 text-slate-400">{message}</p>
          </div>
        </div>
      )}
    </div>
  );
}
