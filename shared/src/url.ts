// Page identity is a normalized URL: the same content reached with tracking params,
// a www prefix, http, or a trailing slash must map to one read-state record.

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref_src$)/;

export type LinkTarget = { page: string; fragment: string | null };

/** Canonical page URL, or null for anything that is not an http(s) page. */
export function normalizePageUrl(raw: string, base?: string): string | null {
  let url: URL;
  try   { url = new URL(raw, base); }
  catch { return null; }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const params = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    if (!TRACKING_PARAMS.test(key)) params.append(key, value);
  }
  params.sort();

  const host  = url.hostname.toLowerCase().replace(/^www\./, "");
  const path  = url.pathname.replace(/\/+$/, "") || "/";
  const query = params.toString();

  return `https://${host}${path}${query === "" ? "" : `?${query}`}`;
}

/** A link's page identity plus its in-page fragment, so section links can carry section read-state. */
export function splitLinkTarget(raw: string, base?: string): LinkTarget | null {
  const page = normalizePageUrl(raw, base);
  if (page === null) return null;

  const hash     = new URL(raw, base).hash;
  const fragment = hash.length > 1 ? safeDecode(hash.slice(1)) : null;

  return { page, fragment };
}

// The URL parser preserves stray percent signs ("#100%" stays "#100%"), and
// decodeURIComponent throws on them. Third-party pages get to write sloppy anchors
// without crashing us; an undecodable fragment is used as-is.
function safeDecode(fragment: string): string {
  try   { return decodeURIComponent(fragment); }
  catch { return fragment; }
}
