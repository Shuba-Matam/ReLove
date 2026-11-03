export type CutoutPreviewIdentity = { operation_id: string; cutout_url: string };

export function cutoutPreviewIdentity(preview: CutoutPreviewIdentity): string {
  return `${preview.operation_id}:${preview.cutout_url}`;
}

export function reconcileLoadedPreview(currentLoadedIdentity: string | null, nextPreview: CutoutPreviewIdentity): string | null {
  const nextIdentity = cutoutPreviewIdentity(nextPreview);
  return currentLoadedIdentity === nextIdentity ? currentLoadedIdentity : null;
}
