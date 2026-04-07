import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

export type S3PdfUploadResult = {
  objectKey: string;
  /** SEC: Short-lived read URL for the extraction model prompt only; do not log or return to untrusted clients beyond the API response. */
  signedGetUrl: string;
};

export function isS3InvoicePdfUploadConfigured(): boolean {
  const bucket = process.env.AWS_S3_BUCKET?.trim();
  const region = process.env.AWS_REGION?.trim();

  return Boolean(bucket && region);
}

/**
 * SEC: Uses the default AWS credential chain (env keys, shared config, or instance role).
 * Returns null when bucket/region are not configured (extraction still works from PDF text).
 */
export async function uploadInvoicePdfToS3(
  buffer: Buffer,
): Promise<S3PdfUploadResult | null> {
  const bucket = process.env.AWS_S3_BUCKET?.trim();
  const region = process.env.AWS_REGION?.trim();

  if (!bucket || !region) {
    return null;
  }

  const client = new S3Client({ region });
  const objectKey = `invoice-pdf-imports/${randomUUID()}.pdf`;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: buffer,
      ContentType: "application/pdf",
    }),
  );

  const signedGetUrl = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
    { expiresIn: 900 },
  );

  return { objectKey, signedGetUrl };
}
