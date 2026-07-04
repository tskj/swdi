/** Whitespace-collapsed, NFC-normalized rendered text; the identity input for paragraph hashing. */
export function normalizeParagraphText(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

export function wordCount(text: string): number {
  const normalized = normalizeParagraphText(text);
  if (normalized === "") return 0;

  return normalized.split(" ").length;
}
