import { useEffect, useRef, useState } from "react";
import { Dialog } from "../../components/Dialog";
import { cropRectangle, imageKind, SCREEN_HEIGHT, SCREEN_WIDTH } from "./crop";
export interface ImageSource {
  image: HTMLImageElement;
  url: string;
  filename: string;
}
export async function inspectImage(
  file: File,
  bytes: Uint8Array,
): Promise<ImageSource | null> {
  if (imageKind(bytes) !== "static") return null;
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
    if (
      image.naturalWidth > 8192 ||
      image.naturalHeight > 8192 ||
      image.naturalWidth * image.naturalHeight > 16_777_216
    )
      throw new Error("图片尺寸过大，请先缩小到 1600 万像素以内。");
    if (
      image.naturalWidth === SCREEN_WIDTH &&
      image.naturalHeight === SCREEN_HEIGHT
    ) {
      URL.revokeObjectURL(url);
      return null;
    }
    return { image, url, filename: file.name };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}
export function ImageComposer({
  source,
  onClose,
  onApply,
}: {
  source: ImageSource;
  onClose: () => void;
  onApply: (file: File) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [x, setX] = useState(0.5);
  const [y, setY] = useState(0.5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    const crop = cropRectangle(
      source.image.naturalWidth,
      source.image.naturalHeight,
      zoom,
      x,
      y,
    );
    context.fillStyle = "#000";
    context.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      source.image,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      SCREEN_WIDTH,
      SCREEN_HEIGHT,
    );
  }, [source, zoom, x, y]);
  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.current!.toBlob(
          (blob) =>
            blob ? resolve(blob) : reject(new Error("图片无法转换，请重试。")),
          "image/png",
        ),
      );
      if (alive.current)
        onApply(
          new File(
            [blob],
            `${source.filename.replace(/\.[^.]*$/, "")}-160x80.png`,
            { type: "image/png" },
          ),
        );
    } catch (cause) {
      if (alive.current)
        setError(cause instanceof Error ? cause.message : "图片转换失败。");
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Dialog
      title="调整屏幕画面"
      onClose={onClose}
      actions={
        <>
          <button className="secondary-button" autoFocus onClick={onClose}>
            取消
          </button>
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => void apply()}
          >
            {busy ? "转换中…" : "使用此画面"}
          </button>
        </>
      }
    >
      <p>
        {source.filename} · {source.image.naturalWidth} ×{" "}
        {source.image.naturalHeight} 像素
      </p>
      <div className="crop-preview">
        <canvas
          ref={canvas}
          width={SCREEN_WIDTH}
          height={SCREEN_HEIGHT}
          role="img"
          aria-label="160 × 80 裁剪预览"
        />
      </div>
      <div className="crop-controls">
        <label>
          缩放 <output>{zoom.toFixed(1)}×</output>
          <input
            aria-label="缩放"
            type="range"
            min="1"
            max="4"
            step="0.1"
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
        </label>
        <label>
          水平位置
          <input
            aria-label="水平位置"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={x}
            onChange={(event) => setX(Number(event.target.value))}
          />
        </label>
        <label>
          垂直位置
          <input
            aria-label="垂直位置"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={y}
            onChange={(event) => setY(Number(event.target.value))}
          />
        </label>
      </div>
      <p className="field-hint">
        将预览区域转换为 160 × 80 的
        PNG，透明部分合成到黑底。原文件保持不变；此步骤不会写入键盘。
      </p>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
