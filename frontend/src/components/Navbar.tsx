"use client";

import React, { useEffect, useState } from "react";
import { Sparkles, Video, Wifi, WifiOff, FileCode2, ExternalLink } from "lucide-react";

export default function Navbar() {
  const [backendStatus, setBackendStatus] = useState<"checking" | "online" | "offline">("checking");

  useEffect(() => {
    const checkBackend = async () => {
      try {
        const res = await fetch("http://localhost:8000/api/health", {
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
          setBackendStatus("online");
        } else {
          setBackendStatus("offline");
        }
      } catch {
        setBackendStatus("offline");
      }
    };

    checkBackend();
    const interval = setInterval(checkBackend, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand Logo */}
        <div className="flex items-center space-x-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-violet-600 via-indigo-600 to-cyan-400 p-0.5 shadow-lg shadow-violet-500/20">
            <div className="flex h-full w-full items-center justify-center rounded-[10px] bg-zinc-950">
              <Video className="h-5 w-5 text-violet-400" />
            </div>
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-lg font-bold tracking-tight text-white">
                AutoCaption<span className="text-violet-400">AI</span>
              </span>
              <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-violet-400 border border-violet-500/20">
                v1.0 BETA
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 hidden sm:block">
              Viral Hormozi & Karaoke Captions Engine
            </p>
          </div>
        </div>

        {/* Action / Status Center */}
        <div className="flex items-center space-x-3">
          {/* Backend Status Indicator */}
          <div
            className={`flex items-center space-x-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
              backendStatus === "online"
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : backendStatus === "checking"
                ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                : "bg-rose-500/10 text-rose-400 border-rose-500/20"
            }`}
            title={`FastAPI Backend: ${backendStatus}`}
          >
            {backendStatus === "online" ? (
              <>
                <Wifi className="h-3.5 w-3.5 animate-pulse" />
                <span>Backend Online</span>
              </>
            ) : backendStatus === "checking" ? (
              <>
                <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping mr-1" />
                <span>Connecting...</span>
              </>
            ) : (
              <>
                <WifiOff className="h-3.5 w-3.5" />
                <span>Backend Offline</span>
              </>
            )}
          </div>

          {/* Swagger API Docs link */}
          <a
            href="http://localhost:8000/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-flex items-center space-x-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 border border-zinc-800 hover:border-zinc-700 hover:text-white transition"
          >
            <FileCode2 className="h-3.5 w-3.5 text-zinc-400" />
            <span>API Docs</span>
            <ExternalLink className="h-3 w-3 text-zinc-500" />
          </a>

          {/* Badge / Button */}
          <div className="flex items-center space-x-1 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-md shadow-violet-600/25">
            <Sparkles className="h-3.5 w-3.5" />
            <span>AI Ready</span>
          </div>
        </div>
      </div>
    </header>
  );
}
