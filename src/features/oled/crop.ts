export const SCREEN_WIDTH = 160;
export const SCREEN_HEIGHT = 80;
export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function cropRectangle(
  width: number,
  height: number,
  zoom: number,
  x: number,
  y: number,
): Crop {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    throw new Error("图片尺寸无效。");
  const scale =
    Math.max(SCREEN_WIDTH / width, SCREEN_HEIGHT / height) *
    Math.max(1, Math.min(4, zoom));
  const croppedWidth = SCREEN_WIDTH / scale;
  const croppedHeight = SCREEN_HEIGHT / scale;
  return {
    x: Math.max(0, width - croppedWidth) * Math.max(0, Math.min(1, x)),
    y: Math.max(0, height - croppedHeight) * Math.max(0, Math.min(1, y)),
    width: croppedWidth,
    height: croppedHeight,
  };
}
export function imageKind(bytes: Uint8Array): "static" | "animated" | "other" {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "static";
  if (bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70) return "animated";
  if (
    bytes.length < 8 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every(
      (byte, index) => bytes[index] === byte,
    )
  )
    return "other";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    if (length > bytes.length - offset - 12) return "other";
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === "acTL") return "animated";
    if (type === "IEND") return "static";
    offset += length + 12;
  }
  return "other";
}
