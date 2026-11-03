export type SuggestionField = "title" | "description" | "category_slug" | "tags";

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

export function isSuggestionApplied(field: SuggestionField, suggestion: SuggestionValues, current: ListingSuggestionState): boolean {
  if (field === "title") return Boolean(suggestion.title) && current.title === suggestion.title;
  if (field === "description") return Boolean(suggestion.description) && current.description === suggestion.description;
  if (field === "category_slug") return Boolean(suggestion.category_slug) && current.categorySlug === suggestion.category_slug;
  if (field === "tags") {
    const suggestedTags = suggestion.tags?.slice(0, 12) ?? [];
    return suggestedTags.length > 0 && suggestedTags.length === current.tags.length && suggestedTags.every((tag, index) => tag === current.tags[index]);
  }
  return false;
}
