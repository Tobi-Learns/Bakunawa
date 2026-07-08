import { ImageResponse } from "next/og";
import { OgFrame, brandImageSize } from "../../brand-image";

export const size = brandImageSize;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const marketId = /^\d+$/.test(id) ? id : "market";

  return new ImageResponse(
    (
      <OgFrame
        kicker="Bakunawa market"
        title={`Market #${marketId}`}
        body="Live pool, ladder, and crowd-implied dominance forecast on Stellar."
        badge="Trade tickets or lock a conviction"
      />
    ),
    size,
  );
}
