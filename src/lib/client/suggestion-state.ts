export type SuggestionValues = {
  title?: string | null;
  description?: string | null;
  category_slug?: string | null;
  tags?: string[] | null;
};

export type ListingSuggestionState = {
  title: string;
  description: string;
  categorySlug: string;
  tags: string[];
};

export function suggestionValuesForForm(suggestion: SuggestionValues): ListingSuggestionState {
  return {
    title: suggestion.title ?? "",
    description: suggestion.description ?? "",
    categorySlug: suggestion.category_slug ?? "",
    tags: suggestion.tags?.slice(0, 12) ?? [],
  };
}

export function generationSourceKey(input: { userId: string | null; imagePath: string; transcript: string; imageContext: string }): string {
  return JSON.stringify(input);
}

export function shouldApplyGenerationResult(input: { requestId: number; currentRequestId: number; requestedSource: string; currentSource: string }): boolean {
  return input.requestId === input.currentRequestId && input.requestedSource === input.currentSource;
}

export function draftIdempotencyKey(nonce: string): string {
  return `draft-${nonce}`.slice(0, 128);
}
