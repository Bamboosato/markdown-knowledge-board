import type { BackupDocument } from "./backup";
import { canonicalStringify } from "./canonicalJson";
import {
  parseStrictBackupDocument,
  validateBackupDocument,
} from "./cloudRestore";

export const PBKDF2_ITERATIONS_V1 = 600_000;
export const MAX_ENCRYPTED_BACKUP_BYTES = 4_500_000;
export const MIN_PASSPHRASE_CODE_POINTS = 12;
export const PASSPHRASE_TOO_SHORT_MESSAGE =
  "Passphrase must contain at least 12 characters.";
export const PASSPHRASES_DO_NOT_MATCH_MESSAGE = "Passphrases do not match.";
export const DECRYPTION_FAILURE_MESSAGE =
  "The passphrase is incorrect or the backup is damaged.";
export const BACKUP_TOO_LARGE_MESSAGE =
  "The encrypted backup exceeds 4.5 MB. Use a local JSON backup instead.";
export const PASSPHRASE_LOSS_WARNING =
  "If you lose this passphrase, the backup cannot be recovered.";

const SALT_BYTES = 16;
const IV_BYTES = 12;
const AES_GCM_TAG_BITS = 128;
const AES_GCM_TAG_BYTES = AES_GCM_TAG_BITS / 8;
const ENVELOPE_KEYS = new Set([
  "app",
  "envelopeVersion",
  "crypto",
  "ciphertext",
]);
const CRYPTO_KEYS = new Set([
  "algorithm",
  "keyLength",
  "kdf",
  "iterations",
  "salt",
  "iv",
]);

export type EncryptedBackupEnvelope = {
  app: "markdown-knowledge-board";
  envelopeVersion: 1;
  crypto: {
    algorithm: "AES-GCM";
    keyLength: 256;
    kdf: "PBKDF2-SHA-256";
    iterations: typeof PBKDF2_ITERATIONS_V1;
    salt: string;
    iv: string;
  };
  ciphertext: string;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  location: string
): void {
  const unknownKey = Object.keys(value).find((key) => !allowed.has(key));
  if (unknownKey) {
    throw new Error(`${location} contains an unsupported field: ${unknownKey}.`);
  }
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function decodeBase64Url(value: string, location = "value"): Uint8Array {
  if (
    value.length === 0 ||
    value.length % 4 === 1 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new Error(`${location} must be unpadded base64url.`);
  }
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    value.length + ((4 - (value.length % 4)) % 4),
    "="
  );
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error(`${location} must be unpadded base64url.`);
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (encodeBase64Url(bytes) !== value) {
    throw new Error(`${location} must use canonical unpadded base64url.`);
  }
  return bytes;
}

export function normalizePassphrase(passphrase: string): string {
  const normalized = passphrase.normalize("NFC");
  if ([...normalized].length < MIN_PASSPHRASE_CODE_POINTS) {
    throw new Error(PASSPHRASE_TOO_SHORT_MESSAGE);
  }
  return normalized;
}

export function validateNewBackupPassphrase(
  passphrase: string,
  confirmation: string
): string {
  const normalized = normalizePassphrase(passphrase);
  if (normalized !== confirmation.normalize("NFC")) {
    throw new Error(PASSPHRASES_DO_NOT_MATCH_MESSAGE);
  }
  return normalized;
}

function validateEncodedLength(
  value: string,
  expectedBytes: number,
  location: string
): void {
  const bytes = decodeBase64Url(value, location);
  if (bytes.length !== expectedBytes) {
    throw new Error(`${location} must encode exactly ${expectedBytes} bytes.`);
  }
}

export function validateEncryptedBackupEnvelope(
  value: unknown
): EncryptedBackupEnvelope {
  if (!isPlainRecord(value)) {
    throw new Error("Encrypted backup envelope must be an object.");
  }
  assertAllowedKeys(value, ENVELOPE_KEYS, "Encrypted backup envelope");
  if (value.app !== "markdown-knowledge-board" || value.envelopeVersion !== 1) {
    throw new Error("Unsupported encrypted backup envelope.");
  }
  if (!isPlainRecord(value.crypto)) {
    throw new Error("Encrypted backup crypto header must be an object.");
  }
  assertAllowedKeys(value.crypto, CRYPTO_KEYS, "Encrypted backup crypto header");
  if (
    value.crypto.algorithm !== "AES-GCM" ||
    value.crypto.keyLength !== 256 ||
    value.crypto.kdf !== "PBKDF2-SHA-256" ||
    value.crypto.iterations !== PBKDF2_ITERATIONS_V1
  ) {
    throw new Error("Unsupported encrypted backup crypto parameters.");
  }
  if (typeof value.crypto.salt !== "string") {
    throw new Error("Encrypted backup salt must be a string.");
  }
  if (typeof value.crypto.iv !== "string") {
    throw new Error("Encrypted backup IV must be a string.");
  }
  validateEncodedLength(value.crypto.salt, SALT_BYTES, "Encrypted backup salt");
  validateEncodedLength(value.crypto.iv, IV_BYTES, "Encrypted backup IV");
  if (typeof value.ciphertext !== "string") {
    throw new Error("Encrypted backup ciphertext must be a string.");
  }
  if (
    decodeBase64Url(value.ciphertext, "Encrypted backup ciphertext").length <
    AES_GCM_TAG_BYTES
  ) {
    throw new Error("Encrypted backup ciphertext is shorter than the GCM tag.");
  }

  return {
    app: "markdown-knowledge-board",
    envelopeVersion: 1,
    crypto: {
      algorithm: "AES-GCM",
      keyLength: 256,
      kdf: "PBKDF2-SHA-256",
      iterations: PBKDF2_ITERATIONS_V1,
      salt: value.crypto.salt,
      iv: value.crypto.iv,
    },
    ciphertext: value.ciphertext,
  };
}

export function assertEncryptedBackupSize(byteLength: number): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new Error("Encrypted backup byte length is invalid.");
  }
  if (byteLength > MAX_ENCRYPTED_BACKUP_BYTES) {
    throw new Error(BACKUP_TOO_LARGE_MESSAGE);
  }
}

function orderedEnvelopeJson(envelope: EncryptedBackupEnvelope): string {
  return JSON.stringify({
    app: envelope.app,
    envelopeVersion: envelope.envelopeVersion,
    crypto: {
      algorithm: envelope.crypto.algorithm,
      keyLength: envelope.crypto.keyLength,
      kdf: envelope.crypto.kdf,
      iterations: envelope.crypto.iterations,
      salt: envelope.crypto.salt,
      iv: envelope.crypto.iv,
    },
    ciphertext: envelope.ciphertext,
  });
}

export function serializeEncryptedBackupEnvelope(
  value: unknown
): Uint8Array {
  const envelope = validateEncryptedBackupEnvelope(value);
  const bytes = new TextEncoder().encode(orderedEnvelopeJson(envelope));
  assertEncryptedBackupSize(bytes.byteLength);
  return bytes;
}

export function parseEncryptedBackupEnvelope(
  content: string | Uint8Array
): EncryptedBackupEnvelope {
  const bytes =
    typeof content === "string" ? new TextEncoder().encode(content) : content;
  assertEncryptedBackupSize(bytes.byteLength);

  let text: string;
  try {
    text =
      typeof content === "string"
        ? content
        : new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    throw new Error("Encrypted backup envelope must be valid UTF-8.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Encrypted backup envelope must be valid JSON.");
  }
  return validateEncryptedBackupEnvelope(parsed);
}

type EnvelopeHeader = Omit<EncryptedBackupEnvelope, "ciphertext">;

function createEnvelopeHeader(
  salt: Uint8Array,
  iv: Uint8Array
): EnvelopeHeader {
  return {
    app: "markdown-knowledge-board",
    envelopeVersion: 1,
    crypto: {
      algorithm: "AES-GCM",
      keyLength: 256,
      kdf: "PBKDF2-SHA-256",
      iterations: PBKDF2_ITERATIONS_V1,
      salt: encodeBase64Url(salt),
      iv: encodeBase64Url(iv),
    },
  };
}

export function createEnvelopeAdditionalData(
  envelope: EnvelopeHeader
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      app: envelope.app,
      envelopeVersion: envelope.envelopeVersion,
      crypto: {
        algorithm: envelope.crypto.algorithm,
        keyLength: envelope.crypto.keyLength,
        kdf: envelope.crypto.kdf,
        iterations: envelope.crypto.iterations,
        salt: envelope.crypto.salt,
        iv: envelope.crypto.iv,
      },
    })
  );
}

async function deriveBackupKey(
  normalizedPassphrase: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(normalizedPassphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      iterations: PBKDF2_ITERATIONS_V1,
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

export async function encryptBackupDocument(
  document: BackupDocument,
  passphrase: string
): Promise<EncryptedBackupEnvelope> {
  const validatedDocument = validateBackupDocument(document);
  const normalizedPassphrase = normalizePassphrase(passphrase);
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const header = createEnvelopeHeader(salt, iv);
  const key = await deriveBackupKey(normalizedPassphrase, salt);
  const plaintext = new TextEncoder().encode(
    canonicalStringify(validatedDocument)
  );
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(createEnvelopeAdditionalData(header)),
      tagLength: AES_GCM_TAG_BITS,
    },
    key,
    plaintext
  );
  const envelope: EncryptedBackupEnvelope = {
    ...header,
    ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
  };
  serializeEncryptedBackupEnvelope(envelope);
  return envelope;
}

export async function decryptBackupEnvelope(
  value: unknown,
  passphrase: string
): Promise<BackupDocument> {
  const envelope = validateEncryptedBackupEnvelope(value);
  serializeEncryptedBackupEnvelope(envelope);
  const normalizedPassphrase = normalizePassphrase(passphrase);
  const salt = decodeBase64Url(envelope.crypto.salt);
  const iv = decodeBase64Url(envelope.crypto.iv);
  const ciphertext = decodeBase64Url(envelope.ciphertext);
  const key = await deriveBackupKey(normalizedPassphrase, salt);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(createEnvelopeAdditionalData(envelope)),
        tagLength: AES_GCM_TAG_BITS,
      },
      key,
      toArrayBuffer(ciphertext)
    );
  } catch {
    throw new Error(DECRYPTION_FAILURE_MESSAGE);
  }

  let json: string;
  try {
    json = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
  } catch {
    throw new Error("Decrypted backup must be valid UTF-8.");
  }
  return parseStrictBackupDocument(json);
}
