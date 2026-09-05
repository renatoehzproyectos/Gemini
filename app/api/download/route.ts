import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-gemini-api-key") || process.env.GEMINI_API_KEY;
  const envId = req.nextUrl.searchParams.get("environmentId");
  if (!apiKey) return new Response("Missing Gemini API key", { status: 401 });
  if (!envId) return new Response("Missing environmentId", { status: 400 });
  const url = `https://generativelanguage.googleapis.com/v1beta/files/environment-${encodeURIComponent(envId)}:download?alt=media`;
  const response = await fetch(url, { headers: { "x-goog-api-key": apiKey } });
  if (!response.ok) return new Response(await response.text(), { status: response.status });
  return new Response(await response.arrayBuffer(), { headers: { "Content-Type": "application/x-tar", "Content-Disposition": 'attachment; filename="gemini-environment.tar"', "Cache-Control": "no-store" } });
}
