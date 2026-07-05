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

export type ArticleContainer = { el: HTMLElement; fallback: boolean };

export function findArticleContainer(doc: Document): ArticleContainer | null {
  const semantic = doc.querySelector<HTMLElement>("article")
                ?? doc.querySelector<HTMLElement>("main")
                ?? doc.querySelector<HTMLElement>("#content");
  if (semantic !== null) return { el: semantic, fallback: false };

  return doc.body === null ? null : { el: doc.body, fallback: true };
}

// The extension runs everywhere, so this gate decides what counts as readable content.
// Pages that fail it are silently ignored: apps, dashboards, search results, stores.
// A semantic container earns lower thresholds; a whole-body fallback must look
// unmistakably like an article before we track anything.
const MIN_PARAGRAPHS          = 5;
const MIN_WORDS               = 150;
const MIN_PARAGRAPHS_FALLBACK = 8;
const MIN_WORDS_FALLBACK      = 300;

export function isReadableArticle(paragraphs: Paragraph[], usedFallback: boolean): boolean {
  const words = paragraphs.reduce((sum, p) => sum + p.words, 0);

  if (usedFallback) return paragraphs.length >= MIN_PARAGRAPHS_FALLBACK && words >= MIN_WORDS_FALLBACK;
  return paragraphs.length >= MIN_PARAGRAPHS && words >= MIN_WORDS;
}

/** Trackable paragraphs in document order, each tagged with the enclosing heading-anchor section. */
export async function collectParagraphs(container: HTMLElement): Promise<Paragraph[]> {
  const nodes = container.querySelectorAll<HTMLElement>(`${HEADING_SELECTOR}, ${BLOCK_SELECTOR}`);

  const pending: Array<Omit<Paragraph, "hash">> = [];
  let sectionId: string | null = null;

  for (const el of nodes) {
    if (el.matches(HEADING_SELECTOR)) { sectionId = sanitizeSectionId(el.id); continue; }

    if (el.querySelector(BLOCK_SELECTOR) !== null) continue;
    if (el.closest(EXCLUDED_ANCESTOR)   !== null) continue;

    const text = normalizeParagraphText(el.textContent ?? "");
    if (text.length < PARAGRAPH_MIN_CHARS) continue;

    pending.push({ el, text, words: wordCount(text), sectionId });
  }

  return Promise.all(pending.map(async (p) => ({ ...p, hash: await hashText(p.text) })));
}

// Heading ids are page-controlled and become plain-object keys in records and summaries;
// prototype-chain names would corrupt those lookups.
const FORBIDDEN_SECTION_IDS = new Set(["__proto__", "constructor", "prototype"]);

function sanitizeSectionId(id: string): string | null {
  if (id === "") return null;
  if (FORBIDDEN_SECTION_IDS.has(id)) return null;

  return id;
}
