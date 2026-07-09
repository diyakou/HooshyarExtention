import * as path from "path";
import * as vscode from "vscode";
import { AttachedImage, ImageMediaType } from "./types";

const IMAGE_EXT_TO_MIME: Record<string, ImageMediaType> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp"
};

const TEXT_EXT =
  /\.(txt|md|ts|tsx|js|jsx|py|json|css|html|yml|yaml|toml|xml|csv|sh|bat|ps1|rs|go|java|kt|rb|php|vue|svelte)$/i;

export function isImagePath(filePath: string): boolean {
  return IMAGE_EXT_TO_MIME[path.extname(filePath).toLowerCase()] !== undefined;
}

export function mediaTypeFromPath(filePath: string): ImageMediaType | null {
  return IMAGE_EXT_TO_MIME[path.extname(filePath).toLowerCase()] ?? null;
}

export function getMaxImageBytes(): number {
  return vscode.workspace.getConfiguration("hooshyar").get<number>("maxImageSizeBytes", 4 * 1024 * 1024);
}

export async function readImageAttachment(uri: vscode.Uri): Promise<AttachedImage> {
  const mediaType = mediaTypeFromPath(uri.fsPath);
  if (!mediaType) {
    throw new Error("Unsupported image type. Use PNG, JPEG, GIF, or WebP.");
  }

  const bytes = await vscode.workspace.fs.readFile(uri);
  const maxBytes = getMaxImageBytes();
  if (bytes.byteLength > maxBytes) {
    throw new Error(`Image too large (${bytes.byteLength} bytes). Max is ${maxBytes} bytes.`);
  }

  const name = path.basename(uri.fsPath);
  return {
    name,
    mediaType,
    base64: Buffer.from(bytes).toString("base64")
  };
}

export function isLikelyTextFile(filePath: string): boolean {
  if (isImagePath(filePath)) return false;
  return TEXT_EXT.test(filePath) || !path.extname(filePath);
}

export function imageToDataUrl(image: AttachedImage): string {
  return `data:${image.mediaType};base64,${image.base64}`;
}

export function buildUserContent(
  text: string,
  images: AttachedImage[]
): string | import("./types").ContentBlock[] {
  if (images.length === 0) return text;

  const blocks: import("./types").ContentBlock[] = [{ type: "text", text }];
  for (const img of images) {
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: img.mediaType,
        data: img.base64
      }
    });
  }
  return blocks;
}
