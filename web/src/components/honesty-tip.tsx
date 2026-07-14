import Link from "next/link";

/** The price-!=-fixed-payout honesty rule, everywhere a payout number appears. */
export function HonestyTip() {
  return (
    <Link
      href="/how-it-works#multiplier-vs-odds"
      className="cursor-help text-ink-muted underline decoration-dotted underline-offset-2 hover:text-ink-secondary"
      title="A share's price is a probability, but its payout is a parimutuel pool split — not a fixed $1. Payouts are bounded by the losing pool and shared with every lower rung that also wins, so we always show the live implied payout instead."
    >
      price ≠ fixed payout
    </Link>
  );
}
