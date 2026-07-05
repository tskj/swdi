# Known issues

Deliberate gaps we know about, so nobody rediscovers them the hard way. Each entry says
what breaks, why it is the way it is, and what the fix would look like.

## Sync has no tombstones: deletions resurrect

Sync merges are pure unions (`mergePages`/`mergeRecords` in `shared/src/`): every device
folds the remote set into its local set and uploads the result. Nothing represents "this
page was deleted", so removing a page locally (the backfill undo in
`extension/src/lib/storage.ts` `removePage`, or any future delete affordance) only sticks
if it happens before the next sync; after that, the page returns from the server on the
following merge.

Fix shape: a sync payload revision (`v: 2`) carrying per-url tombstones with timestamps,
merged like reads (latest of delete-vs-recreate wins), plus a migration path for v1 blobs.
Bundle any other payload format wishes into the same revision, since old clients strip
unknown fields and would silently drop them.

## Donation config is last-write-wins across devices

`donation_configs.doc` is replaced whole on every PUT with no versioning. Two devices
editing the budget or ticking off payments concurrently lose one side's change. Accepted
because a budget is edited by one human, rarely; the fix is the same expectedVersion
dance the sync blob already does.

## The sync rate limiter is in-memory, single-instance

`src/lib/rate-limit.ts` keeps its buckets in process memory: a deploy or restart forgives
everyone, and a second replica would double every allowance. Fine at one Railway
instance; move the buckets to Postgres (or add a shared store) before scaling out.

## Backfilled reading carries no donation weight

A page vouched for via backfill (`assumedReadAt`) counts as read everywhere visible, but
contributes zero dwell time, so it never influences the monthly proposal. Chosen so money
follows measured reading only. If assumed reading should ever count, the policy lives in
one place: `authorEngagement` in `src/app/dashboard/derive.ts`.
