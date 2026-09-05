import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-gemini-api-key") || process.env.GEMINI_API_KEY;
  const envId = req.nextUrl.searchParams.get("environmentId");
  const path = req.nextUrl.searchParams.get("path");
  if (!apiKey) return new Response("Missing Gemini API key", { status: 401 });
  if (!envId || !path) return new Response("Missing environmentId or path", { status: 400 });
  if (path.includes("..") || path.startsWith("/")) return new Response("Invalid path", { status: 400 });

  const url = `https://generativelanguage.googleapis.com/v1beta/environments/${encodeURIComponent(envId)}/files/${encodePath(path)}?alt=media`;
  const upstream = await fetch(url, { headers: { "x-goog-api-key": apiKey }, cache: "no-store" });
  if (!upstream.ok) {
    const text = await upstream.text();
    return new Response(text || "Unable to download file", { status: upstream.status });
  }

  const headers = new Headers();
  headers.set("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
  headers.set("Content-Disposition", `attachment; filename="${safeName(path)}"`);
  const length = upstream.headers.get("content-length");
  if (length) headers.set("Content-Length", length);
  return new Response(upstream.body, { status: 200, headers });
}

function encodePath(path: string) {
  return path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}
function safeName(path: string) { return (path.split("/").pop() || "download").replace(/[\\\"\r\n]/g, "_"); }
