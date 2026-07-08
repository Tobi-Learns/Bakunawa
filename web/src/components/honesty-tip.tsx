import Link from "next/link";

/** The multiplier-!=-odds honesty rule, everywhere a payout number appears. */
export function HonestyTip() {
  return (
    <Link
      href="/how-it-works#multiplier-vs-odds"
      className="cursor-help text-neutral-500 underline decoration-dotted underline-offset-2 hover:text-neutral-300"
      title="A multiplier is a relative weight in the pool, never a fixed-odds promise. Payouts are bounded by the losing pool and shared with every lower rung that also wins — so we always show the live implied payout instead."
    >
      multiplier ≠ odds
    </Link>
  );
}
