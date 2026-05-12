"use client";

import { useEffect, useRef } from "react";

type DarkVeilProps = {
  hueShift?: number;
  noiseIntensity?: number;
  scanlineIntensity?: number;
  speed?: number;
  scanlineFrequency?: number;
  warpAmount?: number;
  resolutionScale?: number;
  className?: string;
};

type VeilBand = {
  radius: number;
  orbit: number;
  size: number;
  speed: number;
  phase: number;
  hue: number;
  alpha: number;
};

const TAU = Math.PI * 2;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function wrapHue(hue: number) {
  const wrapped = hue % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

export default function DarkVeil({
  hueShift = 0,
  noiseIntensity = 0,
  scanlineIntensity = 0,
  speed = 0.5,
  scanlineFrequency = 0,
  warpAmount = 0,
  resolutionScale = 1,
  className = "",
}: DarkVeilProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    const parent = canvas.parentElement;
    if (!ctx || !parent) return;

    const veilBands: VeilBand[] = [
      { radius: 0.18, orbit: 0.22, size: 0.48, speed: 0.18, phase: 0.2, hue: 218, alpha: 0.28 },
      { radius: 0.26, orbit: 0.31, size: 0.43, speed: -0.16, phase: 1.6, hue: 192, alpha: 0.18 },
      { radius: 0.14, orbit: 0.4, size: 0.38, speed: 0.12, phase: 3.2, hue: 340, alpha: 0.16 },
      { radius: 0.22, orbit: 0.5, size: 0.34, speed: -0.08, phase: 4.6, hue: 264, alpha: 0.12 },
    ];

    let frameId = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let noiseLayer: HTMLCanvasElement | null = null;
    let noiseCtx: CanvasRenderingContext2D | null = null;
    let noiseTick = 0;
    let isVisible = typeof document === "undefined" ? true : !document.hidden;

    const drawNoise = (alpha: number) => {
      if (!noiseCtx || !noiseLayer || alpha <= 0) return;

      const layerWidth = noiseLayer.width;
      const layerHeight = noiseLayer.height;
      if (noiseTick % 3 === 0) {
        const imageData = noiseCtx.createImageData(layerWidth, layerHeight);
        const { data } = imageData;

        for (let i = 0; i < data.length; i += 4) {
          const value = Math.random() * 255;
          data[i] = value;
          data[i + 1] = value;
          data[i + 2] = value + Math.random() * 20;
          data[i + 3] = Math.random() * alpha * 255;
        }

        noiseCtx.putImageData(imageData, 0, 0);
      }

      noiseTick += 1;
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = alpha;
      ctx.drawImage(noiseLayer, 0, 0, width, height);
      ctx.restore();
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.floor(parent.clientWidth));
      height = Math.max(1, Math.floor(parent.clientHeight));

      const internalWidth = Math.max(1, Math.floor(width * dpr * resolutionScale));
      const internalHeight = Math.max(1, Math.floor(height * dpr * resolutionScale));

      canvas.width = internalWidth;
      canvas.height = internalHeight;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(internalWidth / width, internalHeight / height);

      const noiseScale = clamp(0.2 + noiseIntensity * 0.6, 0.2, 1);
      noiseLayer = document.createElement("canvas");
      noiseLayer.width = Math.max(8, Math.floor(width * noiseScale));
      noiseLayer.height = Math.max(8, Math.floor(height * noiseScale));
      noiseCtx = noiseLayer.getContext("2d", { alpha: true });
    };

    const render = (now: number) => {
      if (!isVisible) {
        frameId = 0;
        return;
      }

      const t = (now / 1000) * speed;
      const shiftedHue = hueShift * 360;
      const warp = clamp(warpAmount, 0, 2.5);

      ctx.clearRect(0, 0, width, height);

      const baseGradient = ctx.createRadialGradient(
        width * 0.5,
        height * 0.4,
        0,
        width * 0.5,
        height * 0.5,
        Math.max(width, height) * 0.85,
      );
      baseGradient.addColorStop(0, "rgba(30, 41, 59, 0.18)");
      baseGradient.addColorStop(0.38, "rgba(10, 18, 40, 0.62)");
      baseGradient.addColorStop(1, "rgba(2, 6, 23, 0.9)");
      ctx.fillStyle = baseGradient;
      ctx.fillRect(0, 0, width, height);

      const ambientGradient = ctx.createLinearGradient(0, 0, width, height);
      ambientGradient.addColorStop(0, `hsla(${wrapHue(208 + shiftedHue)}, 90%, 60%, 0.1)`);
      ambientGradient.addColorStop(0.5, "rgba(15, 23, 42, 0)");
      ambientGradient.addColorStop(1, `hsla(${wrapHue(330 + shiftedHue)}, 90%, 58%, 0.08)`);
      ctx.fillStyle = ambientGradient;
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.globalCompositeOperation = "screen";

      for (const band of veilBands) {
        const angle = t * band.speed * TAU + band.phase;
        const offsetX = Math.cos(angle) * width * band.orbit;
        const offsetY = Math.sin(angle * (1.15 + warp * 0.08)) * height * band.radius;
        const warpX = Math.sin(t * 0.7 + band.phase) * width * 0.08 * warp;
        const warpY = Math.cos(t * 0.55 + band.phase) * height * 0.06 * warp;
        const x = width * 0.5 + offsetX + warpX;
        const y = height * 0.44 + offsetY + warpY;
        const radius = Math.max(width, height) * band.size * (1 + warp * 0.05);
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        const hue = wrapHue(band.hue + shiftedHue);

        gradient.addColorStop(0, `hsla(${hue}, 95%, 68%, ${band.alpha})`);
        gradient.addColorStop(0.35, `hsla(${hue + 18}, 88%, 56%, ${band.alpha * 0.75})`);
        gradient.addColorStop(1, `hsla(${hue + 36}, 82%, 24%, 0)`);

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
      }

      ctx.restore();

      ctx.save();
      ctx.globalAlpha = 0.26 + warp * 0.05;
      ctx.strokeStyle = `hsla(${wrapHue(220 + shiftedHue)}, 82%, 72%, 0.24)`;
      ctx.lineWidth = Math.max(1, Math.min(width, height) * 0.0015);
      for (let i = 0; i < 4; i += 1) {
        const sway = Math.sin(t * 0.45 + i * 1.3) * height * (0.025 + warp * 0.01);
        const crest = Math.cos(t * 0.3 + i) * height * (0.05 + warp * 0.015);
        ctx.beginPath();
        ctx.moveTo(-width * 0.08, height * (0.2 + i * 0.18) + sway);
        ctx.bezierCurveTo(
          width * 0.28,
          height * (0.1 + i * 0.18) - crest,
          width * 0.72,
          height * (0.34 + i * 0.12) + crest,
          width * 1.08,
          height * (0.18 + i * 0.18) - sway,
        );
        ctx.stroke();
      }
      ctx.restore();

      if (scanlineIntensity > 0 && scanlineFrequency > 0) {
        ctx.save();
        ctx.globalAlpha = clamp(scanlineIntensity, 0, 1) * 0.35;
        ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
        const gap = Math.max(2, 28 - scanlineFrequency * 0.5);
        const lineHeight = Math.max(1, gap * 0.18);
        const drift = (t * 18) % gap;
        for (let y = -gap; y < height + gap; y += gap) {
          ctx.fillRect(0, y + drift, width, lineHeight);
        }
        ctx.restore();
      }

      if (noiseIntensity > 0) {
        drawNoise(clamp(noiseIntensity, 0, 1) * 0.14);
      }

      frameId = window.requestAnimationFrame(render);
    };

    const handleVisibilityChange = () => {
      isVisible = !document.hidden;

      if (!isVisible && frameId) {
        window.cancelAnimationFrame(frameId);
        frameId = 0;
        return;
      }

      if (isVisible && !frameId) {
        frameId = window.requestAnimationFrame(render);
      }
    };

    resize();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }
    window.addEventListener("resize", resize);
    frameId = isVisible ? window.requestAnimationFrame(render) : 0;

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
      window.removeEventListener("resize", resize);
    };
  }, [hueShift, noiseIntensity, scanlineIntensity, speed, scanlineFrequency, warpAmount, resolutionScale]);

  return <canvas ref={canvasRef} className={`block h-full w-full ${className}`.trim()} aria-hidden="true" />;
}
