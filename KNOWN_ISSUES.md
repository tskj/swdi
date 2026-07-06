# Known issues

Deliberate gaps we know about, so nobody rediscovers them the hard way. Each entry says
what breaks, why it is the way it is, and what the fix would look like.

## Sync has no tombstones: deletions resurrect

Sync merges are pure unions (`mergePages`/`mergeRecords` in `shared/src/`): every device
folds the remote set into its local set and uploads the result. Nothing represents "this
page was deleted" or "this paragraph was un-read", so clearing read-state locally (the
backfill undo `removePage`, or the below-the-click clearing in "I've read this far",
`markReadThisFar` in `extension/src/content.ts`) only sticks if it happens before the next
sync; after that, the cleared reads return from the server on the following merge. Reads
cleared before they were ever synced never leave the device, so the common case holds.

Fix shape: a sync payload revision (`v: 2`) carrying per-url tombstones with timestamps,
merged like reads (latest of delete-vs-recreate wins), plus a migration path for v1 blobs.
Bundle any other payload format wishes into the same revision, since old clients strip
unknown fields and would silently drop them.

## The sync rate limiter is in-memory, single-instance

`src/lib/rate-limit.ts` keeps its buckets in process memory: a deploy or restart forgives
everyone, and a second replica would double every allowance. Fine at one Railway
instance; move the buckets to Postgres (or add a shared store) before scaling out.

## Backfilled reading carries no donation weight

A page vouched for via backfill (`assumedReadAt`) counts as read everywhere visible, but
carries zero dwell time. The monthly proposal weights authors by the word count of the
paragraphs read, gated on a read having real dwell (`dwellMs > 0`), so vouched reading is
excluded and money follows measured reading only. If assumed reading should ever count,
the policy lives in one place: `authorEngagement` in `src/app/dashboard/derive.ts`.
