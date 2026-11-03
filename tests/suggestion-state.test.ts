import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SuggestionRow } from "@/components/forms/suggestion-row";
import { isSuggestionApplied, suggestionDisplayValue, type ListingSuggestionState, type SuggestionValues } from "@/lib/client/suggestion-state";

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

  it("preserves complete long suggestion content for narrow-screen wrapping", () => {
    const longTitle = "T".repeat(100);
    const unbrokenDescription = "descriptiontoken".repeat(200).slice(0, 3000);
    const longTags = Array.from({ length: 12 }, (_, index) => `${index}`.padEnd(32, "x"));
    const longSuggestion: SuggestionValues = { title: longTitle, description: unbrokenDescription, tags: longTags };

    expect(suggestionDisplayValue("title", longSuggestion)).toBe(longTitle);
    expect(suggestionDisplayValue("description", longSuggestion)).toBe(unbrokenDescription);
    expect(suggestionDisplayValue("tags", longSuggestion)).toBe(longTags.join(", "));
    expect(suggestionDisplayValue("description", longSuggestion)).toHaveLength(3000);

    const rendered = renderToStaticMarkup(createElement(SuggestionRow, { label: "Description", value: unbrokenDescription, applied: false, onApply: () => undefined }));
    expect(rendered).toContain(unbrokenDescription);
    expect(rendered).toContain("Apply description suggestion");
    expect(rendered).toContain("overflow-wrap:anywhere");
    expect(rendered).not.toContain("truncate");
  });
});
