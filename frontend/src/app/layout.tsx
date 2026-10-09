import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Captions - Pro Video Subtitles",
  description: "Create precisely timed, AI-translated video subtitles with expressive caption styles for every platform.",
  icons: {
    icon: "/favicon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[#09090b] text-zinc-100 antialiased selection:bg-purple-500 selection:text-white">
        {children}
      </body>
    </html>
  );
}
