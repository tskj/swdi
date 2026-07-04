# SWDI

SWDI is an open source project about reading on the web: remembering what you have actually read, and eventually paying the people who wrote it.

It grew out of two itches. The first is that long, link-heavy sites are easy to get lost in. Hypertext books like David Chapman's meaningness.com stay open in tabs for weeks, pages jump around through liberal linking, and you forget which chapters you finished, how far down a page you got, and whether you already read the thing a link points to. The second itch is that supporting the writers you keep coming back to is still inconvenient enough that most goodwill never turns into anything. SWDI approaches both with the same primitive: a private, precise record of what you have read.

## What works today: the reader extension

The browser extension in `extension/` keeps a paragraph-level reading memory, stored entirely on your device.

- It notices which paragraphs you have actually read, based on how long they stay in view relative to their length. Scrolling past counts for nothing.
- Read paragraphs get a quiet marker in the margin, so you can see where you stopped, even months later.
- Links grow a small dot when they point to something you have already read. A link to `page#section` reflects that section specifically, since hypertext books link to sections constantly.
- If you left a long page half-finished, a small button offers to take you back to where you stopped. It never moves the page on its own.
- Every paragraph is identified by a hash of its text, so your reading record survives cosmetic edits to the page. When content does change after you read it, the changed or added paragraphs are marked.
- The toolbar badge shows your progress through the current page, and the popup can export everything you have stored as JSON.

It currently runs on a small set of hypertext book sites (meaningness.com, metarationality.com, vividness.live, buddhism-for-vampires.com) while the reading heuristics mature.

### Trying it

```
pnpm install
pnpm ext:build
```

Then open `chrome://extensions`, enable Developer mode, choose "Load unpacked" and select `extension/dist`. Visit one of the tracked sites and read something.

## Where it is going

The same record of engagement is the foundation for the donation system described in `docs/VISION.md`. The short version: you set one monthly budget you are comfortable with, your own reading determines a proposed split across the writers you actually read, you review and confirm it, and payments go directly from you to the creators' existing payment links (Patreon, PayPal, and so on), discovered through an open community registry. SWDI holds no funds and takes no cut. If you want to help pay for its servers, the project appears in the registry like any other entry.

Two architectural commitments follow from taking reading data seriously as intimate data:

- Reading history stays local. When multi-device sync lands, the server stores only blobs encrypted with keys that never leave your devices, and that claim is verifiable in this repository.
- Your data is always exportable, and self-hosting the whole stack is a supported path. Convenience may be a reason to stay; captivity will never be.

## Repository layout

| Path | What it is |
| --- | --- |
| `/` | Next.js app: the public site now, the dashboard and sync API later |
| `shared/` | The data model as zod schemas, plus the small helpers both sides use |
| `extension/` | The MV3 reader extension, built with esbuild |
| `docs/` | Vision, house style, decisions |

## Development

Prerequisites: Node 24 and pnpm 10.

```
pnpm install         # whole workspace
pnpm dev             # web app on localhost:3000
pnpm ext:build       # build the extension into extension/dist
pnpm typecheck       # all three packages
pnpm test            # unit tests
pnpm cicd            # everything CI runs
```

## Production

The web app deploys on Railway from the `Dockerfile`. Database migrations run in the pre-deploy step and `/api/health` gates the rollout. `railway.json` holds the configuration.

## Contributing

Issues and pull requests are welcome. Read `docs/HOUSE_STYLE.md` before writing code; it is opinionated and enforced.
