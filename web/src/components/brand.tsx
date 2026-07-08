import Image from "next/image";

const BRAND_MARK = "/brand/bakunawa-logo-mark.png";

export function BrandMark({
  size = 28,
  className = "",
  title,
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <Image
      src={BRAND_MARK}
      width={size}
      height={size}
      alt={title ?? ""}
      aria-hidden={title ? undefined : true}
      className={`rounded-sm object-cover ${className}`}
    />
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
