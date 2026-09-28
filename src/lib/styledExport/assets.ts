import { sanitizeSvg } from "../sanitizeSvg";
import type { StyledAssetMap, StyledImageReference } from "./types";

export const STYLED_EXPORT_IMAGE_LIMIT = 5 * 1024 * 1024;
export const STYLED_EXPORT_TOTAL_IMAGE_LIMIT = 20 * 1024 * 1024;
export const STYLED_EXPORT_FETCH_TIMEOUT_MS = 15_000;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

function normalizeMime(value: string): string {
  return value.split(";")[0].trim().toLowerCase();
}

function inspectBlob(blob: Blob): string {
  const type = normalizeMime(blob.type);
  if (!ALLOWED_IMAGE_TYPES.has(type)) {
    throw new Error(`Unsupported image type: ${type || "unknown"}.`);
  }
  if (blob.size > STYLED_EXPORT_IMAGE_LIMIT) {
    throw new Error("Image exceeds the 5 MiB per-image limit.");
  }
  return type;
}

async function validateRasterSignature(blob: Blob, type: string): Promise<void> {
  if (type === "image/svg+xml") return;
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const matches = (signature: number[]) => signature.every((value, index) => bytes[index] === value);
  const valid = type === "image/png"
    ? matches([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    : type === "image/jpeg"
      ? matches([0xff, 0xd8, 0xff])
      : type === "image/gif"
        ? String.fromCharCode(...bytes.slice(0, 6)).startsWith("GIF8")
        : type === "image/webp"
          ? String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
          : false;
  if (!valid) throw new Error("Image data does not match its declared image type.");
}

async function validateRasterDecode(blob: Blob): Promise<void> {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
  } catch {
    throw new Error("Image data could not be decoded.");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function dataUrlToBlob(url: string): Blob {
  const comma = url.indexOf(",");
  if (comma < 0) throw new Error("Image data URL is malformed.");
  const header = url.slice(0, comma);
  const payload = url.slice(comma + 1);
  const mime = normalizeMime(header.slice(5).split(";")[0]);
  let bytes: Uint8Array;
  if (/;base64/i.test(header)) {
    const binary = atob(payload);
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } else {
    const result: number[] = [];
    for (let index = 0; index < payload.length;) {
      if (payload[index] === "%" && /^[0-9a-f]{2}$/i.test(payload.slice(index + 1, index + 3))) {
        result.push(Number.parseInt(payload.slice(index + 1, index + 3), 16));
        index += 3;
      } else {
        const codePoint = payload.codePointAt(index);
        if (codePoint === undefined) break;
        const encoded = new TextEncoder().encode(String.fromCodePoint(codePoint));
        result.push(...encoded);
        index += codePoint > 0xffff ? 2 : 1;
      }
    }
    bytes = new Uint8Array(result);
  }
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: mime });
}

function decodeBase64Utf8(payload: string): string {
  const binary = atob(payload);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function readLimitedImageResponse(response: Response): Promise<Blob> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > STYLED_EXPORT_IMAGE_LIMIT) {
    await response.body?.cancel();
    throw new Error("Image exceeds the 5 MiB per-image limit.");
  }
  if (!response.body) return response.blob();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > STYLED_EXPORT_IMAGE_LIMIT) {
      await reader.cancel();
      throw new Error("Image exceeds the 5 MiB per-image limit.");
    }
    chunks.push(value);
  }
  const buffer = new ArrayBuffer(size);
  const result = new Uint8Array(buffer);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Blob([buffer], { type: response.headers.get("content-type") ?? "" });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Image data could not be read."));
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Image data could not be read."));
    reader.readAsDataURL(blob);
  });
}

export async function fileToSafeDataUrl(file: File): Promise<string> {
  const type = inspectBlob(file);
  if (type === "image/svg+xml") {
    const source = await file.text();
    const sanitized = sanitizeSvg(source, true);
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sanitized)}`;
  }
  await validateRasterSignature(file, type);
  await validateRasterDecode(file);
  return blobToDataUrl(file);
}

export async function resolveDirectImage(url: string, externalSignal?: AbortSignal): Promise<string> {
  if (/^data:image\//i.test(url)) {
    const comma = url.indexOf(",");
    if (comma < 0) throw new Error("Image data URL is malformed.");
    const header = url.slice(0, comma);
    const payload = url.slice(comma + 1);
    const mime = normalizeMime(header.slice(5).split(";")[0]);
    if (!ALLOWED_IMAGE_TYPES.has(mime)) throw new Error("Unsupported embedded image type.");
    const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
    const roughBytes = /;base64/i.test(header)
      ? Math.floor((payload.length * 3) / 4) - padding
      : payload.length / 3;
    if (roughBytes > STYLED_EXPORT_IMAGE_LIMIT) {
      throw new Error("Image exceeds the 5 MiB per-image limit.");
    }
    const blob = dataUrlToBlob(url);
    const actualType = inspectBlob(blob);
    if (actualType !== mime) throw new Error("Image data does not match its declared image type.");
    if (mime === "image/svg+xml") {
      const source = /;base64/i.test(header)
        ? decodeBase64Utf8(payload)
        : decodeURIComponent(payload);
      const sanitized = sanitizeSvg(source, true);
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sanitized)}`;
    }
    await validateRasterSignature(blob, mime);
    await validateRasterDecode(blob);
    return url;
  }

  if (!/^https:\/\//i.test(url)) {
    throw new Error("This image needs a local file to be selected.");
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    STYLED_EXPORT_FETCH_TIMEOUT_MS
  );
  const abortFromCaller = () => controller.abort();
  externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    if (externalSignal?.aborted) controller.abort();
    const response = await fetch(url, {
      credentials: "omit",
      mode: "cors",
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Image request failed (${response.status}).`);
    if (!response.url.startsWith("https://")) {
      throw new Error("Image redirected to a non-HTTPS address.");
    }
    const blob = await readLimitedImageResponse(response);
    const type = inspectBlob(blob);
    if (type === "image/svg+xml") {
      const sanitized = sanitizeSvg(await blob.text(), true);
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sanitized)}`;
    }
    await validateRasterSignature(blob, type);
    await validateRasterDecode(blob);
    return blobToDataUrl(blob);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("Image request timed out after 15 seconds.");
    }
    throw error instanceof Error ? error : new Error("Image request failed.");
  } finally {
    window.clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromCaller);
  }
}

export function totalAssetBytes(assets: StyledAssetMap): number {
  return Object.values(assets).reduce((total, dataUrl) => {
    const comma = dataUrl.indexOf(",");
    const payload = dataUrl.slice(comma + 1);
    let size = payload.length;
    if (/;base64,/i.test(dataUrl.slice(0, comma + 1))) {
      const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
      size = Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
    } else {
      try {
        size = new TextEncoder().encode(decodeURIComponent(payload)).length;
      } catch {
        size = payload.length;
      }
    }
    return total + size;
  }, 0);
}

export function setAsset(
  assets: StyledAssetMap,
  reference: StyledImageReference,
  dataUrl: string
): StyledAssetMap {
  const next = { ...assets, [reference.id]: dataUrl };
  if (totalAssetBytes(next) > STYLED_EXPORT_TOTAL_IMAGE_LIMIT) {
    throw new Error("All embedded images exceed the 20 MiB total limit.");
  }
  return next;
}
