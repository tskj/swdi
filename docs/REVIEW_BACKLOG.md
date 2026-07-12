# Review backlog

Findings from a full code + UX review (2026-07-07), ordered by importance as judged at the
time. Sources: three fresh-eyes reviewers (web app, extension, server) plus a manual UX
walk-through, cross-checked against source. Severity is the reviewer's; the ordering is
this project's own priority call, which does not always follow severity.

Not a commitment to do all of these. It is the shared memory so nothing is rediscovered
the hard way. Check items off or delete them as they are addressed or deliberately declined.

## Tier 1 — sits on a promise we lead with

### 1. Settlements leak the reading you paid for (privacy) [HIGH] — DONE 2026-07-12
Fixed the preferred way: settlement lines moved into the encrypted sync payload (v3);
budget and the share answer stay plaintext. The dashboard edits settlements by
pull-apply-push against the blob's version (`src/app/dashboard/settlements-client.ts`),
the extension carries them through untouched, and legacy plaintext settlements are
adopted into the blob on the next dashboard connect, after which the donation doc is
rewritten without them. The settle/unsettle/set-paid ops left the server PATCH schema.

### 2. Month rollover silently drops unpaid authors [HIGH] — DONE 2026-07-12
Every settled month except the current one now stays on the dashboard, newest first:
months with unpaid lines keep their Pay buttons across the rollover (with an explicit
"Forget this month" to write one off), fully paid months shrink to a history line.
Months are computed on the reader's wall clock (`currentMonth`/`monthOf` in
`src/app/dashboard/derive.ts`), and reads bucket by the same local months so proposals
and settles agree near a boundary. The e2e drives the rollover with a faked clock.

### 3. Pay marks a line paid before any money moves [HIGH]
Clicking Pay fires `onPaid(key, true)` on the link click itself
(`src/app/dashboard/budget-section.tsx:279`). Land on Patreon, find no way to send the amount,
close the tab, and the dashboard shows it struck through as done. Undo exists but the default
state lies. Related: Patreon and GitHub Sponsors rank first (`:214`) but cannot take an
arbitrary one-off amount, so "Pay 83kr on Patreon" is a promise the channel cannot keep (only
PayPal's donate form prefills, `:234-237`).
Fix: mark paid on return, or make ticking explicit; rank one-off-capable channels first, or make
the button copy honest ("Open Patreon, suggested 83kr").

## Tier 2 — repairs the reading model we just shipped, and stops data loss

### 4. Finishing an article usually does not commit the tail [HIGH]
The bottom-commit rule keys on document bottom (`extension/src/content.ts:322`
`scrollY + innerHeight >= scrollHeight`), but nearly every article has a footer / comments /
related-posts below the prose. A reader who stops at the last paragraph and closes the tab never
reaches document bottom, so the final screenful never commits. Directly weakens the scroll-out
model.
Fix (preferred, faithful to intent): define the terminal region against the article container
bottom, not the whole document. Preserves "close mid-page, lose the in-view tail, re-read it"
while fixing the footer case.

### 5. "I've read this far" can wipe a page from a stray click, no undo [HIGH]
Clears-and-tombstones everything below the click (`extension/src/content.ts:481-506`),
propagating through sync, unrecoverable. The menu item shows on every http(s) page. A
keyboard-invoked context menu (menu key / Shift+F10) carries no coordinates, so
`lastContextMenuY` stays 0 (`content.ts:145-146`) and it means "above the first paragraph": full
page wipe.
Fix: an in-page Undo toast (hold the pre-clear read map for one action), and guard the zero-Y /
above-article case behind a confirm or make it a no-op.

### 6. Backfill undo deletes real history [HIGH]
`toggleBackfilled` (`extension/src/content.ts:634-646`): first click vouches even a page with a
full dwell-earned record; second click `removePage`s the entire record and stamps a
sync-propagating deletion tombstone (`storage.ts:44-50`). The `stubbed` set is session-only, so
the same misclick on the next page is not even undoable.
Fix: undo reverts the vouch (clear `assumedReadAt` / restore pre-vouch record), never deletes;
track vouch-vs-preexisting in the record, not session memory.

### 7. Inner-scroll layouts void the parked-page protection [MEDIUM]
When the article scrolls inside an `overflow:auto` pane (common docs themes),
`scrollY + innerHeight >= scrollHeight` is permanently true (`extension/src/content.ts:322`), so
every visible paragraph commits after mere dwell: exactly the AFK case the design promises not to
count. Same root cause as #4 (document-geometry assumption).

### 8. SPA navigation causes cross-page false reads [MEDIUM]
Detached paragraphs keep `intersecting: true` (no final IO entry) and commit under the old URL
when `atBottom` next holds; the new page is never tracked
(`extension/src/content.ts:325-327`).
Fix: guard commit with `el.isConnected`; optionally detect URL change to end the session. Full
SPA support is out of scope (don't pre-design), but the false-read guard is cheap.

## Tier 3 — first-run and onboarding dead ends

### 9. Install day shows nothing, and the popup lies [MEDIUM]
The content script only injects into pages loaded after install, so the popup on the current
article says "SWDI cannot run on this page" (`extension/src/popup/popup.ts:241-243`), which is
false. With markers default-off + badges hidden when overlay is off (`content.css:25`), a new
user sees no sign it works. Keep the default-off decision; fix the dead end.
Fix: for http(s) tabs, say "Reload this page so SWDI can see it"; consider a one-page post-install
explainer.

### 10. Landing page has no install path [HIGH]
"Installing from source takes a minute; the readme has the steps" (`src/app/page.tsx:84`) links
nowhere; the only GitHub link is the footer (`:122`). The single conversion action points at an
unlinked document.
Fix: link the README / install steps from that sentence.

### 11. Mistyped key silently creates a fresh identity [HIGH]
A wrong-but-strong sync key derives a different `syncId`, the server 404s, the client treats it
as "fresh blob, version 0" (`extension/src/lib/sync-client.ts:106`) and uploads everything under
the wrong identity; the dashboard shows its generic Empty state
(`src/app/dashboard/DashboardClient.tsx:85,244-248`). The user believes they are synced; the
devices never converge.
Fix: after connect, report what was found ("this key holds N pages" vs "no data yet; if you
expected some, the key may be mistyped").

### 12. Locked dashboard / registry-fail are dead ends [MEDIUM]
The Connect card assumes you have the extension, with no install or front-page link
(`DashboardClient.tsx:176-219`; footer only renders when open, `:155`). When `/api/registry`
fails, Monthly support and The people behind it just do not render (`:149-154`), so a user
mid-settlement watches the donation flow vanish with no explanation.
Fix: degrade with a message; add install/front-page links to the locked state.

## Tier 4 — stale and misleading copy (two are self-inflicted this session)

### 13. Proposal explains itself by the wrong metric [MEDIUM]
"in proportion to time spent" (`src/app/dashboard/budget-section.tsx:163`) and the per-line dwell
durations (`:173`) contradict the split, which is now word-count weighted
(`src/app/dashboard/derive.ts:90-95`). Introduced this session when weighting switched to words.
Fix: copy and the displayed measure should both follow word count.

### 14. SupportAsk copy is stale [MEDIUM]
"When monthly budgets arrive, should SWDI include itself in your split?"
(`DashboardClient.tsx:283`). Budgets have arrived; it renders directly above the budget section.

### 15. Landing contradicts README and manifest [MEDIUM]
Landing: "follows a handful of hypertext book sites" (`src/app/page.tsx:83`). README: "runs on
every page and decides for itself" (`README.md:18`); manifest matches `*://*/*`
(`extension/manifest.json:15`). The landing is the stale one, on the page most visitors see.

### 16. "creator" survives in code comments [LOW]
`shared/src/registry.ts:3,4,26`. Not user-facing, but authors-never-creators is easiest to hold
when the code says authors too.

### 17. Grammar and singular/plural [LOW]
"1 paragraphs are new or changed" has no singular form (`extension/src/popup/popup.ts:89`), while
the link sentences just below do handle it. "For you who reads" / "For you who wants"
(`src/app/page.tsx:19,32`) reads as a grammar slip in the first two sentences of the site (may be
a deliberate parallel for the drop caps).

## Tier 5 — server hardening (before the domain is shared widely)

### 18. Rate limiter is trivially bypassed [HIGH]
`clientIp` reads the leftmost `X-Forwarded-For` (`src/lib/rate-limit.ts:37`), which is
client-controlled; spoof a new value per request and never get limited. It is the only brake on
online key-guessing and on storage abuse (#19). Spoofed values also push `buckets.size` past
`MAX_BUCKETS` and trigger `buckets.clear()`, resetting everyone.
Fix: use the rightmost / trusted-hop XFF (or Railway's platform client-IP header); evict per
bucket by age instead of clearing the whole map. Update KNOWN_ISSUES (documents the in-memory
weakness but not this bypass).

### 19. Unauthenticated, unmetered 8MB-per-id storage [HIGH]
Anyone can `PUT /api/sync/<any 32-hex>` with `expectedVersion: 0`, an invented bearer token, and
up to 8,000,000 chars (`src/app/api/sync/[id]/route.ts:78-90`; `SYNC_DATA_MAX_CHARS`). No secret
required, bytes never validated as real ciphertext, no quota, TTL, or cleanup. Free key-value
store and a cheap DB-fill / hosting-cost DoS. Not in KNOWN_ISSUES.
Fix: global/per-window storage budget, costed first-write, sweep of never-updated blobs.

### 20. syncId logged in cleartext [MEDIUM]
`log.ts` records the request path (`/api/sync/<syncId>`) on every request. App logs plus platform
HTTP logs (IP + timestamp) re-link person <-> blob <-> plaintext donation doc, the exact tie the
design claims not to make.
Fix: redact or salted-hash the id in the path for these routes.

### 21. Donation-doc squatting [MEDIUM]
First PATCH/PUT registers a row with whatever token hash arrives first, independent of the sync
table's hash for that id (`src/app/api/donations/[id]/route.ts:56-59,89-92`). Anyone who learns a
syncId can create the donation doc first and lock the real user out with 404s.
Fix: bind creation to the sync row's authHash when one exists.

### 22. GET /api/sync loads the whole blob before checking the token [MEDIUM]
`SELECT *` including `data`, then compares the hash (`src/app/api/sync/[id]/route.ts:33-34`): a
wrong-token GET does work proportional to blob size (a work/timing oracle, and an amplification
lever). 128-bit id space keeps enumeration infeasible, so medium.
Fix: `SELECT auth_hash` first, match, then fetch `data`.

### 23. Generated-key fast path skips the entropy gate [MEDIUM]
Any valid base64url string decoding to >=16 bytes is classified `generated` and returned before
any entropy check, then fed to HKDF with no PBKDF2 stretching (`shared/src/sync.ts:86-87`). A
low-entropy base64url-shaped string ("aaaa...") is treated as a strong generated key.
Fix: require the app-generated form (43-char / 32-byte) for the fast path, or apply a minimal
entropy floor even on the generated branch.

### 24. Registry payment.url is unvalidated, rendered as href [MEDIUM]
`shared/src/registry.ts:21` is `z.string()` (no scheme check); rendered as `href`
(`DashboardClient.tsx:424`, `budget-section.tsx:276`). Repo-controlled today, but the design goal
is a community-edited commons, at which point `javascript:` / look-alike phishing URLs become
stored XSS / payment redirection on a "Pay" button.
Fix: constrain the schema to `https:` / `bitcoin:` before community editing opens.

### 25. Security-relevant paths are untested [MEDIUM]
`e2e/dashboard.spec.ts` covers the happy path only. Untested: wrong-token 404, 409 version
conflict, 429 rate-limit, oversized-blob 400, corrupted-doc-reads-as-absent, and the
concurrent-first-registration unique-violation -> 409 path. These are exactly where a regression
silently breaks the trust model. API-level tests, no browser needed.

## Tier 6 — smaller code hygiene and correctness

- **Settlements do not record their currency** [HIGH, but narrow] — DONE 2026-07-12 with #2:
  `settlementSchema` gained an optional `currency`, snapshotted from the budget at settle time;
  display falls back to the live budget only for settlements from before the field existed.
- **Per-page read classes leak to page scripts** [MEDIUM]: `swdi-read`/`swdi-new` are set on the
  page's own elements from the stored record (`extension/src/content.ts:218-221`), so a page can
  read which of its paragraphs you read on prior visits, even with overlay off (only CSS is
  disabled, the class stays). Consider applying classes only when overlay is on, or a shadow-rooted
  overlay like the badges.
- **Pause state in the popup goes stale** [MEDIUM]: `pauseState` cached once at startup
  (`content.ts:75,155-158`); the set-paused handlers save to storage but never update it, so
  reopening the popup without reload shows the wrong checkbox and live stats. Also, tracking
  continues until reload; a privacy control should stop the interval + observer immediately.
- **Every tab-switch triggers a full sync cycle** [MEDIUM]: `flush()` on every
  visibilitychange-hidden even with zero new reads (`content.ts:245-248`) writes storage and emits
  `page-flushed`, which schedules a full pull/merge/encrypt/PUT of the whole library. Dirty-flag
  the flush.
- **Patch reconcile can regress newer optimistic edits** [MEDIUM]: each PATCH response overwrites
  `stage.doc` unconditionally (`DashboardClient.tsx:118-127`); a slow first response clobbers a
  second quick edit. A sequence counter that ignores stale responses fixes it.
- **No way to delete history** [MEDIUM]: no "forget this page/site" anywhere; a privacy-first
  product needs an explicit forget affordance next to Pause.
- **Popup reports link-dot counts the user cannot see** [LOW]: the "N links point to pages you
  have read" sentences render regardless of overlay, but overlay-off hides the badges
  (`content.css:25`).
- **"Last synced" shows UTC** [LOW]: `popup.ts:327-329` slices the ISO string; format in local
  time.
- **`display:none` paragraphs get marked read by "read this far"** [LOW]: collapsed accordions
  report rect top 0, so `top <= pageY` holds (`content.ts:486-490`). Skip zero-height rects.
- **Native form controls are off-palette** [LOW]: Remember checkbox
  (`DashboardClient.tsx:213`) and currency select (`budget-section.tsx:105`) show the browser's
  blue accent; `globals.css` sets no `accent-color`. One line fixes it.
- **Fragile exclusion selector** [LOW]: `EXCLUDED_ANCESTOR` uses `[class*='comment']`
  (`extension/src/dom.ts:16`), which drops "commentary", "recommended-articles", etc. Word-boundary
  match or an explicit list.
- **`http://localhost/*` host permission ships in the store artifact** [LOW]:
  `extension/manifest.json:9`, a dev leftover widening the permission prompt.
- **Corrupted donation doc silently resets to empty on next PATCH** [LOW]:
  `src/app/api/donations/[id]/route.ts:97-98`, discarding recoverable settlements.
- **PBKDF2 at 310k iterations** [LOW]: below current OWASP guidance (~600k for HMAC-SHA256);
  `shared/src/sync.ts:121`. Derivation string is versioned, so a `-v2` migration path exists.

## Worth rethinking (product-level, not bugs)

- **Ask for SWDI's 1% before the user has seen value.** SupportAsk renders above the budget
  section, before a budget is set, for a project whose own registry entry has `payment: []` and
  terminates in "no channel yet". Better: ask at first settle, when 1% is a concrete number of
  crowns.
- **No registry-contribution path from the dashboard.** "Add the people you read to the registry"
  (`budget-section.tsx:153-155`) is a GitHub PR mentioned only in the README. If registry coverage
  is the growth constraint of the donation loop (it is), the dashboard should link a prefilled
  issue/PR from that sentence, ideally listing the user's own top unmatched sites (which it knows).
- **One overlay toggle controls three things** (green marks, changed-amber marks, link badges),
  but the info text only describes the green bars. Rename and document, or split badges out.
- **No proposal preview before setting a budget.** The user must commit an amount before seeing
  what a split looks like. Show the current month's weights against a placeholder.

## What is genuinely solid (do not "fix")

- Prose tone discipline (no emojis / em-dashes / "not X, but Y") holds throughout the user-facing
  text.
- The money math: `computeProposal` is a correct largest-remainder split that sums exactly;
  `proposalWithShare` cannot exceed budget; `urlUnderSite` closes the prefix-spoofing hole.
- The crypto core: fresh per-encryption GCM IV, HKDF domain separation via info strings,
  `timingSafeEqual` with length guard, the gzip-magic sniff that cannot false-positive, and the
  v1->v2 normalization with the "old client must refuse v2" invariant.
- Design language: panels and chips go through `csR(...)` + superellipse, palette and dark mode are
  consistent, the Dark Reader lock is a thoughtful touch.
