export default function HowItWorksPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">How Bakunawa works</h1>
      <section className="flex flex-col gap-3 text-sm leading-relaxed text-neutral-300">
        <p>
          Every market asks two questions: <b>who wins</b>, and <b>by how much</b>. A
          standard prediction backs just the winner. A <b>dominance prediction</b> backs
          the winner plus a minimum margin — and wins only if the actual margin is at
          least what you predicted (an exact hit wins).
        </p>
        <p>
          All stakes share <b>one parimutuel pool</b>. Every losing stake — wrong winner
          or unmet margin — funds the winners, split by weight:
        </p>
        <pre className="rounded border border-neutral-800 bg-neutral-900 px-4 py-3 text-xs">
          Weight = Stake × (SideStake / S(m)){"\n"}Payout = Stake + Weight / ΣWeights ×
          (LosingPool − Rake)
        </pre>
        <p>
          <b>S(m)</b> is how much of your side&apos;s money went at least as aggressive
          as you. Picking a rarely-backed margin earns a bigger multiplier — priced
          entirely by where the crowd put its money, self-balancing as stakes move.
        </p>
        <p id="multiplier-vs-odds" className="scroll-mt-20">
          <b>A multiplier is a relative weight, never fixed odds.</b> When a long shot
          lands, everyone below it on the same side also wins and shares the pool. That
          is why every rung shows a live <i>&quot;if settled now&quot;</i> payout instead
          of dressing the multiplier up as bookmaker odds — the pool can never owe more
          than it holds.
        </p>
        <p>
          Dominance bets that die mid-event stay <b>banked in the pool</b> until
          settlement — never paid out early, because the dead bettor&apos;s own side may
          still win. Watch the pool grow as convictions fail: that is the Bakunawa
          moment.
        </p>
        <p className="text-neutral-500">
          Full mechanics explainer, worked examples, and settlement rules ship with
          Phase 1.8.
        </p>
      </section>
    </div>
  );
}
