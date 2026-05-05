import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import type { RawAttachment } from "@/types/database";

export const CAPTURE_UPLOAD_URL_PREFIX = "/api/uploads/captures/";
export const MAX_CAPTURE_FILES = 6;
export const MAX_CAPTURE_IMPORT_FILES = 60;
export const MAX_CAPTURE_FILE_SIZE_BYTES = 10 * 1024 * 1024;

const CAPTURE_UPLOAD_DIR = path.join(process.cwd(), ".data", "uploads", "captures");
const CAPTURE_IMAGE_MIME_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/bmp": ".bmp",
  "image/avif": ".avif",
};

export class UploadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadValidationError";
  }
}

export async function saveCaptureUploads(values: FormDataEntryValue[], options: { maxFiles?: number } = {}) {
  const files = values.filter((value): value is File => value instanceof File && value.size > 0);
  const maxFiles = options.maxFiles ?? MAX_CAPTURE_FILES;

  if (files.length === 0) {
    return [];
  }

  if (files.length > maxFiles) {
    throw new UploadValidationError(`最多一次上传 ${maxFiles} 张图片。`);
  }

  await mkdir(CAPTURE_UPLOAD_DIR, { recursive: true });

  const attachments: RawAttachment[] = [];

  for (const file of files) {
    const extension = CAPTURE_IMAGE_MIME_TYPES[file.type];

    if (!extension) {
      throw new UploadValidationError("当前只支持上传 JPEG、PNG、WebP、GIF、BMP 或 AVIF 图片。");
    }

    if (file.size > MAX_CAPTURE_FILE_SIZE_BYTES) {
      throw new UploadValidationError("单张图片不能超过 10MB。");
    }

    const filename = `${new Date().toISOString().slice(0, 10)}-${randomUUID()}${extension}`;
    const bytes = Buffer.from(await file.arrayBuffer());

    await writeFile(getCaptureUploadPath(filename), bytes);

    attachments.push({
      kind: "image",
      url: `${CAPTURE_UPLOAD_URL_PREFIX}${filename}`,
      name: file.name || filename,
      mime_type: file.type,
      size_bytes: file.size,
      storage: "local",
    });
  }

  return attachments;
}

export async function readCaptureUpload(filename: string) {
  return readFile(getCaptureUploadPath(filename));
}

export function getCaptureUploadPath(filename: string) {
  if (!isSafeCaptureUploadFilename(filename)) {
    throw new UploadValidationError("Invalid upload filename.");
  }

  const filePath = path.resolve(CAPTURE_UPLOAD_DIR, filename);
  const root = path.resolve(CAPTURE_UPLOAD_DIR);

  if (!filePath.startsWith(`${root}${path.sep}`)) {
    throw new UploadValidationError("Invalid upload path.");
  }

  return filePath;
}

export function getFilenameFromCaptureUploadUrl(url: string) {
  if (!url.startsWith(CAPTURE_UPLOAD_URL_PREFIX)) {
    return null;
  }

  const filename = decodeURIComponent(url.slice(CAPTURE_UPLOAD_URL_PREFIX.length));
  return isSafeCaptureUploadFilename(filename) ? filename : null;
}

export function getMimeTypeFromCaptureUploadFilename(filename: string) {
  const extension = path.extname(filename).toLowerCase();
  const entry = Object.entries(CAPTURE_IMAGE_MIME_TYPES).find(([, value]) => value === extension);
  return entry?.[0] || "application/octet-stream";
}

export function isRemoteImageUrl(url: string) {
  return /^https?:\/\//i.test(url) || url.startsWith("data:image/");
}

function isSafeCaptureUploadFilename(filename: string) {
  return /^\d{4}-\d{2}-\d{2}-[0-9a-f-]{36}\.(jpg|png|webp|gif|bmp|avif)$/i.test(filename);
}
