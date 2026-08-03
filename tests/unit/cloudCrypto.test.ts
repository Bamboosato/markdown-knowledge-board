import { beforeAll, describe, expect, it } from "vitest";

import { createBackupDocument } from "../../src/lib/backup";
import { canonicalStringify } from "../../src/lib/canonicalJson";
import {
  assertEncryptedBackupSize,
  BACKUP_TOO_LARGE_MESSAGE,
  createEnvelopeAdditionalData,
  decodeBase64Url,
  DECRYPTION_FAILURE_MESSAGE,
  decryptBackupEnvelope,
  encodeBase64Url,
  encryptBackupDocument,
  type EncryptedBackupEnvelope,
  MAX_ENCRYPTED_BACKUP_BYTES,
  normalizePassphrase,
  parseEncryptedBackupEnvelope,
  PASSPHRASES_DO_NOT_MATCH_MESSAGE,
  PASSPHRASE_TOO_SHORT_MESSAGE,
  PBKDF2_ITERATIONS_V1,
  serializeEncryptedBackupEnvelope,
  validateEncryptedBackupEnvelope,
  validateNewBackupPassphrase,
} from "../../src/lib/cloudCrypto";
import type { Note } from "../../src/lib/types";

const PASSPHRASE = "phase2-backup-passphrase-🔐";
const WRONG_PASSPHRASE = "phase2-wrong-passphrase-🔐";

const FIXED_VECTOR: EncryptedBackupEnvelope = {
  app: "markdown-knowledge-board",
  envelopeVersion: 1,
  crypto: {
    algorithm: "AES-GCM",
    keyLength: 256,
    kdf: "PBKDF2-SHA-256",
    iterations: 600_000,
    salt: "AAECAwQFBgcICQoLDA0ODw",
    iv: "EBESExQVFhcYGRob",
  },
  ciphertext:
    "WcJkEWWjT6c5csVlQrIbpzXnbojyCdFXGJ6xAGZa8q8rT3-ktOazTmKP7T7YwEDKX4WKWy6Ex2FWrGDy6rV1--OY33c9XemQuHiZ6ZpbjDoLDT_NfbntO-xwMG91oy72fxIR_b4tmWztY2gcu0trn41Gu8U1UOyDEksgoAWF",
};

const EMPTY_BACKUP = {
  app: "markdown-knowledge-board" as const,
  version: 1 as const,
  createdAt: "2026-08-03T00:00:00.000Z",
  noteCount: 0,
  notes: [],
};

function createCompleteBackup() {
  const note: Note = {
    id: "note-1",
    title: "Encrypted note",
    body: "# Encrypted note\n\n本文 👋",
    tags: ["Phase 2", "暗号"],
    updatedAt: 1_700_000_000_000,
    pinnedAt: 1_700_000_000_100,
    marp: {
      enabled: true,
      theme: "gaia",
      size: "4:3",
      paginate: false,
      headingDivider: 2,
    },
    customMetadata: [
      { key: "owner", value: "開発" },
      { key: "review", value: { approved: true, scores: [1, 2, 3] } },
    ],
  };
  return createBackupDocument([note], "2026-08-03T00:00:00.000Z");
}

function mutateByte(value: string): string {
  const bytes = decodeBase64Url(value);
  bytes[0] ^= 1;
  return encodeBase64Url(bytes);
}

describe("canonical JSON and passphrase rules", () => {
  it("sorts object keys recursively while preserving array order", () => {
    expect(
      canonicalStringify({ z: 1, a: { beta: 2, alpha: 1 }, list: [2, 1] })
    ).toBe('{"a":{"alpha":1,"beta":2},"list":[2,1],"z":1}');
  });

  it("rejects 11 code points and accepts exactly 12", () => {
    expect(() => normalizePassphrase("1234567890🔐")).toThrow(
      PASSPHRASE_TOO_SHORT_MESSAGE
    );
    expect(normalizePassphrase("12345678901🔐")).toBe("12345678901🔐");
  });

  it("normalizes canonically equivalent Unicode before confirmation", () => {
    expect(
      validateNewBackupPassphrase("12345678901e\u0301", "12345678901é")
    ).toBe("12345678901é");
  });

  it("does not trim leading or trailing passphrase spaces", () => {
    expect(normalizePassphrase(" 1234567890 ")).toBe(" 1234567890 ");
  });

  it("rejects a confirmation that differs after NFC normalization", () => {
    expect(() =>
      validateNewBackupPassphrase(PASSPHRASE, `${PASSPHRASE}!`)
    ).toThrow(PASSPHRASES_DO_NOT_MATCH_MESSAGE);
  });
});

describe("encrypted backup envelope validation", () => {
  it("accepts the version 1 fixed vector and authenticates its exact AAD", () => {
    expect(validateEncryptedBackupEnvelope(FIXED_VECTOR)).toEqual(FIXED_VECTOR);
    expect(new TextDecoder().decode(createEnvelopeAdditionalData(FIXED_VECTOR))).toBe(
      '{"app":"markdown-knowledge-board","envelopeVersion":1,"crypto":{"algorithm":"AES-GCM","keyLength":256,"kdf":"PBKDF2-SHA-256","iterations":600000,"salt":"AAECAwQFBgcICQoLDA0ODw","iv":"EBESExQVFhcYGRob"}}'
    );
  });

  it("serializes and parses the strict envelope without padding base64url", () => {
    const bytes = serializeEncryptedBackupEnvelope(FIXED_VECTOR);

    expect(parseEncryptedBackupEnvelope(bytes)).toEqual(FIXED_VECTOR);
    expect(new TextDecoder().decode(bytes)).not.toContain("=");
  });

  it.each([
    ["unknown root field", (value: Record<string, unknown>) => (value.extra = true)],
    [
      "unsupported version",
      (value: Record<string, unknown>) => (value.envelopeVersion = 2),
    ],
    [
      "unknown crypto field",
      (value: Record<string, unknown>) =>
        ((value.crypto as Record<string, unknown>).extra = true),
    ],
    [
      "unsupported iteration count",
      (value: Record<string, unknown>) =>
        ((value.crypto as Record<string, unknown>).iterations = 599_999),
    ],
    [
      "padded base64 salt",
      (value: Record<string, unknown>) =>
        ((value.crypto as Record<string, unknown>).salt = "AAECAw=="),
    ],
  ])("rejects %s before key derivation", (_label, mutate) => {
    const value = structuredClone(FIXED_VECTOR) as unknown as Record<
      string,
      unknown
    >;
    mutate(value);

    expect(() => validateEncryptedBackupEnvelope(value)).toThrow();
  });

  it("rejects salt, IV, and ciphertext byte-length violations", () => {
    const shortSalt = structuredClone(FIXED_VECTOR);
    shortSalt.crypto.salt = encodeBase64Url(new Uint8Array(15));
    const shortIv = structuredClone(FIXED_VECTOR);
    shortIv.crypto.iv = encodeBase64Url(new Uint8Array(11));
    const shortCiphertext = structuredClone(FIXED_VECTOR);
    shortCiphertext.ciphertext = encodeBase64Url(new Uint8Array(15));

    expect(() => validateEncryptedBackupEnvelope(shortSalt)).toThrow("16 bytes");
    expect(() => validateEncryptedBackupEnvelope(shortIv)).toThrow("12 bytes");
    expect(() => validateEncryptedBackupEnvelope(shortCiphertext)).toThrow(
      "shorter than the GCM tag"
    );
  });

  it("accepts 4,500,000 bytes and rejects 4,500,001 bytes", () => {
    expect(() => assertEncryptedBackupSize(MAX_ENCRYPTED_BACKUP_BYTES)).not.toThrow();
    expect(() =>
      assertEncryptedBackupSize(MAX_ENCRYPTED_BACKUP_BYTES + 1)
    ).toThrow(BACKUP_TOO_LARGE_MESSAGE);
  });

  it("rejects invalid UTF-8 and malformed JSON before envelope validation", () => {
    expect(() => parseEncryptedBackupEnvelope(new Uint8Array([0xff]))).toThrow(
      "valid UTF-8"
    );
    expect(() => parseEncryptedBackupEnvelope("{broken")).toThrow("valid JSON");
  });
});

describe("AES-256-GCM backup encryption", () => {
  let encrypted: EncryptedBackupEnvelope;

  beforeAll(async () => {
    encrypted = await encryptBackupDocument(createCompleteBackup(), PASSPHRASE);
  });

  it("decrypts an independently generated PBKDF2/AES-GCM fixed vector", async () => {
    await expect(
      decryptBackupEnvelope(FIXED_VECTOR, "phase2-fixed-passphrase")
    ).resolves.toEqual(EMPTY_BACKUP);
  });

  it("roundtrips pinned, Marp, metadata, and Unicode backup data", async () => {
    await expect(decryptBackupEnvelope(encrypted, PASSPHRASE)).resolves.toEqual(
      createCompleteBackup()
    );
  });

  it("stores only ciphertext and supported non-secret crypto parameters", () => {
    const serialized = new TextDecoder().decode(
      serializeEncryptedBackupEnvelope(encrypted)
    );

    expect(encrypted.crypto).toMatchObject({
      algorithm: "AES-GCM",
      keyLength: 256,
      kdf: "PBKDF2-SHA-256",
      iterations: PBKDF2_ITERATIONS_V1,
    });
    expect(decodeBase64Url(encrypted.crypto.salt)).toHaveLength(16);
    expect(decodeBase64Url(encrypted.crypto.iv)).toHaveLength(12);
    expect(serialized).not.toContain("Encrypted note");
    expect(serialized).not.toContain("本文");
    expect(serialized).not.toContain(PASSPHRASE);
  });

  it("generates a new salt, IV, and ciphertext for each backup operation", async () => {
    const second = await encryptBackupDocument(createCompleteBackup(), PASSPHRASE);

    expect(second.crypto.salt).not.toBe(encrypted.crypto.salt);
    expect(second.crypto.iv).not.toBe(encrypted.crypto.iv);
    expect(second.ciphertext).not.toBe(encrypted.ciphertext);
  });

  it("uses the same safe error for a wrong passphrase and ciphertext tampering", async () => {
    const tampered = structuredClone(encrypted);
    tampered.ciphertext = mutateByte(tampered.ciphertext);

    await expect(
      decryptBackupEnvelope(encrypted, WRONG_PASSPHRASE)
    ).rejects.toThrow(DECRYPTION_FAILURE_MESSAGE);
    await expect(decryptBackupEnvelope(tampered, PASSPHRASE)).rejects.toThrow(
      DECRYPTION_FAILURE_MESSAGE
    );
  });

  it("fails authentication when a valid-length salt header is changed", async () => {
    const tampered = structuredClone(encrypted);
    tampered.crypto.salt = mutateByte(tampered.crypto.salt);

    await expect(decryptBackupEnvelope(tampered, PASSPHRASE)).rejects.toThrow(
      DECRYPTION_FAILURE_MESSAGE
    );
  });
});
