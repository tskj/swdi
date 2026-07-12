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

### 3. Pay marks a line paid before any money moves [HIGH] — DONE 2026-07-12
Ticking is explicit now: the link only opens the channel, and every unpaid line carries
a quiet "Mark paid" (chosen over mark-on-return, which still guesses; this also lets a
channel-less line, like SWDI's own, be ticked at all). One-off-capable channels rank
first (PayPal, Ko-fi, Buy Me a Coffee, Stripe) and memberships trail; the copy follows
the channel's real capability: "Pay 83 kr on PayPal" only when the amount prefills,
"Open Patreon, suggested 83 kr" otherwise.

## Tier 2 — repairs the reading model we just shipped, and stops data loss

### 4. Finishing an article usually does not commit the tail [HIGH] — DONE 2026-07-12
The terminal rule (`articleEndReached` in `extension/src/content.ts`) now keys to the
article's own geometry: the end is reached when the last paragraph that still has
geometry has its bottom inside the viewport. Anchoring to the last tracked paragraph
(rather than the container) also ignores trailing in-article chrome like next-page
navs. Footers and comment threads below the prose no longer push the finish line away;
e2e covers stopping at the last paragraph well short of document bottom.

### 5. "I've read this far" can wipe a page from a stray click, no undo [HIGH] — DONE 2026-07-12
The action now leaves a one-shot in-page Undo toast holding exactly what it changed.
Undo re-stamps everything at undo time so the reversal beats the action's tombstones in
every merge and on every device: cleared paragraphs come back as read-at-now (the
original reading date is the price, paid only on paragraphs the stray click hit), and a
revoked whole-page vouch is reinstated the same way. `lastContextMenuY` is null until a
real right-click happens, so a keyboard-opened menu (no coordinates) is a no-op instead
of a full page wipe. Both paths are e2e-covered.

### 6. Backfill undo deletes real history [HIGH] — DONE 2026-07-12
The toggle now keys on the record itself (`assumedReadAt`), not session memory, so it
stays undoable on the next page, day, or device. Un-vouching (`unvouch` in content.ts)
removes exactly what the vouch added: materialized reads are recognizable forever
(zero dwell, stamped at the vouch time) and get tombstoned so the revert syncs;
dwell-earned reads are never touched. Only a pure stub with no history at all is still
deleted outright, which keeps the old clean-undo behavior for the misclick case.

### 7. Inner-scroll layouts void the parked-page protection [MEDIUM] — DONE 2026-07-12
Same fix as #4: the anchor paragraph's `getBoundingClientRect` is viewport-relative and
unclipped, so an article inside an `overflow:auto` pane is only "at the end" when the
pane is actually scrolled there. e2e covers a 100vh pane: parked paragraphs never
commit, scrolling the pane to the article's end still does.

### 8. SPA navigation causes cross-page false reads [MEDIUM] — DONE 2026-07-12
Both commit paths now require `isConnected`: the terminal loop, and the scroll-out
rule, where the e2e revealed modern Chromium DOES fire a final not-intersecting entry
on removal, so detached paragraphs were committing through scroll-out, not the
terminal path as diagnosed. A detached anchor also cannot satisfy `articleEndReached`.
URL-change session detection deliberately not built (don't pre-design); the new page
still goes untracked until reload, which the popup copy owns up to (see #9).

## Tier 3 — first-run and onboarding dead ends

### 9. Install day shows nothing, and the popup lies [MEDIUM] — DONE 2026-07-12
On an http(s) tab with no content script the popup now says the page loaded before
SWDI could see it and asks for a reload; "cannot run" is reserved for pages where that
is true. The post-install explainer was not built (default-off stays, no pre-design).

### 10. Landing page has no install path [HIGH] — DONE 2026-07-12
"the readme has the steps" now links to the README (GitHub URL extracted to
`src/lib/links.ts`, shared with the dashboard's locked state).

### 11. Mistyped key silently creates a fresh identity [HIGH] — DONE 2026-07-12
Connecting a key in the popup now reports what the key was found to hold ("This key
holds N synced pages" against "Nothing is stored under this key yet... check the key
for typos"), via a `remotePages` count on the sync result. The dashboard's Empty state
says the same: a wrong key opens its own empty store, so check for a mistype.

### 12. Locked dashboard / registry-fail are dead ends [MEDIUM] — DONE 2026-07-12
The Connect card links the front page and the README's install steps. A registry
fetch failure now explains itself where the donation views would be, and says the
reading views are unaffected.

## Tier 4 — stale and misleading copy (two are self-inflicted this session)

### 13. Proposal explains itself by the wrong metric [MEDIUM] — DONE 2026-07-12
Copy says "in proportion to how much of each author you read" and each line shows the
word count that actually weights the split, instead of dwell time.

### 14. SupportAsk copy is stale [MEDIUM] — DONE 2026-07-12
Now asks "Should SWDI include itself in your monthly split?"; budgets have arrived.

### 15. Landing contradicts README and manifest [MEDIUM] — DONE 2026-07-12 with #10
The landing now says it runs on every page and decides for itself, matching the README
and the manifest.

### 16. "creator" survives in code comments [LOW] — DONE 2026-07-12
`shared/src/registry.ts` says authors now; no "creator" remains anywhere in source.

### 17. Grammar and singular/plural [LOW] — popup half DONE 2026-07-12
"1 paragraph is new or changed" now has its singular form. "For you who reads" / "For
you who wants" (`src/app/page.tsx`) left alone: possibly a deliberate parallel for the
drop caps, needs the author's call.

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
- **`display:none` paragraphs get marked read by "read this far"** [LOW] — DONE 2026-07-12 with
  #4: zero-size rects (collapsed or detached) are skipped; their state stays as it is.
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
