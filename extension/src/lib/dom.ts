import { PARAGRAPH_MIN_CHARS, hashText, normalizeParagraphText, wordCount } from "@swdi/shared";

export type Paragraph = {
  el:        HTMLElement;
  hash:      string;
  text:      string;
  words:     number;
  sectionId: string | null;
};

// Leaf text blocks only: a blockquote wrapping a <p> must not double-count its text.
const BLOCK_SELECTOR   = "p, blockquote, li, pre";
const HEADING_SELECTOR = "h1[id], h2[id], h3[id], h4[id]";

// Chrome (nav/TOC/comments) is excluded from tracking even when it sits inside the article.
const EXCLUDED_ANCESTOR = "nav, header, footer, aside, [class*='book-contents'], [class*='comment'], #comments";

export function findArticleContainer(doc: Document): HTMLElement | null {
  return doc.querySelector<HTMLElement>("article")
      ?? doc.querySelector<HTMLElement>("main")
      ?? doc.querySelector<HTMLElement>("#content");
}

/** Trackable paragraphs in document order, each tagged with the enclosing heading-anchor section. */
export async function collectParagraphs(container: HTMLElement): Promise<Paragraph[]> {
  const nodes = container.querySelectorAll<HTMLElement>(`${HEADING_SELECTOR}, ${BLOCK_SELECTOR}`);

  const pending: Array<Omit<Paragraph, "hash">> = [];
  let sectionId: string | null = null;

  for (const el of nodes) {
    if (el.matches(HEADING_SELECTOR)) { sectionId = el.id; continue; }

    if (el.querySelector(BLOCK_SELECTOR) !== null) continue;
    if (el.closest(EXCLUDED_ANCESTOR)   !== null) continue;

    const text = normalizeParagraphText(el.textContent ?? "");
    if (text.length < PARAGRAPH_MIN_CHARS) continue;

    pending.push({ el, text, words: wordCount(text), sectionId });
  }

  return Promise.all(pending.map(async (p) => ({ ...p, hash: await hashText(p.text) })));
}
