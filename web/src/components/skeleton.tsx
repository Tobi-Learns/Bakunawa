export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
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
