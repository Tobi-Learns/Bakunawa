import { useId } from "react";

// Bakunawa brand mark: a fierce serpent-dragon taking the blood moon.
// Drawn as an insignia, not a mascot: angular head, open maw, dorsal spikes.
export function BrandMark({
  size = 28,
  className = "",
  title,
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  const rawId = useId().replace(/:/g, "");
  const moon = `baku-moon-${rawId}`;
  const serpent = `baku-serpent-${rawId}`;
  const aura = `baku-aura-${rawId}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title && <title>{title}</title>}
      <defs>
        <radialGradient id={aura} cx="50%" cy="42%" r="68%">
          <stop offset="0%" stopColor="#ef4444" stopOpacity="0.2" />
          <stop offset="62%" stopColor="#0f172a" stopOpacity="0.42" />
          <stop offset="100%" stopColor="#020617" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={moon} cx="36%" cy="30%" r="68%">
          <stop offset="0%" stopColor="#fecaca" />
          <stop offset="46%" stopColor="#ef4444" />
          <stop offset="100%" stopColor="#7f1d1d" />
        </radialGradient>
        <linearGradient id={serpent} x1="5" x2="62" y1="55" y2="9">
          <stop offset="0%" stopColor="#022c22" />
          <stop offset="46%" stopColor="#0f766e" />
          <stop offset="100%" stopColor="#2dd4bf" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="31" fill={`url(#${aura})`} />
      <circle cx="25" cy="24" r="15.5" fill={`url(#${moon})`} />
      <path
        d="M15 20 C 21 27 31 28 40 22"
        stroke="#450a0a"
        strokeOpacity="0.38"
        strokeWidth="3.4"
        strokeLinecap="round"
      />
      <path
        d="M5 48 C 16 35 30 38 38 51 C 47 47 52 39 52 30 C 52 22 48 16 42 11"
        stroke="#010f0d"
        strokeWidth="13.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 48 C 16 35 30 38 38 51 C 47 47 52 39 52 30 C 52 22 48 16 42 11"
        stroke={`url(#${serpent})`}
        strokeWidth="8.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M39 8 C 51 6 61 13 63 25 C 55 21 49 24 42 33 C 44 23 43 15 39 8Z"
        fill={`url(#${serpent})`}
      />
      <path d="M43 24 L63 25 L43 36 Z" fill="#020617" opacity="0.94" />
      <path d="M42 36 L48 35 L43 43 Z" fill="#f8fafc" opacity="0.95" />
      <path d="M54 25 L61 25.5 L55 32 Z" fill="#f8fafc" opacity="0.95" />
      <path d="M39 8 L36 1 L48 8 Z" fill="#021c18" />
      <path d="M49 12 L53 4 L56 16 Z" fill="#021c18" />
      <path d="M34 51 L30 61 L24 52 Z" fill="#021c18" />
      <path
        d="M40 18 C 35 22 31 24 24 24"
        stroke="#020617"
        strokeOpacity="0.58"
        strokeWidth="4.2"
        strokeLinecap="round"
      />
      <path d="M48 15 L55 16.7 L49 19.6 Z" fill="#991b1b" />
      <path
        d="M10 47 C 20 54 30 56 40 51"
        stroke="#99f6e4"
        strokeOpacity="0.22"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function BrandWordmark({ size = 30 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <BrandMark size={size} title="Bakunawa" />
      <span className="flex flex-col leading-none">
        <span className="brand-wordmark text-[1.05rem] font-semibold">Bakunawa</span>
        <span className="hidden text-[0.55rem] font-medium uppercase tracking-[0.26em] text-[var(--baku-serpent)] sm:block">
          Dominance market
        </span>
      </span>
    </span>
  );
}
