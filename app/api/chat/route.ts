import { GoogleGenAI } from "@google/genai";
import JSZip from "jszip";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const TEXT_EXTENSIONS = /\.(txt|md|markdown|json|js|jsx|ts|tsx|mjs|cjs|css|scss|html|htm|xml|yaml|yml|toml|ini|env|py|pyw|java|kt|kts|c|h|cpp|cc|cxx|hpp|cs|go|rs|rb|php|swift|dart|lua|sh|bash|zsh|bat|cmd|ps1|sql|graphql|gql|vue|svelte|astro|gitignore|dockerfile|csv|log)$/i;
const SKIP = /(^|\/)(node_modules|\.git|\.next|dist|build|coverage|target|vendor)(\/|$)/i;
const INLINE_FILE_LIMIT = 1_000_000;
const INLINE_TOTAL_LIMIT = 2_000_000;
const MAX_REQUEST_FILES = 20;

type Uploaded = { name: string; mimeType?: string; data: string };

type Body = {
  apiKey?: string;
  prompt?: string;
  model?: string;
  previousInteractionId?: string;
  environmentId?: string;
  files?: Uploaded[];
  repositoryUrl?: string;
  repositoryTarget?: string;
  background?: boolean;
  maxTokens?: number;
  systemPrompt?: string;
  thinkingSummaries?: boolean;
  autoRun?: boolean;
};

export async function POST(req: NextRequest) {
  try {
    const apiKey = req.headers.get("x-gemini-api-key") || process.env.GEMINI_API_KEY;
    if (!apiKey) return new Response("Missing Gemini API key", { status: 401 });

    const body = (await req.json()) as Body;
    const prompt = String(body.prompt || "").trim();
    if (!prompt) return new Response("Missing prompt", { status: 400 });

    const model = normalizeModel(body.model);
    const previousInteractionId = cleanId(body.previousInteractionId);
    const environmentId = cleanId(body.environmentId);
    const files = Array.isArray(body.files) ? body.files.slice(0, MAX_REQUEST_FILES) : [];
    const repositoryUrl = normalizeRepositoryUrl(body.repositoryUrl);
    const repositoryTarget = normalizeTarget(body.repositoryTarget || "/workspace/project");
    const background = !!body.background;
    const maxTokens = Math.max(1000, Math.min(Number(body.maxTokens) || 50000, 1_000_000));
    const extra = String(body.systemPrompt || "").trim();
    const autoRun = body.autoRun !== false;
    const ai = new GoogleGenAI({ apiKey });

    const systemInstruction = `You are Gemini Agent, a highly capable autonomous coding and computer-use agent.

WORKSPACE: /workspace/project. You have a managed Linux sandbox. Use the available filesystem and code execution tools directly. You can read, create, edit, rename, move, delete and search files; execute Bash/Python/Node commands; install packages; run tests, linters and builds; inspect command output; and browse the public web with Google Search and URL context.

MANDATORY WORKFLOW:
1. Inspect /workspace/project before making changes.
2. If files were mounted for this turn, verify that they are actually present before claiming you inspected them.
3. When asked to modify something, actually modify the files; do not merely provide a hypothetical patch.
4. Work iteratively: inspect -> plan -> change -> verify -> fix failures -> summarize.
5. Preserve existing architecture and user changes unless the task requires otherwise.
6. Never expose secrets, API keys or credentials in output or source files.
7. Never claim a test, build, file inspection, benchmark, or code change happened unless you actually performed it.
8. If a requested file or repository is missing, say exactly what is missing and inspect the mounted workspace before asking the user for anything.
${autoRun ? "9. When code changes are requested, run the most relevant tests, type checks, lint, or build available in the project when practical, and fix failures before finishing." : "9. Do not automatically run expensive tests/builds unless the user asks; still perform lightweight validation when safe."}
10. At the end, report what you actually changed, what you actually verified, and any remaining limitation.
${extra ? `\nADDITIONAL USER INSTRUCTIONS:\n${extra}` : ""}`;

    const sourceResult = await buildSources(files, repositoryUrl, repositoryTarget);
    if (sourceResult.error) return new Response(sourceResult.error, { status: 413 });

    const baseSources = [
      {
        type: "inline",
        target: "/workspace/project/.agents/AGENTS.md",
        content: "Work directly in /workspace/project. Inspect, edit, execute and verify. Never claim changes without checking them."
      },
      ...(sourceResult.sources || [])
    ];

    // Important: environment_id + sources updates the existing managed sandbox.
    // The previous implementation silently ignored attachments whenever an environment already existed.
    const environment: any = environmentId
      ? (baseSources.length > 1
          ? { type: "remote", environment_id: environmentId, sources: baseSources }
          : environmentId)
      : { type: "remote", sources: baseSources };

    const createInput = {
      agent: "antigravity-preview-05-2026",
      input: prompt,
      system_instruction: systemInstruction,
      environment,
      previous_interaction_id: previousInteractionId,
      agent_config: { type: "antigravity", model, max_total_tokens: maxTokens },
      background,
      stream: true,
      store: true,
    };

    const interaction = await ai.interactions.create(createInput as any, { timeout: 300000 });

    const encoder = new TextEncoder();
    const send = (controller: ReadableStreamDefaultController, data: any) =>
      controller.enqueue(encoder.encode(`\u0000EVENT ${JSON.stringify(data)}\n`));

    const readable = new ReadableStream({
      async start(controller) {
        let sawText = false;
        try {
          for await (const event of interaction as any) {
            const e: any = event;
            if (e?.event_type === "interaction.created") {
              const interactionObject = e.interaction || {};
              send(controller, {
                kind: "meta",
                interactionId: interactionObject.id,
                environmentId: interactionObject.environment_id,
                status: interactionObject.status,
              });
            } else if (e?.event_type === "step.start") {
              send(controller, { kind: "step", type: e.step?.type, label: labelForStep(e.step?.type) });
            } else if (e?.event_type === "step.delta") {
              const d = e.delta || {};
              if (d.type === "text" && d.text) {
                sawText = true;
                send(controller, { kind: "text", text: d.text });
              } else if (d.type === "thought_summary") {
                const text = d.content?.text || "";
                if (text && body.thinkingSummaries !== false) send(controller, { kind: "thought", text });
              } else if (d.type === "arguments_delta") {
                send(controller, { kind: "step", type: "function_call", label: "Preparing tool call…" });
              } else if (d.type === "google_search_call") {
                send(controller, { kind: "step", type: d.type, label: "Searching the web" });
              } else if (d.type === "code_execution_call") {
                send(controller, { kind: "step", type: d.type, label: "Running code" });
              }
            } else if (e?.event_type === "interaction.status_update") {
              send(controller, { kind: "status", status: e.status || e.interaction?.status || "Working" });
            } else if (e?.event_type === "interaction.completed" || e?.event_type === "interaction.failed" || e?.event_type === "interaction.incomplete" || e?.event_type === "interaction.cancelled") {
              const i = e.interaction || {};
              // Some SDK/API versions only expose the final text on the completion object.
              if (!sawText && typeof i.output_text === "string" && i.output_text) {
                send(controller, { kind: "text", text: i.output_text });
              }
              send(controller, {
                kind: "status",
                status: i.status || e.status || "completed",
                interactionId: i.id,
                environmentId: i.environment_id,
              });
            }
          }
          controller.close();
        } catch (err: any) {
          send(controller, { kind: "error", message: friendlyError(err) });
          controller.close();
        }
      }
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      }
    });
  } catch (err: any) {
    return new Response(friendlyError(err), { status: statusForError(err) });
  }
}

function normalizeModel(value: unknown) {
  const allowed = new Set(["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"]);
  const model = String(value || "gemini-3.7-flash");
  return allowed.has(model) ? model : "gemini-3.7-flash";
}

function cleanId(value: unknown) {
  const text = String(value || "").trim();
  return text || undefined;
}

function normalizeRepositoryUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    if (!/github\.com$/i.test(url.hostname) && !/gitlab\.com$/i.test(url.hostname) && !/bitbucket\.org$/i.test(url.hostname)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function normalizeTarget(value: unknown) {
  const target = String(value || "/workspace/project").replaceAll("\\", "/").replace(/\/+/g, "/");
  if (!target.startsWith("/workspace/")) return "/workspace/project";
  return target.replace(/\/$/, "") || "/workspace/project";
}

function labelForStep(type: string) {
  if (type === "thought") return "Thinking";
  if (type === "model_output") return "Generating response";
  if (type === "function_call") return "Calling tool";
  if (type === "google_search_call") return "Searching the web";
  if (type === "google_search_result") return "Reading search results";
  if (type === "code_execution" || type === "code_execution_call") return "Running code";
  return type ? `Agent: ${type.replaceAll("_", " ")}` : "Agent working";
}

async function buildSources(files: Uploaded[], repositoryUrl: string, repositoryTarget: string) {
  const out: any[] = [];
  let totalBytes = 0;

  if (repositoryUrl) {
    out.push({ type: "repository", source: repositoryUrl, target: repositoryTarget });
  }

  for (const file of files) {
    const name = normalizePath(file.name || "uploaded-file");
    if (!name || SKIP.test(name)) continue;

    if (/\.zip$/i.test(name) || file.mimeType === "application/zip" || file.mimeType === "application/x-zip-compressed") {
      let zip: JSZip;
      try {
        zip = await JSZip.loadAsync(Buffer.from(file.data || "", "base64"));
      } catch {
        return { sources: out, error: `Could not read ${name} as a ZIP archive.` };
      }

      for (const [rawName, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        const path = normalizePath(rawName);
        if (!path || SKIP.test(path) || path.startsWith("../") || path.includes("/../")) continue;

        const raw = await entry.async("uint8array");
        const byteLength = raw.byteLength;
        if (byteLength > INLINE_FILE_LIMIT) {
          return { sources: out, error: `${name} contains ${path}, which is larger than the Gemini inline-source limit of 1 MB. Use a Git repository for projects with large files.` };
        }
        if (totalBytes + byteLength > INLINE_TOTAL_LIMIT) {
          return { sources: out, error: `The mounted project exceeds Gemini's 2 MB total inline-source limit. Use the Git repository field for larger projects.` };
        }
        totalBytes += byteLength;

        if (TEXT_EXTENSIONS.test(path)) {
          out.push({ type: "inline", target: `/workspace/project/${path}`, content: Buffer.from(raw).toString("utf8") });
        } else {
          out.push({ type: "inline", target: `/workspace/project/${path}`, content: Buffer.from(raw).toString("base64"), encoding: "base64" });
        }
      }
      continue;
    }

    const raw = Buffer.from(file.data || "", "base64");
    if (raw.byteLength > INLINE_FILE_LIMIT) {
      return { sources: out, error: `${name} is larger than Gemini's 1 MB inline-source limit. Use a Git repository for larger files.` };
    }
    if (totalBytes + raw.byteLength > INLINE_TOTAL_LIMIT) {
      return { sources: out, error: `The mounted files exceed Gemini's 2 MB total inline-source limit. Use the Git repository field for larger projects.` };
    }
    totalBytes += raw.byteLength;

    if (TEXT_EXTENSIONS.test(name)) {
      out.push({ type: "inline", target: `/workspace/project/${name}`, content: raw.toString("utf8") });
    } else {
      out.push({ type: "inline", target: `/workspace/project/${name}`, content: raw.toString("base64"), encoding: "base64" });
    }
  }

  return { sources: out };
}

function normalizePath(input: string) {
  return input.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+/g, "/");
}

function statusForError(err: any) {
  const message = String(err?.message || err || "");
  if (/401|unauthorized|api key/i.test(message)) return 401;
  if (/403|permission|forbidden/i.test(message)) return 403;
  if (/404|not found/i.test(message)) return 404;
  if (/429|rate limit|quota/i.test(message)) return 429;
  if (/400|invalid|unknown parameter/i.test(message)) return 400;
  return 500;
}

function friendlyError(err: any) {
  const message = String(err?.message || err || "Agent request failed");
  if (/generation_config/i.test(message) && /antigravity/i.test(message)) {
    return "Antigravity rejected a model-only generation_config. The app now uses agent_config for Antigravity and does not send generation_config.";
  }
  return message;
}
