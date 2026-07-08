import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-col items-center gap-6 py-20 text-center">
      <h1 className="max-w-2xl text-4xl font-bold leading-tight">
        Forecast the winner <span className="text-neutral-400">and</span> the
        margin of victory.
      </h1>
      <p className="max-w-xl text-neutral-400">
        One shared pool per event, two ways in: tradable regular predictions
        (exit anytime, live DEX prices) and locked all-or-nothing dominance
        convictions that pay more the rarer the call. Settled trustlessly on
        Stellar. The pool swallows every failed conviction — and grows.
      </p>
      <div className="flex gap-3">
        <Link
          href="/markets"
          className="rounded bg-neutral-100 px-5 py-2.5 font-medium text-neutral-900 hover:bg-white"
        >
          Browse markets
        </Link>
        <Link
          href="/how-it-works"
          className="rounded border border-neutral-700 px-5 py-2.5 text-neutral-300 hover:border-neutral-500"
        >
          How it works
        </Link>
      </div>
      <p className="text-xs text-neutral-600">
        Landing ticker, biggest pools, and recent settlements land in Phase 1.8.
      </p>
    </div>
  );
}
