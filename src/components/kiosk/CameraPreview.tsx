"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export type CameraHandle = {
  capture: () => string | null;
  isReady: () => boolean;
  hasPermission: () => boolean;
};

type Props = { size?: number };

export const CameraPreview = forwardRef<CameraHandle, Props>(
  function CameraPreview({ size = 200 }, ref) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [status, setStatus] = useState<"idle" | "ready" | "denied" | "error">(
      "idle",
    );

    useImperativeHandle(ref, () => ({
      capture: () => {
        const video = videoRef.current;
        if (!video || status !== "ready" || video.videoWidth === 0) return null;
        const canvas = document.createElement("canvas");
        // Cap capture size for upload sanity.
        const maxDim = 480;
        const w = video.videoWidth;
        const h = video.videoHeight;
        const scale = Math.min(1, maxDim / Math.max(w, h));
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", 0.78);
      },
      isReady: () => status === "ready",
      hasPermission: () => status !== "denied",
    }));

    useEffect(() => {
      let cancelled = false;
      async function start() {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 640 },
              height: { ideal: 640 },
              facingMode: "user",
            },
            audio: false,
          });
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await videoRef.current.play().catch(() => {});
          }
          setStatus("ready");
        } catch (e: unknown) {
          const err = e as { name?: string };
          if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
            setStatus("denied");
          } else {
            setStatus("error");
          }
        }
      }
      start();
      return () => {
        cancelled = true;
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }
      };
    }, []);

    return (
      <div
        className="relative mx-auto rounded-full overflow-hidden"
        style={{
          width: size,
          height: size,
          background: "rgba(255,255,255,0.05)",
          border: "3px solid rgba(255,200,61,0.65)",
          boxShadow:
            "0 0 0 6px rgba(10,37,64,0.4), 0 12px 40px rgba(0,0,0,0.4)",
        }}
      >
        <video
          ref={videoRef}
          playsInline
          muted
          className="w-full h-full object-cover"
          style={{
            transform: "scaleX(-1)",
            opacity: status === "ready" ? 1 : 0,
            transition: "opacity 320ms",
          }}
        />
        {status !== "ready" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white text-center px-4">
            {status === "idle" && (
              <>
                <div className="text-3xl mb-1">📷</div>
                <div className="text-xs opacity-80">Starting camera…</div>
              </>
            )}
            {status === "denied" && (
              <>
                <div className="text-3xl mb-1">🚫</div>
                <div className="text-xs opacity-80 leading-tight">
                  Camera blocked.
                  <br />
                  Check-in will be flagged.
                </div>
              </>
            )}
            {status === "error" && (
              <>
                <div className="text-3xl mb-1">⚠️</div>
                <div className="text-xs opacity-80">Camera unavailable</div>
              </>
            )}
          </div>
        )}
      </div>
    );
  },
);
