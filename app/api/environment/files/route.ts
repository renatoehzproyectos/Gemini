import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-gemini-api-key") || process.env.GEMINI_API_KEY;
  const envId = req.nextUrl.searchParams.get("environmentId");
  if (!apiKey) return new Response("Missing Gemini API key", { status: 401 });
  if (!envId) return new Response("Missing environmentId", { status: 400 });

  const path = req.nextUrl.searchParams.get("path") || "workspace/outputs";
  const recursive = req.nextUrl.searchParams.get("recursive") !== "false";
  const url = new URL(`https://generativelanguage.googleapis.com/v1beta/environments/${encodeURIComponent(envId)}/files/${encodePath(path)}`);
  url.searchParams.set("recursive", String(recursive));
  url.searchParams.set("page_size", "1000");

  const upstream = await fetch(url, { headers: { "x-goog-api-key": apiKey }, cache: "no-store" });
  const text = await upstream.text();
  return new Response(text, { status: upstream.status, headers: { "Content-Type": upstream.headers.get("content-type") || "application/json" } });
}

function encodePath(path: string) {
  return path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}
