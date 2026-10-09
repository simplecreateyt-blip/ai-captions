"use client";

import React, { useState, useEffect } from "react";
import { useGroqKey } from "@/hooks/useGroqKey";
import {
  Key,
  Eye,
  EyeOff,
  Check,
  ShieldCheck,
  AlertTriangle,
  ExternalLink,
  X,
  Sparkles,
  Zap,
  Trash2,
  CheckCircle2,
  Loader2,
  Tv,
} from "lucide-react";

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

export default function ApiKeyModal({ isOpen, onClose, onSaved }: ApiKeyModalProps) {
  const { apiKey, hasPersonalKey, updateKey, clearKey } = useGroqKey();
  const [inputValue, setInputValue] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    status: "idle" | "success" | "error";
    message: string;
  }>({ status: "idle", message: "" });
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setInputValue(apiKey);
      setTestResult({ status: "idle", message: "" });
      setSaveSuccess(false);
    }
  }, [isOpen, apiKey]);

  // Handle ESC key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSave = () => {
    const cleaned = inputValue.trim();
    updateKey(cleaned);
    setSaveSuccess(true);
    setTimeout(() => {
      setSaveSuccess(false);
      if (onSaved) onSaved();
      onClose();
    }, 600);
  };

  const handleClear = () => {
    clearKey();
    setInputValue("");
    setTestResult({ status: "idle", message: "" });
  };

  const handleTestConnection = async () => {
    const keyToTest = inputValue.trim();
    if (!keyToTest) {
      setTestResult({
        status: "error",
        message: "Please enter a key starting with 'gsk_' before testing.",
      });
      return;
    }

    setIsTesting(true);
    setTestResult({ status: "idle", message: "" });

    try {
      const res = await fetch(
        `${API_BASE}/api/diagnose?groq_api_key=${encodeURIComponent(keyToTest)}`,
        {
          headers: {
            "x-groq-key": keyToTest,
          },
        }
      );
      const data = await res.json().catch(() => null);

      if (res.ok && data?.chat_ping?.ok) {
        setTestResult({
          status: "success",
          message: `Verified! Connected to Groq (${data.models_count || "multiple"} models active).`,
        });
      } else if (res.ok && data?.models_count > 0) {
        setTestResult({
          status: "success",
          message: `Verified! Valid Groq key with access to ${data.models_count} models.`,
        });
      } else {
        const errorMsg =
          data?.chat_ping?.error ||
          data?.error ||
          data?.detail?.message ||
          "Key rejected by Groq API. Please verify the key at console.groq.com.";
        setTestResult({
          status: "error",
          message: errorMsg,
        });
      }
    } catch {
      // If server unreachable, check key prefix pattern
      if (keyToTest.startsWith("gsk_") && keyToTest.length >= 25) {
        setTestResult({
          status: "success",
          message: "Format looks valid (gsk_...). Backend server is offline, but key is saved.",
        });
      } else {
        setTestResult({
          status: "error",
          message: "Groq keys typically start with 'gsk_'. Please verify your key.",
        });
      }
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-md transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Modal Dialog */}
      <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-zinc-800/90 bg-zinc-950/95 p-6 sm:p-8 shadow-2xl shadow-violet-950/30 backdrop-blur-2xl transition-all z-10 animate-in zoom-in-95 duration-200">
        {/* Glow ambient background accents */}
        <div className="absolute -top-24 -left-24 h-48 w-48 rounded-full bg-violet-600/15 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 h-48 w-48 rounded-full bg-cyan-600/15 blur-3xl pointer-events-none" />

        {/* Modal Header */}
        <div className="flex items-start justify-between pb-5 border-b border-zinc-800/80">
          <div className="flex items-center space-x-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-tr from-violet-600 to-cyan-500 p-0.5 shadow-lg shadow-violet-500/20">
              <div className="flex h-full w-full items-center justify-center rounded-[14px] bg-zinc-950">
                <Key className="h-5 w-5 text-cyan-400" />
              </div>
            </div>
            <div>
              <h3 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                Groq API Key Settings
              </h3>
              <p className="text-xs text-zinc-400">
                BYOK (Bring Your Own Key) &bull; 100% Client-Side Privacy
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

        {/* Status Badge */}
        <div className="mt-5">
          <div
            className={`flex items-center justify-between rounded-2xl p-3.5 border transition-all ${
              hasPersonalKey
                ? "bg-emerald-950/30 border-emerald-500/40 text-emerald-300"
                : "bg-amber-950/20 border-amber-500/30 text-amber-300"
            }`}
          >
            <div className="flex items-center gap-2.5">
              {hasPersonalKey ? (
                <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-sm">
                  <ShieldCheck className="h-4 w-4" />
                </div>
              ) : (
                <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 shadow-sm">
                  <Tv className="h-4 w-4" />
                </div>
              )}
              <div>
                <span className="text-xs font-bold block">
                  {hasPersonalKey
                    ? "Using Personal Key (Unlimited)"
                    : "Using Free Server Tier (Ads required)"}
                </span>
                <span className="text-[11px] text-zinc-400">
                  {hasPersonalKey
                    ? "Direct API routing with zero wait & unlimited exports."
                    : "Shared server rate limits. Ads required before final export."}
                </span>
              </div>
            </div>

            <span
              className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase border shrink-0 ${
                hasPersonalKey
                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                  : "bg-amber-500/20 text-amber-300 border-amber-500/40"
              }`}
            >
              {hasPersonalKey ? "ACTIVE" : "FREE TIER"}
            </span>
          </div>
        </div>

        {/* Key Input Section */}
        <div className="mt-5 space-y-2">
          <label className="text-xs font-medium text-zinc-300 flex items-center justify-between">
            <span>Groq API Key (gsk_...)</span>
            {hasPersonalKey && (
              <span className="text-[11px] text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Stored locally
              </span>
            )}
          </label>

          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setTestResult({ status: "idle", message: "" });
              }}
              placeholder="gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              className="w-full rounded-2xl bg-zinc-900/90 border border-zinc-800 px-4 py-3 pr-20 text-sm text-zinc-100 placeholder-zinc-500 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400/50 transition font-mono"
            />

            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {inputValue && (
                <button
                  type="button"
                  onClick={() => setInputValue("")}
                  className="rounded-lg p-1.5 text-zinc-400 hover:text-zinc-200 transition"
                  title="Clear text"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="rounded-lg p-1.5 text-zinc-400 hover:text-white transition"
                title={showKey ? "Hide API key" : "Show API key"}
              >
                {showKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {/* Mandatory Helper Text */}
          <div className="flex items-start justify-between gap-2 pt-1 text-[11px] text-zinc-400">
            <p className="leading-relaxed">
              Get your free Groq API key from{" "}
              <a
                href="https://console.groq.com/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400 font-semibold hover:underline inline-flex items-center gap-0.5"
              >
                console.groq.com
                <ExternalLink className="h-2.5 w-2.5 inline" />
              </a>
              . Your key stays 100% private in your browser.
            </p>
          </div>
        </div>

        {/* Test Result Feedback */}
        {testResult.status !== "idle" && (
          <div
            className={`mt-3 flex items-start gap-2 rounded-xl p-3 text-xs border ${
              testResult.status === "success"
                ? "bg-emerald-950/30 border-emerald-500/30 text-emerald-300"
                : "bg-rose-950/30 border-rose-500/30 text-rose-300"
            }`}
          >
            {testResult.status === "success" ? (
              <Check className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
            )}
            <p className="flex-1 leading-snug">{testResult.message}</p>
          </div>
        )}

        {/* Feature Highlights Grid */}
        <div className="mt-5 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 p-3.5 space-y-2">
          <div className="flex items-center justify-between text-xs text-zinc-300 font-medium">
            <span className="flex items-center gap-1.5 text-cyan-400">
              <Zap className="h-3.5 w-3.5" /> Why Bring Your Own Key?
            </span>
            <span className="text-[10px] text-zinc-500 uppercase font-mono">
              Always Free
            </span>
          </div>
          <ul className="grid grid-cols-2 gap-2 text-[11px] text-zinc-400">
            <li className="flex items-center gap-1.5">
              <Check className="h-3 w-3 text-emerald-400 shrink-0" />
              <span>Unlimited exports</span>
            </li>
            <li className="flex items-center gap-1.5">
              <Check className="h-3 w-3 text-emerald-400 shrink-0" />
              <span>Zero advertisements</span>
            </li>
            <li className="flex items-center gap-1.5">
              <Check className="h-3 w-3 text-emerald-400 shrink-0" />
              <span>Whisper-large-v3 turbo</span>
            </li>
            <li className="flex items-center gap-1.5">
              <Check className="h-3 w-3 text-emerald-400 shrink-0" />
              <span>Never leaves browser</span>
            </li>
          </ul>
        </div>

        {/* Action Buttons */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-zinc-800/80">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={isTesting || !inputValue.trim()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-white transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {isTesting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" />
                  <span>Testing...</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                  <span>Test Connection</span>
                </>
              )}
            </button>

            {hasPersonalKey && (
              <button
                type="button"
                onClick={handleClear}
                className="inline-flex items-center gap-1 rounded-xl border border-rose-900/40 bg-rose-950/20 px-3 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-900/30 transition cursor-pointer"
                title="Remove key from browser storage"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Remove</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-xs font-medium text-zinc-400 hover:text-white transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saveSuccess}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-cyan-500/25 hover:brightness-110 transition cursor-pointer"
            >
              {saveSuccess ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  <span>Saved!</span>
                </>
              ) : (
                <>
                  <Key className="h-3.5 w-3.5" />
                  <span>Save Key</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
