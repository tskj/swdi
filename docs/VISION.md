# Vision

SWDI (the Sustainable Web & Internet Donations Initiative, "Sweedy" among friends) exists because two problems turn out to share a solution.

Readers of serious long-form hypertext lose track of their own reading. Chapters, pages, sections and links blur together over the weeks a book stays open in rotating tabs. At the same time, the people writing that material are hard to support: every creator has a different donate link, every payment is a separate decision, and almost nobody follows through.

Both problems need the same thing: a trustworthy, private record of what a person has actually read.

## The wedge: reading memory

The first deliverable is the reader extension. It gives immediate personal value with no account, no server and no money involved: paragraph-level read state, link badges, resume positions, and change detection through content hashing. Install it because you want to remember what you have read.

This ordering is deliberate. A donation system alone gives weak reasons to install anything, since its payoff arrives monthly. A reading memory pays off the same afternoon. The engagement data it accumulates locally is exactly the data the donation flow later needs.

## The donation loop

Once reading memory exists, the rest of SWDI builds on it:

1. You set a single monthly budget you are comfortable giving. There are no per-article decisions and no microtransactions.
2. At the end of the month, your local engagement record produces a proposed split of that budget across the creators you actually read.
3. You review the proposal, adjust it, and confirm. Nothing moves without your explicit say.
4. Payments go directly from you to each creator's existing payment channel (Patreon, PayPal, crypto, whatever they already use), discovered through an open registry. Creators do not need to sign up for anything.

SWDI is never a financial intermediary. It holds no funds, processes no payments and takes no cut.

## Components and the trust model

**Extension** (exists): collects engagement locally. Reading history is intimate data, a map of what you read and how far you got, so it never leaves the device unencrypted. That is a hard invariant, and everything else is designed around it.

**Dashboard** (next): the web app where you review reading insights, set the budget and confirm monthly distributions. Server-rendered shell, but it operates on client-side data.

**Sync backend** (next): optional multi-device sync of reading state. End-to-end encrypted with keys that only exist on your devices; the server stores opaque blobs and the encryption is verifiable in this repository. The sync backend is deliberately not a swap-in setting. E2EE means swapping it buys no additional privacy, and running it is what costs the project money. If you want a different operator anyway, fork and self-host; that path stays documented and supported. Your data is always exportable in cleartext from your own devices. Convenience may be a reason to stay; captivity will never be.

**Creator registry** (later): a public mapping from content to existing payment links, community-maintained, containing no personal data. The registry is the opposite of the sync backend in the trust model: it is a commons, so the dashboard treats it as a URL you can point anywhere. The default is the one this project hosts, and community or curated registries are welcome.

## Funding

The project needs servers, a database and tooling. It funds itself by being an ordinary entry in its own registry: if SWDI is useful to you, it shows up in your monthly proposal like any other creator, and you can zero it out. No fees, no premium tier, no ads.

## Roadmap

- v0.1: reader extension, local only, a handful of hypertext book sites. Public site deployed.
- v0.2: E2EE sync and the dashboard's reading views. Account via SSO, no passwords.
- v0.3: registry, monthly proposals, payment guidance.
- Later: more input sources, more browsers, broader site support, registry federation.
