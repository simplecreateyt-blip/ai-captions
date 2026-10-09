"use client";

import React, { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";

export interface CaptionWord {
  word: string;
  start: number;
  end: number;
  probability?: number;
}

export interface CaptionSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  words: CaptionWord[];
}

export interface HormoziChunk {
  id: number;
  start: number;
  end: number;
  text: string;
  words: CaptionWord[];
}

export interface CaptionData {
  language?: string;
  language_probability?: number;
  duration: number;
  full_text: string;
  words: CaptionWord[];
  segments: CaptionSegment[];
  hormozi_chunks: HormoziChunk[];
  total_words: number;
  total_segments: number;
  total_chunks: number;
  system?: string;
  target_language?: string;
  style?: string;
}

export type CaptionStyleId =
  | "hormozi"
  | "karaoke"
  | "ali_abdaal"
  | "typewriter"
  | "neon_hacker"
  | "cinematic"
  | "comic"
  | "glitch"
  | "word_splash"
  | "news_ticker";

interface CaptionOverlayProps {
  currentTime: number;
  style: CaptionStyleId;
  captionData: CaptionData | null;
  position?: "top" | "center" | "bottom";
  fontSize?: "sm" | "md" | "lg" | "xl";
  highlightColor?: "yellow" | "cyan" | "green" | "pink";
}

export default function CaptionOverlay({
  currentTime,
  style = "hormozi",
  captionData,
  position = "bottom",
  fontSize = "lg",
  highlightColor = "yellow",
}: CaptionOverlayProps) {
  if (!captionData) return null;

  // Position classes (unless style enforces its own, like news_ticker or word_splash)
  const positionClass = {
    top: "top-10",
    center: "top-1/2 -translate-y-1/2",
    bottom: "bottom-14",
  }[position];

  // Font size classes
  const fontSizeClass = {
    sm: "text-lg sm:text-xl",
    md: "text-xl sm:text-2xl",
    lg: "text-2xl sm:text-3xl",
    xl: "text-3xl sm:text-4xl",
  }[fontSize];

  // 1. Find active Hormozi Chunk (1-2 punchy words)
  const activeHormoziChunk = useMemo(() => {
    if (!captionData.hormozi_chunks || captionData.hormozi_chunks.length === 0) return null;
    return (
      captionData.hormozi_chunks.find(
        (c) => currentTime >= c.start && currentTime <= c.end + 0.18
      ) || null
    );
  }, [currentTime, captionData]);

  // 2. Find active Sentence Segment
  const activeSegment = useMemo(() => {
    if (!captionData.segments || captionData.segments.length === 0) return null;
    return (
      captionData.segments.find(
        (s) => currentTime >= s.start && currentTime <= s.end + 0.25
      ) || null
    );
  }, [currentTime, captionData]);

  // 3. Find exactly single active word for Word Splash
  const activeSingleWord = useMemo(() => {
    if (!captionData.words || captionData.words.length === 0) return null;
    return (
      captionData.words.find(
        (w) => currentTime >= w.start && currentTime <= w.end + 0.15
      ) || null
    );
  }, [currentTime, captionData]);

  // Custom stroke style helper
  const textStrokeStyle = {
    textShadow:
      "2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 0 4px 8px rgba(0,0,0,0.9)",
  };

  return (
    <div
      className={`pointer-events-none absolute left-0 right-0 ${
        style === "news_ticker" ? "bottom-0" : style === "word_splash" ? "top-1/2 -translate-y-1/2" : positionClass
      } px-3 flex flex-col items-center justify-center text-center select-none z-30 transition-all duration-100`}
    >
      {/* 1. HORMOZI STYLE (Bold 1-2 words, Yellow/Green highlights, Pop bounce) */}
      {style === "hormozi" && activeHormoziChunk && (
        <AnimatePresence mode="wait">
          <motion.div
            key={activeHormoziChunk.id}
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.08 }}
            className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 max-w-[94%] p-0 bg-transparent"
          >
            {activeHormoziChunk.words.map((w, idx) => {
              const isActive = currentTime >= w.start && currentTime <= w.end + 0.1;
              const isHighlightGreen = idx % 2 === 1;
              return (
                <span
                  key={idx}
                  className={`font-black uppercase tracking-wider transition-all duration-75 inline-block ${fontSizeClass} ${
                    isActive
                      ? isHighlightGreen
                        ? "text-emerald-400 scale-110 -rotate-1 drop-shadow-[0_0_15px_rgba(52,211,153,0.9)] z-10"
                        : "text-yellow-400 scale-110 -rotate-1 drop-shadow-[0_0_15px_rgba(250,204,21,0.9)] z-10"
                      : "text-white opacity-95 scale-100"
                  }`}
                  style={textStrokeStyle}
                >
                  {w.word}
                </span>
              );
            })}
          </motion.div>
        </AnimatePresence>
      )}

      {/* 2. KARAOKE GLOW (Full sentence visible, active word glows Neon Blue) */}
      {style === "karaoke" && activeSegment && (
        <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 max-w-[96%] p-0 bg-transparent">
          {activeSegment.words.map((w, idx) => {
            const isCurrent = currentTime >= w.start && currentTime <= w.end + 0.08;
            const isPast = currentTime > w.end + 0.08;

            return (
              <span
                key={idx}
                className={`font-extrabold tracking-wide transition-all duration-100 inline-block text-base sm:text-xl ${
                  isCurrent
                    ? "text-cyan-400 scale-115 font-black underline decoration-cyan-400 drop-shadow-[0_0_16px_rgba(6,182,212,0.9)] animate-pulse"
                    : isPast
                    ? "text-zinc-200 opacity-90"
                    : "text-zinc-500 opacity-40"
                }`}
                style={{
                  textShadow: isCurrent ? "0 0 12px #06b6d4, 1px 1px 2px #000" : "1px 1px 2px #000",
                }}
              >
                {w.word}
              </span>
            );
          })}
        </div>
      )}

      {/* 3. ALI ABDAAL (Clean, minimalist, color changes on keywords) */}
      {style === "ali_abdaal" && activeSegment && (
        <div className="max-w-[88%] px-4 py-2 rounded-xl bg-black/60 border border-white/10 backdrop-blur-md">
          <p className="font-sans font-medium text-sm sm:text-base text-zinc-100 leading-relaxed">
            {activeSegment.words.map((w, idx) => {
              const isActive = currentTime >= w.start && currentTime <= w.end + 0.1;
              const isKeyword = w.word.length > 4 || idx % 3 === 0;

              return (
                <span
                  key={idx}
                  className={`inline-block mr-1 transition-colors duration-150 ${
                    isActive && isKeyword
                      ? "bg-yellow-300 text-black px-1.5 py-0.5 rounded font-bold shadow-md scale-105"
                      : isActive
                      ? "text-cyan-300 font-semibold underline decoration-cyan-400"
                      : "text-zinc-200"
                  }`}
                >
                  {w.word}
                </span>
              );
            })}
          </p>
        </div>
      )}

      {/* 4. TYPEWRITER (Monospace typewriter effect for the active word) */}
      {style === "typewriter" && activeSegment && (
        <div className="px-5 py-2.5 rounded-xl bg-zinc-950/85 border border-zinc-700/80 shadow-2xl backdrop-blur-md">
          <p className="font-mono text-sm sm:text-lg text-zinc-300">
            {activeSegment.words.map((w, idx) => {
              const isActive = currentTime >= w.start && currentTime <= w.end + 0.1;
              const isPast = currentTime > w.end + 0.1;

              return (
                <span
                  key={idx}
                  className={`inline-block mr-1.5 ${
                    isActive
                      ? "text-white font-bold bg-zinc-800 px-1 rounded border-b-2 border-emerald-400"
                      : isPast
                      ? "text-zinc-200"
                      : "text-zinc-600 opacity-40"
                  }`}
                >
                  {w.word}
                  {isActive && <span className="animate-pulse text-emerald-400 font-bold ml-0.5">|</span>}
                </span>
              );
            })}
          </p>
        </div>
      )}

      {/* 5. NEON HACKER (Green monospace font with glowing phosphor matrix effects) */}
      {style === "neon_hacker" && activeSegment && (
        <div className="max-w-[92%] px-4 py-2 rounded-lg bg-black/90 border border-emerald-500/50 shadow-[0_0_20px_rgba(16,185,129,0.35)] backdrop-blur-md font-mono">
          <div className="flex items-center gap-1.5 text-[10px] text-emerald-500/70 mb-1 border-b border-emerald-500/20 pb-0.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
            <span>SYS_SUBTITLES.V1</span>
          </div>
          <p className="text-xs sm:text-sm text-emerald-400/80 tracking-wider">
            {activeSegment.words.map((w, idx) => {
              const isActive = currentTime >= w.start && currentTime <= w.end + 0.1;
              return (
                <span
                  key={idx}
                  className={`inline-block mr-1 ${
                    isActive
                      ? "text-white bg-emerald-600 px-1 rounded font-black shadow-[0_0_12px_#10b981]"
                      : "text-emerald-400"
                  }`}
                >
                  {isActive && "&gt;"} {w.word}
                </span>
              );
            })}
          </p>
        </div>
      )}

      {/* 6. CINEMATIC (Subtle fade-in, white serif text, elegant drop shadow) */}
      {style === "cinematic" && activeSegment && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="max-w-[85%] px-5 py-2.5 rounded-sm bg-gradient-to-r from-transparent via-black/80 to-transparent text-center"
        >
          <p className="font-serif italic text-base sm:text-xl text-zinc-100 tracking-wider drop-shadow-[0_2px_8px_rgba(0,0,0,1)]">
            "{activeSegment.text}"
          </p>
        </motion.div>
      )}

      {/* 7. COMIC BOOK (Bouncy comic font, angled action-style text) */}
      {style === "comic" && activeHormoziChunk && (
        <motion.div
          initial={{ rotate: -3, scale: 0.8 }}
          animate={{ rotate: -1, scale: 1.05 }}
          className="px-4 py-2 rounded-2xl bg-yellow-400 border-4 border-black shadow-[4px_4px_0px_#000] max-w-[90%]"
        >
          <p className="font-black uppercase tracking-wider text-black text-xl sm:text-2xl drop-shadow-[1px_1px_0px_#fff]">
            💥 {activeHormoziChunk.text} !
          </p>
        </motion.div>
      )}

      {/* 8. GLITCH EFFECT (Cyberpunk style RGB glitch on the active word) */}
      {style === "glitch" && activeHormoziChunk && (
        <div className="flex flex-wrap items-center justify-center gap-2 max-w-[90%] px-3 py-1.5 rounded-lg bg-black/60">
          {activeHormoziChunk.words.map((w, idx) => {
            const isActive = currentTime >= w.start && currentTime <= w.end + 0.1;
            return (
              <span
                key={idx}
                className={`font-black uppercase tracking-widest text-xl sm:text-2xl inline-block ${
                  isActive
                    ? "text-cyan-300 scale-110 drop-shadow-[2px_0px_0px_#ef4444]"
                    : "text-zinc-200"
                }`}
                style={{
                  textShadow: isActive
                    ? "2px 0 #ef4444, -2px 0 #06b6d4, 0 0 8px rgba(255,255,255,0.8)"
                    : "1px 1px 2px #000",
                }}
              >
                {w.word}
              </span>
            );
          })}
        </div>
      )}

      {/* 9. WORD SPLASH (Huge text, exactly one word on screen at a time) */}
      {style === "word_splash" && activeSingleWord && (
        <motion.div
          key={activeSingleWord.start}
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1.15, opacity: 1 }}
          exit={{ scale: 1.25, opacity: 0 }}
          transition={{ duration: 0.09 }}
          className="text-center"
        >
          <span
            className="font-black uppercase text-4xl sm:text-6xl lg:text-7xl tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 via-pink-500 to-cyan-400 inline-block"
            style={textStrokeStyle}
          >
            {activeSingleWord.word}
          </span>
        </motion.div>
      )}

      {/* 10. NEWS TICKER (Scrolling text background bar) */}
      {style === "news_ticker" && activeSegment && (
        <div className="w-full bg-red-600/90 border-t-2 border-yellow-400 text-white flex items-center shadow-2xl backdrop-blur-md">
          <div className="bg-yellow-400 text-black px-2.5 py-1 text-[11px] font-black uppercase tracking-wider shrink-0 flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-red-600 animate-ping" />
            BREAKING
          </div>
          <div className="overflow-hidden whitespace-nowrap px-3 py-1 text-xs sm:text-sm font-bold tracking-wide">
            <span className="inline-block animate-marquee">{activeSegment.text}</span>
          </div>
        </div>
      )}
    </div>
  );
}
