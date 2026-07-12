"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  DonationDoc,
  DonationPatch,
  Registry,
  SettlementPatch,
  Settlements,
  ShareAnswer,
  SyncKeys,
  SyncPayload,
  applyDonationPatch,
  applySettlementPatch,
  budgetSchema,
  decryptPayload,
  deriveSyncKeys,
  nowIso,
  registrySchema,
  secretStrength,
  shareAnswerSchema,
  syncEnvelopeSchema,
} from "@swdi/shared";
import { fetchDonationDoc, patchDonationDoc, putDonationDoc } from "./donations-client";
import { adoptLegacySettlements, pushSettlementPatch } from "./settlements-client";
import { GITHUB_URL } from "@/lib/links";
import { csR, squircle, superellipse3 } from "@/lib/squircle";
import { BudgetSection } from "./budget-section";
import {
  AuthorMatch,
  PageStats,
  bitcoinAddress,
  bySite,
  formatCount,
  formatDate,
  formatDuration,
  matchAuthors,
  overview,
  pageStats,
  percentRead,
  pluralize,
} from "./derive";

// Everything on this page happens in the browser: the sync key derives the sync id,
// the write token and the decryption key locally, and the server only ever serves
// ciphertext. There is no account and nothing here identifies a person.

const SECRET_KEY = "swdi:sync-secret";

const RECENT_LIMIT = 15;

type Stage =
  | { stage: "locked";  error: string | null }
  | { stage: "loading" }
  | { stage: "empty" }
  | { stage: "open";    keys: SyncKeys; pages: PageStats[]; registry: Registry | null; doc: DonationDoc; settlements: Settlements };

export function DashboardClient() {
  // Lazy initializers touch localStorage, which exists only in the browser; during
  // prerender they fall back to the disconnected defaults, and since the connected
  // views render long after hydration, the difference never reaches the DOM.
  const [stage, setStage]   = useState<Stage>({ stage: "locked", error: null });
  const [secret, setSecret] = useState("");
  const [remember, setRemember] = useState<boolean>(() => typeof window !== "undefined" && localStorage.getItem(SECRET_KEY) !== null);

  useEffect(() => {
    const stored = localStorage.getItem(SECRET_KEY);
    if (stored !== null) void connect(stored, true);
  }, []);

  async function connect(phrase: string, rememberChoice: boolean) {
    setStage({ stage: "loading" });

    const keys = await deriveSyncKeys(phrase);
    if (keys === null) {
      setStage({ stage: "locked", error: rejectionFor(phrase) });
      return;
    }

    let response: Response;
    try {
      response = await fetch(`/api/sync/${keys.syncId}`, { headers: { authorization: `Bearer ${keys.authToken}` } });
    } catch {
      setStage({ stage: "locked", error: "The sync store could not be reached. Try again in a moment." });
      return;
    }

    if (response.status === 404) { setStage({ stage: "empty" }); return; }
    if (!response.ok) {
      setStage({ stage: "locked", error: `The sync store answered ${response.status}.` });
      return;
    }

    const envelope = syncEnvelopeSchema.safeParse(await response.json().catch(() => null));
    const payload: SyncPayload | null = envelope.success
      ? await decryptPayload(keys.encKey, envelope.data.iv, envelope.data.data)
      : null;

    if (payload === null) {
      setStage({ stage: "locked", error: "This key does not open the stored data. Check that it is the one from the same extension that synced." });
      return;
    }

    if (rememberChoice) localStorage.setItem(SECRET_KEY, phrase);

    const [registry, fetched] = await Promise.all([fetchRegistry(), fetchDonationDoc(keys)]);
    const doc         = await adoptLegacyLocalConfig(keys, fetched);
    const settlements = await adoptServerSettlements(keys, doc, payload.settlements);
    setStage({ stage: "open", keys, pages: payload.pages.map(pageStats), registry, doc: { v: 1, budget: doc.budget, share: doc.share }, settlements });
  }

  function disconnect() {
    localStorage.removeItem(SECRET_KEY);
    setSecret("");
    setRemember(false);
    setStage({ stage: "locked", error: null });
  }

  // Edits are ops: applied optimistically here with the same function the server
  // runs, then reconciled with the doc the server answers, which folds in whatever
  // another open session changed meanwhile.
  function sendPatch(patch: DonationPatch) {
    if (stage.stage !== "open") return;

    setStage({ ...stage, doc: applyDonationPatch(stage.doc, patch) });
    void patchDonationDoc(stage.keys, patch).then((serverDoc) => {
      if (serverDoc === null) return;

      setStage((current) => (current.stage === "open" ? { ...current, doc: serverDoc } : current));
    });
  }

  // Settlement ops go into the encrypted blob instead (whom you paid is reading
  // data). Same optimistic shape; the sequence guard drops a reconcile that lands
  // after a newer edit was already applied here, so a slow push cannot regress it.
  const settleSeq = useRef(0);

  function sendSettlementPatch(patch: SettlementPatch) {
    if (stage.stage !== "open") return;

    const seq = ++settleSeq.current;
    setStage({ ...stage, settlements: applySettlementPatch(stage.settlements, patch) });
    void pushSettlementPatch(stage.keys, patch).then((settlements) => {
      if (settlements === null || seq !== settleSeq.current) return;

      setStage((current) => (current.stage === "open" ? { ...current, settlements } : current));
    });
  }

  function answerShare(include: boolean, pct: number) {
    sendPatch({ op: "set-share", share: { include, pct, answeredAt: nowIso() } });
  }

  return (
    <main className="mx-auto max-w-2xl px-6 pt-20 pb-16 text-[16px] leading-relaxed">
      <p className="font-sans text-[13px] tracking-[0.25em] uppercase text-(--ink-soft)">SWDI</p>
      <h1 className="font-display mt-3 text-[34px] leading-tight font-medium">Your reading</h1>
      <p className="mt-3 text-(--ink-soft)">
        Decrypted in your browser with your sync key. The server only ever sees ciphertext.
      </p>

      {stage.stage === "locked"  && <Connect error={stage.error} secret={secret} setSecret={setSecret} remember={remember} setRemember={setRemember} onConnect={() => void connect(secret, remember)} />}
      {stage.stage === "loading" && <p className="mt-10 text-(--ink-soft)">Opening your reading...</p>}
      {stage.stage === "empty"   && <Empty onBack={disconnect} />}

      {stage.stage === "open" && (
        <>
          <Tiles pages={stage.pages} />
          {stage.doc.share === null && <SupportAsk onAnswer={answerShare} />}
          {stage.registry !== null && (
            <BudgetSection pages={stage.pages} registry={stage.registry} doc={stage.doc} settlements={stage.settlements} onPatch={sendPatch} onSettlementPatch={sendSettlementPatch} />
          )}
          {stage.registry === null && (
            <p className="mt-10 font-sans text-[14px] text-(--ink-soft)">
              The author registry could not be loaded, so monthly support and the people
              behind your reading are hidden for now. Your reading above is unaffected;
              reload the page to try again.
            </p>
          )}
          <Recent pages={stage.pages} />
          <Sites pages={stage.pages} />
          {stage.registry !== null && <Authors registry={stage.registry} pages={stage.pages} share={stage.doc.share} onShareChange={answerShare} />}
          <footer className="mt-14 flex gap-6 border-t border-(--line) pt-5 font-sans text-[13px] text-(--ink-soft)">
            <button className="underline underline-offset-4 hover:text-(--ink)" onClick={disconnect}>
              Disconnect
            </button>
            <Link className="underline underline-offset-4 hover:text-(--ink)" href="/">Front page</Link>
          </footer>
        </>
      )}
    </main>
  );
}

function Connect(props: {
  error:    string | null;
  secret:   string;
  setSecret: (v: string) => void;
  remember: boolean;
  setRemember: (v: boolean) => void;
  onConnect: () => void;
}) {
  return (
    <section className="mt-10 border border-(--line) bg-(--card) px-7 py-6" style={{ borderRadius: csR(12, 28), ...superellipse3 }}>
      <p>
        Your sync key is generated in the extension popup, under Sync. Paste it here and
        your reading opens on this device too. Password managers can save it from this
        form, so next time it fills itself in. If you prefer your manager to be the
        source of randomness, generate a long password there (with symbols) and use it
        as the key on every device instead.
      </p>

      {/* A real login form, so Bitwarden, Proton Pass and friends offer to save the key
          and autofill it on the next visit. The username names the entry in the vault. */}
      <form
        className="mt-5 flex gap-2"
        onSubmit={(e) => { e.preventDefault(); props.onConnect(); }}
      >
        <input className="sr-only" type="text" name="username" autoComplete="username" value="sync key" readOnly tabIndex={-1} aria-hidden="true" />
        <input
          className="min-w-0 flex-1 border border-(--line) bg-transparent px-3 py-2 font-mono text-[13px]"
          style={{ borderRadius: csR(8, 16), ...squircle }}
          type="password"
          name="password"
          value={props.secret}
          onChange={(e) => props.setSecret(e.target.value)}
          placeholder="Paste your sync key"
          spellCheck={false}
          autoComplete="current-password"
        />
        <button
          className="border border-(--line) bg-(--ink) px-4 py-2 font-sans text-[14px] text-(--paper)"
          style={{ borderRadius: csR(8, 16), ...squircle }}
          type="submit"
        >
          Open
        </button>
      </form>

      <label className="mt-4 flex cursor-pointer items-center gap-2 font-sans text-[13px] text-(--ink-soft)">
        <input type="checkbox" checked={props.remember} onChange={(e) => props.setRemember(e.target.checked)} />
        Remember on this device
      </label>

      {props.error !== null && <p className="mt-4 text-[14px] text-(--amber)">{props.error}</p>}

      <p className="mt-5 border-t border-(--line) pt-4 font-sans text-[13px] text-(--ink-soft)">
        No extension yet? The{" "}
        <Link className="underline underline-offset-4 hover:text-(--ink)" href="/">front page</Link>
        {" "}explains what SWDI is, and{" "}
        <a className="underline underline-offset-4 hover:text-(--ink)" href={`${GITHUB_URL}#readme`}>the readme</a>
        {" "}has the install steps.
      </p>
    </section>
  );
}

// The gate's reasons, explained: the key alone locates and unlocks the data, and a
// guess is verifiable against the server, so memorable phrases cannot be accepted.
function rejectionFor(phrase: string): string {
  const trimmed = phrase.trim();
  if (trimmed === "") return "Paste your sync key first.";

  const strength = secretStrength(trimmed);
  if (strength.kind !== "weak") return "That key was not accepted. Copy it again and paste it unchanged.";

  const because = {
    "too-short":     "it is too short",
    "has-spaces":    "it looks like a word phrase, and phrases are guessable",
    "too-uniform":   "it needs symbols, not just letters and digits",
    "too-guessable": "it is too guessable",
  }[strength.reason];

  return `That key cannot protect your reading: ${because}. Use the key the extension generates (popup, under Sync), or generate a long password with symbols in your password manager and use that as your key everywhere.`;
}

function Empty(props: { onBack: () => void }) {
  return (
    <section className="mt-10 border border-(--line) bg-(--card) px-7 py-6" style={{ borderRadius: csR(12, 28), ...superellipse3 }}>
      <p>
        Nothing is stored under this sync key yet. If it is a fresh key, paste it into
        the extension popup (Sync, then &quot;I already have a key&quot;), read something,
        and come back; your reading will appear here.
      </p>
      <p className="mt-3">
        If you expected your reading to be here, the key is probably mistyped. A wrong
        key opens its own empty store, with no error to catch it, so copy the key again
        from the extension popup and retry.
      </p>
      <button className="mt-4 font-sans text-[13px] text-(--ink-soft) underline underline-offset-4" onClick={props.onBack}>
        Try another key
      </button>
    </section>
  );
}

function Tiles(props: { pages: PageStats[] }) {
  const totals = overview(props.pages);

  const tiles = [
    { label: "pages visited",   value: formatCount(totals.visited) },
    { label: "pages finished",  value: formatCount(totals.finished) },
    { label: "paragraphs read", value: formatCount(totals.paragraphsRead) },
    { label: "time reading",    value: formatDuration(totals.dwellMs) },
  ];

  return (
    <section className="mt-10 grid grid-cols-2 gap-3 md:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="border border-(--line) bg-(--card) px-4 py-3" style={{ borderRadius: csR(9, 23), ...superellipse3 }}>
          <p className="font-display text-[26px] leading-none font-medium">{tile.value}</p>
          <p className="mt-2 font-sans text-[12px] tracking-wide text-(--ink-soft)">{tile.label}</p>
        </div>
      ))}
    </section>
  );
}

function SupportAsk(props: { onAnswer: (include: boolean, pct: number) => void }) {
  return (
    <section className="mt-8 border border-(--line) bg-(--card) px-7 py-6" style={{ borderRadius: csR(12, 28), ...superellipse3 }}>
      <h2 className="font-display text-[20px] font-medium">One question, asked once</h2>
      <p className="mt-3 text-[15px]">
        Should SWDI include itself in your monthly split? The suggested share is 1
        percent, and it is what keeps the servers on. Your answer is remembered, you
        can change or remove it at any time, and it will never add itself back.
      </p>
      <div className="mt-5 flex gap-3">
        <button
          className="flex-1 border border-(--line) bg-transparent px-4 py-2 font-sans text-[14px]"
          style={{ borderRadius: csR(8, 16), ...squircle }}
          onClick={() => props.onAnswer(true, 1)}
        >
          Include SWDI at 1%
        </button>
        <button
          className="flex-1 border border-(--line) bg-transparent px-4 py-2 font-sans text-[14px]"
          style={{ borderRadius: csR(8, 16), ...squircle }}
          onClick={() => props.onAnswer(false, 0)}
        >
          No, and don&apos;t ask again
        </button>
      </div>
    </section>
  );
}

function Recent(props: { pages: PageStats[] }) {
  const read = props.pages
    .filter((page) => page.record.lastReadAt !== null)
    .sort((a, b) => (b.record.lastReadAt ?? "").localeCompare(a.record.lastReadAt ?? ""));

  if (read.length === 0) return null;

  const shown = read.slice(0, RECENT_LIMIT);

  return (
    <section className="mt-12">
      <h2 className="font-display text-[24px] font-medium">Recently read</h2>
      <ul className="mt-5 space-y-4">
        {shown.map((page) => (
          <li key={page.record.url} className="marker pl-5">
            <div className="flex items-baseline justify-between gap-4">
              <a className="min-w-0 truncate underline decoration-(--line) underline-offset-4 hover:decoration-(--ink-soft)" href={page.record.url}>
                {page.record.title || page.record.url}
              </a>
              <span className="shrink-0 font-sans text-[12px] text-(--ink-soft)">
                {page.record.lastReadAt !== null ? formatDate(page.record.lastReadAt) : ""}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <Bar pct={percentRead(page.summary)} />
              <span className="shrink-0 font-sans text-[12px] text-(--ink-soft)">
                {percentRead(page.summary)}% of {page.host}
              </span>
            </div>
          </li>
        ))}
      </ul>
      {read.length > shown.length && (
        <p className="mt-4 font-sans text-[13px] text-(--ink-soft)">and {pluralize(read.length - shown.length, "more page")}.</p>
      )}
    </section>
  );
}

function Sites(props: { pages: PageStats[] }) {
  const sites = bySite(props.pages).filter((site) => site.paragraphsRead > 0);
  if (sites.length === 0) return null;

  return (
    <section className="mt-12">
      <h2 className="font-display text-[24px] font-medium">Reading by site</h2>
      <ul className="mt-5 space-y-2 font-sans text-[14px]">
        {sites.map((site) => (
          <li key={site.host} className="flex items-baseline justify-between gap-4 border-b border-(--line) pb-2">
            <span className="min-w-0 truncate">{site.host}</span>
            <span className="shrink-0 text-(--ink-soft)">
              {pluralize(site.pages, "page")} · {formatCount(site.paragraphsRead)} paragraphs · {formatDuration(site.dwellMs)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const PAYMENT_LABELS: Record<string, string> = {
  paypal:            "PayPal",
  buymeacoffee:      "Buy Me a Coffee",
  kofi:              "Ko-fi",
  patreon:           "Patreon",
  stripe:            "Donate",
  "github-sponsors": "GitHub Sponsors",
  liberapay:         "Liberapay",
};

function Authors(props: {
  registry: Registry;
  pages:    PageStats[];
  share:    ShareAnswer | null;
  onShareChange: (include: boolean, pct: number) => void;
}) {
  const matches = matchAuthors(props.registry, props.pages);
  if (matches.length === 0 && props.share === null) return null;

  return (
    <section className="mt-12">
      <h2 className="font-display text-[24px] font-medium">The people behind it</h2>
      <p className="mt-2 text-[15px] text-(--ink-soft)">
        These authors are in the registry, and you have been reading them. This is the
        donation flow taking shape; for now, every link below goes straight to them.
      </p>

      <ul className="mt-5 space-y-5">
        {matches.map((match) => <Author key={match.entry.name} match={match} />)}
      </ul>

      {props.share !== null && <ShareLine share={props.share} onChange={props.onShareChange} />}
    </section>
  );
}

function Author(props: { match: AuthorMatch }) {
  const { entry, paragraphsRead } = props.match;

  return (
    <li className="border border-(--line) bg-(--card) px-5 py-4" style={{ borderRadius: csR(10, 25), ...superellipse3 }}>
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-medium">{entry.name}</span>
        <span className="shrink-0 font-sans text-[12px] text-(--ink-soft)">{formatCount(paragraphsRead)} paragraphs read</span>
      </div>

      {entry.payment.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {entry.payment.map((method) =>
            method.kind === "bitcoin"
              ? <BitcoinChip key={method.url} address={bitcoinAddress(method.url)} />
              : (
                <a
                  key={method.url}
                  className="border border-(--line) px-3 py-1 font-sans text-[13px] hover:bg-(--paper)"
                  style={{ borderRadius: csR(999, 999), ...squircle }}
                  href={method.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {PAYMENT_LABELS[method.kind] ?? method.url}
                </a>
              ),
          )}
        </div>
      )}
    </li>
  );
}

function BitcoinChip(props: { address: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      className="border border-(--line) px-3 py-1 font-sans text-[13px] hover:bg-(--paper)"
      style={{ borderRadius: csR(999, 999), ...squircle }}
      onClick={() => { void navigator.clipboard.writeText(props.address); setCopied(true); }}
    >
      {copied ? "Address copied" : "Bitcoin"}
    </button>
  );
}

function ShareLine(props: { share: ShareAnswer; onChange: (include: boolean, pct: number) => void }) {
  const { share } = props;

  return (
    <p className="mt-5 font-sans text-[13px] text-(--ink-soft)">
      {share.include
        ? <>SWDI is part of your future split at {share.pct}%. </>
        : <>SWDI is not part of your split, and will not ask again. </>}
      {share.include
        ? <button className="underline underline-offset-4" onClick={() => props.onChange(false, 0)}>Remove it</button>
        : <button className="underline underline-offset-4" onClick={() => props.onChange(true, 1)}>Include it at 1%</button>}
    </p>
  );
}

function Bar(props: { pct: number }) {
  return (
    <div className="h-[6px] flex-1 overflow-hidden rounded-[3px] bg-(--line)">
      <div className="h-full rounded-[3px] bg-(--green)" style={{ width: `${props.pct}%` }} />
    </div>
  );
}


/**
 * The budget and the ask answer used to live in localStorage; adopt them into the
 * server-side doc once, then clear them so this device stops shadowing the server.
 */
async function adoptLegacyLocalConfig(keys: SyncKeys, doc: DonationDoc): Promise<DonationDoc> {
  const legacyShare  = readLegacy("swdi:self-share", shareAnswerSchema);
  const legacyBudget = readLegacy("swdi:budget", budgetSchema);
  if (legacyShare === null && legacyBudget === null) return doc;

  const adopted = {
    ...doc,
    share:  doc.share  ?? legacyShare,
    budget: doc.budget ?? legacyBudget,
  };

  if (await putDonationDoc(keys, adopted)) {
    localStorage.removeItem("swdi:self-share");
    localStorage.removeItem("swdi:budget");
    localStorage.removeItem("swdi:settlements");
  }

  return adopted;
}

/**
 * Settlements used to live in the plaintext donation doc; fold any the doc still
 * carries into the encrypted payload once, then rewrite the doc without them so the
 * plaintext copy leaves the server. If the blob write fails, the doc keeps them for
 * the next connect to retry, and the merged view is shown either way.
 */
async function adoptServerSettlements(keys: SyncKeys, doc: DonationDoc, fromBlob: Settlements): Promise<Settlements> {
  const legacy = doc.settlements;
  if (legacy === undefined || Object.keys(legacy).length === 0) return fromBlob;

  const adopted = await adoptLegacySettlements(keys, legacy);
  if (adopted === null) return { ...legacy, ...fromBlob };

  await putDonationDoc(keys, { v: 1, budget: doc.budget, share: doc.share });
  return adopted;
}

function readLegacy<T>(key: string, schema: z.ZodType<T>): T | null {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;

  let json: unknown;
  try   { json = JSON.parse(raw); }
  catch { return null; }

  const parsed = schema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

async function fetchRegistry(): Promise<Registry | null> {
  try {
    const response = await fetch("/api/registry");
    if (!response.ok) return null;

    const parsed = registrySchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
