import Link from "next/link";

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-20 flex-col gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="flex flex-col gap-3 text-sm leading-relaxed text-neutral-300">{children}</div>
    </section>
  );
}

export default function HowItWorksPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-10">
      <div>
        <h1 className="text-2xl font-semibold">How Bakunawa works</h1>
        <p className="mt-2 text-sm text-neutral-400">
          A dominance prediction market: forecast the winner and the margin of victory,
          in one shared pool.
        </p>
      </div>

      <Section title="One pool, two instruments">
        <p>
          Every market asks two questions: <b>who wins</b>, and <b>by how much</b>. Both
          kinds of prediction share a single pot.
        </p>
        <p>
          A <b>regular prediction</b> backs just the winner. You mint tradable pool
          tickets at par ($1 = $1 of stake) and can <b>sell them anytime before lock</b>{" "}
          on Stellar&apos;s DEX — buy at 0.55, sell at 0.80 on news, realize gains before
          the event even settles. Selling transfers the claim, never the cash: the money
          never leaves the pot, so a fleeing side just trades at a discount.
        </p>
        <p>
          A <b>conviction</b> backs the winner plus a minimum margin. It is{" "}
          <b>locked at entry — no exit, no transfer, all-or-nothing</b>: it wins only if
          your side wins by at least the margin you called (an exact hit wins). SAS +20
          losing on a 19-point win is the point, not a bug.
        </p>
      </Section>

      <Section title="How the pool pays out">
        <p>
          Every losing stake — wrong winner or unmet margin — funds the winners, split by
          weight:
        </p>
        <pre className="overflow-x-auto rounded border border-neutral-800 bg-neutral-900 px-4 py-3 text-xs">
          Weight = Stake × (SideStake / S(m)){"\n"}Payout = Stake + Weight / ΣWeights ×
          (LosingPool − Rake)
        </pre>
        <p>
          Regular tickets carry weight 1.0. A conviction&apos;s multiplier is the inverse
          of how much of your side&apos;s money went at least as aggressive as you —{" "}
          <b>S(m)</b>. Rare calls earn bigger multipliers, priced entirely by where the
          crowd put its money and self-balancing as stakes move.
        </p>
      </Section>

      <Section title="The variance transfer (shown, not hidden)">
        <p>
          The two classes trade variance with each other. Regulars are structurally short
          the convictions on their side: they <b>outperform</b> a plain winner market when
          convictions die (their banked stakes swell the pool), and <b>underperform</b>{" "}
          when a conviction lands and takes its share. Every ticket shows the open
          conviction exposure circling its side — the &quot;sharks circling.&quot; Nothing
          about the trade is hidden.
        </p>
      </Section>

      <Section id="multiplier-vs-odds" title="A multiplier is not fixed odds">
        <p>
          <b>The multiplier is a relative weight, never a fixed-odds promise.</b> When a
          long shot lands, everyone below it on the same side also wins (nested
          thresholds) and shares the pool — a ×30 statistical weight can settle to +482%,
          not ×30. &quot;×100 returns&quot; only materialize when the opposing pool is fat
          and the winning side thin.
        </p>
        <p>
          This is solvency by construction — the pool can never owe more than it holds. So
          every rung shows a live <i>&quot;if settled now&quot;</i> implied payout instead
          of dressing the multiplier up as bookmaker odds. Guaranteed fixed odds would
          require a house taking risk; Bakunawa has none.
        </p>
      </Section>

      <Section title="The crowd forecast">
        <p>
          The pool&apos;s state inverts into a live <b>crowd-implied margin
          distribution</b> — &quot;the crowd says 34% chance OKC wins by 10+.&quot; It
          leads every market page and is served as a public API. That published forecast,
          not the payout, is the headline: it is what makes Bakunawa a prediction market
          rather than a betting product.
        </p>
      </Section>

      <Section title="Dead convictions bank into the pool">
        <p>
          Convictions that die mid-event stay <b>banked in the pool</b> until settlement —
          never paid out early, because the dead predictor&apos;s own side may still win.
          Watch the pool grow as convictions fail: the serpent swallowing the moon, the
          Bakunawa moment.
        </p>
      </Section>

      <Section title="Settlement">
        <p>
          <b>Crypto markets</b> settle trustlessly from a named Reflector price feed at
          the settlement timestamp — the % move from the listing snapshot, rounded to two
          decimals. Exactly 0.00% means no winner and full refunds.{" "}
          <b>Curated sports markets</b> post the result from the named official source.
          Winners claim pull-based; the contract never mass-pushes, and holds no authority
          to move funds outside settlement logic.
        </p>
      </Section>

      <p className="text-sm text-neutral-500">
        Ready to try it?{" "}
        <Link href="/markets" className="underline">
          Browse live markets
        </Link>
        . Every number is computed in your browser from on-chain pool state.
      </p>
    </div>
  );
}
