# 🎬 AutoCaption AI

An AI-powered full-stack web application designed to generate viral, dynamic auto-captions (Alex Hormozi style, Karaoke word-by-word style) for short-form videos (TikTok, Instagram Reels, YouTube Shorts), with a **Double-Layer Transcription System** for 100% accurate Roman Hinglish.

---

## ⚡ Double-Layer Hinglish Transcription System

1. **Layer 1 (Audio to Raw Text & Timestamps)**:
   - Uses Groq's high-speed `whisper-large-v3` model.
   - Extracts millisecond-accurate word-level timestamps (`word`, `start`, `end`).
2. **Layer 2 (LLM Cleanup for Perfect Roman Hinglish)**:
   - Passes the word-level JSON array to Groq's `llama-3.1-8b-instant`.
   - Converts any Devanagari script (e.g., 'क्या' -> 'kya') and awkwardly spelled words into natural, modern conversational Roman Hinglish.
   - Strictly preserves exact `start` and `end` timestamps.
3. **Synchronized Frontend Engine**:
   - Live rendered in Next.js matching video `currentTime` with Hormozi bursts (2-3 punchy words, yellow pop) and Karaoke neon word bounce.

---

## 📁 Project Architecture

```
├── backend/
│   ├── main.py              # FastAPI application with upload & transcription endpoints
│   ├── groq_transcriber.py  # Double-Layer Groq Engine (whisper-large-v3 + llama-3.1-8b)
│   ├── transcriber.py       # Local Faster-Whisper offline fallback
│   ├── requirements.txt     # Python backend dependencies
│   ├── .env.example         # Template for GROQ_API_KEY
│   └── uploads/             # Video & transcript cache directory
│
└── frontend/
    ├── package.json         # Next.js 14, React 18, Tailwind CSS, Lucide React
    ├── tsconfig.json        # TypeScript configuration with @/* path aliases
    ├── tailwind.config.ts   # Dark theme palette & neon accents
    ├── postcss.config.mjs   # PostCSS configuration
    ├── next.config.mjs      # Next.js configuration
    └── src/
        ├── app/
        │   ├── layout.tsx   # Root layout with dark mode
        │   ├── page.tsx     # Homepage with Hero, Upload & Preview
        │   └── globals.css  # Dark aesthetic & radial glow styling
        └── components/
            ├── Navbar.tsx           # Glassmorphic header with live backend status ping
            ├── VideoUploader.tsx    # Drag-and-drop zone with animated progress & validation
            ├── VideoPreview.tsx     # 9:16 Shorts player with preset controls & engine toggle
            ├── CaptionOverlay.tsx   # Synchronized Hormozi & Karaoke overlay renderer
            └── TranscriptEditor.tsx # Interactive word-by-word seeker, editor, & SRT/VTT exporter
```

---

## 🚀 Quickstart Guide

### 1. Backend Setup (FastAPI + Groq)

```powershell
cd backend

# Create .env from example and add your Groq API key:
cp .env.example .env
# Edit .env and set: GROQ_API_KEY=gsk_your_key_here

# Install dependencies:
pip install -r requirements.txt

# Start the FastAPI server:
python -m uvicorn main:app --reload --port 8000
```

- **Backend API**: `http://localhost:8000`
- **Swagger Documentation**: `http://localhost:8000/docs`
- **Health Check**: `http://localhost:8000/api/health`
- **Double-Layer Endpoint**: `POST http://localhost:8000/api/transcribe`

---

### 2. Frontend Setup (Next.js)

```powershell
cd frontend

# Set Node environment flag (ensures Windows System CA works seamlessly)
$env:NODE_OPTIONS="--use-system-ca"

# Start the development server
npm.cmd run dev
```

- **Frontend App**: `http://localhost:3000`
