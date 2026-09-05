import { GoogleGenAI } from "@google/genai";
import JSZip from "jszip";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

type InputFile = { name: string; mimeType: string; data: string };
type InputMessage = { role: "user" | "model"; text: string; files?: InputFile[] };

const TEXT_EXTENSIONS = /\.(txt|md|markdown|json|js|jsx|ts|tsx|mjs|cjs|css|scss|html|htm|xml|yaml|yml|toml|ini|env|py|pyw|java|kt|kts|c|h|cpp|cc|cxx|hpp|cs|go|rs|rb|php|swift|dart|lua|sh|bash|zsh|bat|cmd|ps1|sql|graphql|gql|vue|svelte|astro|gitignore|dockerfile|csv|log)$/i;

export async function POST(req: NextRequest) {
  try {
    const apiKey = req.headers.get("x-gemini-api-key") || process.env.GEMINI_API_KEY;
    if (!apiKey) return new Response("Missing Gemini API key", { status: 401 });

    const body = await req.json();
    const model = body.model || "gemini-3.7-flash";
    const messages: InputMessage[] = body.messages || [];
    const ai = new GoogleGenAI({ apiKey });
    const last = messages[messages.length - 1];

    const input: any[] = [];
    if (last?.text) input.push({ type: "text", text: last.text });

    for (const file of last?.files || []) {
      await appendFileInput(input, file);
    }

    const previousText = messages.slice(0, -1).map(m =>
      `${m.role === "user" ? "USER" : "GEMINI"}:\n${m.text}`
    ).join("\n\n");

    if (previousText) {
      input.unshift({ type: "text", text: `Conversation context:\n${previousText}` });
    }

    const stream = await ai.interactions.create({ model, input, stream: true });
    const encoder = new TextEncoder();

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            const e: any = event;
            if (e?.event_type === "step.delta" && e?.delta?.type === "text") {
              controller.enqueue(encoder.encode(e.delta.text));
            }
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
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no"
      }
    });
  } catch (err: any) {
    console.error(err);
    return new Response(err?.message || "Gemini request failed", { status: 500 });
  }
}

async function appendFileInput(input: any[], file: InputFile) {
  const mime = (file.mimeType || "application/octet-stream").toLowerCase();
  const name = file.name || "uploaded-file";

  // Text/code files must use the text field. Sending base64 in `data` for a
  // text content item is invalid in the current Interactions schema.
  if (mime.startsWith("text/") || TEXT_EXTENSIONS.test(name)) {
    input.push({
      type: "text",
      text: `\n--- FILE: ${name} ---\n${Buffer.from(file.data, "base64").toString("utf8")}\n--- END FILE: ${name} ---\n`
    });
    return;
  }

  // ZIP files are unpacked server-side and their readable source/text files
  // are added as text. This makes .zip project uploads useful to Gemini.
  if (mime === "application/zip" || mime === "application/x-zip-compressed" || /\.zip$/i.test(name)) {
    await appendZip(input, file);
    return;
  }

  if (mime.startsWith("image/")) {
    input.push({ type: "image", data: file.data, mime_type: mime });
    return;
  }
  if (mime.startsWith("audio/")) {
    input.push({ type: "audio", data: file.data, mime_type: mime });
    return;
  }
  if (mime.startsWith("video/")) {
    input.push({ type: "video", data: file.data, mime_type: mime });
    return;
  }
  if (mime === "application/pdf") {
    input.push({ type: "document", data: file.data, mime_type: mime });
    return;
  }

  // For other document-like MIME types, use the document content type.
  input.push({ type: "document", data: file.data, mime_type: mime });
}

async function appendZip(input: any[], file: InputFile) {
  const zip = await JSZip.loadAsync(Buffer.from(file.data, "base64"));
  const names = Object.keys(zip.files).filter(n => !zip.files[n].dir);
  const readable: string[] = [];

  for (const name of names) {
    if (!TEXT_EXTENSIONS.test(name)) continue;
    const size = zip.files[name]._data?.uncompressedSize ?? 0;
    if (size > 2_000_000) continue;
    const content = await zip.files[name].async("string");
    readable.push(`--- ${name} ---\n${content}\n--- END ${name} ---`);
  }

  if (readable.length) {
    input.push({
      type: "text",
      text: `\n--- ZIP PROJECT: ${file.name} ---\n${readable.join("\n\n")}\n--- END ZIP PROJECT ---\n`
    });
  } else {
    input.push({
      type: "text",
      text: `The uploaded ZIP file "${file.name}" contains no supported text/source files that can be read inline.`
    });
  }
}
