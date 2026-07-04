@AGENTS.md

# SWDI — what it is

Reading memory for the web first, a donation system built on it second. The extension records
which paragraphs a person has actually read (content-hash identity, dwell-based detection); the
web app is the public site now and becomes the dashboard + E2EE sync API later. `docs/VISION.md`
holds the full picture.

## Core invariants

These shape the data model and the trust story. Don't break them without explicit conversation.

- **Local first.** Reading history is intimate data. It lives in the extension's local storage;
  when sync lands, the server stores only E2EE blobs, keys never leave the user's devices.
- **The shared schemas are the contract.** `shared/src/schema.ts` (zod) defines read-state for
  extension, dashboard and sync payloads alike; TS types are inferred, never hand-declared.
- **Paragraph identity is a content hash** of normalized rendered text (`shared/src/hash.ts`),
  so read-state survives cosmetic edits and doubles as change detection.
- **Registry swappable, sync not.** The registry is a public commons the dashboard
  reaches via a configurable URL. The sync backend is fixed, but export-your-data must always
  work and self-hosting stays a supported path. No data captivity, ever.
- **Never a financial intermediary.** No funds held, no cut taken. SWDI funds itself as an
  ordinary registry entry.
- **Don't pre-design.** No SPA handling, no per-site adapter framework, no realtime until a
  concrete need arrives. Simple and robust go together.

## Conventions

- Monorepo: root Next.js app, `shared/` (schemas + assert/clock), `extension/` (MV3, esbuild,
  no framework). pnpm workspace.
- Extension code runs on other people's pages: every injected element carries a `swdi-` class,
  styling must never shift layout, and UI stays quiet (markers are memory aids). Anything that
  encodes reading state beyond the current page (link badges) renders inside a closed shadow
  root on a uniform zero-size host, so page scripts can never read your history out of the DOM.
- User-facing text (README, landing, popup copy): no emojis, no em-dashes, no "not X, but Y"
  constructions. Plain, human sentences. This is a hard rule.
- Design language: paper-and-ink palette with the extension's marker green and changed amber as
  the only accents (variables in `src/app/globals.css`); Fraunces for display type, Newsreader
  for body. Panels and cards get superellipse corners via `src/lib/squircle.ts` (`csR(...)` +
  `superellipse3`), with plain radii only as the unsupported-browser fallback. A bare
  `border-radius` on a panel is a bug.
- Wall-clock time goes through `shared/src/clock.ts` (`nowMs`/`nowDate`/`nowIso`), never
  `Date.now()` or zero-arg `new Date()` in app code.
- Cross-boundary data is parsed with zod, never cast; this includes extension-internal
  runtime messages and anything read back from `chrome.storage`.
