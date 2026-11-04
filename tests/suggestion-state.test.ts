import { describe, expect, it } from "vitest";
import { draftIdempotencyKey, generationSourceKey, shouldApplyGenerationResult, suggestionValuesForForm, type SuggestionValues } from "@/lib/client/suggestion-state";

const suggestion: SuggestionValues = {
  title: "Desk chair",
  description: "A padded chair with visible wear.",
  category_slug: "furniture",
  tags: ["chair", "seat"],
};

describe("explicit AI autofill state", () => {
  it("maps supported suggestions directly into editable form values", () => {
    expect(suggestionValuesForForm(suggestion)).toEqual({ title: "Desk chair", description: "A padded chair with visible wear.", categorySlug: "furniture", tags: ["chair", "seat"] });
    expect(suggestionValuesForForm({ title: null, tags: null })).toEqual({ title: "", description: "", categorySlug: "", tags: [] });
  });

  it("accepts only the latest response for the unchanged account and source", () => {
    const source = generationSourceKey({ userId: "user-a", imagePath: "user-a/photo.jpg", transcript: "chair", imageContext: "listing_photo" });
    expect(shouldApplyGenerationResult({ requestId: 2, currentRequestId: 2, requestedSource: source, currentSource: source })).toBe(true);
    expect(shouldApplyGenerationResult({ requestId: 1, currentRequestId: 2, requestedSource: source, currentSource: source })).toBe(false);
    expect(shouldApplyGenerationResult({ requestId: 2, currentRequestId: 2, requestedSource: source, currentSource: generationSourceKey({ userId: "user-a", imagePath: "user-a/photo.jpg", transcript: "seller edit", imageContext: "listing_photo" }) })).toBe(false);
    expect(shouldApplyGenerationResult({ requestId: 2, currentRequestId: 2, requestedSource: source, currentSource: generationSourceKey({ userId: "user-b", imagePath: "user-a/photo.jpg", transcript: "chair", imageContext: "listing_photo" }) })).toBe(false);
  });

  it("uses a fresh bounded idempotency key for each intentional click", () => {
    expect(draftIdempotencyKey("click-one")).not.toBe(draftIdempotencyKey("click-two"));
    expect(draftIdempotencyKey("x".repeat(300))).toHaveLength(128);
  });
});
