import { Readable } from "node:stream";
import * as tar from "tar-stream";

export type OutputEntry = { path: string; name: string; size_bytes: string; type: "file" };

/**
 * Downloads the full environment snapshot as a tar archive.
 *
 * This is intentionally the ONLY way this app talks to Google's file storage.
 * The Gemini Interactions/Antigravity API does not expose an endpoint to list
 * or download individual files inside a sandbox — the documented mechanism is
 * always a single-shot tar snapshot of the whole environment:
 *   GET /v1beta/files/environment-{envId}:download?alt=media
 * See: https://ai.google.dev/gemini-api/docs/managed-agents-quickstart
 */
export async function downloadEnvironmentTar(apiKey: string, envId: string): Promise<Buffer> {
  const url = `https://generativelanguage.googleapis.com/v1beta/files/environment-${encodeURIComponent(envId)}:download?alt=media`;
  const res = await fetch(url, { headers: { "x-goog-api-key": apiKey }, cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Failed to download environment snapshot (${res.status})`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

function normalizeTarPath(name: string) {
  return name.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

/** True if this tar path lives anywhere under a `workspace/outputs/` directory. */
function isOutputPath(path: string) {
  return /(^|\/)workspace\/outputs\//i.test(path) || /^workspace\/outputs\//i.test(path);
}

/** Everything after the `workspace/outputs/` segment, used as the display name / download key. */
function outputRelativeName(path: string) {
  return path.replace(/^.*?workspace\/outputs\//i, "");
}

/**
 * Lists every regular file under workspace/outputs/ inside a tar snapshot,
 * without buffering file contents into memory (each entry's body is drained
 * and discarded — we only need the header metadata here).
 */
export async function listOutputEntries(tarBuffer: Buffer): Promise<OutputEntry[]> {
  return new Promise((resolve, reject) => {
    const extract = tar.extract();
    const out: OutputEntry[] = [];
    extract.on("entry", (header, stream, next) => {
      const path = normalizeTarPath(header.name);
      if (header.type === "file" && isOutputPath(path)) {
        out.push({ path, name: outputRelativeName(path), size_bytes: String(header.size ?? 0), type: "file" });
      }
      stream.on("end", next);
      stream.on("error", reject);
      stream.resume();
    });
    extract.on("finish", () => resolve(out));
    extract.on("error", reject);
    Readable.from(tarBuffer).pipe(extract);
  });
}

/** Reads the full contents of a single tar entry matched by its exact normalized path. */
export async function readTarEntry(tarBuffer: Buffer, targetPath: string): Promise<Buffer | null> {
  const wanted = normalizeTarPath(targetPath);
  return new Promise((resolve, reject) => {
    const extract = tar.extract();
    let found: Buffer | null = null;
    extract.on("entry", (header, stream, next) => {
      const path = normalizeTarPath(header.name);
      if (!found && header.type === "file" && path === wanted) {
        const chunks: Buffer[] = [];
        stream.on("data", c => chunks.push(c as Buffer));
        stream.on("end", () => { found = Buffer.concat(chunks); next(); });
        stream.on("error", reject);
      } else {
        stream.on("end", next);
        stream.on("error", reject);
        stream.resume();
      }
    });
    extract.on("finish", () => resolve(found));
    extract.on("error", reject);
    Readable.from(tarBuffer).pipe(extract);
  });
}
