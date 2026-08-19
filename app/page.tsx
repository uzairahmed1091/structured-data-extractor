import { Extractor } from "@/components/extractor";

export default function Home() {
  return (
    <main className="min-h-dvh">
      <header className="border-b border-rule bg-paper">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-4 lg:px-6">
          <h1 className="text-base font-semibold tracking-tight">Cited Extract</h1>
          <p className="text-sm text-ink-2">
            Typed JSON from any document — every value shows the text it came from, and
            fields the document doesn&apos;t contain come back{" "}
            <span className="font-mono">null</span>.
          </p>
        </div>
      </header>
      <Extractor />
    </main>
  );
}
