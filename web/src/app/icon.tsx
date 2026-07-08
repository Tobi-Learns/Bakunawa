import { ImageResponse } from "next/og";
import { OgEmblem } from "./brand-image";

export const size = {
  width: 128,
  height: 128,
};
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#020617",
        }}
      >
        <OgEmblem size={118} />
      </div>
    ),
    size,
  );
}
