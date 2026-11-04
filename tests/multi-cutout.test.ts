import { describe, expect, it } from "vitest";
import { buildObjectPrompt, type SegmentationMaskRecord } from "@meta-sam/parser";
import { AiFailure } from "@/lib/ai/guard";
import { selectBoxMaskRecord } from "@/lib/ai/cutout";
import { isMultiCutoutEnabled } from "@/lib/server/env";
import { MULTI_CUTOUT_SCALE, containedImageRect, defaultItemBox, normalizeDraggedBox, percentBoundsToBox, pointToNormalizedBoxPoint } from "@/lib/client/multi-cutout";

function fakeMask(objectId: string, frameIndex?: number): SegmentationMaskRecord {
  return {
    kind: "mask",
    order: 0,
    objectId,
    frame: frameIndex === undefined ? undefined : { frameIndex },
    identity: `image:${frameIndex ?? "*"}:${objectId}`,
    revision: 1,
    mask: { encoding: "one_bit", payload: "", width: 1, height: 1 },
    bounds: { left: 0, top: 0, right: 1, bottom: 1 },
  };
}

describe("multi-cutout object prompt and mask selection", () => {
  it("is independently disabled by default", () => {
    const previous = process.env.AI_MULTI_CUTOUT_ENABLED;
    delete process.env.AI_MULTI_CUTOUT_ENABLED;
    expect(isMultiCutoutEnabled()).toBe(false);
    process.env.AI_MULTI_CUTOUT_ENABLED = "true";
    expect(isMultiCutoutEnabled()).toBe(true);
    if (previous === undefined) delete process.env.AI_MULTI_CUTOUT_ENABLED;
    else process.env.AI_MULTI_CUTOUT_ENABLED = previous;
  });
  it("uses the public helper with half-open native bounds and object id 1", () => {
    expect(buildObjectPrompt({
      size: { width: 200, height: 100 },
      objects: [{ id: 1, prompts: [{ frame: 0, box: { left: 10, top: 20, right: 80, bottom: 60 } }] }],
    })).toBe("<0f>1<|box;x1=10;y1=20;x2=79;y2=59;w=200;h=100|>");
  });

  it("accepts exactly one matching object and rejects 0, wrong, duplicate, or 3 results", () => {
    expect(selectBoxMaskRecord([fakeMask("1")]).objectId).toBe("1");
    for (const records of [[], [fakeMask("2")], [fakeMask("1"), fakeMask("1")], [fakeMask("1"), fakeMask("2"), fakeMask("3")]]) {
      expect(() => selectBoxMaskRecord(records)).toThrow(AiFailure);
    }
  });
});

describe("multi-cutout object-contain coordinates", () => {
  it("maps a landscape 2:1 image inside a 4:3 surface without counting letterbox bars", () => {
    expect(containedImageRect(400, 300, 200, 100)).toEqual({ left: 0, top: 50, width: 400, height: 200 });
    expect(pointToNormalizedBoxPoint({ clientX: 200, clientY: 150, containerLeft: 0, containerTop: 0, containerWidth: 400, containerHeight: 300, imageWidth: 200, imageHeight: 100 }))
      .toEqual({ x: 500000, y: 500000 });
    expect(pointToNormalizedBoxPoint({ clientX: 200, clientY: 25, containerLeft: 0, containerTop: 0, containerWidth: 400, containerHeight: 300, imageWidth: 200, imageHeight: 100 })).toBeNull();
  });

  it("maps portrait letterboxing and preserves edge boxes", () => {
    expect(containedImageRect(400, 300, 100, 200)).toEqual({ left: 125, top: 0, width: 150, height: 300 });
    const edge = normalizeDraggedBox({ x: 0, y: 0 }, { x: MULTI_CUTOUT_SCALE, y: MULTI_CUTOUT_SCALE });
    expect(edge).toEqual({ left: 0, top: 0, right: MULTI_CUTOUT_SCALE, bottom: MULTI_CUTOUT_SCALE });
  });

  it("rejects tiny/nonempty mistakes and supports numeric bounds", () => {
    expect(normalizeDraggedBox({ x: 100, y: 100 }, { x: 200, y: 200 })).toBeNull();
    expect(percentBoundsToBox({ left: 10, top: 20, right: 90, bottom: 80 })).toEqual({ left: 100000, top: 200000, right: 900000, bottom: 800000 });
  });

  it("provides useful default boxes for keyboard-created items", () => {
    expect(defaultItemBox(1)).toEqual({ left: 150000, top: 150000, right: 850000, bottom: 850000 });
    expect(defaultItemBox(3)).toEqual({ left: 250000, top: 250000, right: 750000, bottom: 750000 });
  });
});
