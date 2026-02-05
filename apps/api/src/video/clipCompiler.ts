import { config } from "../config";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { putFile, signGetUrl } from "../storage/s3";

export type CompilationResult = {
  compiledUrl?: string;
  localPath?: string;
  clipCount: number;
};

async function readSpawnText(stream: number | ReadableStream<Uint8Array<ArrayBuffer>> | undefined) {
  if (!stream || typeof stream === "number") return "";
  return await new Response(stream).text();
}

export async function compileClips(urls: string[], jobId: string): Promise<CompilationResult> {
  if (urls.length === 0) return { clipCount: 0 };
  if (urls.length > config.limits.maxClipCount) {
    throw new Error(`Too many clips requested. Max ${config.limits.maxClipCount}.`);
  }

  // If only one clip, prefer direct playback and avoid any re-hosting.
  if (urls.length === 1) return { clipCount: 1 };

  const tmpDir = join("/tmp", `hoophub-clips-${jobId}`);
  await mkdir(tmpDir, { recursive: true });
  let shouldCleanup = true;

  try {
    // Download clips locally.
    const clipPaths: string[] = [];
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i]!;
      const res = await fetch(url);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const path = join(tmpDir, `clip-${i}.mp4`);
      await Bun.write(path, buf);
      clipPaths.push(path);
    }

    if (clipPaths.length === 0) return { clipCount: urls.length };

    const listPath = join(tmpDir, "concat.txt");
    const listBody = clipPaths.map((p) => `file '${p.replaceAll("'", "'\\''")}'`).join("\n");
    await writeFile(listPath, listBody, "utf8");

    const outPath = join(tmpDir, "out.mp4");

    // Attempt stream copy concat first (fast). If it fails, re-encode and concat again.
    const tryConcat = async (mode: "copy" | "reencode") => {
      if (mode === "copy") {
        let proc: ReturnType<typeof Bun.spawn>;
        try {
          proc = Bun.spawn(
            ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath],
            { stderr: "pipe", stdout: "pipe" }
          );
        } catch (error) {
          throw new Error(
            `ffmpeg is required for clip compilation. Install ffmpeg and retry. Underlying error: ${String(
              error
            )}`
          );
        }
        const code = await proc.exited;
        if (code !== 0) throw new Error(await readSpawnText(proc.stderr));
        return;
      }

      // Re-encode each clip to normalize streams.
      const normalized: string[] = [];
      for (let i = 0; i < clipPaths.length; i++) {
        const inPath = clipPaths[i]!;
        const normPath = join(tmpDir, `norm-${i}.mp4`);
        let proc: ReturnType<typeof Bun.spawn>;
        try {
          proc = Bun.spawn(
            [
              "ffmpeg",
              "-y",
              "-i",
              inPath,
              "-c:v",
              "libx264",
              "-preset",
              "veryfast",
              "-crf",
              "23",
              "-pix_fmt",
              "yuv420p",
              "-c:a",
              "aac",
              "-b:a",
              "128k",
              normPath,
            ],
            { stderr: "pipe", stdout: "pipe" }
          );
        } catch (error) {
          throw new Error(
            `ffmpeg is required for clip compilation. Install ffmpeg and retry. Underlying error: ${String(
              error
            )}`
          );
        }
        const code = await proc.exited;
        if (code !== 0) throw new Error(await readSpawnText(proc.stderr));
        normalized.push(normPath);
      }

      const normListPath = join(tmpDir, "concat-norm.txt");
      await writeFile(normListPath, normalized.map((p) => `file '${p.replaceAll("'", "'\\''")}'`).join("\n"), "utf8");

      let proc: ReturnType<typeof Bun.spawn>;
      try {
        proc = Bun.spawn(
          ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", normListPath, "-c", "copy", outPath],
          { stderr: "pipe", stdout: "pipe" }
        );
      } catch (error) {
        throw new Error(
          `ffmpeg is required for clip compilation. Install ffmpeg and retry. Underlying error: ${String(
            error
          )}`
        );
      }
      const code = await proc.exited;
      if (code !== 0) throw new Error(await readSpawnText(proc.stderr));
    };

    try {
      await tryConcat("copy");
    } catch {
      await tryConcat("reencode");
    }

    // Upload compiled video to S3/R2 and return a signed URL (short-lived).
    // If storage isn't configured yet, still return the local path for dev debugging.
    try {
      const key = `compiled/${jobId}.mp4`;
      await putFile(config.aws.clipBucket, key, outPath, "video/mp4");
      const signed = await signGetUrl(config.aws.clipBucket, key, config.aws.clipUrlTtlSeconds);
      return { clipCount: urls.length, compiledUrl: signed, localPath: outPath };
    } catch {
      // Keep files around so you can inspect the output when storage isn't configured.
      shouldCleanup = false;
      return { clipCount: urls.length, localPath: outPath };
    }
  } finally {
    // Best-effort cleanup.
    if (shouldCleanup) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }
}
