"use client";
import {
  CAPTION_TEMPLATES,
  CaptionTemplateGallery,
  CaptionTemplateOverlay,
  PRO_CAPTION_STYLES,
  buildCaptionGroups,
  wordsPerCaptionForTemplate,
  type CaptionGroup,
  type CaptionTemplate,
  type ProCaptionStyle,
} from "./CaptionTemplateSystem";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UploadResult } from "./VideoUploader";
import type { CaptionData, CaptionStyleId } from "./CaptionOverlay";
import TranscriptEditor from "./TranscriptEditor";
import Card3DTilt from "./Card3DTilt";
import {
  Sparkles,
  RotateCcw,
  CheckCircle2,
  Download,
  FileVideo,
  Layers,
  Zap,
  Sliders,
  Palette,
  Loader2,
  MoveVertical,
  Type,
  Key,
  Globe,
  Radio,
  FileCode,
  Flame,
  Terminal,
  Tv,
  Film,
  Music,
  Smile,
  AlertTriangle,
  Stethoscope,
  RefreshCw,
  FileText,
  UploadCloud,
  X,
  Check,
  Monitor,
  Smartphone,
  Ratio,
  Ban,
  Activity,
  ShieldCheck,
} from "lucide-react";
import { useGroqKey } from "@/hooks/useGroqKey";
import ApiKeyModal from "./ApiKeyModal";
import AdRewardModal from "./AdRewardModal";

const PRO_STYLE_ICONS: Record<string, any> = {
  tharun_classic: Flame,
  abdaal_minimal: Sparkles,
  beast_impact: Zap,
  gadzhi_luxury: Film,
  dev_hacker: Terminal,
  plain_hinglish: FileText,
  mkbhd_crisp: Tv,
  huberman_clean: Activity,
};

/**
 * Base URL of the FastAPI backend.
 * Points directly to http://localhost:8000 unless overridden by NEXT_PUBLIC_API_URL.
 */
const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

interface VideoPreviewProps {
  videoData: UploadResult;
  onReset: () => void;
}

type CaptionPosition = "top" | "center" | "bottom";
type FontSize = "sm" | "md" | "lg" | "xl";
type HighlightColor = "yellow" | "cyan" | "green" | "pink";
type TargetLanguage = "Hinglish" | "English" | "Spanish";

interface StylePreset {
  id: CaptionStyleId;
  name: string;
  tag: string;
  desc: string;
  icon: any;
  color: string;
}

/** Backend style ids, used as the `style` field of /api/transcribe. */
const STYLE_PRESETS: StylePreset[] = [
  {
    id: "hormozi",
    name: "Hormozi",
    tag: "VIRAL",
    desc: "Bold 1-2 words, yellow & green pop, high-hook bounce",
    icon: Flame,
    color: "from-yellow-400 to-amber-500",
  },
  {
    id: "karaoke",
    name: "Karaoke Glow",
    tag: "HOT",
    desc: "Full sentence visible, active word glows Neon Blue",
    icon: Music,
    color: "from-cyan-400 to-blue-500",
  },
  {
    id: "ali_abdaal",
    name: "Ali Abdaal",
    tag: "CLEAN",
    desc: "Minimalist sans-serif with subtle pastel highlighter keywords",
    icon: Sparkles,
    color: "from-emerald-400 to-teal-500",
  },
  {
    id: "typewriter",
    name: "Typewriter",
    tag: "RETRO",
    desc: "Classic typewriter monospace with blinking cursor typing effect",
    icon: Terminal,
    color: "from-zinc-400 to-zinc-600",
  },
  {
    id: "neon_hacker",
    name: "Neon Hacker",
    tag: "CYBER",
    desc: "Matrix green monospace font with glowing phosphor scanline overlay",
    icon: Zap,
    color: "from-green-400 to-emerald-600",
  },
  {
    id: "cinematic",
    name: "Cinematic",
    tag: "ELEGANT",
    desc: "Subtle fade-in white serif text with deep cinematic drop shadow",
    icon: Film,
    color: "from-violet-400 to-purple-600",
  },
  {
    id: "comic",
    name: "Comic Book",
    tag: "BOUNCY",
    desc: "Angled comic font with heavy black outline & action punch",
    icon: Smile,
    color: "from-yellow-500 to-red-500",
  },
  {
    id: "glitch",
    name: "Glitch Effect",
    tag: "RGB",
    desc: "Cyberpunk chromatic aberration split with rapid jitter",
    icon: Radio,
    color: "from-pink-500 to-cyan-400",
  },
  {
    id: "word_splash",
    name: "Word Splash",
    tag: "MASSIVE",
    desc: "Huge text, exactly one word on screen at a time in center",
    icon: Layers,
    color: "from-orange-400 to-rose-500",
  },
  {
    id: "news_ticker",
    name: "News Ticker",
    tag: "BROADCAST",
    desc: "Scrolling bottom marquee tape bar with breaking news badge",
    icon: Tv,
    color: "from-red-500 to-red-700",
  },
];

/**
 * Many gallery templates reuse the look of a backend style. Sending the mapped
 * id keeps the backend grouping in sync with the visual template; unknown ids
 * simply fall back to "cinematic" (the backend also warns instead of erroring).
 */
const API_STYLE_BY_TEMPLATE: Record<string, CaptionStyleId> = {
  // Viral / Social
  hormozi: "hormozi",
  mrbeast: "hormozi",
  "ali-abdaal": "ali_abdaal",
  "clean-pop": "hormozi",
  tiktok: "hormozi",
  vlog: "ali_abdaal",
  "viral-punch": "hormozi",
  "shorts-magnet": "hormozi",

  // Cinematic / Pro
  netflix: "cinematic",
  "anime-vhs": "cinematic",
  "film-noir": "cinematic",
  "luxury-gold": "cinematic",
  "apple-keynote": "cinematic",
  "minimal-white": "cinematic",
  "imax-doc": "cinematic",
  editorial: "cinematic",

  // Gaming / High Energy
  cyberpunk: "glitch",
  "rgb-gamer": "neon_hacker",
  "glitch-matrix": "glitch",
  "retro-80s": "glitch",
  terminal: "neon_hacker",
  "neon-strike": "neon_hacker",
  "pixel-arcade": "comic",
  "fire-drop": "hormozi",
  "apex-predator": "hormozi",
  "valorant-radiant": "neon_hacker",

  // Modern Web
  "spotify-lyrics": "karaoke",
  "tiktok-minimal": "cinematic",
  brutalist: "hormozi",
  "glass-float": "ali_abdaal",
  "linear-dark": "ali_abdaal",
  "notion-clean": "ali_abdaal",
  "stripe-mesh": "ali_abdaal",
  "raycast-cmd": "neon_hacker",

  // Creative / Aesthetic
  "comic-bubble": "comic",
  "y2k-bubblegum": "comic",
  typewriter: "typewriter",
  "holographic-pearl": "ali_abdaal",
  "pastel-bounce": "ali_abdaal",
  "liquid-chrome": "cinematic",

  // Specialty
  newsroom: "news_ticker",
  anime: "comic",
  chalkboard: "typewriter",
  "scifi-hud": "neon_hacker",
  "letterbox-gold": "cinematic",
};

const HIGHLIGHT_ACCENTS: Record<HighlightColor, string> = {
  yellow: "#fde047",
  cyan: "#22d3ee",
  green: "#4ade80",
  pink: "#f472b6",
};

const TRANSCRIBE_TIMEOUT_MS = 25 * 60 * 1000;

interface DiagnoseReport {
  ok?: boolean;
  api_key_present?: boolean;
  api_key_looks_valid?: boolean;
  whisper_model?: string;
  llm_model_chain?: string[];
  available_models?: string[] | null;
  whisper_served?: boolean | null;
  llm_served?: boolean | null;
  chat_ping?: { model?: string; ok?: boolean; error?: string; reply?: string };
  error?: string;
  hint?: string;
  server?: Record<string, unknown>;
}

export default function VideoPreview({ videoData, onReset }: VideoPreviewProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<CaptionTemplate>(
    CAPTION_TEMPLATES[0],
  );
  const [selectedStyle, setSelectedStyle] = useState<CaptionStyleId>("hormozi");
  const [proStyleId, setProStyleId] = useState<string>("tharun_classic");
  const [aspectRatio, setAspectRatio] = useState<string>("original");
  const [customAccent, setCustomAccent] = useState<string | null>(null);
  const [targetLanguage, setTargetLanguage] = useState<TargetLanguage>("Hinglish");
  const [captionPosition, setCaptionPosition] = useState<CaptionPosition>("bottom");
  const [fontSize, setFontSize] = useState<FontSize>("lg");
  const [highlightColor, setHighlightColor] = useState<HighlightColor>("yellow");

  const handleSelectProStyle = (id: string) => {
    // If clicking on already active style, toggle it off to "none"
    if (proStyleId === id) {
      setProStyleId("none");
    } else {
      setProStyleId(id);
    }
    setCustomAccent(null);
  };

  // Groq BYOK API Key & Rewarded Ad Modal state
  const { apiKey: groqApiKey, hasPersonalKey } = useGroqKey();
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [isAdModalOpen, setIsAdModalOpen] = useState(false);

  // Optional SRT state
  const [srtFile, setSrtFile] = useState<File | null>(videoData.srtFile || null);
  const [isParsingSrt, setIsParsingSrt] = useState(false);
  const srtInputRef = useRef<HTMLInputElement>(null);

  // Transcription state
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [transcribeStep, setTranscribeStep] = useState<string>("");
  const [captionData, setCaptionData] = useState<CaptionData | null>(
    videoData.initialCaptionData || null,
  );
  const [warnings, setWarnings] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorHint, setErrorHint] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [wasCached, setWasCached] = useState(false);

  const handleSrtUpload = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".srt")) {
      setErrorMessage("Please select a valid .srt subtitle file.");
      return;
    }
    setSrtFile(file);
    setIsParsingSrt(true);
    setErrorMessage(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(`${API_BASE}/api/parse-srt`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        throw new Error(errJson?.detail || "Failed to parse SRT file.");
      }
      const resData = await response.json();
      setCaptionData({
        duration: resData.words?.[resData.words.length - 1]?.end || 0,
        full_text: resData.full_text || "",
        total_words: resData.total_words || 0,
        total_segments: resData.segments?.length || 0,
        total_chunks: resData.caption_chunks?.length || 0,
        words: resData.words || [],
        segments: resData.segments || [],
        hormozi_chunks: resData.caption_chunks || [],
        language: "English",
        caption_chunks: resData.caption_chunks,
      } as unknown as CaptionData);
      setWarnings([
        `Custom .srt loaded (${resData.total_cues} cues, ${resData.total_words} words). AI Whisper transcription skipped!`,
      ]);
    } catch (err: any) {
      setErrorMessage(err?.message || "Failed to parse .srt file.");
    } finally {
      setIsParsingSrt(false);
    }
  };

  // Diagnostics panel
  const [diagnostics, setDiagnostics] = useState<DiagnoseReport | null>(null);
  const [isDiagnosing, setIsDiagnosing] = useState(false);

  // Video playback time tracking
  const [currentTime, setCurrentTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  }, []);

  const handleSeek = useCallback((time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
      void videoRef.current.play();
    }
  }, []);

  const handleSelectTemplate = useCallback((template: CaptionTemplate) => {
    setSelectedTemplate(template);
    const apiStyle = API_STYLE_BY_TEMPLATE[template.id];
    if (apiStyle) setSelectedStyle(apiStyle);
  }, []);

  /**
   * Warnings + the cached flag can arrive on either the envelope or the payload,
   * so read both before rendering the banner.
   */
  const collectWarnings = (payload: any, envelope: any): string[] => {
    const merged = [
      ...(Array.isArray(envelope?.warnings) ? envelope.warnings : []),
      ...(Array.isArray(payload?.warnings) ? payload.warnings : []),
    ];
    return Array.from(new Set(merged.filter(Boolean)));
  };

  /**
   * Parse a failed response defensively: FastAPI normally returns JSON, but a
   * crashed worker can still return plain text, which used to surface as
   * "Unexpected token I in JSON at position 0" / "Internal Server Error".
   */
  const describeFailure = async (response: Response): Promise<string> => {
    const raw = await response.text().catch(() => "");
    let body: any = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = null;
    }

    setErrorCode(body?.code ?? `http_${response.status}`);
    setErrorHint(body?.hint ?? null);

    const detail =
      (typeof body?.detail === "string" && body.detail) ||
      (typeof body?.message === "string" && body.message) ||
      (Array.isArray(body?.detail) ? JSON.stringify(body.detail) : "");

    if (detail) return detail;
    if (raw && raw.length < 400 && !raw.includes("<!DOCTYPE")) {
      return raw.trim();
    }
    return `Request failed with HTTP ${response.status} ${
      response.statusText || ""
    }`.trim();
  };

  const handleGenerateCaptions = async (options?: { force?: boolean }) => {
    if (srtFile) {
      await handleSrtUpload(srtFile);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = window.setTimeout(
      () => controller.abort(),
      TRANSCRIBE_TIMEOUT_MS,
    );

    setIsTranscribing(true);
    setErrorMessage(null);
    setErrorHint(null);
    setErrorCode(null);
    setTranscribeStep("Re-encoding audio to 16 kHz mono WAV with FFmpeg…");

    const stepTimers: number[] = [
      window.setTimeout(() => {
        setTranscribeStep(
          "Layer 1: Groq whisper-large-v3 extracting word timestamps…",
        );
      }, 1500),
      window.setTimeout(() => {
        setTranscribeStep(
          `Layer 2: rewriting captions into ${targetLanguage}…`,
        );
      }, 4000),
    ];

    try {
      const effectiveKey = groqApiKey.trim();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (effectiveKey) {
        headers["x-groq-key"] = effectiveKey;
      }

      const response = await fetch(`${API_BASE}/api/transcribe`, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          file_id: videoData.fileId,
          target_language: targetLanguage,
          style: selectedStyle,
          engine: "groq",
          groq_api_key: effectiveKey || undefined,
          force: options?.force ?? false,
        }),
      });

      if (!response.ok) {
        throw new Error(await describeFailure(response));
      }

      const resJson = await response.json();
      if (!resJson?.data) {
        throw new Error("The server returned success but no caption data.");
      }

      setCaptionData(resJson.data as CaptionData);
      setWarnings(collectWarnings(resJson.data, resJson));
      setWasCached(Boolean(resJson.cached));
    } catch (err: any) {
      if (err?.name === "AbortError") {
        setErrorMessage(
          "The request was cancelled or timed out. Long videos can take a few minutes — try again, or trim the clip.",
        );
        setErrorCode("client_aborted");
      } else {
        setErrorMessage(err?.message || "An unexpected error occurred.");
        setErrorCode((prev) => prev ?? "client_error");
        if (typeof err?.message === "string" &&
            /api key|unauthor|401|missing_api_key/i.test(err.message)) {
          setIsApiKeyModalOpen(true);
        }
      }
    } finally {
      stepTimers.forEach((timer) => window.clearTimeout(timer));
      window.clearTimeout(timeout);
      setIsTranscribing(false);
      setTranscribeStep("");
    }
  };

  const runDiagnostics = async () => {
    setIsDiagnosing(true);
    try {
      const response = await fetch(`${API_BASE}/api/diagnose`, {
        cache: "no-store",
      });
      const report = (await response.json().catch(() => null)) as
        | DiagnoseReport
        | null;
      setDiagnostics(
        report ?? {
          error: `Diagnostics endpoint returned HTTP ${response.status}.`,
        },
      );
    } catch (err: any) {
      setDiagnostics({
        error:
          err?.message ||
          "Could not reach the backend. Is it running on port 8000?",
        hint: "Start it with: uvicorn main:app --host 0.0.0.0 --port 8000",
      });
    } finally {
      setIsDiagnosing(false);
    }
  };

  /**
   * Caption units actually rendered. Short-form templates use the API's
   * `caption_chunks` (1-2 words); sentence-y templates use `segments`. When the
   * backend response predates `caption_chunks`, group the words on the client so
   * the template still controls how many words appear at once.
   */
  const captionGroups: CaptionGroup[] | null = useMemo(() => {
    if (!captionData) return null;
    const perCaption = wordsPerCaptionForTemplate(selectedTemplate.id);
    const apiGroups = (captionData as any)?.caption_chunks as
      | CaptionGroup[]
      | undefined;

    if (perCaption <= 2) {
      if (apiGroups?.length) return apiGroups;
      return buildCaptionGroups(captionData.words ?? [], perCaption);
    }
    return (captionData.segments ?? []) as CaptionGroup[];
  }, [captionData, selectedTemplate.id]);

  const executeExport = async () => {
    if (proStyleId !== "none" && !srtFile && !captionGroups?.length) return;

    setIsExporting(true);
    setExportError(null);
    try {
      const formData = new FormData();
      if (videoData.videoFile) {
        formData.append("video_file", videoData.videoFile);
      }
      formData.append("file_id", videoData.fileId);
      if (srtFile) {
        formData.append("srt_file", srtFile);
      }
      formData.append("position", captionPosition);
      formData.append("font_size", fontSize);
      formData.append("style_id", proStyleId);
      formData.append("aspect_ratio", aspectRatio);

      if (captionGroups && captionGroups.length > 0) {
        formData.append(
          "captions",
          JSON.stringify(
            captionGroups.map(({ start, end, text }) => ({
              start,
              end,
              text,
            })),
          ),
        );
      }

      const headers: Record<string, string> = {};
      const effectiveKey = groqApiKey.trim();
      if (effectiveKey) {
        headers["x-groq-key"] = effectiveKey;
      }

      const response = await fetch(`${API_BASE}/api/export`, {
        method: "POST",
        headers,
        body: formData,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const detail = body?.detail;
        throw new Error(
          (typeof detail === "string" && detail) ||
            detail?.message ||
            body?.message ||
            `Export failed with HTTP ${response.status}.`,
        );
      }

      const videoBlob = await response.blob();
      const downloadUrl = URL.createObjectURL(videoBlob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download =
        proStyleId === "none"
          ? `${videoData.fileId}_raw_${aspectRatio}.mp4`
          : `${videoData.fileId}_captioned.mp4`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    } catch (error) {
      setExportError(
        error instanceof Error ? error.message : "Video export failed.",
      );
    } finally {
      setIsExporting(false);
    }
  };

  const triggerVideoDownload = async () => {
    await executeExport();
  };

  const handleExportClick = () => {
    if (proStyleId !== "none" && !srtFile && !captionGroups?.length) return;

    const userApiKey = localStorage.getItem("user_groq_key");
    if (userApiKey && userApiKey.trim() !== "") {
      // User has BYOK -> instant export with zero ads
      triggerVideoDownload();
    } else {
      // Free user -> open AdRewardModal
      setIsAdModalOpen(true);
    }
  };

  const handleDownloadEditedVideo = handleExportClick;

  return (
    <div className="w-full space-y-8">
      {/* Top Glassmorphic Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-500/20 bg-zinc-950/60 backdrop-blur-xl px-5 py-3.5 text-emerald-300 shadow-xl">
        <div className="flex items-center space-x-2.5">
          <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
          <span className="text-sm font-semibold tracking-wide">
            Video synced with FastAPI server!
          </span>
        </div>
        <div className="flex items-center space-x-3 text-xs text-emerald-400/90 font-mono">
          <span className="bg-emerald-950/60 px-2.5 py-1 rounded-lg border border-emerald-800/40">
            ID: {videoData.fileId.slice(0, 8)}...
          </span>
          <span>&bull; {videoData.sizeMb} MB</span>
        </div>
      </div>

      {/* Error alert */}
      {errorMessage && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 backdrop-blur-xl p-5 text-rose-300 text-sm space-y-2">
          <p className="font-bold text-rose-200 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Transcription Issue
          </p>
          <p className="text-xs text-rose-300/90 leading-relaxed">{errorMessage}</p>
          {errorHint && (
            <p className="text-xs text-amber-200/90 leading-relaxed">
              <span className="font-semibold">Fix:</span> {errorHint}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {errorCode && (
              <span className="rounded-md bg-rose-950/60 px-2 py-0.5 text-[10px] font-mono text-rose-200 border border-rose-800/50">
                code: {errorCode}
              </span>
            )}
            <button
              type="button"
              onClick={runDiagnostics}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-400/40 px-2.5 py-1 text-[11px] font-semibold text-rose-100 hover:bg-rose-500/20 transition"
            >
              <Stethoscope className="h-3.5 w-3.5" />
              Run backend diagnostics
            </button>
          </div>
        </div>
      )}

      {/* Diagnostics report */}
      {diagnostics && (
        <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/5 backdrop-blur-xl p-5 text-xs text-cyan-100 space-y-2">
          <div className="flex items-center justify-between">
            <p className="font-bold text-cyan-200 flex items-center gap-2">
              <Stethoscope className="h-4 w-4" />
              Backend diagnostics
            </p>
            <button
              type="button"
              onClick={() => setDiagnostics(null)}
              className="text-[11px] text-cyan-300/80 hover:text-white"
            >
              Dismiss
            </button>
          </div>
          <pre className="max-h-64 overflow-auto rounded-xl bg-zinc-950/80 p-3 text-[11px] leading-relaxed text-zinc-200">
            {JSON.stringify(diagnostics, null, 2)}
          </pre>
          {diagnostics.hint && (
            <p className="text-amber-200/90">
              <span className="font-semibold">Suggested fix:</span>{" "}
              {diagnostics.hint}
            </p>
          )}
        </div>
      )}

      {/* Main Grid: Video Player + Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Video Player Container */}
        <div
          className={`flex flex-col items-center transition-all duration-300 ${
            aspectRatio === "16:9" ? "lg:col-span-6" : "lg:col-span-5"
          }`}
        >
          {/* Quick Aspect Ratio Toggle Bar */}
          <div className="flex items-center justify-between w-full max-w-[370px] mb-3 px-1">
            <span className="text-xs font-semibold text-zinc-400 flex items-center gap-1.5">
              <Ratio className="h-3.5 w-3.5 text-cyan-400" />
              Aspect Ratio:
            </span>
            <div className="flex rounded-xl bg-zinc-900/90 p-1 border border-zinc-800">
              <button
                type="button"
                onClick={() => setAspectRatio("original")}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition cursor-pointer ${
                  aspectRatio === "original"
                    ? "bg-cyan-500 text-zinc-950 shadow"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                Original
              </button>
              <button
                type="button"
                onClick={() => setAspectRatio("16:9")}
                className={`flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg transition cursor-pointer ${
                  aspectRatio === "16:9"
                    ? "bg-cyan-500 text-zinc-950 shadow"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                <Monitor className="h-3 w-3" />
                16:9
              </button>
              <button
                type="button"
                onClick={() => setAspectRatio("9:16")}
                className={`flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg transition cursor-pointer ${
                  aspectRatio === "9:16"
                    ? "bg-cyan-500 text-zinc-950 shadow"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                <Smartphone className="h-3 w-3" />
                9:16
              </button>
            </div>
          </div>

          <Card3DTilt
            maxTilt={6}
            scaleHover={1.01}
            className={`w-full transition-all duration-300 ${
              aspectRatio === "16:9"
                ? "max-w-[540px] sm:max-w-[600px]"
                : "max-w-[340px] sm:max-w-[370px]"
            }`}
          >
            <div className="relative w-full overflow-hidden rounded-3xl border border-zinc-800/80 bg-zinc-950/70 backdrop-blur-2xl shadow-[0_0_50px_rgba(0,0,0,0.85)]">
              {/* Header bar */}
              <div className="flex items-center justify-between border-b border-zinc-800/80 bg-zinc-900/60 px-4 py-3 text-xs text-zinc-400">
                <div className="flex items-center space-x-2 truncate">
                  <FileVideo className="h-4 w-4 text-cyan-400 shrink-0" />
                  <span className="truncate font-medium text-zinc-200">
                    {videoData.originalFilename}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-cyan-950/70 px-2 py-0.5 text-[10px] font-mono text-cyan-300 border border-cyan-800/50 uppercase">
                    {aspectRatio}
                  </span>
                  {proStyleId === "none" ? (
                    <span className="rounded-md bg-rose-950/60 px-2 py-0.5 text-[10px] font-mono text-rose-300 border border-rose-800/50">
                      NO CAPTIONS
                    </span>
                  ) : (
                    <span className="rounded-md bg-amber-950/60 px-2 py-0.5 text-[10px] font-mono text-amber-300 border border-amber-800/50">
                      {PRO_CAPTION_STYLES[proStyleId]?.tag || "CAPTIONS"}
                    </span>
                  )}
                  <span className="rounded-md bg-zinc-800/80 px-2 py-0.5 text-[10px] font-mono text-zinc-300 border border-zinc-700/50">
                    {videoData.sizeMb} MB
                  </span>
                </div>
              </div>

              {/* Video Player */}
              <div
                className={`relative w-full bg-black flex items-center justify-center overflow-hidden transition-all duration-300 ${
                  aspectRatio === "16:9"
                    ? "aspect-video"
                    : aspectRatio === "9:16"
                    ? "aspect-[9/16]"
                    : "aspect-[9/16]"
                }`}
              >
                <video
                  ref={videoRef}
                  src={videoData.localPreviewUrl || videoData.videoUrl}
                  controls
                  playsInline
                  onTimeUpdate={handleTimeUpdate}
                  onSeeked={handleTimeUpdate}
                  className="h-full w-full object-contain"
                />

                {/* Template-synchronized caption overlay */}
                <CaptionTemplateOverlay
                  captionData={captionData}
                  currentTime={currentTime}
                  template={selectedTemplate}
                  position={captionPosition}
                  fontSize={fontSize}
                  groups={captionGroups}
                  accentOverride={customAccent || undefined}
                  styleId={proStyleId}
                />

                {/* AI Processing Animation Overlay */}
                {isTranscribing && (
                  <div className="absolute inset-0 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center z-40">
                    <div className="relative flex items-center justify-center mb-5">
                      <div className="h-16 w-16 rounded-full border-2 border-violet-500/30 border-t-cyan-400 animate-spin" />
                      <Sparkles className="absolute h-6 w-6 text-cyan-400 animate-pulse" />
                    </div>
                    <h4 className="text-white font-bold text-base mb-1">
                      Double-Layer Caption Engine
                    </h4>
                    <p className="text-xs text-cyan-300/90 font-mono animate-pulse max-w-xs leading-relaxed">
                      {transcribeStep}
                    </p>
                  </div>
                )}
              </div>

              {/* Bottom bar */}
              <div className="border-t border-zinc-800/80 bg-zinc-950/60 p-3 text-center">
                <p className="text-[11px] text-zinc-400">
                  {proStyleId === "none" ? (
                    <span className="text-zinc-400 font-medium">
                      &bull; No Subtitles &bull; Clean Raw Video Mode &bull; {aspectRatio.toUpperCase()} Canvas
                    </span>
                  ) : captionData ? (
                    <span className="text-emerald-400 font-medium">
                      &bull; {targetLanguage} synced ({captionData.total_words} words
                      &bull; {captionGroups?.length ?? 0} caption units
                      &bull; {PRO_CAPTION_STYLES[proStyleId]?.name || selectedTemplate.name.toUpperCase()})
                      {wasCached ? " \u2022 cached" : ""}
                    </span>
                  ) : (
                    <span>
                      Select Language &amp; Style, then click &quot;Generate
                      Captions&quot;
                    </span>
                  )}
                </p>
              </div>
            </div>
          </Card3DTilt>
          <div className="mt-8 w-full">
            <CaptionTemplateGallery
              selectedId={selectedTemplate.id}
              onSelect={handleSelectTemplate}
              selectedProStyleId={proStyleId}
              onToggleNone={() =>
                setProStyleId(proStyleId === "none" ? "tharun_classic" : "none")
              }
            />
            <div className="mt-4 space-y-2">
              <button
                type="button"
                onClick={handleDownloadEditedVideo}
                disabled={
                  (proStyleId !== "none" && !srtFile && !captionGroups?.length) ||
                  isExporting
                }
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 px-5 py-3.5 text-sm font-black text-zinc-950 shadow-lg shadow-amber-950/40 transition disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
              >
                {isExporting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin text-zinc-950" />
                    <span>
                      {proStyleId === "none"
                        ? `Exporting Raw Video (${aspectRatio.toUpperCase()})…`
                        : `Rendering ASS Subtitles (${aspectRatio.toUpperCase()})…`}
                    </span>
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4 text-zinc-950" />
                    <span>
                      {proStyleId === "none"
                        ? `Export Video (${aspectRatio.toUpperCase()} • Raw Video / No Captions)`
                        : srtFile
                        ? `Export Video with Custom .SRT (${PRO_CAPTION_STYLES[proStyleId]?.name || "Pro Style"})`
                        : `Export Video (${aspectRatio.toUpperCase()} • ${PRO_CAPTION_STYLES[proStyleId]?.name || "Pro Style"})`}
                    </span>
                  </>
                )}
              </button>
              {exportError && (
                <p role="alert" className="text-xs leading-relaxed text-rose-300">
                  {exportError}
                </p>
              )}
              {proStyleId !== "none" && !srtFile && !captionGroups?.length && (
                <p className="text-center text-xs text-zinc-500">
                  Generate captions or upload an .SRT file before exporting. (Or select &quot;None&quot; to export raw video).
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Language, Styles & Customization */}
        <div
          className={`space-y-6 transition-all duration-300 ${
            aspectRatio === "16:9" ? "lg:col-span-6" : "lg:col-span-7"
          }`}
        >
          {/* Optional .SRT File Uploader Card */}
          <div
            className={`rounded-3xl border p-5 backdrop-blur-2xl transition-all duration-300 shadow-xl ${
              srtFile
                ? "border-amber-400/60 bg-amber-950/20 shadow-[0_0_30px_rgba(245,158,11,0.2)]"
                : "border-zinc-800/80 bg-zinc-950/60 hover:border-amber-500/40"
            }`}
          >
            <input
              type="file"
              ref={srtInputRef}
              accept=".srt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleSrtUpload(f);
                e.target.value = "";
              }}
            />
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start sm:items-center space-x-3.5">
                <div
                  className={`h-12 w-12 rounded-2xl flex items-center justify-center shrink-0 border transition-all ${
                    srtFile
                      ? "bg-gradient-to-tr from-amber-400 to-yellow-300 text-zinc-950 border-amber-300 shadow-lg shadow-amber-500/30"
                      : "bg-zinc-900 border-zinc-800 text-amber-400"
                  }`}
                >
                  {isParsingSrt ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    <FileText className="h-6 w-6" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                      Optional .SRT File Upload
                    </h4>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                        srtFile
                          ? "bg-amber-400/20 text-amber-300 border-amber-400/40"
                          : "bg-zinc-800 text-zinc-400 border-zinc-700"
                      }`}
                    >
                      {srtFile ? "ACTIVE (.SRT)" : "OPTIONAL"}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                    {srtFile ? (
                      <span className="text-amber-200 font-medium">
                        Using{" "}
                        <span className="font-mono font-bold text-amber-300">
                          {srtFile.name}
                        </span>{" "}
                        ({(srtFile.size / 1024).toFixed(1)} KB) &bull; AI
                        transcription skipped, word-by-word karaoke highlighting
                        active!
                      </span>
                    ) : (
                      "Have your own subtitles? Upload an optional .srt file to bypass Whisper AI transcription completely."
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                {srtFile ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSrtFile(null);
                      setCaptionData(null);
                      setWarnings([]);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-zinc-900 px-3.5 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 border border-zinc-800 transition cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                    Remove .SRT
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => srtInputRef.current?.click()}
                    disabled={isParsingSrt}
                    className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 px-4 py-2.5 text-xs font-black text-zinc-950 hover:brightness-110 shadow-lg shadow-amber-500/20 transition cursor-pointer"
                  >
                    <UploadCloud className="h-4 w-4" />
                    Upload .SRT File
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Main Action Box */}
          <div className="rounded-3xl border border-violet-500/30 bg-zinc-950/50 backdrop-blur-2xl p-6 shadow-2xl space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-cyan-400" />
                  Double-Layer Translation &amp; Caption Engine
                </h3>
                <p className="text-xs text-zinc-400 mt-1">
                  Layer 1 Whisper word timestamps &bull; Layer 2 contextual
                  Hinglish rewrite (gpt-oss-120b, auto-fallback chain).
                </p>
              </div>
              <span className="rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-300 border border-cyan-500/30">
                Two-layer AI
              </span>
            </div>

            {/* Target Language Dropdown Selector */}
            <div className="rounded-2xl bg-zinc-900/60 p-4 border border-zinc-800/80 space-y-2">
              <label className="text-xs font-bold text-zinc-300 flex items-center gap-1.5">
                <Globe className="h-4 w-4 text-cyan-400" />
                Target Language:
              </label>
              <select
                value={targetLanguage}
                onChange={(event) =>
                  setTargetLanguage(event.target.value as TargetLanguage)
                }
                className="w-full rounded-xl border border-zinc-700 bg-zinc-950/80 px-3 py-2.5 text-sm font-medium text-zinc-100 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
              >
                <option value="Hinglish">Hinglish</option>
                <option value="English">English</option>
                <option value="Spanish">Spanish</option>
              </select>
            </div>

            {/* Groq API Key BYOK Card */}
            <div className="pt-2">
              <div
                className={`rounded-2xl p-3 border transition-all ${
                  hasPersonalKey
                    ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-300"
                    : "bg-amber-950/20 border-amber-500/30 text-amber-300"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {hasPersonalKey ? (
                      <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
                    ) : (
                      <Key className="h-4 w-4 text-amber-400 shrink-0" />
                    )}
                    <div>
                      <span className="text-xs font-bold block">
                        {hasPersonalKey
                          ? "Using Personal Key (Unlimited)"
                          : "Using Free Server Tier (Ads required)"}
                      </span>
                      <span className="text-[10px] text-zinc-400 block">
                        {hasPersonalKey
                          ? "Fast Whisper turbo & instant ad-free exports"
                          : "Add your free key for unlimited instant exports"}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsApiKeyModalOpen(true)}
                    className="inline-flex items-center gap-1 rounded-xl bg-zinc-900 hover:bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-200 border border-zinc-700 transition cursor-pointer shrink-0"
                  >
                    <Key className="h-3 w-3 text-cyan-400" />
                    <span>{hasPersonalKey ? "Settings" : "Add Key"}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Generate Button */}
            <button
              onClick={() => handleGenerateCaptions()}
              disabled={isTranscribing || isParsingSrt}
              className={`w-full inline-flex items-center justify-center space-x-2 rounded-2xl px-6 py-4 text-sm font-bold shadow-xl hover:scale-[1.01] active:scale-[0.99] transition duration-200 disabled:opacity-60 cursor-pointer ${
                srtFile
                  ? "bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 text-zinc-950 shadow-amber-500/20"
                  : "bg-gradient-to-r from-cyan-500 via-indigo-600 to-violet-600 text-white shadow-cyan-500/25"
              }`}
            >
              {isTranscribing || isParsingSrt ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-current" />
                  <span>
                    {isParsingSrt
                      ? "Parsing .SRT subtitle timings…"
                      : "Transcribing & rewriting captions…"}
                  </span>
                </>
              ) : srtFile ? (
                <>
                  <Check className="h-4 w-4" />
                  <span>Re-apply Custom .SRT Captions</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 text-cyan-300" />
                  <span>
                    Generate {targetLanguage} Captions ({selectedStyle})
                  </span>
                </>
              )}
            </button>


            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-500">
              <span>
                Style switching reuses the cached transcript — no second Whisper
                run.
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleGenerateCaptions({ force: true })}
                  disabled={isTranscribing || !captionData}
                  className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 disabled:opacity-40"
                >
                  <RefreshCw className="h-3 w-3" />
                  Re-run from scratch
                </button>
                <button
                  type="button"
                  onClick={runDiagnostics}
                  disabled={isDiagnosing}
                  className="inline-flex items-center gap-1 text-violet-300 hover:text-violet-200 disabled:opacity-40"
                >
                  {isDiagnosing ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Stethoscope className="h-3 w-3" />
                  )}
                  Diagnostics
                </button>
              </div>
            </div>
          </div>

          {/* Warnings / degraded-output banner */}
          {warnings.length > 0 && (
            <div className="rounded-3xl border border-amber-500/30 bg-amber-500/5 backdrop-blur-xl p-5 space-y-2">
              <p className="text-sm font-bold text-amber-200 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                {warnings.length} notice{warnings.length === 1 ? "" : "s"} from the
                caption engine
              </p>
              <ul className="list-disc pl-5 space-y-1 text-[11px] leading-relaxed text-amber-100/90">
                {warnings.map((warning, index) => (
                  <li key={`${index}-${warning.slice(0, 24)}`}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Influencer Caption Presets & Static Subtitles */}
          <div className="rounded-3xl border border-amber-500/30 bg-zinc-950/60 backdrop-blur-2xl p-6 shadow-2xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center space-x-2 text-white font-bold text-base">
                <Sparkles className="h-5 w-5 text-amber-400" />
                <h3>Tech Influencer Caption Presets</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setProStyleId(proStyleId === "none" ? "tharun_classic" : "none")
                  }
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold transition cursor-pointer border ${
                    proStyleId === "none"
                      ? "bg-rose-500/20 text-rose-300 border-rose-500/50 shadow-sm"
                      : "bg-zinc-900/90 text-zinc-400 border-zinc-800 hover:text-white hover:border-zinc-700"
                  }`}
                >
                  <Ban className="h-3.5 w-3.5" />
                  <span>
                    {proStyleId === "none"
                      ? "Captions Off (Disabled)"
                      : "Deselect / None"}
                  </span>
                </button>
                <span className="text-xs text-amber-400 font-medium hidden sm:inline">
                  {proStyleId === "none" ? "Raw Video Mode" : "Word-by-word karaoke"}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[500px] overflow-y-auto pr-1">
              {/* Dedicated "None / Deselect" Card */}
              <Card3DTilt maxTilt={6} scaleHover={1.02}>
                <div
                  onClick={() => handleSelectProStyle("none")}
                  className={`cursor-pointer rounded-2xl border p-4 transition-all h-full flex flex-col justify-between backdrop-blur-md ${
                    proStyleId === "none"
                      ? "border-rose-400 bg-rose-950/30 shadow-[0_0_25px_rgba(244,63,94,0.25)]"
                      : "border-zinc-800/80 bg-zinc-900/50 hover:border-zinc-700 hover:bg-zinc-900/80"
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-2.5">
                        <div
                          className={`h-8 w-8 rounded-xl flex items-center justify-center font-black text-xs shadow-md ${
                            proStyleId === "none"
                              ? "bg-rose-500 text-white"
                              : "bg-zinc-800 text-zinc-400"
                          }`}
                        >
                          <Ban className="h-4 w-4" />
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                            None / Deselect
                            <span className="rounded bg-zinc-800 text-[9px] px-1.5 py-0.2 font-semibold text-rose-300">
                              RAW
                            </span>
                          </h4>
                          <p className="text-[10px] text-zinc-400 font-mono">
                            No Subtitles
                          </p>
                        </div>
                      </div>
                      <input
                        type="radio"
                        name="pro_caption_style"
                        checked={proStyleId === "none"}
                        onChange={() => handleSelectProStyle("none")}
                        className="accent-rose-400 mt-1 cursor-pointer"
                      />
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-2 leading-relaxed">
                      Disable subtitle burn-in. Exports clean raw video formatted to the chosen aspect ratio.
                    </p>
                  </div>

                  <div className="mt-3 pt-2 border-t border-zinc-800/60 flex items-center justify-between">
                    <span className="text-[10px] text-zinc-500 font-mono">
                      Subtitles: Off
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded font-black text-zinc-400 bg-zinc-900 border border-zinc-800">
                      RAW VIDEO
                    </span>
                  </div>
                </div>
              </Card3DTilt>
              {Object.values(PRO_CAPTION_STYLES).map((preset) => {
                const IconComponent = PRO_STYLE_ICONS[preset.id] || Flame;
                const isSelected = proStyleId === preset.id;

                return (
                  <Card3DTilt key={preset.id} maxTilt={6} scaleHover={1.02}>
                    <div
                      onClick={() => handleSelectProStyle(preset.id)}
                      className={`cursor-pointer rounded-2xl border p-4 transition-all h-full flex flex-col justify-between backdrop-blur-md ${
                        isSelected
                          ? "border-amber-400 bg-amber-950/30 shadow-[0_0_25px_rgba(245,158,11,0.25)]"
                          : "border-zinc-800/80 bg-zinc-900/50 hover:border-zinc-700 hover:bg-zinc-900/80"
                      }`}
                    >
                      <div>
                        <div className="flex items-start justify-between">
                          <div className="flex items-center space-x-2.5">
                            <div
                              className={`h-8 w-8 rounded-xl bg-gradient-to-tr ${preset.colorSwatch} flex items-center justify-center text-black font-black text-xs shadow-md`}
                            >
                              <IconComponent className="h-4 w-4 text-zinc-950" />
                            </div>
                            <div>
                              <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                                {preset.name}
                                <span className="rounded bg-zinc-800 text-[9px] px-1.5 py-0.2 font-semibold text-zinc-300">
                                  {preset.tag}
                                </span>
                              </h4>
                              <p className="text-[10px] text-zinc-400 font-mono">
                                {preset.subtitle}
                              </p>
                            </div>
                          </div>
                          <input
                            type="radio"
                            name="pro_caption_style"
                            checked={isSelected}
                            onChange={() => handleSelectProStyle(preset.id)}
                            className="accent-amber-400 mt-1 cursor-pointer"
                          />
                        </div>
                        <p className="text-[11px] text-zinc-400 mt-2 leading-relaxed">
                          {preset.description}
                        </p>
                      </div>

                      {/* Visual Live Word Preview */}
                      <div className="mt-3 pt-2 border-t border-zinc-800/60 flex items-center justify-between">
                        <span className="text-[10px] text-zinc-500 font-mono">
                          {preset.font.split(",")[0].replace(/['"]/g, "")}
                        </span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded font-black ${
                            preset.isStatic ? "normal-case" : "uppercase"
                          }`}
                          style={{
                            color: preset.activeColor,
                            fontFamily: preset.font,
                            textShadow: preset.shadow,
                            WebkitTextStroke: preset.stroke,
                          }}
                        >
                          {preset.isStatic ? "Subtitles" : "ACTIVE"}
                        </span>
                      </div>
                    </div>
                  </Card3DTilt>
                );
              })}
            </div>
          </div>

          {/* Export Aspect Ratio Selector Card */}
          <div className="rounded-3xl border border-zinc-800/80 bg-zinc-950/50 backdrop-blur-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-white font-bold text-base">
                <Ratio className="h-5 w-5 text-cyan-400" />
                <h3>Export Aspect Ratio</h3>
              </div>
              <span className="text-xs text-cyan-400 font-mono font-medium">
                {aspectRatio === "original"
                  ? "Native Frame"
                  : aspectRatio === "16:9"
                  ? "1920 × 1080 (Landscape)"
                  : "1080 × 1920 (Portrait)"}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                {
                  id: "original",
                  label: "Original",
                  desc: "Keep native camera dimensions",
                  icon: Film,
                  badge: "NATIVE",
                },
                {
                  id: "16:9",
                  label: "16:9 Landscape",
                  desc: "YouTube, PC, TV (1920×1080)",
                  icon: Monitor,
                  badge: "YOUTUBE",
                },
                {
                  id: "9:16",
                  label: "9:16 Portrait",
                  desc: "Reels, Shorts, TikTok (1080×1920)",
                  icon: Smartphone,
                  badge: "REELS / SHORTS",
                },
              ].map((item) => {
                const IconComponent = item.icon;
                const isSelected = aspectRatio === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setAspectRatio(item.id)}
                    className={`cursor-pointer rounded-2xl border p-4 text-left transition-all backdrop-blur-md ${
                      isSelected
                        ? "border-cyan-400 bg-cyan-950/30 shadow-[0_0_20px_rgba(6,182,212,0.25)]"
                        : "border-zinc-800/80 bg-zinc-900/50 hover:border-zinc-700 hover:bg-zinc-900/80"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div
                        className={`h-7 w-7 rounded-lg flex items-center justify-center ${
                          isSelected
                            ? "bg-cyan-400 text-zinc-950"
                            : "bg-zinc-800 text-zinc-400"
                        }`}
                      >
                        <IconComponent className="h-4 w-4" />
                      </div>
                      <span className="rounded bg-zinc-800 text-[9px] px-1.5 py-0.5 font-semibold text-zinc-300">
                        {item.badge}
                      </span>
                    </div>
                    <p className="text-xs font-bold text-white">{item.label}</p>
                    <p className="text-[11px] text-zinc-400 mt-1 leading-snug">
                      {item.desc}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Positioning & Customization Controls */}
          <div className="rounded-3xl border border-zinc-800/80 bg-zinc-950/50 backdrop-blur-2xl p-6 shadow-2xl space-y-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
              <Sliders className="h-4 w-4 text-violet-400" />
              Positioning &amp; Typography
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Position */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300 flex items-center gap-1">
                  <MoveVertical className="h-3.5 w-3.5 text-zinc-400" />
                  Position
                </label>
                <div className="flex rounded-xl bg-zinc-900 p-1 border border-zinc-800">
                  {(["top", "center", "bottom"] as CaptionPosition[]).map((pos) => (
                    <button
                      key={pos}
                      onClick={() => setCaptionPosition(pos)}
                      className={`flex-1 capitalize text-xs py-1.5 rounded-lg font-medium transition cursor-pointer ${
                        captionPosition === pos
                          ? "bg-cyan-500 text-black font-bold shadow"
                          : "text-zinc-400 hover:text-white"
                      }`}
                    >
                      {pos}
                    </button>
                  ))}
                </div>
              </div>

              {/* Font Size */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300 flex items-center gap-1">
                  <Type className="h-3.5 w-3.5 text-zinc-400" />
                  Font Scale
                </label>
                <div className="flex rounded-xl bg-zinc-900 p-1 border border-zinc-800">
                  {(["sm", "md", "lg", "xl"] as FontSize[]).map((sz) => (
                    <button
                      key={sz}
                      onClick={() => setFontSize(sz)}
                      className={`flex-1 uppercase text-xs py-1.5 rounded-lg font-medium transition cursor-pointer ${
                        fontSize === sz
                          ? "bg-cyan-500 text-black font-bold shadow"
                          : "text-zinc-400 hover:text-white"
                      }`}
                    >
                      {sz}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Highlight colour */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-zinc-300 flex items-center gap-1">
                  <FileCode className="h-3.5 w-3.5 text-zinc-400" />
                  Active word highlight override
                </label>
                {customAccent && (
                  <button
                    type="button"
                    onClick={() => setCustomAccent(null)}
                    className="text-[10px] text-amber-400 hover:text-amber-300 underline cursor-pointer"
                  >
                    Reset to preset active color
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                {(Object.keys(HIGHLIGHT_ACCENTS) as HighlightColor[]).map((color) => (
                  <button
                    key={color}
                    onClick={() => {
                      setHighlightColor(color);
                      setCustomAccent(HIGHLIGHT_ACCENTS[color]);
                    }}
                    aria-pressed={customAccent === HIGHLIGHT_ACCENTS[color]}
                    title={color}
                    className={`h-8 w-8 rounded-full border-2 transition cursor-pointer ${
                      customAccent === HIGHLIGHT_ACCENTS[color]
                        ? "border-white scale-110 shadow-[0_0_12px_rgba(255,255,255,0.4)]"
                        : "border-zinc-700 hover:border-zinc-500"
                    }`}
                    style={{ background: HIGHLIGHT_ACCENTS[color] }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-2 flex flex-wrap items-center gap-3">
            <button
              onClick={onReset}
              className="inline-flex items-center justify-center space-x-2 rounded-2xl border border-zinc-700 bg-zinc-900/80 px-5 py-3 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-white transition shadow-lg cursor-pointer"
            >
              <RotateCcw className="h-4 w-4" />
              <span>Upload Another Video</span>
            </button>
            <button
              type="button"
              onClick={() => srtInputRef.current?.click()}
              className="inline-flex items-center justify-center space-x-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-5 py-3 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 transition shadow-lg cursor-pointer"
            >
              <FileText className="h-4 w-4" />
              <span>{srtFile ? "Change .SRT File" : "Upload Optional .SRT"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Transcript Editor Section */}
      {captionData && (
        <div className="w-full pt-4">
          <TranscriptEditor
            captionData={captionData}
            currentTime={currentTime}
            onSeek={handleSeek}
            onUpdateCaptionData={(updated) => setCaptionData(updated)}
          />
        </div>
      )}

      {/* Global Modals for BYOK & Rewarded Ad Flow */}
      <ApiKeyModal
        isOpen={isApiKeyModalOpen}
        onClose={() => setIsApiKeyModalOpen(false)}
      />
      <AdRewardModal
        isOpen={isAdModalOpen}
        onClose={() => setIsAdModalOpen(false)}
        onComplete={() => {
          setIsAdModalOpen(false);
          triggerVideoDownload();
        }}
        onOpenKeyModal={() => {
          setIsApiKeyModalOpen(true);
        }}
      />
    </div>
  );
}
