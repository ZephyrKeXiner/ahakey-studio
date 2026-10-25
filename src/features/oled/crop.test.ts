import { describe, expect, it } from "vitest";
import { cropRectangle, imageKind } from "./crop";
describe("explicit static-image conversion", () => {
  it("centers a portrait image in the display aspect ratio", () => {
    expect(cropRectangle(320, 480, 1, 0.5, 0.5)).toEqual({
      x: 0,
      y: 160,
      width: 320,
      height: 160,
    });
  });
  it("keeps zoomed crops within the source at every slider edge", () => {
    for (const x of [0, 0.5, 1])
      for (const y of [0, 0.5, 1]) {
        const crop = cropRectangle(1000, 300, 4, x, y);
        expect(crop.x).toBeGreaterThanOrEqual(0);
        expect(crop.y).toBeGreaterThanOrEqual(0);
        expect(crop.x + crop.width).toBeLessThanOrEqual(1000);
        expect(crop.y + crop.height).toBeLessThanOrEqual(300);
        expect(crop.width / crop.height).toBe(2);
      }
  });
  it("keeps a screen-sized source intact at normal zoom", () => {
    expect(cropRectangle(160, 80, 1, 1, 1)).toEqual({
      x: 0,
      y: 0,
      width: 160,
      height: 80,
    });
  });
  it("does not flatten GIF or APNG into a static image", () => {
    expect(imageKind(new TextEncoder().encode("GIF89a"))).toBe("animated");
    const png = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 97, 99, 84, 76, 0, 0, 0, 0,
    ]);
    expect(imageKind(png)).toBe("animated");
    expect(imageKind(new Uint8Array([255, 216, 255]))).toBe("static");
    expect(imageKind(png.subarray(0, 15))).toBe("other");
  });
});
