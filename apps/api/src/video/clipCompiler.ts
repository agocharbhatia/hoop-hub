import { config } from "../config";

export type CompilationResult = {
  compiledUrl?: string;
  localPath?: string;
  clipCount: number;
};

export async function compileClips(urls: string[], jobId: string): Promise<CompilationResult> {
  if (urls.length === 0) return { clipCount: 0 };
  if (urls.length > config.limits.maxClipCount) {
    throw new Error(`Too many clips requested. Max ${config.limits.maxClipCount}.`);
  }

  // TODO: download clips, normalize, and concatenate using ffmpeg.
  // For MVP skeleton we return a placeholder and rely on client to use individual URLs.
  return {
    clipCount: urls.length,
    compiledUrl: undefined,
  };
}
