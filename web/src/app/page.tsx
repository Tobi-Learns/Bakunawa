import Image from "next/image";
import Link from "next/link";
import { LandingMarkets } from "@/components/landing-markets";
import { ui } from "@/lib/ui";

function EclipseHero() {
  return (
    <div className="relative mx-auto grid h-56 w-full max-w-md shrink-0 place-items-center sm:h-72 lg:mx-0 lg:h-80 lg:max-w-xl">
      <div
        className="absolute inset-6 rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(239,68,68,0.2), transparent 72%)" }}
      />
      <Image
        src="/brand/bakunawa-logo-wide.png"
        alt=""
        width={640}
        height={427}
        priority
        className="hero-logo-fade relative h-full w-full object-cover drop-shadow-[0_22px_70px_rgba(239,68,68,0.16)]"
      />
    </div>
  );
}

const principles = [
  {
    number: "01",
    title: "Predict or convict",
    body: "Back a winner with tradable shares, or lock a conviction on the margin. The rarer the call, the cheaper the shares — so your dollar buys more of them.",
  },
  {
    number: "02",
    title: "Watch the pool swallow",
    body: "Convictions that die mid-event bank into the pool — it visibly grows, and every surviving position pays more.",
  },
  {
    number: "03",
    title: "Settle on-chain",
    body: "Crypto markets settle trustlessly from a Reflector price feed. Winners pull their payout; the contract never mass-pushes.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-col gap-16 py-4 sm:gap-20 sm:py-8">
      <section className="grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-12">
        <EclipseHero />
        <div className="flex flex-col items-center gap-5 text-center lg:items-start lg:text-left">
          <span className={ui.eyebrow}>Dominance prediction market · Stellar</span>
          <h1 className="max-w-2xl text-4xl font-bold leading-[1.08] tracking-tight text-ink sm:text-5xl lg:text-6xl">
            Forecast the winner <span className="text-ink-subtle">—</span> and how big.
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-ink-secondary sm:text-xl">
            The prediction market that rewards conviction: the bolder your call, the bigger
            your share when it lands.
          </p>
          <p className="max-w-xl leading-relaxed text-ink-muted">
            Trade in and out at live prices, or lock a dominance call and let the rarest
            correct forecast take the biggest cut.
          </p>
          <p className="max-w-xl text-sm leading-relaxed text-action">
            Named for the serpent that swallows the moon — the pool swallows every failed
            conviction, and grows.
          </p>
          <div className="flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row lg:justify-start">
            <Link href="/markets" className={`${ui.buttonPrimary} px-5`}>
              Browse markets
            </Link>
            <Link href="/how-it-works" className={`${ui.buttonSecondary} px-5`}>
              How it works
            </Link>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-5" aria-labelledby="live-markets-heading">
        <div className="flex items-end justify-between gap-4">
          <div>
            <span className={ui.eyebrow}>Live signal</span>
            <h2 id="live-markets-heading" className="mt-1 text-2xl font-semibold tracking-tight">
              Crowd forecasts
            </h2>
          </div>
          <Link href="/markets" className="inline-flex min-h-11 items-center text-sm text-ink-muted hover:text-ink">
            View all →
          </Link>
        </div>
        <LandingMarkets />
      </section>

      <section className="grid gap-4 sm:grid-cols-3" aria-label="How Bakunawa works">
        {principles.map((principle) => (
          <div key={principle.title} className={`${ui.card} p-5`}>
            <div className="mb-5 font-mono text-xs text-action">{principle.number}</div>
            <h3 className="mb-2 font-semibold text-ink">{principle.title}</h3>
            <p className="text-sm leading-relaxed text-ink-muted">{principle.body}</p>
          </div>
        ))}
      </section>

      <p className="mx-auto max-w-3xl text-center text-xs leading-relaxed text-ink-subtle">
        A share&apos;s price is a probability, but its payout is a parimutuel pool split —
        not a fixed $1. Every market shows live implied payouts.{" "}
        <Link href="/how-it-works#multiplier-vs-odds" className="underline decoration-line-strong underline-offset-4 hover:text-ink-secondary">
          Why that matters
        </Link>
        .
      </p>
    </div>
  );
}
