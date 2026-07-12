# Known issues

Deliberate gaps we know about, so nobody rediscovers them the hard way. Each entry says
what breaks, why it is the way it is, and what the fix would look like.

## An extension older than sync v2 refuses newer blobs

Sync deletions are tombstoned (payload `v: 2`: page tombstones in `deleted`, paragraph
tombstones in each record's `cleared`, vouch revocation in `assumedClearedAt`). A client
from before this revision fails the schema parse on a v2 blob and reports the remote data
as unreadable rather than syncing. That refusal is deliberate: an old client would strip
the tombstone fields it does not know and resurrect deletions for every other device.
The cure is updating the extension.

## The sync rate limiter is in-memory, single-instance

`src/lib/rate-limit.ts` keeps its buckets in process memory: a deploy or restart forgives
everyone, and a second replica would double every allowance. Fine at one Railway
instance; move the buckets to Postgres (or add a shared store) before scaling out.

Two more edges of the same limiter, deliberate at this tier:

- `clientIp` trusts the RIGHTMOST `X-Forwarded-For` entry, which assumes exactly one
  trusted proxy hop (Railway's edge) appending it. Putting another proxy or CDN in
  front changes which entry is trustworthy; revisit `clientIp` before doing that.
- Per-IP limiting cannot hold against an attacker with many real addresses: each fresh
  address is a fresh allowance, and once the bucket map is full of live entries, new
  identities pass untracked (existing counters are never sacrificed to make room). The
  128-bit sync id space is what keeps enumeration infeasible regardless.

## The sync store prices registration and can sweep abandoned blobs

Registration (the first PUT for a sync id) is the server's only unauthenticated write,
so it has its own allowance (30 per hour per address) on top of the per-minute limit,
and a global capacity ceiling (20k ids / 10 GB, constants in
`src/app/api/sync/[id]/route.ts`) guards the hosting bill. At capacity, blobs that
registered and were never updated for two weeks are swept before new registrations are
refused. The consequence to know: a device that synced exactly once and then went idle
for two weeks can lose its SERVER copy under capacity pressure. Its local data is
untouched, and its next sync re-uploads and re-registers; the dashboard just shows
nothing for that key until then. Active users are never swept and never refused.

## Backfilled reading carries no donation weight

A page vouched for via backfill (`assumedReadAt`) counts as read everywhere visible, but
carries zero dwell time. The monthly proposal weights authors by the word count of the
paragraphs read, gated on a read having real dwell (`dwellMs > 0`), so vouched reading is
excluded and money follows measured reading only. If assumed reading should ever count,
the policy lives in one place: `authorEngagement` in `src/app/dashboard/derive.ts`.
