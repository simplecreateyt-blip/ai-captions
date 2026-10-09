"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import Navbar from "@/components/Navbar";
import VideoUploader, { UploadResult } from "@/components/VideoUploader";
import VideoPreview from "@/components/VideoPreview";
import { Sparkles, Flame } from "lucide-react";

const ThreeBackground = dynamic(
  () => import("@/components/ThreeBackground"),
  { ssr: false },
);

export default function HomePage() {
  const [videoData, setVideoData] = useState<UploadResult | null>(null);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#060608] text-zinc-100">
      <ThreeBackground />
      <div className="relative z-20">
        <Navbar />
      </div>

      <main className="relative z-10 mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {!videoData ? (
          <div className="mx-auto max-w-3xl space-y-8 pt-4">
            <header className="text-center space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-yellow-500/10 via-amber-500/15 to-orange-500/10 border border-amber-500/30 px-4 py-1.5 text-xs font-bold text-amber-300 shadow-lg shadow-amber-500/5">
                <Flame className="h-4 w-4 text-amber-400" />
                <span>Tech Influencer Style &bull; Tharun Speaks &amp; Alex Hormozi</span>
              </div>
              <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight">
                Word-by-Word Viral Caption Studio
              </h1>
              <p className="text-sm sm:text-base text-zinc-400 max-w-xl mx-auto leading-relaxed">
                Generate high-energy, word-by-word highlighted captions with active yellow popping text, or upload your own .SRT file to bypass AI and hard-burn directly with FFmpeg.
              </p>
            </header>

            <VideoUploader onUploadSuccess={(data) => setVideoData(data)} />
          </div>
        ) : (
          <VideoPreview
            videoData={videoData}
            onReset={() => setVideoData(null)}
          />
        )}
      </main>
    </div>
  );
}