export const MULTI_CUTOUT_SCALE = 1_000_000;

export type NormalizedCutoutBox = { left: number; top: number; right: number; bottom: number };

export function defaultItemBox(number: number): NormalizedCutoutBox {
  const offset = Math.max(0, Math.min(2, number - 1)) * 50000;
  return { left: 150000 + offset, top: 150000 + offset, right: 850000 - offset, bottom: 850000 - offset };
}

export function containedImageRect(containerWidth: number, containerHeight: number, imageWidth: number, imageHeight: number) {
  if (![containerWidth, containerHeight, imageWidth, imageHeight].every((value) => Number.isFinite(value) && value > 0)) return null;
  const scale = Math.min(containerWidth / imageWidth, containerHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return { left: (containerWidth - width) / 2, top: (containerHeight - height) / 2, width, height };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function pointToNormalizedBoxPoint(input: {
  clientX: number;
  clientY: number;
  containerLeft: number;
  containerTop: number;
  containerWidth: number;
  containerHeight: number;
  imageWidth: number;
  imageHeight: number;
}) {
  const rect = containedImageRect(input.containerWidth, input.containerHeight, input.imageWidth, input.imageHeight);
  if (!rect) return null;
  const localX = input.clientX - input.containerLeft - rect.left;
  const localY = input.clientY - input.containerTop - rect.top;
  if (localX < 0 || localY < 0 || localX > rect.width || localY > rect.height) return null;
  return {
    x: clamp(Math.round((localX / rect.width) * MULTI_CUTOUT_SCALE), 0, MULTI_CUTOUT_SCALE),
    y: clamp(Math.round((localY / rect.height) * MULTI_CUTOUT_SCALE), 0, MULTI_CUTOUT_SCALE),
  };
}

export function normalizeDraggedBox(start: { x: number; y: number }, end: { x: number; y: number }): NormalizedCutoutBox | null {
  const left = clamp(Math.min(start.x, end.x), 0, MULTI_CUTOUT_SCALE - 1);
  const top = clamp(Math.min(start.y, end.y), 0, MULTI_CUTOUT_SCALE - 1);
  const right = clamp(Math.max(start.x, end.x), 1, MULTI_CUTOUT_SCALE);
  const bottom = clamp(Math.max(start.y, end.y), 1, MULTI_CUTOUT_SCALE);
  if (right - left < 5000 || bottom - top < 5000) return null;
  return { left, top, right, bottom };
}

export function boxToPercent(box: NormalizedCutoutBox) {
  return {
    left: (box.left / MULTI_CUTOUT_SCALE) * 100,
    top: (box.top / MULTI_CUTOUT_SCALE) * 100,
    width: ((box.right - box.left) / MULTI_CUTOUT_SCALE) * 100,
    height: ((box.bottom - box.top) / MULTI_CUTOUT_SCALE) * 100,
  };
}

export function percentBoundsToBox(bounds: { left: number; top: number; right: number; bottom: number }): NormalizedCutoutBox | null {
  const values = [bounds.left, bounds.top, bounds.right, bounds.bottom];
  if (!values.every(Number.isFinite)) return null;
  return normalizeDraggedBox(
    { x: Math.round(clamp(bounds.left, 0, 100) * MULTI_CUTOUT_SCALE / 100), y: Math.round(clamp(bounds.top, 0, 100) * MULTI_CUTOUT_SCALE / 100) },
    { x: Math.round(clamp(bounds.right, 0, 100) * MULTI_CUTOUT_SCALE / 100), y: Math.round(clamp(bounds.bottom, 0, 100) * MULTI_CUTOUT_SCALE / 100) },
  );
}

export function derivedCutoutPathToDiscard(sourcePath: string, cutoutPath: string | null | undefined): string | null {
  if (!cutoutPath || cutoutPath === sourcePath) return null;
  const sourceOwner = sourcePath.split("/")[0];
  return sourceOwner && cutoutPath.startsWith(`${sourceOwner}/`) ? cutoutPath : null;
}
