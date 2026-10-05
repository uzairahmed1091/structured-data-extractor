import { Extractor } from "@/components/extractor";
import { StatusChip } from "@/components/results-table";
import { ThemeToggle } from "@/components/theme-toggle";

const REPO_URL = "https://github.com/uzairahmed1091/structured-data-extractor";

/**
 * The page scrolls: a short pitch, then the tool. The workspace below is sized to the
 * viewport on desktop and its two panes scroll internally, so once a visitor reaches it
 * the document and the results stay side by side.
 */
export default function Home() {
  return (
    <main id="top" className="relative flex min-h-dvh flex-col">
      <header className="border-b border-rule bg-paper">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 lg:px-6">
          <a
            href="#top"
            className="flex min-h-11 items-center text-base font-semibold tracking-tight"
          >
            <span className="mr-1.5 rounded-[2px] bg-mark px-1 text-on-mark">Cited</span>
            Extract
          </a>
          <span className="eyebrow text-ink-3">Open-source demo</span>
          <div className="ml-auto flex items-center gap-1">
            <a
              href={REPO_URL}
              className="flex min-h-11 items-center gap-2 rounded px-3 text-[13px] text-ink-2 hover:bg-raise hover:text-ink"
            >
              <svg
                viewBox="0 0 16 16"
                width="15"
                height="15"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" />
              </svg>
              Source on GitHub
            </a>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <section className="mx-auto grid w-full max-w-[1320px] items-center gap-x-14 gap-y-10 px-4 pt-10 pb-10 lg:grid-cols-2 lg:px-6 lg:pt-14">
        <div className="flex flex-col items-start gap-5">
          <h1 className="text-[clamp(2.125rem,4.6vw,3.375rem)] leading-[1.06] font-semibold tracking-[-0.03em]">
            Typed JSON from documents,{" "}
            <span className="rounded-[2px] bg-mark box-decoration-clone px-1.5 text-on-mark">
              with receipts.
            </span>
          </h1>
          <p className="max-w-[520px] text-[17px] leading-relaxed text-ink-2">
            Define a schema, paste a document or drop in a PDF, and get validated JSON
            where every value cites the exact span it came from. Fields the document
            doesn&apos;t contain come back <span className="font-mono text-ink">null</span>,
            never a plausible guess.
          </p>
          <div className="flex flex-wrap items-center gap-2.5">
            <a
              href="#workspace"
              className="flex min-h-11 items-center rounded bg-ink px-4.5 text-sm font-medium text-paper hover:opacity-85"
            >
              Try it on a sample
            </a>
            <a
              href={REPO_URL}
              className="flex min-h-11 items-center rounded border border-rule px-3.5 text-sm hover:border-ink"
            >
              Read the code
            </a>
          </div>
          <p className="eyebrow text-ink-3">Next.js · Zod · OpenAI structured outputs</p>
        </div>

        {/* One real excerpt and the three values it produces: the whole idea in a glance. */}
        <div className="panel overflow-hidden">
          <div className="flex flex-col gap-2.5 px-5 pt-4.5 pb-5">
            <span className="eyebrow text-ink-3">Source · services agreement</span>
            <p className="font-mono text-[13px] leading-[1.75] text-ink-2">
              …Client shall pay Provider{" "}
              <mark className="cite">a total fee of $148,500</mark>. Provider shall invoice
              Client monthly in arrears. …{" "}
              <mark className="cite">The Agreement does not renew automatically</mark>; any
              extension requires a written amendment…
            </p>
          </div>
          <div className="flex flex-col gap-2.5 border-t border-rule bg-raise px-5 pt-4.5 pb-5">
            <span className="eyebrow text-ink-3">Output · validated against your schema</span>
            <dl className="flex flex-col gap-2 font-mono text-[13px]">
              {(
                [
                  ["total_fee_usd", "148500", "found"],
                  ["auto_renews", "false", "found"],
                  ["termination_notice_days", "null", "not_found"],
                ] as const
              ).map(([key, value, status]) => (
                <div key={key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <div>
                    <dt className="inline text-ink-3">&quot;{key}&quot;:</dt>{" "}
                    <dd className="inline">{value}</dd>
                  </div>
                  <StatusChip status={status} />
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      <section className="mx-auto flex w-full max-w-[1320px] flex-col gap-3.5 px-4 pb-10 lg:px-6">
        <h2 className="eyebrow text-ink-3">Three things can come back</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Outcome
            title="Backed by the document"
            status="found"
            body="Every value carries the exact quote it came from. The quote is located in the source before the value is accepted."
          >
            <span className="font-mono text-[15px] font-medium">30</span>
            <mark className="cite text-[12.5px]">within thirty (30) days of receipt</mark>
          </Outcome>
          <Outcome
            title="Silent means null"
            status="not_found"
            body="If the document doesn't state a field, it comes back null and renders as not found. No guess from what a contract usually says."
          >
            <span className="font-mono text-[15px] font-medium text-ink-3">null</span>
          </Outcome>
          <Outcome
            title="No quote, no value"
            status="unverified"
            label="discarded"
            body="A value whose quote can't be found in the source, or that fails its declared type, is thrown away and shown as rejected."
          >
            <span className="font-mono text-[15px] font-medium text-flag line-through">60</span>
            <span className="font-mono text-[15px] font-medium text-ink-3">null</span>
          </Outcome>
        </div>
      </section>

      <Extractor />

      <footer className="mt-auto border-t border-rule">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-4 text-[13px] text-ink-2 lg:px-6">
          <span>
            The shared demo key is limited to 10 runs per hour. Bring your own key to skip
            the limit.
          </span>
          <a href={REPO_URL} className="flex min-h-11 items-center underline underline-offset-2 hover:text-ink">
            Open source on GitHub
          </a>
        </div>
      </footer>
    </main>
  );
}

function Outcome({
  title,
  status,
  label,
  body,
  children,
}: {
  title: string;
  status: React.ComponentProps<typeof StatusChip>["status"];
  label?: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-rule bg-paper px-5 py-4.5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
        <StatusChip status={status} label={label} />
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1.5">{children}</div>
      <p className="text-[13px] text-ink-2">{body}</p>
    </div>
  );
}
