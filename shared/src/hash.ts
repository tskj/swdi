/** Blocks shorter than this carry too little identity to hash (collisions between short stock phrases). */
export const PARAGRAPH_MIN_CHARS = 40;

/** 128-bit prefix of SHA-256 over normalized paragraph text, hex-encoded. */
export async function hashText(normalized: string): Promise<string> {
  const bytes  = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}
