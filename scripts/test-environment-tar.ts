import * as tar from "tar-stream";
import { listOutputEntries, readTarEntry } from "../lib/environmentTar";

async function buildFakeSnapshot(): Promise<Buffer> {
  const pack = tar.pack();
  pack.entry({ name: "workspace/project/README.md" }, "hello world");
  pack.entry({ name: "workspace/outputs/MegaScale.zip" }, Buffer.from("PK-fake-zip-bytes-1234567890"));
  pack.entry({ name: "workspace/outputs/nested/report.pdf" }, Buffer.from("%PDF-fake-bytes"));
  pack.entry({ name: "./workspace/outputs/", type: "directory" }); // dirs must be skipped
  pack.finalize();
  const chunks: Buffer[] = [];
  for await (const chunk of pack as any) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function main() {
  const tarBuffer = await buildFakeSnapshot();
  console.log("Fake snapshot size:", tarBuffer.length, "bytes");

  const entries = await listOutputEntries(tarBuffer);
  console.log("listOutputEntries ->", entries);

  const assert = (cond: boolean, msg: string) => { if (!cond) throw new Error("FAILED: " + msg); };
  assert(entries.length === 2, "should find exactly 2 output files (not the README, not the directory entry)");
  assert(entries.some(e => e.name === "MegaScale.zip"), "should find MegaScale.zip by relative name");
  assert(entries.some(e => e.name === "nested/report.pdf"), "should find nested/report.pdf by relative name");

  const zipEntry = entries.find(e => e.name === "MegaScale.zip")!;
  const data = await readTarEntry(tarBuffer, zipEntry.path);
  assert(!!data, "readTarEntry should find the file by its full tar path");
  assert(data!.toString("utf8") === "PK-fake-zip-bytes-1234567890", "file contents should round-trip exactly");
  assert(zipEntry.size_bytes === String(data!.length), "reported size_bytes should match actual content length");

  const missing = await readTarEntry(tarBuffer, "workspace/outputs/does-not-exist.txt");
  assert(missing === null, "readTarEntry should return null for a path that isn't in the tar");

  console.log("\nAll environmentTar.ts checks passed.");
}

main().catch(err => { console.error(err); process.exit(1); });
