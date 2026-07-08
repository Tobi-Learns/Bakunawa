import Link from "next/link";
import { LandingMarkets } from "@/components/landing-markets";

function EclipseHero() {
  // The serpent swallowing the moon — the settlement motif, large.
  return (
    <div className="relative mx-auto h-40 w-40 shrink-0">
      <div
        className="absolute inset-0 rounded-full blur-2xl"
        style={{ background: "radial-gradient(circle, rgba(56,189,248,0.25), transparent 70%)" }}
      />
      <svg viewBox="0 0 160 160" className="eclipse-drift relative">
        <defs>
          <radialGradient id="hero-moon" cx="42%" cy="38%" r="65%">
            <stop offset="0%" stopColor="#f7f1da" />
            <stop offset="100%" stopColor="#c9bd90" />
          </radialGradient>
          <mask id="hero-eclipse">
            <rect width="160" height="160" fill="white" />
            <circle cx="112" cy="66" r="50" fill="black" />
          </mask>
        </defs>
        <circle cx="72" cy="74" r="46" fill="url(#hero-moon)" mask="url(#hero-eclipse)" />
        <path
          d="M14 100 C 40 140, 104 140, 124 100 C 138 72, 128 40, 104 36"
          stroke="var(--baku-serpent)"
          strokeWidth="6"
          strokeLinecap="round"
          fill="none"
        />
        <circle cx="104" cy="36" r="6" fill="var(--baku-serpent)" />
      </svg>
    </div>
  );
}

export default function Home() {
  return (
    <div className="flex flex-col gap-16 py-8">
      {/* Hero */}
      <section className="flex flex-col items-center gap-8 text-center md:flex-row md:text-left">
        <EclipseHero />
        <div className="flex flex-col gap-5">
          <span className="text-xs font-medium uppercase tracking-widest text-[var(--baku-serpent)]">
            Dominance prediction market · Stellar
          </span>
          <h1 className="max-w-2xl text-4xl font-bold leading-tight">
            Forecast the winner <span className="text-neutral-500">—</span> and how big.
          </h1>
          <p className="max-w-xl text-lg text-neutral-300">
            The prediction market that rewards conviction: the bolder your call, the
            bigger your share when it lands.
          </p>
          <p className="max-w-xl text-neutral-400">
            Trade in and out at live prices, or lock a dominance call and let the rarest
            correct forecast take the biggest cut.
          </p>
          <p className="max-w-xl text-sm text-[var(--baku-serpent)]">
            Named for the serpent that swallows the moon — the pool swallows every failed
            conviction, and grows.
          </p>
          <div className="flex justify-center gap-3 md:justify-start">
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
        </div>
      </section>

      {/* Live markets */}
      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Live markets</h2>
          <Link href="/markets" className="text-sm text-neutral-400 hover:text-neutral-200">
            View all →
          </Link>
        </div>
        <LandingMarkets />
      </section>

      {/* Three-beat explainer */}
      <section className="grid gap-4 sm:grid-cols-3">
        {[
          {
            h: "Predict or convict",
            b: "Back a winner with tradable tickets, or lock a conviction on the margin. The rarer the call, the bigger the multiplier.",
          },
          {
            h: "Watch the pool swallow",
            b: "Convictions that die mid-event bank into the pool — it visibly grows, and every surviving position pays more.",
          },
          {
            h: "Settle on-chain",
            b: "Crypto markets settle trustlessly from a Reflector price feed. Winners pull their payout; the contract never mass-pushes.",
          },
        ].map((c) => (
          <div key={c.h} className="rounded-lg border border-neutral-800 p-4">
            <h3 className="mb-1.5 font-medium">{c.h}</h3>
            <p className="text-sm text-neutral-400">{c.b}</p>
          </div>
        ))}
      </section>

      <p className="text-center text-xs text-neutral-600">
        A multiplier is a relative weight in the pool, never fixed odds — every market
        shows live implied payouts.{" "}
        <Link href="/how-it-works#multiplier-vs-odds" className="underline">
          Why that matters
        </Link>
        .
      </p>
    </div>
  );
}
