"use client";

import { useState } from "react";
import {
  Budget,
  DonationDoc,
  DonationPatch,
  Registry,
  RegistryEntry,
  SWDI_ALLOCATION_KEY,
  Settlement,
  SettlementLine,
  SettlementPatch,
  Settlements,
  nowIso,
  proposalWithShare,
} from "@swdi/shared";
import { csR, squircle, superellipse3 } from "@/lib/squircle";
import { AuthorEngagement, PageStats, authorEngagement, currentMonth, formatDuration, formatMonth, pluralize } from "./derive";

// The donation loop: one monthly amount, split in proportion to your reading,
// reviewed and adjusted by you, then paid down as a one-click-per-author list. SWDI
// never touches the money; each Pay button opens the author's own channel (with the
// amount prefilled where the provider supports it) and ticks the line off for you.
// Budget and the ask answer live in the plaintext donation doc server-side;
// settlements name the authors you read, so they travel inside the encrypted blob
// with the reading they derive from.

export function BudgetSection(props: {
  pages:       PageStats[];
  registry:    Registry;
  doc:         DonationDoc;
  settlements: Settlements;
  onPatch:            (patch: DonationPatch) => void;
  onSettlementPatch:  (patch: SettlementPatch) => void;
}) {
  const [overrides, setOverrides] = useState<Record<string, number>>({});

  const month   = currentMonth();
  const monthly = authorEngagement(props.registry, props.pages, month);
  const engaged = monthly.length > 0 ? monthly : authorEngagement(props.registry, props.pages, null);
  const settled = props.settlements[month];
  const budget  = props.doc.budget;

  // Every settled month except the current one stays on the page, newest first:
  // unpaid lines keep their Pay buttons across the rollover, finished months shrink
  // to a history line. Nothing settled ever silently disappears.
  const past = Object.values(props.settlements)
    .filter((settlement) => settlement.month !== month)
    .sort((a, b) => b.month.localeCompare(a.month));

  function saveBudget(next: Budget | null) {
    setOverrides({});
    props.onPatch({ op: "set-budget", budget: next });
  }

  function settle(lines: SettlementLine[]) {
    if (budget === null) return;

    props.onSettlementPatch({ op: "settle", settlement: { month, settledAt: nowIso(), currency: budget.currency, lines } });
  }

  function unsettle(target: string) {
    props.onSettlementPatch({ op: "unsettle", month: target });
  }

  function markPaid(target: string, key: string, paid: boolean) {
    props.onSettlementPatch({ op: "set-paid", month: target, key, paid });
  }

  return (
    <section className="mt-12">
      <h2 className="font-display text-[24px] font-medium">Monthly support</h2>

      {budget === null && <BudgetSetup onSave={saveBudget} />}

      {budget !== null && settled === undefined && (
        <Proposal
          budget={budget}
          engaged={engaged}
          usingAllTime={monthly.length === 0 && engaged.length > 0}
          sharePct={props.doc.share !== null && props.doc.share.include ? props.doc.share.pct : null}
          overrides={overrides}
          setOverride={(key, minor) => setOverrides({ ...overrides, [key]: minor })}
          onClearBudget={() => saveBudget(null)}
          onSettle={settle}
        />
      )}

      {settled !== undefined && (
        <PayList
          settlement={settled}
          registry={props.registry}
          currency={settled.currency ?? budget?.currency ?? "kr"}
          onPaid={(key, paid) => markPaid(month, key, paid)}
          onReopen={() => unsettle(month)}
        />
      )}

      {past.map((settlement) => {
        const currency = settlement.currency ?? budget?.currency ?? "kr";
        return settlement.lines.some((line) => !line.paid)
          ? (
            <OutstandingMonth
              key={settlement.month}
              settlement={settlement}
              registry={props.registry}
              currency={currency}
              onPaid={(key, paid) => markPaid(settlement.month, key, paid)}
              onForget={() => unsettle(settlement.month)}
            />
          )
          : <FinishedMonth key={settlement.month} settlement={settlement} currency={currency} />;
      })}
    </section>
  );
}

function BudgetSetup(props: { onSave: (budget: Budget) => void }) {
  const [amount, setAmount]     = useState("");
  const [currency, setCurrency] = useState("kr");

  const parsed = Number.parseInt(amount, 10);
  const valid  = Number.isFinite(parsed) && parsed > 0;

  return (
    <div className="mt-4 border border-(--line) bg-(--card) px-6 py-5" style={{ borderRadius: csR(12, 28), ...superellipse3 }}>
      <p className="text-[15px]">
        Choose one monthly amount you are comfortable giving. Your reading proposes how
        to divide it; you confirm, and payments go directly from you to each author.
      </p>
      <div className="mt-4 flex items-center gap-2 font-sans text-[14px]">
        <input
          className="w-28 border border-(--line) bg-transparent px-3 py-2"
          style={{ borderRadius: csR(8, 16), ...squircle }}
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="200"
        />
        <select
          className="border border-(--line) bg-transparent px-2 py-2"
          style={{ borderRadius: csR(8, 16), ...squircle }}
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
        >
          {["kr", "$", "€", "£"].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="text-(--ink-soft)">a month</span>
        <button
          className="ml-auto border border-(--line) bg-(--ink) px-4 py-2 text-(--paper) disabled:opacity-40"
          style={{ borderRadius: csR(8, 16), ...squircle }}
          disabled={!valid}
          onClick={() => props.onSave({ amountMinor: parsed * 100, currency })}
        >
          Set budget
        </button>
      </div>
    </div>
  );
}

function Proposal(props: {
  budget:       Budget;
  engaged:      AuthorEngagement[];
  usingAllTime: boolean;
  sharePct:     number | null;
  overrides:    Record<string, number>;
  setOverride:  (key: string, minor: number) => void;
  onClearBudget: () => void;
  onSettle:     (lines: SettlementLine[]) => void;
}) {
  const proposed = proposalWithShare(
    props.budget.amountMinor,
    props.sharePct,
    props.engaged.map((e) => ({ key: e.entry.name, weight: e.words })),
  );

  const lines = proposed.map((allocation) => ({
    key:   allocation.key,
    name:  allocation.key === SWDI_ALLOCATION_KEY ? "SWDI" : allocation.key,
    minor: props.overrides[allocation.key] ?? allocation.minor,
  }));
  const total = lines.reduce((sum, line) => sum + line.minor, 0);

  if (props.engaged.length === 0) {
    return (
      <p className="mt-4 text-[15px] text-(--ink-soft)">
        Nothing to propose yet: none of your reading matches a registry author this
        month. Read something, or add the people you read to the registry.
      </p>
    );
  }

  return (
    <div className="mt-4 border border-(--line) bg-(--card) px-6 py-5" style={{ borderRadius: csR(12, 28), ...superellipse3 }}>
      <p className="text-[15px] text-(--ink-soft)">
        Proposed from your {props.usingAllTime ? "reading so far (nothing read this month yet)" : "reading this month"},
        in proportion to time spent. Adjust anything, or let it stand.
      </p>

      <ul className="mt-4 space-y-3">
        {lines.map((line) => {
          const engagement = props.engaged.find((e) => e.entry.name === line.key);
          return (
            <li key={line.key} className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate">{line.name}</span>
              {engagement !== undefined && (
                <span className="shrink-0 font-sans text-[12px] text-(--ink-soft)">{formatDuration(engagement.dwellMs)}</span>
              )}
              {line.key === SWDI_ALLOCATION_KEY && (
                <span className="shrink-0 font-sans text-[12px] text-(--ink-soft)">your {props.sharePct}% share</span>
              )}
              <input
                className="w-20 border border-(--line) bg-transparent px-2 py-1 text-right font-sans text-[13px]"
                style={{ borderRadius: csR(7, 14), ...squircle }}
                inputMode="numeric"
                value={Math.round(line.minor / 100)}
                onChange={(e) => {
                  const units = Number.parseInt(e.target.value, 10);
                  props.setOverride(line.key, Number.isFinite(units) && units >= 0 ? units * 100 : 0);
                }}
              />
              <span className="w-6 shrink-0 font-sans text-[13px] text-(--ink-soft)">{props.budget.currency}</span>
            </li>
          );
        })}
      </ul>

      <div className="mt-5 flex items-center gap-4 border-t border-(--line) pt-4 font-sans text-[14px]">
        <span className="text-(--ink-soft)">Total {Math.round(total / 100)} {props.budget.currency} of {Math.round(props.budget.amountMinor / 100)} {props.budget.currency}</span>
        <button
          className="ml-auto border border-(--line) bg-(--ink) px-4 py-2 text-(--paper)"
          style={{ borderRadius: csR(8, 16), ...squircle }}
          onClick={() => props.onSettle(lines.filter((line) => line.minor > 0).map((line) => ({ ...line, paid: false })))}
        >
          Start paying
        </button>
      </div>

      <button className="mt-3 font-sans text-[12px] text-(--ink-soft) underline underline-offset-4" onClick={props.onClearBudget}>
        Change the monthly amount
      </button>
    </div>
  );
}

// The channel a Pay button opens, most-preferred first. PayPal donate links accept a
// prefilled amount; the others open at the author's page and the reader types it.
const CHANNEL_PRIORITY = ["patreon", "github-sponsors", "kofi", "buymeacoffee", "paypal", "stripe", "liberapay", "custom"];

const CURRENCY_CODES: Record<string, string> = { kr: "NOK", "$": "USD", "€": "EUR", "£": "GBP" };

const PAYMENT_LABELS: Record<string, string> = {
  paypal:            "PayPal",
  buymeacoffee:      "Buy Me a Coffee",
  kofi:              "Ko-fi",
  patreon:           "Patreon",
  stripe:            "Donate",
  "github-sponsors": "GitHub Sponsors",
  liberapay:         "Liberapay",
};

function payTarget(entry: RegistryEntry | undefined, minor: number, currency: string): { url: string; label: string } | null {
  const usable = (entry?.payment ?? []).filter((m) => m.kind !== "bitcoin");
  const best   = [...usable].sort((a, b) => CHANNEL_PRIORITY.indexOf(a.kind) - CHANNEL_PRIORITY.indexOf(b.kind))[0];
  if (best === undefined) return null;

  let url = best.url;
  if (best.kind === "paypal" && url.includes("/donate")) {
    const code = CURRENCY_CODES[currency];
    url += `${url.includes("?") ? "&" : "?"}amount=${(minor / 100).toFixed(2)}${code === undefined ? "" : `&currency_code=${code}`}`;
  }

  return { url, label: PAYMENT_LABELS[best.kind] ?? "Open" };
}

function PayList(props: {
  settlement: Settlement;
  registry:   Registry;
  currency:   string;
  onPaid:     (key: string, paid: boolean) => void;
  onReopen:   () => void;
}) {
  const paid = props.settlement.lines.filter((line) => line.paid).length;

  return (
    <div className="mt-4 border border-(--line) bg-(--card) px-6 py-5" style={{ borderRadius: csR(12, 28), ...superellipse3 }}>
      <p className="text-[15px] text-(--ink-soft)">
        {formatMonth(props.settlement.month)}: each Pay opens the author&apos;s own channel
        and ticks the line off. {paid} of {props.settlement.lines.length} done.
      </p>

      <ul className="mt-4 space-y-4">
        {props.settlement.lines.map((line) => (
          <PayLine key={line.key} line={line} registry={props.registry} currency={props.currency} onPaid={props.onPaid} />
        ))}
      </ul>

      <button className="mt-4 font-sans text-[12px] text-(--ink-soft) underline underline-offset-4" onClick={props.onReopen}>
        Reopen and adjust
      </button>
    </div>
  );
}

// A month that rolled over with lines still unpaid. It keeps its Pay buttons for as
// long as it takes; Forget writes the remainder off and removes the month's record.
function OutstandingMonth(props: {
  settlement: Settlement;
  registry:   Registry;
  currency:   string;
  onPaid:     (key: string, paid: boolean) => void;
  onForget:   () => void;
}) {
  const left = props.settlement.lines.filter((line) => !line.paid).length;

  return (
    <div className="mt-4 border border-(--line) bg-(--card) px-6 py-5" style={{ borderRadius: csR(12, 28), ...superellipse3 }}>
      <p className="text-[15px] text-(--ink-soft)">
        {formatMonth(props.settlement.month)} is unfinished: {left} of {props.settlement.lines.length} still unpaid.
      </p>

      <ul className="mt-4 space-y-4">
        {props.settlement.lines.map((line) => (
          <PayLine key={line.key} line={line} registry={props.registry} currency={props.currency} onPaid={props.onPaid} />
        ))}
      </ul>

      <button className="mt-4 font-sans text-[12px] text-(--ink-soft) underline underline-offset-4" onClick={props.onForget}>
        Forget this month
      </button>
    </div>
  );
}

function FinishedMonth(props: { settlement: Settlement; currency: string }) {
  const total = props.settlement.lines.reduce((sum, line) => sum + line.minor, 0);

  return (
    <p className="mt-4 flex items-baseline justify-between gap-4 border-b border-(--line) pb-2 font-sans text-[14px]">
      <span>{formatMonth(props.settlement.month)}</span>
      <span className="text-(--ink-soft)">paid {Math.round(total / 100)} {props.currency} to {pluralize(props.settlement.lines.length, "author")}</span>
    </p>
  );
}

function PayLine(props: {
  line:     SettlementLine;
  registry: Registry;
  currency: string;
  onPaid:   (key: string, paid: boolean) => void;
}) {
  const { line } = props;

  const entry  = props.registry.entries.find((e) => e.name === (line.key === SWDI_ALLOCATION_KEY ? "SWDI" : line.key));
  const target = payTarget(entry, line.minor, props.currency);

  return (
    <li className="flex flex-wrap items-center gap-3">
      <span className={`min-w-0 flex-1 truncate ${line.paid ? "line-through opacity-60" : ""}`}>{line.name}</span>

      {line.paid && (
        <button className="shrink-0 font-sans text-[12px] text-(--ink-soft) underline underline-offset-4" onClick={() => props.onPaid(line.key, false)}>
          undo
        </button>
      )}

      {!line.paid && target !== null && (
        <a
          className="shrink-0 border border-(--line) bg-(--ink) px-4 py-1.5 font-sans text-[13px] text-(--paper)"
          style={{ borderRadius: csR(999, 999), ...squircle }}
          href={target.url}
          target="_blank"
          rel="noreferrer"
          onClick={() => props.onPaid(line.key, true)}
        >
          Pay {Math.round(line.minor / 100)} {props.currency} on {target.label}
        </a>
      )}

      {!line.paid && target === null && (
        <span className="shrink-0 font-sans text-[12px] text-(--ink-soft)">
          {Math.round(line.minor / 100)} {props.currency} · no channel yet
        </span>
      )}
    </li>
  );
}
