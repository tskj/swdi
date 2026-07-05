import { z } from "zod";
import { PageRecord, pageRecordSchema } from "./schema";
import { mergeRecords } from "./read-model";

// Accountless end-to-end encrypted sync. One random secret, generated on the first
// device and pasted onto the others, is the only identity in the system. Three values
// derive from it with HKDF-SHA256 under distinct info strings:
//
//   sync id     public; names the blob on the server
//   auth token  bearer write-token; the server stores only its SHA-256 hash
//   enc key     AES-256-GCM; never serialized, never leaves the device
//
// The server holds ciphertext and a token hash. It can withhold service, but it can
// never read, and nothing ties the blob to a person. Losing the secret loses the data;
// that is the honest price of the design, and local data plus JSON export remain.

export const syncPayloadSchema = z.object({
  v: z.literal(1),
  exportedAt: z.string(),
  pages: z.array(pageRecordSchema),
});

export const syncEnvelopeSchema = z.object({
  version: z.number().int().nonnegative(),
  iv:   z.string().max(64),
  data: z.string().max(8_000_000),
});

export const syncPutRequestSchema = z.object({
  expectedVersion: z.number().int().nonnegative(), // 0 registers a fresh sync id
  iv:   z.string().max(64),
  data: z.string().max(8_000_000),
});

export type SyncPayload    = z.infer<typeof syncPayloadSchema>;
export type SyncEnvelope   = z.infer<typeof syncEnvelopeSchema>;
export type SyncPutRequest = z.infer<typeof syncPutRequestSchema>;

export type SyncKeys = {
  syncId:    string;
  authToken: string;
  encKey:    CryptoKey;
};

export function generateSyncSecret(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** Null for anything that is not a plausibly entropic base64url secret. */
export async function deriveSyncKeys(secret: string): Promise<SyncKeys | null> {
  const raw = fromBase64Url(secret.trim());
  if (raw === null || raw.length < 16) return null;

  const master = await crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveBits", "deriveKey"]);

  const idBits    = await crypto.subtle.deriveBits(hkdf("swdi-sync-id-v1"), master, 128);
  const tokenBits = await crypto.subtle.deriveBits(hkdf("swdi-auth-token-v1"), master, 256);
  const encKey    = await crypto.subtle.deriveKey(
    hkdf("swdi-enc-key-v1"),
    master,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  return { syncId: toHex(new Uint8Array(idBits)), authToken: toBase64Url(new Uint8Array(tokenBits)), encKey };
}

export async function encryptPayload(encKey: CryptoKey, payload: SyncPayload): Promise<{ iv: string; data: string }> {
  const iv    = crypto.getRandomValues(new Uint8Array(12));
  const bytes = new TextEncoder().encode(JSON.stringify(payload));

  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, encKey, bytes);
  return { iv: toBase64Url(iv), data: toBase64Url(new Uint8Array(ciphertext)) };
}

/** Null on a wrong key, tampered ciphertext, or a payload that fails the schema. */
export async function decryptPayload(encKey: CryptoKey, iv: string, data: string): Promise<SyncPayload | null> {
  const ivBytes   = fromBase64Url(iv);
  const dataBytes = fromBase64Url(data);
  if (ivBytes === null || dataBytes === null) return null;

  let plaintext: ArrayBuffer;
  try   { plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivBytes }, encKey, dataBytes); }
  catch { return null; }

  let json: unknown;
  try   { json = JSON.parse(new TextDecoder().decode(plaintext)); }
  catch { return null; }

  const parsed = syncPayloadSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/**
 * Union of two page sets, one record per url. When both sides carry a page, the copy
 * with the newer visit contributes the outline and title, and mergeRecords folds the
 * other side's reads and sightings in.
 */
export function mergePages(a: PageRecord[], b: PageRecord[]): PageRecord[] {
  const byUrl = new Map<string, PageRecord>();
  for (const record of a) byUrl.set(record.url, record);

  for (const record of b) {
    const existing = byUrl.get(record.url);
    if (existing === undefined) { byUrl.set(record.url, record); continue; }

    const [base, other] = existing.lastVisitAt >= record.lastVisitAt ? [existing, record] : [record, existing];
    mergeRecords(base, other);
    byUrl.set(base.url, base);
  }

  return [...byUrl.values()];
}

// The secret is already uniform randomness, so a fixed zero salt is fine; the info
// strings are what separate the derived values.
function hkdf(info: string): HkdfParams {
  return { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: new TextEncoder().encode(info) };
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  const base64 = text.replaceAll("-", "+").replaceAll("_", "/");

  let binary: string;
  try   { binary = atob(base64); }
  catch { return null; }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  return bytes;
}
