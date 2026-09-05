import { GoogleGenAI } from "@google/genai";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const apiKey = req.headers.get("x-gemini-api-key") || process.env.GEMINI_API_KEY;
    if (!apiKey) return new Response("Missing Gemini API key", { status: 401 });
    const { id } = await req.json();
    if (!id) return new Response("Missing interaction id", { status: 400 });
    const ai = new GoogleGenAI({ apiKey });
    await (ai.interactions as any).cancel(id);
    return Response.json({ ok: true });
  } catch (err: any) {
    return new Response(err?.message || "Failed to cancel interaction", { status: 500 });
  }
}
