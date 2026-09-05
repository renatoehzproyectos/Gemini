import { GoogleGenAI } from "@google/genai";
import JSZip from "jszip";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const TEXT_EXTENSIONS = /\.(txt|md|markdown|json|js|jsx|ts|tsx|mjs|cjs|css|scss|html|htm|xml|yaml|yml|toml|ini|env|py|pyw|java|kt|kts|c|h|cpp|cc|cxx|hpp|cs|go|rs|rb|php|swift|dart|lua|sh|bash|zsh|bat|cmd|ps1|sql|graphql|gql|vue|svelte|astro|gitignore|dockerfile|csv|log)$/i;
const SKIP = /(^|\/)(node_modules|\.git|\.next|dist|build|coverage|target|vendor)(\/|$)/i;

type Uploaded = { name: string; mimeType?: string; data: string };

export async function POST(req: NextRequest) {
  try {
    const apiKey = req.headers.get("x-gemini-api-key") || process.env.GEMINI_API_KEY;
    if (!apiKey) return new Response("Missing Gemini API key", { status: 401 });
    const body = await req.json();
    const prompt = String(body.prompt || "").trim();
    if (!prompt) return new Response("Missing prompt", { status: 400 });
    const model = body.model || "gemini-3.7-flash";
    const previousInteractionId = body.previousInteractionId || undefined;
    const environmentId = body.environmentId || undefined;
    const files: Uploaded[] = Array.isArray(body.files) ? body.files : [];
    const background = body.background !== false;
    const maxTokens = Math.max(10000, Math.min(Number(body.maxTokens) || 250000, 1000000));
    const extra = String(body.systemPrompt || "").trim();
    const ai = new GoogleGenAI({ apiKey });

    const systemInstruction = `You are Gemini Agent, a highly capable autonomous general-purpose coding and computer-use agent.\n\nWORKSPACE: /workspace/project. You have a managed Linux sandbox. Use the available filesystem and code execution tools directly. You can read, create, edit, rename, move, delete and search files; execute Bash/Python/Node commands; install packages; run tests, linters and builds; inspect command output; and browse the public web with Google Search and URL context.\n\nBEHAVIOR:\n- Inspect the workspace before changing it.\n- When asked to modify something, actually modify the files; do not merely provide a hypothetical patch.\n- Use tools iteratively: inspect -> plan -> change -> verify -> fix failures -> summarize.\n- Preserve existing architecture and user changes unless the task requires otherwise.\n- For destructive operations, be cautious; if the user explicitly requested them, perform them.\n- Never expose secrets, API keys or credentials in output or source files.\n- Prefer robust production-quality implementations over toy examples.\n- If tests/builds are relevant, run them and fix failures when practical.\n- For web/current-information tasks, use the web tools rather than guessing.\n- At the end, report what you actually changed and what you actually verified.\n- When you create a deliverable intended for the user to download (ZIP, PDF, image, source file, report, document, dataset, etc.), save or copy the final deliverable into /workspace/outputs/ with a clear filename and extension.\n${extra ? `\nADDITIONAL USER INSTRUCTIONS:\n${extra}` : ""}`;

    const sources = await buildSources(files);
    const environment: any = environmentId
      ? environmentId
      : { type: "remote", sources: [
          { type: "inline", target: "/workspace/project/.agents/AGENTS.md", content: "Work directly in /workspace/project. Inspect, edit, execute and verify. Never claim changes without checking them." },
          ...sources
        ] };

    const interaction = await ai.interactions.create({
      agent: "antigravity-preview-05-2026",
      input: prompt,
      system_instruction: systemInstruction,
      environment,
      previous_interaction_id: previousInteractionId,
      agent_config: { type: "antigravity", model, max_total_tokens: maxTokens },
      background,
      store: true,
      stream: true,
    } as any, { timeout: 300000 });

    const encoder = new TextEncoder();
    const send = (controller: ReadableStreamDefaultController, data: any) => controller.enqueue(encoder.encode(`\u0000EVENT ${JSON.stringify(data)}\n`));
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of interaction as any) {
            const e: any = event;
            if (e?.event_type === "interaction.created") send(controller, { kind: "meta", interactionId: e.interaction?.id, environmentId: e.interaction?.environment_id });
            else if (e?.event_type === "step.start") send(controller, { kind: "step", type: e.step?.type, label: labelForStep(e.step?.type) });
            else if (e?.event_type === "step.delta") {
              const d = e.delta;
              if (d?.type === "text") send(controller, { kind: "text", text: d.text || "" });
              else if (d?.type === "thought_summary") send(controller, { kind: "thought", text: d.content?.text || "" });
              else if (d?.type === "arguments_delta") send(controller, { kind: "step", type: "function_call", label: "Preparing tool call…" });
            } else if (e?.event_type === "interaction.status_update") send(controller, { kind: "status", status: e.status || e.interaction?.status || "Working" });
            else if (e?.event_type === "interaction.completed" || e?.event_type === "interaction.failed" || e?.event_type === "interaction.incomplete" || e?.event_type === "interaction.cancelled") send(controller, { kind: "status", status: e.interaction?.status || e.status || "completed", interactionId: e.interaction?.id, environmentId: e.interaction?.environment_id });
          }
          controller.close();
        } catch (err: any) { send(controller, { kind: "error", message: err?.message || String(err) }); controller.close(); }
      }
    });
    return new Response(readable, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
  } catch (err: any) { return new Response(err?.message || "Agent request failed", { status: 500 }); }
}

function labelForStep(type: string) {
  if (type === "thought") return "Thinking";
  if (type === "model_output") return "Generating response";
  if (type === "function_call") return "Calling tool";
  if (type === "google_search_call") return "Searching the web";
  if (type === "google_search_result") return "Reading search results";
  if (type === "code_execution") return "Running code";
  return type ? `Agent: ${type.replaceAll("_", " ")}` : "Agent working";
}

async function buildSources(files: Uploaded[]) {
  const out: any[] = [];
  for (const file of files) {
    const name = normalizePath(file.name || "uploaded-file");
    if (!name || SKIP.test(name)) continue;
    if (/\.zip$/i.test(name) || file.mimeType === "application/zip" || file.mimeType === "application/x-zip-compressed") {
      const zip = await JSZip.loadAsync(Buffer.from(file.data, "base64"));
      for (const [rawName, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        const path = normalizePath(rawName);
        if (!path || SKIP.test(path) || path.startsWith("../") || path.includes("/../")) continue;
        const bytes = await entry.async("base64");
        if (TEXT_EXTENSIONS.test(path)) {
          const text = Buffer.from(bytes, "base64").toString("utf8");
          if (text.length <= 3_000_000) out.push({ type: "inline", target: `/workspace/project/${path}`, content: text });
        } else if (bytes.length <= 8_000_000) out.push({ type: "inline", target: `/workspace/project/${path}`, content: bytes, encoding: "base64" });
      }
      continue;
    }
    if (TEXT_EXTENSIONS.test(name)) {
      const text = Buffer.from(file.data || "", "base64").toString("utf8");
      if (text.length <= 3_000_000) out.push({ type: "inline", target: `/workspace/project/${name}`, content: text });
    } else if ((file.data || "").length <= 8_000_000) out.push({ type: "inline", target: `/workspace/project/${name}`, content: file.data, encoding: "base64" });
  }
  return out;
}
function normalizePath(input: string) { return input.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+/g, "/"); }
