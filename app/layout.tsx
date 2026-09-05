import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Gemini Terminal UI",
  description: "A Vercel-ready Gemini API terminal-style interface"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
