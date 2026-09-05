import { NextRequest } from "next/server";
import { downloadEnvironmentTar, readTarEntry } from "@/lib/environmentTar";

export const runtime = "nodejs";
export const maxDuration = 120;

// See app/api/environment/files/route.ts for why this fetches the whole tar
// snapshot instead of hitting a per-file endpoint — Google's API doesn't have one.
export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-gemini-api-key") || process.env.GEMINI_API_KEY;
  const envId = req.nextUrl.searchParams.get("environmentId");
  const path = req.nextUrl.searchParams.get("path");
  if (!apiKey) return new Response("Missing Gemini API key", { status: 401 });
  if (!envId || !path) return new Response("Missing environmentId or path", { status: 400 });
  if (path.includes("..") || path.startsWith("/")) return new Response("Invalid path", { status: 400 });

  try {
    const tarBuffer = await downloadEnvironmentTar(apiKey, envId);
    const data = await readTarEntry(tarBuffer, path);
    if (!data) return new Response("File not found in environment snapshot", { status: 404 });

    const headers = new Headers();
    headers.set("Content-Type", mimeFromName(path));
    headers.set("Content-Disposition", `attachment; filename="${safeName(path)}"`);
    headers.set("Content-Length", String(data.length));
    headers.set("Cache-Control", "no-store");
    return new Response(new Uint8Array(data), { status: 200, headers });
  } catch (err: any) {
    return new Response(err?.message || "Failed to download file", { status: 502 });
  }
}

function safeName(path: string) {
  return (path.split("/").pop() || "download").replace(/[\\"\r\n]/g, "_");
}

function mimeFromName(path: string) {
  const ext = path.toLowerCase().split(".").pop() || "";
  const map: Record<string, string> = {
    zip: "application/zip", pdf: "application/pdf", json: "application/json", txt: "text/plain",
    md: "text/markdown", html: "text/html", css: "text/css", js: "text/javascript", ts: "text/typescript",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml",
    csv: "text/csv", mp3: "audio/mpeg", mp4: "video/mp4", webm: "video/webm",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
  return map[ext] || "application/octet-stream";
}
