"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  X,
  Tv,
  Sparkles,
  Key,
  CheckCircle2,
  Lock,
  ArrowRight,
  ExternalLink,
  Volume2,
  Clock,
  ShieldCheck,
} from "lucide-react";

interface AdRewardModalProps {
  isOpen: boolean;
  onComplete: () => void;
  onClose: () => void;
  onOpenKeyModal?: () => void;
}

export default function AdRewardModal({
  isOpen,
  onComplete,
  onClose,
  onOpenKeyModal,
}: AdRewardModalProps) {
  // Stage 1: Watching Ad 1 of 2
  // Stage 2: Watching Ad 2 of 2
  // Stage 3: Ads Completed! Video Ready
  const [currentStage, setCurrentStage] = useState<1 | 2 | 3>(1);
  const [timer, setTimer] = useState<number>(10);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Reset state whenever modal is opened or closed
  useEffect(() => {
    if (isOpen) {
      setCurrentStage(1);
      setTimer(10);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
  }, [isOpen]);

  // Handle ESC key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && currentStage === 3) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, currentStage, onClose]);

  // Multi-Stage Ad Countdown Logic
  useEffect(() => {
    if (!isOpen) return;

    if (currentStage === 3) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(() => {
      setTimer((prev) => {
        if (prev > 1) {
          return prev - 1;
        }

        // Timer reached 0 -> advance stage
        if (currentStage === 1) {
          setCurrentStage(2);
          return 10;
        } else if (currentStage === 2) {
          setCurrentStage(3);
          return 0;
        }
        return 0;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isOpen, currentStage]);

  if (!isOpen) return null;

  const handleDownloadClick = () => {
    if (currentStage === 3) {
      onComplete();
    }
  };

  const stageTitle =
    currentStage === 1
      ? "Watching Ad 1 of 2"
      : currentStage === 2
      ? "Watching Ad 2 of 2"
      : "Ads Completed! Video Ready";

  const stageSubtitle =
    currentStage === 1
      ? "Please view the sponsor message to unlock your free export."
      : currentStage === 2
      ? "Almost there! One last message before your download unlocks."
      : "Thank you for supporting the free tier! Your video is ready.";

  // Calculate percentage of 10s countdown for progress bar
  const progressPercent = currentStage === 3 ? 100 : Math.round(((10 - timer) / 10) * 100);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/85 backdrop-blur-md transition-opacity animate-in fade-in duration-200"
        onClick={() => currentStage === 3 && onClose()}
      />

      {/* Modal Card */}
      <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-zinc-800/90 bg-zinc-950/95 p-6 sm:p-8 shadow-2xl shadow-emerald-950/20 backdrop-blur-2xl transition-all z-10 animate-in zoom-in-95 duration-200">
        {/* Glow ambient background accents */}
        <div className="absolute -top-24 -left-24 h-48 w-48 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 h-48 w-48 rounded-full bg-emerald-500/15 blur-3xl pointer-events-none" />

        {/* Modal Header */}
        <div className="flex items-start justify-between pb-4 border-b border-zinc-800/80">
          <div className="flex items-center space-x-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-2xl border p-0.5 shadow-lg transition-all ${
                currentStage === 3
                  ? "bg-gradient-to-tr from-emerald-500 to-teal-400 border-emerald-400/40 text-emerald-300 shadow-emerald-500/20"
                  : "bg-gradient-to-tr from-amber-500 to-orange-500 border-amber-500/40 text-amber-300 shadow-amber-500/20"
              }`}
            >
              <div className="flex h-full w-full items-center justify-center rounded-[14px] bg-zinc-950">
                {currentStage === 3 ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                ) : (
                  <Tv className="h-5 w-5 text-amber-400" />
                )}
              </div>
            </div>
            <div>
              <h3 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                <span>{stageTitle}</span>
                {currentStage !== 3 && (
                  <span className="flex h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                )}
              </h3>
              <p className="text-xs text-zinc-400">{stageSubtitle}</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-xl p-2 text-zinc-400 hover:bg-zinc-800/80 hover:text-white transition cursor-pointer"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Multi-Stage Visual Stepper */}
        <div className="mt-4 flex items-center justify-between gap-2 px-1">
          <div className="flex-1">
            <div className="flex items-center justify-between text-[11px] font-semibold mb-1">
              <span className={currentStage >= 1 ? "text-amber-400" : "text-zinc-500"}>
                Ad 1 (10s)
              </span>
              <span className={currentStage >= 2 ? "text-amber-400" : "text-zinc-500"}>
                Ad 2 (10s)
              </span>
              <span className={currentStage === 3 ? "text-emerald-400" : "text-zinc-500"}>
                Export Ready
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-zinc-900 border border-zinc-800 overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ease-linear ${
                  currentStage === 3
                    ? "bg-gradient-to-r from-emerald-500 to-teal-400 shadow-[0_0_12px_rgba(16,185,129,0.8)]"
                    : "bg-gradient-to-r from-amber-500 via-orange-500 to-yellow-400 shadow-[0_0_12px_rgba(245,158,11,0.6)]"
                }`}
                style={{
                  width:
                    currentStage === 1
                      ? `${(progressPercent / 2).toFixed(1)}%`
                      : currentStage === 2
                      ? `${(50 + progressPercent / 2).toFixed(1)}%`
                      : "100%",
                }}
              />
            </div>
          </div>
        </div>

        {/* Ad Container: A centered box placeholder (height ~250px) where an ad network iframe/script can be rendered */}
        <div className="mt-4 flex justify-center">
          <div
            id="ad-slot-rewarded"
            data-ad-network="monetag-adsense"
            className="relative flex h-[250px] w-full items-center justify-center overflow-hidden rounded-2xl border border-zinc-800/90 bg-gradient-to-b from-zinc-900/90 via-zinc-950 to-zinc-900/90 p-4 text-center shadow-inner"
          >
            {/* Background pattern */}
            <div className="absolute inset-0 bg-[radial-gradient(#27272a_1px,transparent_1px)] [background-size:16px_16px] opacity-40 pointer-events-none" />

            {/* In active countdown mode: simulated rewarded ad creative display */}
            {currentStage !== 3 ? (
              <div className="relative z-10 flex flex-col items-center justify-between h-full w-full py-2">
                <div className="flex items-center justify-between w-full text-[11px] text-zinc-400">
                  <span className="flex items-center gap-1.5 rounded-full bg-zinc-800/80 px-2.5 py-0.5 border border-zinc-700/60 font-mono text-[10px]">
                    <Volume2 className="h-3 w-3 text-amber-400" />
                    SPONSORED PLACEMENT
                  </span>
                  <span className="font-mono font-bold text-amber-300 bg-amber-950/40 px-2 py-0.5 rounded border border-amber-800/40">
                    {timer}s left
                  </span>
                </div>

                <div className="space-y-2 max-w-xs">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-800/90 border border-zinc-700 text-amber-400 shadow-md">
                    <Tv className="h-6 w-6 animate-pulse" />
                  </div>
                  <h4 className="text-sm font-bold text-white">
                    {currentStage === 1
                      ? "Monetag / AdSense Rewarded Video #1"
                      : "Monetag / AdSense Rewarded Video #2"}
                  </h4>
                  <p className="text-xs text-zinc-400 leading-snug">
                    {currentStage === 1
                      ? "Keep this window open to support the free server tier. Ad 2 starts automatically."
                      : "Final ad playing. Your download link will unlock as soon as the timer reaches 0s."}
                  </p>
                </div>

                {/* Subtext info for ad network insertion */}
                <div className="text-[10px] text-zinc-500 font-mono">
                  Container slot: #ad-slot-rewarded (250px)
                </div>
              </div>
            ) : (
              /* Stage 3: Completed Screen */
              <div className="relative z-10 flex flex-col items-center justify-center space-y-3 py-4 animate-in zoom-in-95 duration-200">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 animate-bounce">
                  <CheckCircle2 className="h-8 w-8" />
                </div>
                <h4 className="text-base font-bold text-white">
                  All 2 Ads Completed!
                </h4>
                <p className="text-xs text-emerald-300 max-w-xs">
                  Thank you for watching! Click the button below to generate and download your captioned video.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Action Button: Disabled during Stage 1 & 2, Active green during Stage 3 */}
        <div className="mt-5">
          {currentStage !== 3 ? (
            <button
              type="button"
              disabled
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-zinc-900 border border-zinc-800 px-5 py-3.5 text-sm font-bold text-zinc-500 cursor-not-allowed transition shadow-md"
            >
              <Clock className="h-4 w-4 animate-spin text-zinc-600" />
              <span>Please wait ({timer}s)...</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleDownloadClick}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-green-500 hover:from-emerald-400 hover:to-green-400 px-5 py-3.5 text-sm font-black text-zinc-950 shadow-lg shadow-emerald-500/25 transition cursor-pointer hover:scale-[1.01] active:scale-[0.99]"
            >
              <span>Download Video Now 🚀</span>
            </button>
          )}
        </div>

        {/* Bypass Option at the bottom */}
        {onOpenKeyModal && (
          <div className="mt-4 pt-3 border-t border-zinc-800/70 text-center">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenKeyModal();
              }}
              className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-cyan-400 transition underline underline-offset-4 cursor-pointer"
            >
              <Key className="h-3.5 w-3.5 text-cyan-400" />
              <span>Skip ads forever by adding your free Groq API key</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
