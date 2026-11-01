export const CONDITIONS = ["new", "like_new", "good", "fair"] as const;
export type Condition = typeof CONDITIONS[number];
export const CONDITION_LABELS: Record<Condition, string> = { new: "New", like_new: "Like new", good: "Good", fair: "Fair" };
export type AppMode = "demo" | "live" | "setup";
export type ListingStatus = "active" | "sold" | "hidden";
export type AiStatus = "none" | "pending" | "done" | "failed";

export interface Category { id: string; slug: string; name: string; icon: string }
export interface Profile { id: string; display_name: string; avatar_url: string | null; hostel_block: string | null; created_at?: string }
export interface Listing {
  id: string;
  seller_id: string;
  category_id: string;
  title: string;
  description: string;
  price_inr: number;
  condition: Condition;
  hostel_block: string;
  status: ListingStatus;
  image_url: string;
  image_path: string;
  cutout_url: string | null;
  cutout_path?: string | null;
  tags: string[];
  ai_status: AiStatus;
  created_at: string;
  updated_at: string;
  category?: Category;
  seller?: Profile;
}
export interface Message { id: string; thread_id: string; sender_id: string; recipient_id: string; body: string; created_at: string; read_at: string | null }
export interface ThreadSummary {
  id: string;
  listing: Pick<Listing, "id" | "title" | "image_url" | "price_inr" | "status">;
  participant: Profile;
  last_message: Pick<Message, "body" | "created_at" | "sender_id"> | null;
  unread_count: number;
  updated_at: string;
}
export interface ThreadDetail { thread: ThreadSummary; messages: Message[]; has_more?: boolean; before?: string | null }
export interface SessionInfo { user: Profile | null; mode: AppMode; ai_enabled: boolean; auth_configured: boolean }
export interface ApiResponse<T> { data: T; mode: AppMode; meta?: { next_cursor?: number | null; total?: number } }
export interface ApiError { error: { code: string; message: string; fields?: Record<string, string[]> } }

export const CATEGORIES: Category[] = [
  { id: "00000000-0000-4000-8000-000000000001", slug: "books", name: "Books & notes", icon: "BookOpen" },
  { id: "00000000-0000-4000-8000-000000000002", slug: "electronics", name: "Electronics", icon: "Headphones" },
  { id: "00000000-0000-4000-8000-000000000003", slug: "furniture", name: "Room essentials", icon: "Armchair" },
  { id: "00000000-0000-4000-8000-000000000004", slug: "cycles", name: "Cycles", icon: "Bike" },
  { id: "00000000-0000-4000-8000-000000000005", slug: "fashion", name: "Clothing", icon: "Shirt" },
  { id: "00000000-0000-4000-8000-000000000006", slug: "sports", name: "Sports", icon: "Dumbbell" },
  { id: "00000000-0000-4000-8000-000000000007", slug: "kitchen", name: "Kitchen", icon: "Coffee" },
  { id: "00000000-0000-4000-8000-000000000008", slug: "other", name: "Everything else", icon: "Shapes" },
];
