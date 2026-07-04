import { csR, squircle, superellipse3 } from "@/lib/squircle";

const GITHUB_URL = "https://github.com/tskj/swdi";

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 pt-24 pb-20 text-[17px] leading-relaxed">
      <p className="text-[13px] font-sans tracking-[0.25em] uppercase text-(--ink-soft)">
        SWDI
      </p>
      <h1 className="sr-only">SWDI, the Sustainable Web &amp; Internet Donations Initiative</h1>

      <div className="mt-10 grid gap-12 md:grid-cols-2 md:gap-0">
        <section className="md:pr-9">
          <h2 className="font-display text-[32px] leading-[1.12] font-medium">
            Remember what you read.
          </h2>
          <p className="newsprint dropcap mt-5">
            For you who reads the old web: hypertext books, essay blogs, long pages that
            stay open in tabs for weeks and link everywhere. The extension keeps a quiet,
            paragraph-level memory of your reading. It knows where you stopped, shows
            which links you have already followed, and notices what changed since you
            were last there. It lives on your device and answers to nobody else.
          </p>
        </section>

        <section className="md:border-l md:border-(--line) md:pl-9">
          <h2 className="font-display text-[32px] leading-[1.12] font-medium italic text-(--green)">
            Pay the people who wrote it.
          </h2>
          <p className="newsprint dropcap mt-5">
            For you who wants your favorite authors to keep writing. Set one monthly
            amount you are comfortable giving, and your own reading proposes how to
            divide it among the people behind it. You confirm every split, and the money
            travels straight from you to the payment channels they already have. No
            fees, no middlemen, no signup asked of anyone.
          </p>
        </section>
      </div>

      <Demo />

      <section className="mt-16">
        <h2 className="font-display text-[26px] font-medium">A memory for hypertext</h2>
        <p className="mt-4">
          Long hypertext books stay open in tabs for weeks. Pages link back and forth,
          chapters blur together, and browsers forget your place the moment they restart.
          The extension keeps a paragraph-level record of what you have read, stored on
          your device and nowhere else.
        </p>

        <ul className="mt-6 space-y-4">
          <Point>
            Paragraphs count as read when they stay in view long enough to actually be
            read. Scrolling past changes nothing.
          </Point>
          <Point>
            Links grow a small dot when they point to something you already read, and a
            link to a single section answers for that section alone.
          </Point>
          <Point>
            Every paragraph is identified by a hash of its text, so your record survives
            cosmetic edits and can show you exactly what changed since you were there.
          </Point>
          <Point>
            Half-finished pages offer to take you back to where you stopped. The page
            never moves on its own.
          </Point>
        </ul>

        <p className="mt-6 text-(--ink-soft)">
          It currently follows a handful of hypertext book sites, with meaningness.com as
          the reference. Installing from source takes a minute; the readme has the steps.
        </p>
      </section>

      <section className="mt-16">
        <h2 className="font-display text-[26px] font-medium">Where this is going</h2>
        <p className="mt-4">
          Set one monthly budget you are comfortable giving. Your own reading produces a
          proposed split across the authors behind it. You review it, adjust it, confirm
          it, and the money goes directly from you to each author&apos;s existing payment
          channel, found through an open community registry. Authors never sign up for
          anything. SWDI holds no funds and takes no cut.
        </p>
      </section>

      <section
        className="mt-16 border border-(--line) bg-(--card) px-7 py-6"
        style={{ borderRadius: csR(12, 28), ...superellipse3 }}
      >
        <h2 className="font-display text-[22px] font-medium">Principles</h2>
        <ul className="mt-4 space-y-3">
          <li>
            Reading history is intimate data. It stays local, and sync, when it arrives,
            will be end to end encrypted with keys that never leave your devices.
          </li>
          <li>
            Your data is always exportable, and self-hosting the whole stack is a
            supported path.
          </li>
          <li>Everything is open source and auditable, including the claims above.</li>
        </ul>
      </section>

      <footer className="mt-16 border-t border-(--line) pt-6 font-sans text-[14px] text-(--ink-soft)">
        <p>SWDI, the Sustainable Web &amp; Internet Donations Initiative.</p>
        <a className="underline underline-offset-4 hover:text-(--ink)" href={GITHUB_URL}>
          Source, issues and discussion on GitHub
        </a>
      </footer>
    </main>
  );
}

function Point({ children }: { children: React.ReactNode }) {
  return <li className="marker pl-5">{children}</li>;
}

// The demo card demonstrates the overlay on itself: the same margin markers, link dot
// and resume pill the extension draws, rendered as plain markup.
function Demo() {
  return (
    <figure
      className="relative mt-12 border border-(--line) bg-(--card) px-8 py-7 text-[16px]"
      style={{ borderRadius: csR(14, 32), ...superellipse3 }}
    >
      <p className="marker pl-5">
        You read this paragraph yesterday. The green mark in the margin is the extension
        remembering that for you.
      </p>
      <p className="marker mt-4 pl-5">
        This one mentions{" "}
        <span className="underline decoration-(--ink-soft) underline-offset-4">
          a chapter you finished
          <span className="read-dot" />
        </span>
        , so the link carries a small dot. You never have to wonder.
      </p>
      <p className="marker-amber mt-4 pl-5">
        The author edited this paragraph after you read the page, which is why its mark is
        amber.
      </p>
      <p className="mt-4 pl-5 text-(--ink-soft)">
        This one you have not read yet. Give it the time it takes to read, and it quietly
        joins your memory.
      </p>

      <figcaption
        className="absolute right-5 -bottom-4 border border-(--line) bg-(--ink) px-4 py-2 font-sans text-[13px] text-(--paper) shadow-md"
        style={{ borderRadius: csR(999, 999), ...squircle }}
      >
        Continue where you left off
      </figcaption>
    </figure>
  );
}
