import "./globals.css";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "Gemini", description: "A polished Gemini managed-agent workspace" };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
