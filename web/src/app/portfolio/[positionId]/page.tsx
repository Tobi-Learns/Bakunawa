import Link from "next/link";

export default async function PositionPage({
  params,
}: {
  params: Promise<{ positionId: string }>;
}) {
  const { positionId } = await params;
  return (
    <div className="py-16 text-center text-sm text-neutral-400">
      <h1 className="mb-2 text-xl font-semibold text-neutral-100">
        Position {positionId}
      </h1>
      Entry, multiplier at entry vs now, and the settlement breakdown arrive in Phase
      1.5.{" "}
      <Link href="/portfolio" className="underline">
        Back to portfolio
      </Link>
    </div>
  );
}
