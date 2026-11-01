import { CATEGORIES, type Condition, type Listing, type Profile } from "./marketplace";

// Fictional, read-only examples. Illustrations are original local SVGs, not seller photos.
export const DEMO_PROFILES: Profile[] = [
  { id: "10000000-0000-4000-8000-000000000001", display_name: "Sample seller A", avatar_url: null, hostel_block: "Block A", created_at: "2026-11-01T00:00:00Z" },
  { id: "10000000-0000-4000-8000-000000000002", display_name: "Sample seller B", avatar_url: null, hostel_block: "Block B", created_at: "2026-11-01T00:00:00Z" },
  { id: "10000000-0000-4000-8000-000000000003", display_name: "Sample seller C", avatar_url: null, hostel_block: "Block C", created_at: "2026-11-01T00:00:00Z" },
];

type Example = [string, number, number, Condition, string, string[]];
const examples: Example[] = [
  ["A semester of good reads", 450, 0, "good", "books", ["books", "reading", "paperback"]],
  ["Over-ear study headphones", 1200, 1, "like_new", "headphones", ["headphones", "audio", "study"]],
  ["Your new favourite desk chair", 1600, 2, "good", "chair", ["chair", "seat", "furniture", "desk"]],
  ["A cycle for campus days", 3400, 3, "good", "bike", ["cycle", "bicycle", "bike", "commute"]],
  ["An easy everyday jacket", 650, 4, "like_new", "jacket", ["jacket", "clothes", "outerwear"]],
  ["Badminton after class", 750, 5, "good", "racket", ["badminton", "racket", "sports"]],
  ["A kettle for late-night chai", 500, 6, "good", "kettle", ["kettle", "tea", "kitchen"]],
  ["Warm light for your desk", 400, 2, "like_new", "lamp", ["lamp", "light", "study"]],
  ["Notes for the next semester", 150, 0, "good", "books", ["notes", "study", "books"]],
  ["Wired headphones, ready to go", 350, 1, "fair", "headphones", ["headphones", "wired", "audio"]],
  ["A spare seat for your room", 800, 2, "fair", "chair", ["seat", "chair", "room"]],
  ["Weekend ride, anyone?", 2800, 3, "fair", "bike", ["bike", "cycle", "bicycle"]],
  ["Light layer for cooler evenings", 500, 4, "good", "jacket", ["jacket", "clothing", "layer"]],
  ["A spare badminton racket", 300, 5, "fair", "racket", ["racket", "badminton", "sport"]],
  ["Roommate's spare kettle", 600, 6, "like_new", "kettle", ["kettle", "kitchen", "hot water"]],
  ["Little lamp, big study energy", 250, 7, "good", "lamp", ["lamp", "light", "desk"]],
  ["Paperbacks looking for a reader", 200, 0, "fair", "books", ["books", "fiction", "reading"]],
  ["Comfy headphones for the library", 900, 1, "good", "headphones", ["headphones", "study", "audio"]],
  ["A reading chair with a second chapter", 1400, 2, "good", "chair", ["chair", "seat", "reading"]],
  ["A little light, passed on", 200, 7, "good", "lamp", ["light", "lamp", "room"]],
];

export const DEMO_LISTINGS: Listing[] = examples.map(([title, price, category, condition, art, tags], index) => {
  const id = `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
  const seller = DEMO_PROFILES[index % DEMO_PROFILES.length];
  const date = new Date(Date.UTC(2026, 10, 1, 0, 0) - index * 3600000).toISOString();
  return {
    id, seller_id: seller.id, category_id: CATEGORIES[category].id, title,
    description: "This is an illustrative sample listing for exploring Re-Love. It is not an item for sale. Real sellers will add their own original photos, confirm the condition, and arrange a campus pickup through private messages.",
    price_inr: price, condition, hostel_block: seller.hostel_block!, status: index === 19 ? "sold" : "active",
    image_url: `/demo/${art}.svg`, image_path: `${seller.id}/${id}.jpg`, cutout_url: null,
    tags, ai_status: "none", created_at: date, updated_at: date, category: CATEGORIES[category], seller,
  };
});
