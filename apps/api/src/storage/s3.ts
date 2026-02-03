import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createReadStream } from "node:fs";
import { basename } from "node:path";
import { config } from "../config";

let s3: S3Client | null = null;

export function getS3Client() {
  if (s3) return s3;
  s3 = new S3Client({
    region: config.aws.region,
    endpoint: config.aws.endpoint,
    forcePathStyle: Boolean(config.aws.endpoint),
  });
  return s3;
}

export async function putJson(bucket: string, key: string, value: unknown) {
  const client = getS3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(value),
      ContentType: "application/json",
    })
  );
}

export async function putFile(bucket: string, key: string, filePath: string, contentType?: string) {
  const client = getS3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(filePath),
      ContentType: contentType,
      ContentDisposition: `inline; filename=\"${basename(filePath)}\"`,
    })
  );
}

export async function signGetUrl(bucket: string, key: string, ttlSeconds: number) {
  const client = getS3Client();
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(client, command, { expiresIn: ttlSeconds });
}
