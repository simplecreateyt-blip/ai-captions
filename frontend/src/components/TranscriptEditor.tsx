"use client";

import React, { useState } from "react";
import { CaptionData, CaptionSegment, CaptionWord } from "./CaptionOverlay";
import {
  FileText,
  Download,
  Search,
  Play,
  Edit2,
  Check,
  Clock,
  Sparkles,
  ExternalLink,
} from "lucide-react";

interface TranscriptEditorProps {
  captionData: CaptionData;
  currentTime: number;
  onSeek: (time: number) => void;
  onUpdateCaptionData: (updated: CaptionData) => void;
}

export default function TranscriptEditor({
  captionData,
  currentTime,
  onSeek,
  onUpdateCaptionData,
}: TranscriptEditorProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [editingWordId, setEditingWordId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms}`;
  };

  const formatSrtTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${hours.toString().padStart(2, "0")}:${mins
      .toString()
      .padStart(2, "0")}:${secs.toString().padStart(2, "0")},${ms
      .toString()
      .padStart(3, "0")}`;
  };

  const downloadFile = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportSRT = () => {
    let srtContent = "";
    captionData.segments.forEach((seg, index) => {
      srtContent += `${index + 1}\n`;
      srtContent += `${formatSrtTime(seg.start)} --> ${formatSrtTime(seg.end)}\n`;
      srtContent += `${seg.text}\n\n`;
    });
    downloadFile(srtContent, "captions.srt", "text/plain");
  };

  const handleExportVTT = () => {
    let vttContent = "WEBVTT\n\n";
    captionData.segments.forEach((seg, index) => {
      vttContent += `${index + 1}\n`;
      vttContent += `${formatSrtTime(seg.start).replace(",", ".")} --> ${formatSrtTime(
        seg.end
      ).replace(",", ".")}\n`;
      vttContent += `${seg.text}\n\n`;
    });
    downloadFile(vttContent, "captions.vtt", "text/vtt");
  };

  const handleExportJSON = () => {
    const jsonStr = JSON.stringify(captionData, null, 2);
    downloadFile(jsonStr, "captions_word_timestamps.json", "application/json");
  };

  const handleStartEditWord = (wordId: string, currentWord: string) => {
    setEditingWordId(wordId);
    setEditingText(currentWord);
  };

  const handleSaveWordEdit = (segIdx: number, wordIdx: number) => {
    const newSegments = [...captionData.segments];
    const segment = newSegments[segIdx];
    if (segment && segment.words[wordIdx]) {
      segment.words[wordIdx].word = editingText.trim();
      segment.text = segment.words.map((w) => w.word).join(" ");
    }

    // Also update all_words and hormozi_chunks
    const newWords = newSegments.flatMap((s) => s.words);

    // Reconstruct chunks
    const updatedData: CaptionData = {
      ...captionData,
      segments: newSegments,
      words: newWords,
      full_text: newSegments.map((s) => s.text).join(" "),
    };

    onUpdateCaptionData(updatedData);
    setEditingWordId(null);
  };

  const filteredSegments = captionData.segments.filter(
    (s) =>
      searchQuery === "" ||
      s.text.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 backdrop-blur-md space-y-6">
      {/* Header and Export Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
        <div>
          <div className="flex items-center space-x-2">
            <FileText className="h-5 w-5 text-violet-400" />
            <h3 className="text-base font-bold text-white">Interactive Transcript & Editor</h3>
            <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-xs text-violet-300 font-semibold border border-violet-500/30">
              {captionData.total_words} Words
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Click any word to jump video playback &bull; Click to edit misheard words
          </p>
        </div>

        {/* Export Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExportSRT}
            className="inline-flex items-center space-x-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-200 border border-zinc-700 hover:bg-zinc-700 hover:text-white transition shadow-sm"
            title="Download standard SubRip subtitle file"
          >
            <Download className="h-3.5 w-3.5 text-violet-400" />
            <span>.SRT</span>
          </button>
          <button
            onClick={handleExportVTT}
            className="inline-flex items-center space-x-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-200 border border-zinc-700 hover:bg-zinc-700 hover:text-white transition shadow-sm"
            title="Download WebVTT format"
          >
            <Download className="h-3.5 w-3.5 text-cyan-400" />
            <span>.VTT</span>
          </button>
          <button
            onClick={handleExportJSON}
            className="inline-flex items-center space-x-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-200 border border-zinc-700 hover:bg-zinc-700 hover:text-white transition shadow-sm"
            title="Download complete word-level timestamp JSON"
          >
            <Download className="h-3.5 w-3.5 text-yellow-400" />
            <span>JSON</span>
          </button>
        </div>
      </div>

      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search spoken words or phrases..."
          className="w-full rounded-xl border border-zinc-800 bg-zinc-950/80 pl-10 pr-4 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 transition"
        />
      </div>

      {/* Segments & Words List */}
      <div className="max-h-[360px] overflow-y-auto space-y-3 pr-1">
        {filteredSegments.length === 0 ? (
          <div className="text-center py-8 text-zinc-500 text-sm">
            No matching words found for "{searchQuery}"
          </div>
        ) : (
          filteredSegments.map((seg, segIdx) => {
            const isSegmentActive =
              currentTime >= seg.start && currentTime <= seg.end + 0.2;

            return (
              <div
                key={seg.id}
                className={`rounded-xl border p-3.5 transition-all ${
                  isSegmentActive
                    ? "border-violet-500/60 bg-violet-950/20 shadow-md shadow-violet-500/10"
                    : "border-zinc-800/80 bg-zinc-950/50 hover:border-zinc-700"
                }`}
              >
                {/* Timestamp Pill & Quick Play */}
                <div className="flex items-center justify-between text-xs text-zinc-400 mb-2">
                  <button
                    onClick={() => onSeek(seg.start)}
                    className="inline-flex items-center space-x-1.5 font-mono text-zinc-400 hover:text-violet-400 transition"
                  >
                    <Clock className="h-3.5 w-3.5 text-violet-400" />
                    <span>
                      {formatTime(seg.start)} &rarr; {formatTime(seg.end)}
                    </span>
                  </button>
                  {isSegmentActive && (
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-violet-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-ping" />
                      Playing
                    </span>
                  )}
                </div>

                {/* Words Chips */}
                <div className="flex flex-wrap gap-1.5 items-center">
                  {seg.words.map((w, wordIdx) => {
                    const wordKey = `${seg.id}-${wordIdx}`;
                    const isWordActive =
                      currentTime >= w.start && currentTime <= w.end + 0.1;
                    const isEditing = editingWordId === wordKey;

                    if (isEditing) {
                      return (
                        <div key={wordKey} className="inline-flex items-center gap-1">
                          <input
                            type="text"
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveWordEdit(segIdx, wordIdx);
                              if (e.key === "Escape") setEditingWordId(null);
                            }}
                            autoFocus
                            className="rounded bg-zinc-900 border border-violet-500 px-2 py-0.5 text-xs text-white focus:outline-none w-20"
                          />
                          <button
                            onClick={() => handleSaveWordEdit(segIdx, wordIdx)}
                            className="p-1 rounded bg-violet-600 text-white hover:bg-violet-500"
                          >
                            <Check className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    }

                    return (
                      <span
                        key={wordKey}
                        onClick={() => onSeek(w.start)}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          handleStartEditWord(wordKey, w.word);
                        }}
                        title={`Click to seek to ${w.start}s (Double-click to edit)`}
                        className={`group relative cursor-pointer select-none rounded-md px-2 py-0.5 text-xs font-medium transition-all ${
                          isWordActive
                            ? "bg-violet-600 text-white shadow-md shadow-violet-500/40 scale-105"
                            : "bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700 hover:text-white"
                        }`}
                      >
                        {w.word}
                        <Edit2
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartEditWord(wordKey, w.word);
                          }}
                          className="h-2.5 w-2.5 ml-1 opacity-0 group-hover:opacity-60 inline hover:opacity-100 text-zinc-400"
                        />
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
