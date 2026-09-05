import { GoogleGenAI } from "@google/genai";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

type InputMessage = {
  role: "user" | "model";
  text: string;
  files?: { name: string; mimeType: string; data: string }[];
};

export async function POST(req: NextRequest) {
  try {
    const apiKey = req.headers.get("x-gemini-api-key") || process.env.GEMINI_API_KEY;
    if (!apiKey) return new Response("Missing Gemini API key", { status: 401 });

    const body = await req.json();
    const model = body.model || "gemini-3.7-flash";
    const messages: InputMessage[] = body.messages || [];

    const ai = new GoogleGenAI({ apiKey });

    // Use the current Gemini Interactions API. Files are sent as inline multimodal
    // inputs, which keeps the demo self-contained and Vercel deployable.
    const last = messages[messages.length - 1];
    const input: any[] = [];

    if (last?.text) input.push({ type: "text", text: last.text });

    for (const f of last?.files || []) {
      input.push({
        type: mimeToType(f.mimeType),
        data: f.data,
        mime_type: f.mimeType
      });
    }

    // Preserve prior conversation as context.
    const previousText = messages.slice(0, -1).map(m =>
      `${m.role === "user" ? "USER" : "GEMINI"}:\n${m.text}`
    ).join("\n\n");

    if (previousText) {
      input.unshift({
        type: "text",
        text: `Conversation context:\n${previousText}`
      });
    }

    const stream = await ai.interactions.create({
      model,
      input,
      stream: true
    });

    const encoder = new TextEncoder();

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            const e: any = event;
            const text =
              e?.delta?.text ??
              (e?.event_type === "step.delta" && e?.delta?.type === "text" ? e.delta.text : null);

            if (text) controller.enqueue(encoder.encode(text));
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      }
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no"
      }
    });
  } catch (err: any) {
    return new Response(err?.message || "Gemini request failed", { status: 500 });
  }
}

function mimeToType(mime: string) {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "file";
  return "text";
}
