"use client";

import { useState } from "react";
import { z } from "zod";
import { Registry, SWDI_ALLOCATION_KEY, nowIso, proposalWithShare } from "@swdi/shared";
import { csR, squircle, superellipse3 } from "@/lib/squircle";
import { AuthorEngagement, PageStats, authorEngagement, bitcoinAddress, formatDuration } from "./derive";

// The donation loop, prototype edition: one monthly amount, split in proportion to
// your reading, reviewed and adjusted by you, settled by you through each author's
// own payment channel. Money never touches SWDI; this page only does arithmetic and
// remembers, on this device, what you decided.

const BUDGET_KEY      = "swdi:budget";
const SETTLEMENTS_KEY = "swdi:settlements";

const budgetSchema = z.object({
  amountMinor: z.number().int().positive(),
  currency:    z.string().min(1).max(8),
});

const settlementSchema = z.object({
  month:     z.string(),
  settledAt: z.string(),
  lines: z.array(z.object({
    key:   z.string(),
    name:  z.string(),
    minor: z.number(),
    paid:  z.boolean(),
  })),
});

const settlementsSchema = z.record(z.string(), settlementSchema);

type Budget      = z.infer<typeof budgetSchema>;
type Settlement  = z.infer<typeof settlementSchema>;
type Settlements = z.infer<typeof settlementsSchema>;

export function BudgetSection(props: { pages: PageStats[]; registry: Registry; sharePct: number | null }) {
  const [budget, setBudget]           = useState<Budget | null>(loadBudget);
  const [settlements, setSettlements] = useState<Settlements>(loadSettlements);
  const [overrides, setOverrides]     = useState<Record<string, number>>({});

  const month = nowIso().slice(0, 7);

  const monthly  = authorEngagement(props.registry, props.pages, month);
  const allTime  = monthly.length > 0 ? null : authorEngagement(props.registry, props.pages, null);
  const engaged  = monthly.length > 0 ? monthly : (allTime ?? []);
  const settled  = settlements[month];

  function saveBudget(next: Budget | null) {
    if (next === null) localStorage.removeItem(BUDGET_KEY);
    else               localStorage.setItem(BUDGET_KEY, JSON.stringify(next));

    setBudget(next);
    setOverrides({});
  }

  function settle(lines: Settlement["lines"]) {
    const next = { ...settlements, [month]: { month, settledAt: nowIso(), lines } };
    localStorage.setItem(SETTLEMENTS_KEY, JSON.stringify(next));
    setSettlements(next);
  }

  function unsettle() {
    const next = { ...settlements };
    delete next[month];
    localStorage.setItem(SETTLEMENTS_KEY, JSON.stringify(next));
    setSettlements(next);
  }

  function markPaid(key: string, paid: boolean) {
    if (settled === undefined) return;

    settle(settled.lines.map((line) => (line.key === key ? { ...line, paid } : line)));
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
          sharePct={props.sharePct}
          registry={props.registry}
          overrides={overrides}
          setOverride={(key, minor) => setOverrides({ ...overrides, [key]: minor })}
          onClearBudget={() => saveBudget(null)}
          onSettle={settle}
        />
      )}

      {settled !== undefined && (
        <Checklist settlement={settled} registry={props.registry} onPaid={markPaid} onReopen={unsettle} />
      )}
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
        to divide it; you always confirm before anything is paid, and payments go
        directly from you to each author. Stored on this device only, for now.
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
  budget:      Budget;
  engaged:     AuthorEngagement[];
  usingAllTime: boolean;
  sharePct:    number | null;
  registry:    Registry;
  overrides:   Record<string, number>;
  setOverride: (key: string, minor: number) => void;
  onClearBudget: () => void;
  onSettle:    (lines: Settlement["lines"]) => void;
}) {
  const proposed = proposalWithShare(
    props.budget.amountMinor,
    props.sharePct,
    props.engaged.map((e) => ({ key: e.entry.name, weight: e.dwellMs })),
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
        in proportion to time spent. Adjust anything; nothing is paid until you settle,
        and settling only prepares the checklist below.
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
          Settle this month
        </button>
      </div>

      <button className="mt-3 font-sans text-[12px] text-(--ink-soft) underline underline-offset-4" onClick={props.onClearBudget}>
        Change the monthly amount
      </button>
    </div>
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

function Checklist(props: {
  settlement: Settlement;
  registry:   Registry;
  onPaid:     (key: string, paid: boolean) => void;
  onReopen:   () => void;
}) {
  const paid = props.settlement.lines.filter((line) => line.paid).length;

  return (
    <div className="mt-4 border border-(--line) bg-(--card) px-6 py-5" style={{ borderRadius: csR(12, 28), ...superellipse3 }}>
      <p className="text-[15px] text-(--ink-soft)">
        Settled for {props.settlement.month}: pay each author through their own channel
        and tick them off. {paid} of {props.settlement.lines.length} done.
      </p>

      <ul className="mt-4 space-y-4">
        {props.settlement.lines.map((line) => {
          const entry = props.registry.entries.find((e) => e.name === (line.key === SWDI_ALLOCATION_KEY ? "SWDI" : line.key));
          return (
            <li key={line.key} className="flex flex-wrap items-center gap-3">
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                <input type="checkbox" checked={line.paid} onChange={(e) => props.onPaid(line.key, e.target.checked)} />
                <span className={`truncate ${line.paid ? "line-through opacity-60" : ""}`}>{line.name}</span>
              </label>
              <span className="shrink-0 font-sans text-[13px]">{Math.round(line.minor / 100)}</span>
              <span className="flex shrink-0 gap-2">
                {entry === undefined || entry.payment.length === 0
                  ? <span className="font-sans text-[12px] text-(--ink-soft)">no channel yet</span>
                  : entry.payment.map((method) => (
                      <a
                        key={method.url}
                        className="border border-(--line) px-2.5 py-1 font-sans text-[12px] hover:bg-(--paper)"
                        style={{ borderRadius: csR(999, 999), ...squircle }}
                        href={method.kind === "bitcoin" ? `https://blockchair.com/bitcoin/address/${bitcoinAddress(method.url)}` : method.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {PAYMENT_LABELS[method.kind] ?? "Open"}
                      </a>
                    ))}
              </span>
            </li>
          );
        })}
      </ul>

      <button className="mt-4 font-sans text-[12px] text-(--ink-soft) underline underline-offset-4" onClick={props.onReopen}>
        Reopen and adjust
      </button>
    </div>
  );
}

function loadBudget(): Budget | null {
  if (typeof window === "undefined") return null;

  const raw = localStorage.getItem(BUDGET_KEY);
  if (raw === null) return null;

  let json: unknown;
  try   { json = JSON.parse(raw); }
  catch { return null; }

  const parsed = budgetSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

function loadSettlements(): Settlements {
  if (typeof window === "undefined") return {};

  const raw = localStorage.getItem(SETTLEMENTS_KEY);
  if (raw === null) return {};

  let json: unknown;
  try   { json = JSON.parse(raw); }
  catch { return {}; }

  const parsed = settlementsSchema.safeParse(json);
  return parsed.success ? parsed.data : {};
}
