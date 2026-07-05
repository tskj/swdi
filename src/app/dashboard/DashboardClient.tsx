"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
  Registry,
  SyncPayload,
  decryptPayload,
  deriveSyncKeys,
  nowIso,
  registrySchema,
  syncEnvelopeSchema,
} from "@swdi/shared";
import { csR, squircle, superellipse3 } from "@/lib/squircle";
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
const SHARE_KEY  = "swdi:self-share";

const RECENT_LIMIT = 15;

// The one-time funding ask, answered symmetrically and remembered forever
// (docs/VISION.md, Funding). A no or a zero is never asked again.
const selfShareSchema = z.object({
  include:    z.boolean(),
  pct:        z.number(),
  answeredAt: z.string(),
});

type SelfShare = z.infer<typeof selfShareSchema>;

type Stage =
  | { stage: "locked";  error: string | null }
  | { stage: "loading" }
  | { stage: "empty" }
  | { stage: "open";    pages: PageStats[]; registry: Registry | null };

export function DashboardClient() {
  // Lazy initializers touch localStorage, which exists only in the browser; during
  // prerender they fall back to the disconnected defaults, and since the connected
  // views render long after hydration, the difference never reaches the DOM.
  const [stage, setStage]   = useState<Stage>({ stage: "locked", error: null });
  const [secret, setSecret] = useState("");
  const [remember, setRemember] = useState<boolean>(() => typeof window !== "undefined" && localStorage.getItem(SECRET_KEY) !== null);
  const [share, setShare]   = useState<SelfShare | null>(() => (typeof window === "undefined" ? null : loadShare()));

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

    const registry = await fetchRegistry();
    setStage({ stage: "open", pages: payload.pages.map(pageStats), registry });
  }

  function disconnect() {
    localStorage.removeItem(SECRET_KEY);
    setSecret("");
    setRemember(false);
    setStage({ stage: "locked", error: null });
  }

  function answerShare(include: boolean, pct: number) {
    const answered: SelfShare = { include, pct, answeredAt: nowIso() };
    localStorage.setItem(SHARE_KEY, JSON.stringify(answered));
    setShare(answered);
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
          {share === null && <SupportAsk onAnswer={answerShare} />}
          <Recent pages={stage.pages} />
          <Sites pages={stage.pages} />
          {stage.registry !== null && <Authors registry={stage.registry} pages={stage.pages} share={share} onShareChange={answerShare} />}
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
        form, so next time it fills itself in.
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
    </section>
  );
}

// Distinguish "you invented a passphrase" from "this got mangled": the first deserves
// an explanation of why self-chosen phrases cannot work, since the key alone locates
// and unlocks the data, so it must be unguessably random.
function rejectionFor(phrase: string): string {
  const trimmed = phrase.trim();

  if (trimmed === "") return "Paste your sync key first.";

  if (/\s/.test(trimmed) || trimmed.length < 24) {
    return "That looks like a phrase you chose yourself, and those cannot work here. The sync key alone locates and unlocks your data, so it has to be truly random: SWDI generates it for you in the extension popup, under Sync. Copy it from there.";
  }

  return "That does not look like a sync key. Copy it from the extension popup, under Sync, and paste it unchanged.";
}

function Empty(props: { onBack: () => void }) {
  return (
    <section className="mt-10 border border-(--line) bg-(--card) px-7 py-6" style={{ borderRadius: csR(12, 28), ...superellipse3 }}>
      <p>
        Nothing is stored under this sync key yet. Turn sync on in the extension popup,
        read something, and come back.
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
        When monthly budgets arrive, should SWDI include itself in your split? The
        suggested share is 1 percent, and it is what keeps the servers on. Your answer
        is remembered, you can change or remove it at any time, and it will never add
        itself back.
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
  share:    SelfShare | null;
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

function ShareLine(props: { share: SelfShare; onChange: (include: boolean, pct: number) => void }) {
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

function loadShare(): SelfShare | null {
  const raw = localStorage.getItem(SHARE_KEY);
  if (raw === null) return null;

  let json: unknown;
  try   { json = JSON.parse(raw); }
  catch { return null; }

  const parsed = selfShareSchema.safeParse(json);
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
