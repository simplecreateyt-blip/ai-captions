"use client";
import { useId } from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import type { CSSProperties } from "react";
import type { CaptionData } from "./CaptionOverlay";
import { Sparkles, CheckCircle2, Zap } from "lucide-react";

export type Category =
  | "Viral / Social"
  | "Cinematic / Pro"
  | "Gaming / High Energy"
  | "Modern Web"
  | "Creative / Aesthetic"
  | "Specialty";

export type AnimationId =
  | "slam"
  | "hud"
  | "swing"
  | "typewriter"
  | "fade"
  | "bounce"
  | "glitch"
  | "flip"
  | "wave"
  | "zoom";

export type EffectId =
  | "retro"
  | "gold"
  | "neon"
  | "rgb"
  | "glass"
  | "comic"
  | "cinematic"
  | "trail"
  | "holographic"
  | "liquid";

export interface CaptionTemplate {
  id: string;
  name: string;
  category: Category;
  animation: AnimationId;
  effect: EffectId;
  font: string;
  color: string;
  accent: string;
  stroke: string;
  panel: string;
  shadow: string;
  weight: number;
  uppercase?: boolean;
  swatch: string;
  padding?: string;
  borderRadius?: string;
  border?: string;
  backdropBlur?: string;
  letterSpacing?: string;
  textGradient?: string;
  boxShadow?: string;
  description?: string;
}

/** One timed caption unit: either a sentence segment or a short word group. */
export interface CaptionGroup {
  id: number;
  start: number;
  end: number;
  text: string;
  words: Array<{ word: string; start: number; end: number }>;
}

/**
 * Single, ultra-premium "Tech Influencer" (Tharun Speaks / Alex Hormozi) caption template.
 * Highlights the current spoken word in vivid electric yellow while keeping the rest in solid white.
 */
export const CAPTION_TEMPLATES: CaptionTemplate[] = [
  {
    id: "hormozi",
    name: "Tech Influencer (Tharun / Hormozi)",
    category: "Viral / Social",
    animation: "bounce",
    effect: "comic",
    font: "'Montserrat', 'Arial Black', -apple-system, sans-serif",
    color: "#FFFFFF",
    accent: "#FFE600",
    stroke: "3.5px #000000",
    panel: "transparent",
    shadow:
      "-3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000, 3px 3px 0 #000, 0 6px 18px rgba(0,0,0,0.9)",
    weight: 900,
    uppercase: true,
    swatch: "linear-gradient(135deg, #09090b 0%, #18181b 40%, #facc15 100%)",
    padding: "0px",
    borderRadius: "0px",
    border: "none",
    backdropBlur: "0px",
    letterSpacing: "0.03em",
    boxShadow: "none",
    description:
      "Word-by-word karaoke style: current word pops in electric yellow with solid white context text on 100% transparent background.",
  },
];

export const WORDS_PER_CAPTION_BY_TEMPLATE: Record<string, number> = {
  hormozi: 3,
};

export function wordsPerCaptionForTemplate(templateId: string): number {
  return WORDS_PER_CAPTION_BY_TEMPLATE[templateId] ?? 3;
}

/**
 * Group word timings into short, punchy 3-word visual chunks.
 */
export function buildCaptionGroups(
  words: CaptionGroup["words"],
  maxWords = 3,
  maxPauseSeconds = 0.35,
): CaptionGroup[] {
  const groups: CaptionGroup[] = [];
  let current: CaptionGroup["words"] = [];
  const limit = Math.max(1, maxWords);

  for (const word of words) {
    if (current.length) {
      const pause = word.start - current[current.length - 1].end;
      if (pause > maxPauseSeconds || current.length >= limit) {
        groups.push({
          id: groups.length,
          start: current[0].start,
          end: current[current.length - 1].end,
          text: current.map((item) => item.word).join(" "),
          words: current,
        });
        current = [];
      }
    }
    current.push(word);
  }

  if (current.length) {
    groups.push({
      id: groups.length,
      start: current[0].start,
      end: current[current.length - 1].end,
      text: current.map((item) => item.word).join(" "),
      words: current,
    });
  }
  return groups;
}

const ANIMATIONS: Record<AnimationId, Variants> = {
  slam: {
    rest: { opacity: 0.9, y: 0, scale: 1 },
    active: {
      opacity: 1,
      y: [-12, 0],
      scale: [0.95, 1.15, 1.08],
      transition: { duration: 0.2 },
    },
  },
  bounce: {
    rest: { opacity: 0.9, scale: 1, y: 0 },
    active: {
      opacity: 1,
      scale: 1.14,
      y: -2,
      transition: { type: "spring", stiffness: 500, damping: 18 },
    },
  },
  hud: {
    rest: { opacity: 0.8 },
    active: { opacity: 1, scale: 1.1, transition: { duration: 0.18 } },
  },
  swing: {
    rest: { opacity: 0.9, rotate: 0 },
    active: { opacity: 1, scale: 1.12, rotate: [-3, 3, 0], transition: { duration: 0.2 } },
  },
  typewriter: {
    rest: { opacity: 0.8 },
    active: { opacity: 1, scale: 1.08, transition: { duration: 0.1 } },
  },
  fade: {
    rest: { opacity: 0.85 },
    active: { opacity: 1, scale: 1.1, transition: { duration: 0.15 } },
  },
  glitch: {
    rest: { opacity: 0.9, x: 0 },
    active: { opacity: 1, scale: 1.12, x: [-2, 2, 0], transition: { duration: 0.18 } },
  },
  flip: {
    rest: { opacity: 0.9 },
    active: { opacity: 1, scale: 1.12, transition: { duration: 0.2 } },
  },
  wave: {
    rest: { opacity: 0.9, y: 0 },
    active: { opacity: 1, scale: 1.12, y: -3, transition: { duration: 0.2 } },
  },
  zoom: {
    rest: { opacity: 0.85, scale: 1 },
    active: { opacity: 1, scale: 1.16, transition: { duration: 0.2 } },
  },
};

function getEffectStyle(
  template: CaptionTemplate,
  accent: string,
  liquidFilterId: string,
): CSSProperties {
  return {
    color: accent,
    WebkitTextStroke: "3px #000000",
    textShadow:
      "-3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000, 3px 3px 0 #000, 0 0 18px rgba(254, 226, 39, 0.75)",
  };
}

interface GalleryProps {
  selectedId: string;
  onSelect: (template: CaptionTemplate) => void;
  selectedProStyleId?: string;
  onToggleNone?: () => void;
}

/**
 * Clean, uncluttered UI card showcasing the active "Tech Influencer" word-by-word karaoke style.
 */
export function CaptionTemplateGallery({
  selectedId,
  onSelect,
  selectedProStyleId = "tharun_classic",
  onToggleNone,
}: GalleryProps) {
  const isNone = selectedProStyleId === "none";
  const proStyle =
    PRO_CAPTION_STYLES[selectedProStyleId] || PRO_CAPTION_STYLES.tharun_classic;

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5 shadow-2xl backdrop-blur-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-400/10 text-amber-300 border border-amber-400/30">
              <Zap className="h-3.5 w-3.5" />
            </span>
            <h3 className="text-sm font-bold text-white">
              {isNone ? "Caption Engine (Disabled)" : proStyle.name}
            </h3>
            {isNone ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-400 border border-rose-500/20">
                No Subtitles
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/20">
                <CheckCircle2 className="h-3 w-3" /> Active
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            {isNone
              ? "Subtitles are currently disabled. Video will be exported in raw format without captions."
              : proStyle.description}
          </p>
        </div>
        {onToggleNone && (
          <button
            type="button"
            onClick={onToggleNone}
            className={`text-xs px-3 py-1.5 rounded-xl font-bold transition border cursor-pointer ${
              isNone
                ? "bg-amber-400/20 text-amber-300 border-amber-400/40 hover:bg-amber-400/30"
                : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white"
            }`}
          >
            {isNone ? "Re-enable Captions" : "Disable Captions"}
          </button>
        )}
      </div>

      {/* Live Visual Preview of Word-by-Word Highlighting */}
      <div className="mt-4 rounded-xl border border-amber-400/25 bg-zinc-900/70 p-4 shadow-inner">
        <div className="mb-2 flex items-center justify-between text-[11px] font-medium text-zinc-400">
          <span className="flex items-center gap-1.5 text-zinc-300">
            <Sparkles className="h-3.5 w-3.5 text-amber-400" />
            {isNone ? "Raw Video Mode" : "Live Highlighting Preview"}
          </span>
          <span className="font-mono text-[10px] text-zinc-500">
            {isNone
              ? "No Text Overlays"
              : `Font: ${proStyle.font.split(",")[0].replace(/['"]/g, "")}`}
          </span>
        </div>

        {isNone ? (
          <div className="flex flex-col items-center justify-center py-5 text-center">
            <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest bg-zinc-950/80 px-4 py-2 rounded-xl border border-zinc-800">
              Captions Disabled &bull; Raw Video Export
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-center gap-2 py-3 text-center">
            <span
              className="text-lg font-black tracking-wide"
              style={{
                color: proStyle.inactiveColor,
                textShadow: proStyle.shadow,
                WebkitTextStroke: proStyle.stroke,
                fontFamily: proStyle.font,
              }}
            >
              HOW
            </span>
            <span
              className="scale-110 -translate-y-0.5 rounded px-2 py-0.5 text-xl font-black tracking-wide transition-transform"
              style={{
                color: proStyle.activeColor,
                textShadow: proStyle.shadow,
                WebkitTextStroke: proStyle.stroke,
                fontFamily: proStyle.font,
              }}
            >
              CREATORS
            </span>
            <span
              className="text-lg font-black tracking-wide"
              style={{
                color: proStyle.inactiveColor,
                textShadow: proStyle.shadow,
                WebkitTextStroke: proStyle.stroke,
                fontFamily: proStyle.font,
              }}
            >
              GROW
            </span>
          </div>
        )}

        <div className="mt-2 flex items-center justify-between border-t border-zinc-800/80 pt-2 text-[10px] text-zinc-400">
          <span className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: isNone ? "#71717a" : proStyle.activeColor }}
            />
            {isNone ? "No Caption Layer" : `Active Word: ${proStyle.name} (${proStyle.activeColor})`}
          </span>
          <span>
            {isNone ? "100% Transparent" : `Context Words: ${proStyle.inactiveColor}`}
          </span>
        </div>
      </div>
    </section>
  );
}

export interface ProCaptionStyle {
  id: string;
  name: string;
  subtitle: string;
  tag: string;
  font: string;
  activeColor: string;
  inactiveColor: string;
  scale: number;
  stroke: string;
  shadow: string;
  isStatic?: boolean;
  colorSwatch: string;
  description: string;
}

export const PRO_CAPTION_STYLES: Record<string, ProCaptionStyle> = {
  tharun_classic: {
    id: "tharun_classic",
    name: "Tharun Classic",
    subtitle: "Viral Tech Reel",
    tag: "VIRAL",
    font: "'Montserrat', 'Arial Black', sans-serif",
    activeColor: "#FFE600",
    inactiveColor: "#FFFFFF",
    scale: 1.2,
    stroke: "3.5px #000000",
    shadow: "-3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000, 3px 3px 0 #000, 0 4px 14px rgba(0,0,0,0.9)",
    colorSwatch: "from-yellow-400 to-amber-500",
    description: "Bright yellow active word with 120% pop bounce and thick outline.",
  },
  abdaal_minimal: {
    id: "abdaal_minimal",
    name: "Abdaal Minimal",
    subtitle: "Clean & Aesthetic",
    tag: "CLEAN",
    font: "'Inter', Arial, sans-serif",
    activeColor: "#7FFFD4",
    inactiveColor: "#FFFFFF",
    scale: 1.1,
    stroke: "2px #000000",
    shadow: "-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000",
    colorSwatch: "from-emerald-400 to-teal-500",
    description: "Soft mint green highlight, clean Inter/Arial font, and subtle shadow.",
  },
  beast_impact: {
    id: "beast_impact",
    name: "Beast Impact",
    subtitle: "High Energy",
    tag: "HYPER",
    font: "Impact, 'Montserrat Black', sans-serif",
    activeColor: "#00FFFF",
    inactiveColor: "#FFFFFF",
    scale: 1.3,
    stroke: "4px #000000",
    shadow: "-3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000, 3px 3px 0 #000, 0 6px 20px rgba(0,0,0,1)",
    colorSwatch: "from-cyan-400 to-blue-500",
    description: "Bright cyan pop with 130% punch, Impact font, and heavy 4px border.",
  },
  gadzhi_luxury: {
    id: "gadzhi_luxury",
    name: "Gadzhi Luxury",
    subtitle: "Moody & Elegant",
    tag: "LUXURY",
    font: "'Montserrat', Arial, sans-serif",
    activeColor: "#FFA500",
    inactiveColor: "#C0C0C0",
    scale: 1.15,
    stroke: "3px #000000",
    shadow: "-3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000, 3px 3px 0 #000, 0 8px 24px rgba(0,0,0,0.95)",
    colorSwatch: "from-amber-500 to-orange-600",
    description: "Warm gold/orange active word with light gray text and deep shadow.",
  },
  dev_hacker: {
    id: "dev_hacker",
    name: "Dev Hacker",
    subtitle: "Terminal Monospace",
    tag: "TECH",
    font: "Consolas, 'Courier New', monospace",
    activeColor: "#00FF00",
    inactiveColor: "#FFFFFF",
    scale: 1.15,
    stroke: "2.5px #000000",
    shadow: "-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, 0 0 12px rgba(0,255,0,0.6)",
    colorSwatch: "from-green-400 to-emerald-600",
    description: "Terminal green glow on monospaced font for developers.",
  },
  plain_hinglish: {
    id: "plain_hinglish",
    name: "Plain Hinglish (Static)",
    subtitle: "Static Subtitle",
    tag: "STATIC",
    font: "Arial, sans-serif",
    activeColor: "#FFFFFF",
    inactiveColor: "#FFFFFF",
    scale: 1.0,
    stroke: "2px #000000",
    shadow: "-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000",
    isStatic: true,
    colorSwatch: "from-zinc-300 to-zinc-500",
    description: "Clean full-sentence subtitles without word-by-word animation.",
  },
  mkbhd_crisp: {
    id: "mkbhd_crisp",
    name: "MKBHD Crisp",
    subtitle: "Matte Studio Red",
    tag: "CRISP",
    font: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    activeColor: "#FF3B30",
    inactiveColor: "#FFFFFF",
    scale: 1.2,
    stroke: "3px #18181b",
    shadow: "-2px -2px 0 #18181b, 2px -2px 0 #18181b, -2px 2px 0 #18181b, 2px 2px 0 #18181b, 0 4px 12px rgba(0,0,0,0.8)",
    colorSwatch: "from-red-500 to-rose-700",
    description: "Matte studio red pop on crisp white text with deep charcoal outline.",
  },
  huberman_clean: {
    id: "huberman_clean",
    name: "Huberman Clean",
    subtitle: "Deep Work / Scientific",
    tag: "FOCUS",
    font: "'Montserrat', 'Outfit', sans-serif",
    activeColor: "#00F2FE",
    inactiveColor: "#E2E8F0",
    scale: 1.12,
    stroke: "2px #0f172a",
    shadow: "-2px -2px 0 #0f172a, 2px -2px 0 #0f172a, -2px 2px 0 #0f172a, 2px 2px 0 #0f172a, 0 2px 8px rgba(0,242,254,0.3)",
    colorSwatch: "from-cyan-400 to-sky-500",
    description: "Electric ice cyan keyword on slate gray text with minimalist crisp outline.",
  },
};

interface OverlayProps {
  currentTime: number;
  captionData: CaptionData | null;
  template: CaptionTemplate;
  position?: "top" | "center" | "bottom";
  fontSize?: "sm" | "md" | "lg" | "xl";
  /** Explicit caption units; falls back to captionData.segments. */
  groups?: CaptionGroup[] | null;
  /** Optional accent override (Highlight colour control in the toolbar). */
  accentOverride?: string | null;
  /** Pro style preset identifier */
  styleId?: string;
}

/**
 * Live video player overlay rendering viral word-by-word karaoke captions.
 */
export function CaptionTemplateOverlay({
  currentTime,
  captionData,
  template,
  position = "bottom",
  fontSize = "lg",
  groups,
  accentOverride,
  styleId = "tharun_classic",
}: OverlayProps) {
  if (!styleId || styleId === "none") return null;

  const fallbackSegments = (captionData?.segments ?? []) as CaptionGroup[];
  const units: CaptionGroup[] = groups?.length ? groups : fallbackSegments;
  if (!units.length) return null;

  // Find the caption segment corresponding to the current video time
  const segment = units.find(
    (item) => currentTime >= item.start - 0.04 && currentTime <= item.end + 0.2,
  );
  if (!segment) return null;

  const proStyle =
    PRO_CAPTION_STYLES[styleId] || PRO_CAPTION_STYLES.tharun_classic;
  const isStatic = Boolean(proStyle.isStatic);
  const activeColor = accentOverride || proStyle.activeColor;
  const inactiveColor = proStyle.inactiveColor;
  const activeScale = proStyle.scale;

  const positionClass = {
    top: "top-10",
    center: "top-1/2 -translate-y-1/2",
    bottom: "bottom-14",
  }[position];

  const sizeClass = {
    sm: "text-lg sm:text-xl",
    md: "text-xl sm:text-2xl",
    lg: "text-2xl sm:text-3xl",
    xl: "text-3xl sm:text-4xl",
  }[fontSize];

  return (
    <div
      className={`pointer-events-none absolute left-0 right-0 z-30 flex justify-center px-4 ${positionClass}`}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={`caption-segment-${segment.id}`}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.12 }}
          className="max-w-[96%] bg-transparent p-0 text-center"
          style={{
            background: "transparent",
            boxShadow: "none",
            border: "none",
          }}
        >
          <p
            className={`${sizeClass} flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 font-black ${
              isStatic ? "normal-case" : "uppercase"
            } leading-tight tracking-wider`}
            style={{
              fontFamily: proStyle.font,
            }}
          >
            {segment.words.map((word, index) => {
              const isActive =
                !isStatic &&
                currentTime >= word.start - 0.02 &&
                currentTime <= word.end + 0.06;

              return (
                <motion.span
                  key={`${word.start}-${index}`}
                  animate={
                    isStatic
                      ? { scale: 1, y: 0, color: inactiveColor }
                      : isActive
                      ? {
                          scale: activeScale,
                          y: -2,
                          color: activeColor,
                        }
                      : {
                          scale: 1,
                          y: 0,
                          color: inactiveColor,
                        }
                  }
                  transition={{ type: "spring", stiffness: 500, damping: 20 }}
                  style={{
                    display: "inline-block",
                    WebkitTextStroke: isActive
                      ? proStyle.stroke
                      : isStatic
                      ? proStyle.stroke
                      : "2.5px #000000",
                    textShadow: isActive
                      ? proStyle.shadow
                      : "-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000",
                  }}
                >
                  {word.word}
                </motion.span>
              );
            })}
          </p>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
