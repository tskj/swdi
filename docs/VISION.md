# Vision

SWDI (the Sustainable Web Donations Initiative, "Sweedy" among friends) exists because two problems turn out to share a solution.

Readers of serious long-form hypertext lose track of their own reading. Chapters, pages, sections and links blur together over the weeks a book stays open in rotating tabs. At the same time, the people writing that material are hard to support: every author has a different donate link, every payment is a separate decision, and almost nobody follows through.

Both problems need the same thing: a trustworthy, private record of what a person has actually read.

## The wedge: reading memory

The first deliverable is the reader extension. It gives immediate personal value with no account, no server and no money involved: paragraph-level read state, link badges, resume positions, and change detection through content hashing. Install it because you want to remember what you have read.

This ordering is deliberate. A donation system alone gives weak reasons to install anything, since its payoff arrives monthly. A reading memory pays off the same afternoon. The engagement data it accumulates locally is exactly the data the donation flow later needs.

## The donation loop

Once reading memory exists, the rest of SWDI builds on it:

1. You set a single monthly budget you are comfortable giving. There are no per-article decisions and no microtransactions.
2. At the end of the month, your local engagement record produces a proposed split of that budget across the authors you actually read.
3. You review the proposal, adjust it, and confirm. Nothing moves without your explicit say.
4. Payments go directly from you to each author's existing payment channel (Patreon, PayPal, crypto, whatever they already use), discovered through an open registry. Authors do not need to sign up for anything.

SWDI is never a financial intermediary. It holds no funds, processes no payments and takes no cut.

## Components and the trust model

**Extension** (exists): collects engagement locally. Reading history is intimate data, a map of what you read and how far you got, so it never leaves the device unencrypted. That is a hard invariant, and everything else is designed around it.

**Dashboard** (exists): the web app where you review reading insights, and later set the budget and confirm monthly distributions. Server-rendered shell; all reading data decrypts and stays client-side.

**Sync backend** (exists): optional multi-device sync of reading state. End-to-end encrypted with keys that only exist on your devices; the server stores opaque blobs and the encryption is verifiable in this repository. Connecting is never destructive: the local record merges with whatever the key already holds, so a long-running local-only tracker can join an established sync identity at any time. There is no account: a random sync key generated on the first device is the whole identity, and everything else (the blob's name, the write token, the encryption key) derives from it. The server stores only the write token's hash beside the ciphertext, so it can withhold service but can never read, and nothing ties a blob to a person. Losing the key loses the synced copy; local data and JSON export remain, and that trade is stated plainly rather than papered over with a recovery backdoor. The sync backend is deliberately not a swap-in setting. E2EE means swapping it buys no additional privacy, and running it is what costs the project money. If you want a different operator anyway, fork and self-host; that path stays documented and supported. Your data is always exportable in cleartext from your own devices. Convenience may be a reason to stay; captivity will never be.

**The registry** (seeded): a public mapping from content to existing payment links, community-maintained, containing no personal data. It starts as versioned JSON in this repo, served at /api/registry. The registry is the opposite of the sync backend in the trust model: it is a commons, so the dashboard treats it as a URL you can point anywhere. The default is the one this project hosts, and community or curated registries are welcome.

## Funding

The project needs servers, a database and tooling. It funds itself by being an ordinary entry in its own registry: if SWDI is useful to you, it shows up in your monthly proposal like any other author, and you can zero it out. No fees, no premium tier, no ads.

How the ask works is a design commitment, written down so it survives future pressure:

- SWDI asks exactly once, as a symmetric question with yes and no equally prominent: include SWDI in your split, suggested at 1%? The answer is remembered forever and adjustable in settings.
- Never pre-selected, never re-added after a no or a zero. "Holds no funds, takes no cut" stays literally true; the share is a line in your own split like any other, executed by you.
- The ask lives inside the flow where you are already reviewing your giving, never as a popup over your reading. Being quietly starved is a failure mode, but so is nagging; one honest question is the whole budget for asking.

## Roadmap

- v0.1 (done): reader extension, local only. Public site deployed, registry seeded as versioned data.
- v0.2 (done): the extension runs on every page behind a readability gate, E2EE sync under a generated key, and the dashboard's reading views with the registry join.
- v0.3: monthly budget, proposals, payment guidance.
- Later: more input sources, more browsers, registry federation and verification tooling.
