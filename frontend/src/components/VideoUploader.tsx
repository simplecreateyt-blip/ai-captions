"use client";

import React, { useState, useRef, DragEvent, ChangeEvent } from "react";
import Card3DTilt from "./Card3DTilt";
import { UploadCloud, Film, AlertCircle, Loader2, Sparkles, FileText, X } from "lucide-react";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

export interface UploadResult {
  fileId: string;
  originalFilename: string;
  storedFilename: string;
  contentType: string;
  sizeBytes: number;
  sizeMb: number;
  videoUrl: string;
  localPreviewUrl: string;
  videoFile?: File;
  srtFile?: File;
  initialCaptionData?: any;
}

interface VideoUploaderProps {
  onUploadSuccess: (data: UploadResult) => void;
}

const ALLOWED_EXTENSIONS = [".mp4", ".mov", ".webm", ".mkv", ".avi"];
const MAX_FILE_SIZE_MB = 150;

export default function VideoUploader({ onUploadSuccess }: VideoUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [srtFile, setSrtFile] = useState<File | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const srtInputRef = useRef<HTMLInputElement>(null);

  const validateFile = (file: File): string | null => {
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return `Unsupported file format (${ext}). Please upload an MP4, MOV, WEBM, or MKV video.`;
    }
    const fileSizeMb = file.size / (1024 * 1024);
    if (fileSizeMb > MAX_FILE_SIZE_MB) {
      return `File size (${fileSizeMb.toFixed(1)}MB) exceeds the maximum limit of ${MAX_FILE_SIZE_MB}MB.`;
    }
    return null;
  };

  const uploadFile = (file: File) => {
    const error = validateFile(file);
    if (error) {
      setErrorMessage(error);
      setUploadStatus("error");
      return;
    }

    setErrorMessage(null);
    setUploadStatus("uploading");
    setUploadProgress(0);
    setFileName(file.name);

    const localUrl = URL.createObjectURL(file);
    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    const targetUrl = `${API_BASE}/api/upload`;
    xhr.open("POST", targetUrl);

    try {
      const userGroqKey = localStorage.getItem("user_groq_key") || localStorage.getItem("groq_api_key");
      if (userGroqKey && userGroqKey.trim()) {
        xhr.setRequestHeader("x-groq-key", userGroqKey.trim());
      }
    } catch {
      // Safely ignore localStorage access errors
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percentComplete = Math.round((event.loaded / event.total) * 100);
        setUploadProgress(percentComplete);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = JSON.parse(xhr.responseText);
          setUploadProgress(100);
          setUploadStatus("idle");

          onUploadSuccess({
            fileId: response.file_id,
            originalFilename: response.original_filename,
            storedFilename: response.stored_filename,
            contentType: response.content_type,
            sizeBytes: response.size_bytes,
            sizeMb: response.size_mb,
            videoUrl: response.video_url,
            localPreviewUrl: localUrl,
            videoFile: file,
            srtFile: srtFile || undefined,
          });
        } catch {
          setErrorMessage("Failed to parse response from server.");
          setUploadStatus("error");
        }
      } else {
        try {
          const errRes = JSON.parse(xhr.responseText);
          setErrorMessage(errRes.detail || "Upload failed. Please check the backend server.");
        } catch {
          setErrorMessage(`Upload failed with status code ${xhr.status}.`);
        }
        setUploadStatus("error");
      }
    };

    xhr.onerror = () => {
      setErrorMessage(
        `Could not connect to backend server at ${targetUrl}. Please ensure the server is running.`,
      );
      setUploadStatus("error");
    };

    xhr.send(formData);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      uploadFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      uploadFile(e.target.files[0]);
    }
  };

  return (
    <div className="w-full">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept={ALLOWED_EXTENSIONS.join(",")}
        className="hidden"
      />

      {/* 3D Tilt Wrapper */}
      <Card3DTilt maxTilt={7} scaleHover={1.01}>
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => uploadStatus !== "uploading" && fileInputRef.current?.click()}
          className={`relative group cursor-pointer overflow-hidden rounded-3xl border-2 border-dashed p-8 sm:p-14 transition-all duration-300 backdrop-blur-2xl ${
            isDragging
              ? "border-cyan-400 bg-cyan-950/30 shadow-[0_0_50px_rgba(6,182,212,0.35)]"
              : "border-zinc-800/80 bg-zinc-950/50 hover:border-violet-500/60 hover:bg-zinc-950/70 shadow-2xl shadow-black/80"
          } ${uploadStatus === "uploading" ? "pointer-events-none opacity-90" : ""}`}
        >
          {/* Glassmorphism ambient glow accents */}
          <div className="absolute -top-20 -left-20 h-48 w-48 rounded-full bg-violet-600/15 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-20 -right-20 h-48 w-48 rounded-full bg-cyan-600/15 blur-3xl pointer-events-none" />

          <div className="relative flex flex-col items-center justify-center text-center">
            {/* Glowing Icon */}
            <div
              className={`mb-6 flex h-24 w-24 items-center justify-center rounded-3xl border transition-all duration-300 ${
                isDragging
                  ? "border-cyan-400 bg-cyan-500/20 text-cyan-300 scale-110 shadow-lg shadow-cyan-500/40"
                  : "border-zinc-700/60 bg-zinc-900/80 text-zinc-300 group-hover:border-cyan-500/50 group-hover:text-cyan-300 group-hover:scale-105 shadow-xl"
              }`}
            >
              {uploadStatus === "uploading" ? (
                <Loader2 className="h-10 w-10 animate-spin text-cyan-400" />
              ) : isDragging ? (
                <Film className="h-10 w-10 text-cyan-400 animate-bounce" />
              ) : (
                <UploadCloud className="h-10 w-10" />
              )}
            </div>

            {/* Upload Feedback */}
            {uploadStatus === "uploading" ? (
              <div className="w-full max-w-md space-y-3">
                <div className="flex items-center justify-between text-xs text-zinc-300">
                  <span className="truncate max-w-[200px] font-medium text-zinc-100">
                    {fileName || "Uploading video..."}
                  </span>
                  <span className="font-bold text-cyan-400">{uploadProgress}%</span>
                </div>
                {/* Neon Gradient Progress Bar */}
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-900 border border-zinc-800">
                  <div
                    className="h-full bg-gradient-to-r from-violet-600 via-indigo-500 to-cyan-400 transition-all duration-200 ease-out shadow-[0_0_12px_rgba(6,182,212,0.8)]"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <p className="text-xs text-zinc-400">
                  Streaming chunks to FastAPI server & preparing 3D preview...
                </p>
              </div>
            ) : (
              <>
                <h3 className="text-xl font-bold text-white sm:text-2xl tracking-tight">
                  {isDragging ? "Drop your short video here" : "Drag and drop your video here"}
                </h3>
                <p className="mt-2 text-sm text-zinc-400 max-w-md">
                  Or <span className="text-cyan-400 font-semibold underline underline-offset-4">browse files</span> to generate viral multi-language 3D animated captions.
                </p>

                {/* Badges */}
                <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                  {[
                    "MP4 / MOV / WEBM",
                    "9:16 Shorts & Reels",
                    "Max 150MB",
                    "Groq Whisper AI",
                    "10 Trendy Styles",
                  ].map((badge, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center rounded-lg bg-zinc-900/80 px-2.5 py-1 text-[11px] font-medium text-zinc-300 border border-zinc-800 backdrop-blur-sm"
                    >
                      {badge}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </Card3DTilt>

      {/* Optional .SRT Subtitle Upload Section */}
      <div className="mt-4 rounded-2xl border border-dashed border-amber-500/40 bg-zinc-950/60 backdrop-blur-xl p-4 transition-all duration-300 hover:border-amber-400">
        <input
          type="file"
          ref={srtInputRef}
          accept=".srt"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setSrtFile(f);
            e.target.value = "";
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl border transition-all ${
              srtFile
                ? "bg-amber-400 text-zinc-950 border-amber-300 shadow-md font-bold"
                : "bg-amber-500/20 text-amber-300 border-amber-500/30"
            }`}>
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white">Custom .SRT Subtitles</span>
                <span className={`rounded px-2 py-0.5 text-[10px] font-semibold border ${
                  srtFile
                    ? "bg-amber-400/20 text-amber-300 border-amber-400/40"
                    : "bg-zinc-800 text-zinc-400 border-zinc-700"
                }`}>
                  {srtFile ? "ATTACHED" : "OPTIONAL"}
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                {srtFile
                  ? `Attached: ${srtFile.name} (${(srtFile.size / 1024).toFixed(1)} KB) — AI Whisper will be bypassed!`
                  : "Upload an optional .srt file to bypass Whisper AI transcription."}
              </p>
            </div>
          </div>
          <div>
            {srtFile ? (
              <button
                type="button"
                onClick={() => setSrtFile(null)}
                className="inline-flex items-center gap-1 rounded-xl bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 border border-zinc-800 transition cursor-pointer"
              >
                <X className="h-3 w-3" />
                Remove
              </button>
            ) : (
              <button
                type="button"
                onClick={() => srtInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-400 px-3.5 py-1.5 text-xs font-bold text-zinc-950 hover:brightness-110 shadow-md shadow-amber-500/20 transition cursor-pointer"
              >
                <UploadCloud className="h-3.5 w-3.5" />
                Select .SRT
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Error Alert */}
      {errorMessage && (
        <div className="mt-4 flex items-start space-x-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-rose-300 backdrop-blur-md">
          <AlertCircle className="h-5 w-5 shrink-0 text-rose-400 mt-0.5" />
          <div className="flex-1 text-sm">
            <p className="font-semibold text-rose-200">Upload Issue Detected</p>
            <p className="mt-0.5 text-xs text-rose-300/90">{errorMessage}</p>
          </div>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-xs font-semibold text-rose-400 hover:text-rose-200 underline"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
