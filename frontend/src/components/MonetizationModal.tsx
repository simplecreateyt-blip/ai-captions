"use client";

import React, { useState, useEffect } from "react";
import {
  Sparkles,
  Zap,
  Key,
  Tv,
  CheckCircle2,
  X,
  Play,
  ArrowRight,
  Flame,
  Volume2,
  ExternalLink,
  ShieldCheck,
} from "lucide-react";

interface MonetizationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onWatchAdsComplete: () => void;
  onOpenApiKeyModal: () => void;
}

const SAMPLE_ADS = [
  {
    sponsor: "CloudStudio GPU",
    tagline: "Ultra-fast Cloud Rendering for Creators",
    description: "Render 4K 60fps clips in under 10 seconds with dedicated H100 cloud nodes.",
    gradient: "from-blue-600 via-indigo-600 to-violet-800",
  },
  {
    sponsor: "DevPulse AI",
    tagline: "Autonomous Agentic Pair Programmer",
    description: "Build full-stack web applications with deep reasoning and automated browser validation.",
    gradient: "from-amber-600 via-orange-600 to-rose-700",
  },
];

export default function MonetizationModal({
  isOpen,
  onClose,
  onWatchAdsComplete,
  onOpenApiKeyModal,
}: MonetizationModalProps) {
  // "options" | "playing_ads" | "ads_finished"
  const [modalStage, setModalStage] = useState<"options" | "playing_ads" | "ads_finished">("options");
  const [currentAdIndex, setCurrentAdIndex] = useState(0);
  const [secondsRemaining, setSecondsRemaining] = useState(4);
  const [adProgress, setAdProgress] = useState(0);

  useEffect(() => {
    if (isOpen) {
      setModalStage("options");
      setCurrentAdIndex(0);
      setSecondsRemaining(4);
      setAdProgress(0);
    }
  }, [isOpen]);

  // Handle ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && modalStage === "options") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, modalStage, onClose]);

  // Simulated ad timer logic
  useEffect(() => {
    if (modalStage !== "playing_ads") return;

    const DURATION_PER_AD = 4; // 4 seconds per ad
    let startTime = Date.now();

    const interval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      const remaining = Math.max(0, Math.ceil(DURATION_PER_AD - elapsed));
      const progress = Math.min(100, Math.round((elapsed / DURATION_PER_AD) * 100));

      setSecondsRemaining(remaining);
      setAdProgress(progress);

      if (elapsed >= DURATION_PER_AD) {
        clearInterval(interval);
        if (currentAdIndex === 0) {
          // Move to Ad 2
          setCurrentAdIndex(1);
          setSecondsRemaining(DURATION_PER_AD);
          setAdProgress(0);
          startTime = Date.now();
        } else {
          // Both ads completed!
          setModalStage("ads_finished");
          setTimeout(() => {
            onWatchAdsComplete();
          }, 1200);
        }
      }
    }, 100);

    return () => clearInterval(interval);
  }, [modalStage, currentAdIndex, onWatchAdsComplete]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-md transition-opacity animate-in fade-in duration-200"
        onClick={() => modalStage === "options" && onClose()}
      />

      {/* Modal Dialog */}
      <div className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-zinc-800/90 bg-zinc-950/95 p-6 sm:p-8 shadow-2xl shadow-amber-950/30 backdrop-blur-2xl transition-all z-10 animate-in zoom-in-95 duration-200">
        {/* Glow ambient background accents */}
        <div className="absolute -top-24 -right-24 h-56 w-56 rounded-full bg-amber-500/15 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 h-56 w-56 rounded-full bg-violet-600/15 blur-3xl pointer-events-none" />

        {modalStage === "options" && (
          <div className="space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-tr from-amber-500 to-yellow-400 p-0.5 shadow-lg shadow-amber-500/20">
                  <div className="flex h-full w-full items-center justify-center rounded-[14px] bg-zinc-950">
                    <Flame className="h-5 w-5 text-amber-400" />
                  </div>
                </div>
                <div>
                  <h3 className="text-xl font-black text-white tracking-tight">
                    Choose Your Export Option
                  </h3>
                  <p className="text-xs text-zinc-400">
                    You are currently using the Free Server Tier
                  </p>
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

            {/* Explanation banner */}
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-200 flex items-center gap-3">
              <Tv className="h-5 w-5 text-amber-400 shrink-0" />
              <span>
                To keep this free server tier running without subscription fees, you can watch 2 short ads or bring your own free Groq key.
              </span>
            </div>

            {/* Two Action Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Option 1: Watch 2 short ads */}
              <div className="group relative flex flex-col justify-between rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 hover:border-amber-500/50 hover:bg-zinc-900/90 transition-all duration-200 shadow-lg">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
                      <Tv className="h-4 w-4" />
                    </div>
                    <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-bold text-zinc-300 uppercase">
                      Free Tier
                    </span>
                  </div>

                  <div>
                    <h4 className="text-sm font-bold text-white group-hover:text-amber-300 transition">
                      Watch 2 short ads to export
                    </h4>
                    <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
                      Watch 2 quick 4-second sponsored clips to immediately unlock and download your captioned video.
                    </p>
                  </div>
                </div>

                <div className="mt-5 pt-3 border-t border-zinc-800/60">
                  <button
                    type="button"
                    onClick={() => {
                      setModalStage("playing_ads");
                      setCurrentAdIndex(0);
                    }}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-800 hover:bg-amber-500 hover:text-zinc-950 px-4 py-2.5 text-xs font-bold text-zinc-200 transition shadow-md cursor-pointer"
                  >
                    <Play className="h-3.5 w-3.5 fill-current" />
                    <span>Watch 2 Ads &amp; Export</span>
                  </button>
                </div>
              </div>

              {/* Option 2: Add Groq Key (Recommended) */}
              <div className="group relative flex flex-col justify-between rounded-2xl border-2 border-cyan-500/60 bg-gradient-to-b from-cyan-950/30 via-zinc-900/80 to-zinc-950 p-5 shadow-xl shadow-cyan-950/40 hover:border-cyan-400 transition-all duration-200">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                      <Key className="h-4 w-4" />
                    </div>
                    <span className="rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 px-2.5 py-0.5 text-[10px] font-extrabold text-white shadow-sm uppercase tracking-wide">
                      RECOMMENDED
                    </span>
                  </div>

                  <div>
                    <h4 className="text-sm font-bold text-white group-hover:text-cyan-300 transition">
                      Add your own Groq Key for instant &amp; unlimited exports
                    </h4>
                    <p className="mt-1 text-xs text-zinc-300 leading-relaxed">
                      100% Free at console.groq.com. Skip all ads forever, bypass queues, and get instant exports.
                    </p>
                  </div>
                </div>

                <div className="mt-5 pt-3 border-t border-cyan-500/20">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenApiKeyModal();
                    }}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:brightness-110 px-4 py-2.5 text-xs font-bold text-white transition shadow-lg shadow-cyan-500/30 cursor-pointer"
                  >
                    <Zap className="h-3.5 w-3.5" />
                    <span>Enter Groq Key</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Footer privacy guarantee */}
            <div className="flex items-center justify-between text-[11px] text-zinc-400 pt-2 border-t border-zinc-800/80">
              <span className="flex items-center gap-1 text-zinc-400">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                Keys stored locally in your browser only
              </span>
              <button
                type="button"
                onClick={onClose}
                className="text-zinc-400 hover:text-white transition"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Ad Player Screen */}
        {modalStage === "playing_ads" && (
          <div className="space-y-5 animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-2.5 w-2.5 rounded-full bg-rose-500 animate-ping" />
                <span className="text-xs font-bold uppercase tracking-wider text-rose-400">
                  Sponsored Advertisement &bull; Ad {currentAdIndex + 1} of 2
                </span>
              </div>
              <div className="rounded-full bg-zinc-900 border border-zinc-800 px-2.5 py-1 text-xs font-mono font-bold text-amber-300">
                {secondsRemaining}s remaining
              </div>
            </div>

            {/* Interactive Ad Screen */}
            <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${SAMPLE_ADS[currentAdIndex].gradient} p-8 text-white shadow-2xl flex flex-col justify-between min-h-[220px]`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Volume2 className="h-4 w-4 text-white/80" />
                  <span className="text-[10px] uppercase font-bold tracking-widest text-white/70">
                    Sponsor Broadcast
                  </span>
                </div>
                <span className="rounded bg-black/40 px-2 py-0.5 text-[10px] font-mono text-white/90">
                  Ad #{currentAdIndex + 1}/2
                </span>
              </div>

              <div className="my-4 space-y-2">
                <h4 className="text-2xl font-black tracking-tight text-white">
                  {SAMPLE_ADS[currentAdIndex].sponsor}
                </h4>
                <p className="text-sm font-semibold text-white/90">
                  {SAMPLE_ADS[currentAdIndex].tagline}
                </p>
                <p className="text-xs text-white/75 max-w-md">
                  {SAMPLE_ADS[currentAdIndex].description}
                </p>
              </div>

              {/* Progress bar within ad */}
              <div className="w-full space-y-1.5">
                <div className="h-1.5 w-full rounded-full bg-black/40 overflow-hidden">
                  <div
                    className="h-full bg-white transition-all duration-100 ease-linear shadow-[0_0_8px_white]"
                    style={{ width: `${adProgress}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Skip ads option inside ad player */}
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs pt-2">
              <span className="text-zinc-400">
                Watching ad {currentAdIndex + 1} of 2. Export starts automatically.
              </span>

              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenApiKeyModal();
                }}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-400 hover:text-cyan-300 underline cursor-pointer"
              >
                <Zap className="h-3.5 w-3.5" />
                Skip ads forever with your free Groq key
              </button>
            </div>
          </div>
        )}

        {/* Ads Finished Screen */}
        {modalStage === "ads_finished" && (
          <div className="text-center py-6 space-y-4 animate-in zoom-in-95 duration-200">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 animate-bounce">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <h4 className="text-xl font-black text-white">
              Ads Completed!
            </h4>
            <p className="text-xs text-emerald-300">
              Generating your captioned video now...
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
