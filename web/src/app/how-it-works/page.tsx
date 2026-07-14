import Link from "next/link";

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-20 flex-col gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="flex flex-col gap-3 text-sm leading-relaxed text-ink-secondary">{children}</div>
    </section>
  );
}

export default function HowItWorksPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-10">
      <div>
        <h1 className="text-2xl font-semibold">How Bakunawa works</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          A dominance prediction market: forecast the winner and the margin of victory,
          in one shared pool.
        </p>
      </div>

      <Section title="One pool, two instruments">
        <p>
          Every market asks two questions: <b>who wins</b>, and <b>by how much</b>. Both
          kinds of prediction share a single pool.
        </p>
        <p>
          A <b>neutral prediction</b> backs just the winner — neutral on the margin. You mint
          tradable pool shares at the <b>live price</b> — the side&apos;s money-share, so the
          heavier (more favored) side costs more per share and buying the under-backed side is
          cheap. Early / contrarian money is rewarded; late piling of the near-certain side is
          priced out. You can <b>buy and sell anytime before lock</b>{" "}
          on Stellar&apos;s DEX — buy at 0.55, sell at 0.80 on news, cash out
          your gains before the event even settles, exactly like an order-book prediction
          market. The share price is the live winner forecast.
        </p>
        <p>
          A <b>conviction</b> is the <b>same priced-share buy</b>, but on a specific minimum
          margin and <b>locked at entry — no exit, no transfer, all-or-nothing</b>: it wins
          only if your side wins by at least the margin you called (an exact hit wins). A
          deeper margin is a rarer call, so its shares are <b>cheaper</b> — the same dollar
          buys more of them. The reward for conviction lives in the price you pay, not a bonus
          at settlement. SAS +20 losing on a 19-point win is the point, not a bug.
        </p>
      </Section>

      <Section title="Dynamic share pricing">
        <p>
          <b>Every</b> share — neutral or conviction — mints at a <b>dynamic price = the
          crowd&apos;s implied probability</b>. A 50/50 book prices at <b>$0.50</b>, running
          from <b>$0.01 to $0.99</b> as a side nears certainty or a long-shot margin stays
          rare — Polymarket-style. A neutral share prices off the whole side; a conviction
          prices off how much money went at least as deep as its margin.
        </p>
        <p>
          So the favored side (and shallow margins) are dearer, the under-backed side (and
          deep margins) cheap: <b>early and contrarian money gets more shares per dollar</b>,
          while piling the near-certain side late — the classic information snipe that dilutes
          early holders — is priced out. Every dollar enters the same pot, so there is <b>no
          market-maker subsidy to drain</b> — solvent by construction (a dynamic{" "}
          <i>parimutuel</i> works where an LMSR maker would not).
        </p>
        <p>
          One honest caveat vs Polymarket: the price is a <b>probability</b>, but a winning
          share <b>does not pay a fixed $1</b> — it pays a <b>parimutuel pool split</b> (its
          slice of the whole pot), which can be more or less than $1. On a cancel it redeems
          at its money-backing.
        </p>
      </Section>

      <Section title="How the pool pays out">
        <p>
          At settlement the pot is one share-denominated pool. Winners are every share on the
          winning side whose margin was met (rung ≤ the actual margin). Every losing stake —
          wrong winner, or a winning-side margin that missed — funds them, split by{" "}
          <b>share count</b>:
        </p>
        <pre className="overflow-x-auto rounded-xl border border-line bg-panel px-4 py-3 text-xs">
          per-share payout = money-backing + (LosingPool − Fee) / WinningShares
        </pre>
        <p>
          There is no separate multiplier: a deep conviction earns more simply because it{" "}
          <b>bought more shares cheaply</b>. The rarity reward is priced at the buy, then
          every winning share splits the pool the same way. Solvent by construction — the
          split sets only proportions, never the total.
        </p>
      </Section>

      <Section title="The variance transfer (shown, not hidden)">
        <p>
          The two classes trade variance with each other. Neutrals are structurally short
          the convictions on their side: they <b>outperform</b> a plain winner market when
          convictions die (their banked stakes swell the pool), and <b>underperform</b>{" "}
          when a conviction lands and takes its share. Every share shows the open
          conviction exposure circling its side — the &quot;sharks circling.&quot; Nothing
          about the trade is hidden.
        </p>
      </Section>

      <Section id="multiplier-vs-odds" title="A share price is not a fixed payout">
        <p>
          <b>The price you pay is a probability; the payout is a pool split, not a fixed
          $1.</b> Unlike an order-book market where a winning share always redeems for $1,
          here every winning share splits the raked losing pool — so a share bought at
          $0.20 can settle well above or below $1 depending on how fat the opposing pool is
          and how thin the winning side. Nested thresholds compound this: when a long-shot
          margin lands, everyone below it on the same side wins too and shares the pot.
        </p>
        <p>
          This is solvency by construction — the pool can never owe more than it holds. So
          every rung shows a live <i>&quot;if settled now&quot;</i> implied payout <b>range</b>
          rather than a single promised figure. Guaranteed fixed odds would require a house
          taking risk; Bakunawa has none.
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

      <p className="text-sm leading-relaxed text-ink-muted">
        Ready to try it?{" "}
        <Link href="/markets" className="underline">
          Browse live markets
        </Link>
        . Every number is computed in your browser from on-chain pool state.
      </p>
    </div>
  );
}
