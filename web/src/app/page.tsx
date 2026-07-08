import Link from "next/link";
import Image from "next/image";
import { LandingMarkets } from "@/components/landing-markets";

function EclipseHero() {
  return (
    <div className="relative mx-auto grid h-44 w-64 shrink-0 place-items-center overflow-hidden rounded-lg border border-red-950/50 bg-black md:h-52 md:w-80">
      <div
        className="absolute inset-0 rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(239,68,68,0.22), transparent 70%)" }}
      />
      <Image
        src="/brand/bakunawa-logo-wide.png"
        alt=""
        width={640}
        height={427}
        priority
        className="eclipse-drift relative h-full w-full object-cover drop-shadow-[0_20px_60px_rgba(239,68,68,0.18)]"
      />
    </div>
  );
}

export default function Home() {
  return (
    <div className="flex flex-col gap-16 py-8">
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

      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Live markets</h2>
          <Link href="/markets" className="text-sm text-neutral-400 hover:text-neutral-200">
            View all →
          </Link>
        </div>
        <LandingMarkets />
      </section>

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
