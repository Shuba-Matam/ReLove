import { describe, expect, it } from "vitest";
import { cutoutPreviewIdentity, reconcileLoadedPreview } from "@/lib/client/cutout-preview";

describe("cutout preview readiness", () => {
  const cached = { operation_id: "11111111-1111-4111-8111-111111111111", cutout_url: "https://example.test/cutout.jpg" };

  it("retains readiness when cached success returns the same rendered preview", () => {
    const loaded = cutoutPreviewIdentity(cached);
    expect(reconcileLoadedPreview(loaded, cached)).toBe(loaded);
  });

  it("requires a new image load for a genuinely different generated result", () => {
    const loaded = cutoutPreviewIdentity(cached);
    expect(reconcileLoadedPreview(loaded, { ...cached, operation_id: "22222222-2222-4222-8222-222222222222" })).toBeNull();
    expect(reconcileLoadedPreview(loaded, { ...cached, cutout_url: "https://example.test/new-cutout.jpg" })).toBeNull();
  });
});
