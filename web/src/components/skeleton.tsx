export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

/** A chart-shaped placeholder. The chart SVGs are viewBox 640×200 (= 16:5),
 *  rendered w-full, so this reserves their exact body height (plus a legend row)
 *  and the layout doesn't jump when the series loads. */
export function ChartSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="aspect-[16/5] w-full rounded" />
      <div className="flex gap-4">
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-3 w-14" />
      </div>
    </div>
  );
}

/** A market-card-shaped placeholder for the browse grid. */
export function MarketCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-neutral-800 p-4">
      <div className="flex items-start justify-between gap-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-14 rounded-full" />
      </div>
      <Skeleton className="h-3 w-40" />
      <div className="mt-2 flex items-end justify-between">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  );
}
