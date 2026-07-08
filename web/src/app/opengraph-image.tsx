import { ImageResponse } from "next/og";
import { OgFrame, brandImageSize } from "./brand-image";

export const size = brandImageSize;
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <OgFrame
        kicker="Bakunawa · Stellar"
        title="Forecast the winner and how big."
        body="A dominance prediction market where the pool rewards conviction."
        badge="Blood moon, fierce conviction, live crowd forecasts"
      />
    ),
    size,
  );
}
