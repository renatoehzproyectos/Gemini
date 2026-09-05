import { NextRequest } from "next/server";
import { downloadEnvironmentTar, listOutputEntries } from "@/lib/environmentTar";

export const runtime = "nodejs";
export const maxDuration = 120;

// IMPORTANT: Google's Gemini Interactions/Antigravity API does not expose an
// endpoint to list files inside a sandbox by path. The only real mechanism is
// downloading the whole environment as a tar snapshot and reading it locally:
// https://ai.google.dev/gemini-api/docs/managed-agents-quickstart
//
// The previous version of this route called a made-up endpoint
// (`/v1beta/environments/{id}/files/...`) that Google's API does not have, so
// this call always failed and the "Output" download cards never appeared.
export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-gemini-api-key") || process.env.GEMINI_API_KEY;
  const envId = req.nextUrl.searchParams.get("environmentId");
  if (!apiKey) return new Response("Missing Gemini API key", { status: 401 });
  if (!envId) return new Response("Missing environmentId", { status: 400 });

  try {
    const tarBuffer = await downloadEnvironmentTar(apiKey, envId);
    const files = await listOutputEntries(tarBuffer);
    return Response.json({ files });
  } catch (err: any) {
    return new Response(err?.message || "Failed to list output files", { status: 502 });
  }
}
