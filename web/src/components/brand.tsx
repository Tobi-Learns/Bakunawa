// Bakunawa brand mark — the serpent swallowing the moon (the myth is the
// mechanic: the pool swallows failed convictions; a dominant win eclipses the
// opponent). A pale moon with a crescent eclipse bite, a serpent coil beneath.

export function BrandMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden
    >
      <defs>
        <radialGradient id="baku-moon-g" cx="42%" cy="38%" r="65%">
          <stop offset="0%" stopColor="#f5efd6" />
          <stop offset="100%" stopColor="#cabf94" />
        </radialGradient>
        <mask id="baku-eclipse">
          <rect width="32" height="32" fill="white" />
          {/* the bite — serpent swallowing the moon from the right */}
          <circle cx="23" cy="13" r="9.5" fill="black" />
        </mask>
      </defs>
      {/* moon, eclipsed */}
      <circle cx="14.5" cy="14.5" r="9" fill="url(#baku-moon-g)" mask="url(#baku-eclipse)" />
      {/* serpent — a coil arcing across the eclipse seam */}
      <path
        d="M4 20 C 9 27, 20 27, 24 20 C 27 15, 25 9, 21 8"
        stroke="var(--baku-serpent)"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
      {/* serpent eye/head */}
      <circle cx="21" cy="8" r="1.6" fill="var(--baku-serpent)" />
    </svg>
  );
}

export function BrandWordmark({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <BrandMark size={size} />
      <span className="text-lg font-semibold tracking-wide">BAKUNAWA</span>
    </span>
  );
}
