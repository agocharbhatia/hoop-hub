import { config } from "../config";
import { putJson } from "../storage/s3";

export async function archiveRaw(key: string, payload: unknown) {
  if (!config.ingest.archiveRaw) return;
  await putJson(config.aws.rawBucket, key, payload);
}
