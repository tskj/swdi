// Re-checks every payment link and site in registry/registry.json so verifiedAt dates
// do not quietly rot. Bot walls (403/429) count as reachable: PayPal and Ko-fi answer
// automated requests with challenges while working fine in a browser. Only hard
// failures (404/410, network errors) are reported as broken. Exit 1 when anything is.

import { readFileSync } from "node:fs";

const registry = JSON.parse(readFileSync(new URL("../registry/registry.json", import.meta.url), "utf8"));

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 swdi-registry-verify";

async function probe(url) {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
    if (res.status === 404 || res.status === 410) return { state: "broken", detail: `HTTP ${res.status}` };
    if (res.status === 403 || res.status === 429) return { state: "blocked", detail: `HTTP ${res.status} (bot wall; verify in a browser)` };
    if (!res.ok && res.status >= 500)             return { state: "broken", detail: `HTTP ${res.status}` };

    return { state: "ok", detail: `HTTP ${res.status}` };
  } catch (err) {
    return { state: "broken", detail: err?.cause?.code ?? err?.name ?? "network error" };
  }
}

// Site identities are canonically https (that is how page urls normalize), but a few
// registry sites only actually serve http; a scheme fallback keeps them from reading
// as dead.
async function probeSite(url) {
  const first = await probe(url);
  if (first.state !== "broken" || !url.startsWith("https://")) return first;

  // Identities strip www and force https (page urls normalize the same way), but the
  // server may only answer as www, or only over http.
  for (const [variant, note] of [
    [url.replace("https://", "http://"), "http only"],
    [url.replace("https://", "https://www."), "www only"],
  ]) {
    const retry = await probe(variant);
    if (retry.state === "ok") return { state: "ok", detail: `${retry.detail} (${note})` };
  }

  return first;
}

let broken = 0;

for (const entry of registry.entries) {
  const checks = [];

  for (const site of entry.sites) checks.push(["site", site, probeSite]);
  for (const method of entry.payment) {
    if (method.kind === "bitcoin") continue; // nothing to probe over HTTP

    checks.push([method.kind, method.url, probe]);
  }

  const results = await Promise.all(checks.map(async ([label, url, prober]) => [label, url, await prober(url)]));

  console.log(`\n${entry.name} (${entry.status})`);
  for (const [label, url, result] of results) {
    const mark = result.state === "ok" ? " ok  " : result.state === "blocked" ? " ??  " : " DEAD";
    console.log(`  ${mark} ${label.padEnd(16)} ${result.detail.padEnd(34)} ${url}`);
    if (result.state === "broken") broken += 1;
  }
}

console.log(broken === 0 ? "\nAll reachable (bot walls excluded)." : `\n${broken} broken link(s); update registry/registry.json.`);
process.exit(broken === 0 ? 0 : 1);
