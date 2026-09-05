import { GoogleGenAI } from "@google/genai";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const apiKey = req.headers.get("x-gemini-api-key") || process.env.GEMINI_API_KEY;
    const id = req.nextUrl.searchParams.get("id");
    if (!apiKey) return new Response("Missing Gemini API key", { status: 401 });
    if (!id) return new Response("Missing interaction id", { status: 400 });
    const ai = new GoogleGenAI({ apiKey });
    const interaction: any = await ai.interactions.get(id);
    return Response.json({
      id: interaction.id,
      status: interaction.status,
      environmentId: interaction.environment_id,
      outputText: interaction.output_text || interaction.outputText || "",
      error: interaction.error?.message || interaction.error || null,
      usage: interaction.usage || null,
    });
  } catch (err: any) {
    return new Response(err?.message || "Failed to retrieve interaction", { status: 500 });
  }
}
