import { describe, expect, it } from "vitest";
import { isSuggestionApplied, type ListingSuggestionState, type SuggestionValues } from "@/lib/client/suggestion-state";

const suggestion: SuggestionValues = {
  title: "Desk chair",
  description: "A padded chair with visible wear.",
  category_slug: "furniture",
  tags: ["chair", "seat"],
};

const applied: ListingSuggestionState = {
  title: "Desk chair",
  description: "A padded chair with visible wear.",
  categorySlug: "furniture",
  tags: ["chair", "seat"],
};

describe("AI suggestion applied state", () => {
  it("marks each field applied only when the current value matches its suggestion", () => {
    expect(isSuggestionApplied("title", suggestion, applied)).toBe(true);
    expect(isSuggestionApplied("description", suggestion, applied)).toBe(true);
    expect(isSuggestionApplied("category_slug", suggestion, applied)).toBe(true);
    expect(isSuggestionApplied("tags", suggestion, applied)).toBe(true);
  });

  it("allows a suggestion to be reapplied after the seller edits the field away", () => {
    expect(isSuggestionApplied("title", suggestion, { ...applied, title: "Wooden desk chair" })).toBe(false);
    expect(isSuggestionApplied("description", suggestion, { ...applied, description: "Seller-written details" })).toBe(false);
    expect(isSuggestionApplied("category_slug", suggestion, { ...applied, categorySlug: "home" })).toBe(false);
    expect(isSuggestionApplied("tags", suggestion, { ...applied, tags: ["chair"] })).toBe(false);
  });

  it("does not report empty or reordered suggestions as applied", () => {
    expect(isSuggestionApplied("title", { title: null }, { ...applied, title: "" })).toBe(false);
    expect(isSuggestionApplied("tags", suggestion, { ...applied, tags: ["seat", "chair"] })).toBe(false);
  });
});
