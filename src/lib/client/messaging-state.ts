import type { Message } from "@/lib/marketplace";

export type DisplayMessage = Message & {
  delivery?: "pending" | "failed";
  error?: string;
};

export function compareMessages(a: Pick<Message, "created_at" | "id">, b: Pick<Message, "created_at" | "id">): number {
  const time = a.created_at.localeCompare(b.created_at);
  return time || a.id.localeCompare(b.id);
}

export function mergeMessages(current: DisplayMessage[], incoming: DisplayMessage[]): DisplayMessage[] {
  const byId = new Map<string, DisplayMessage>();
  const actionToId = new Map<string, string>();
  const actionKey = (message: DisplayMessage) => message.client_action_id ? `${message.sender_id}:${message.client_action_id}` : null;
  for (const message of current) {
    byId.set(message.id, message);
    const key = actionKey(message);
    if (key) actionToId.set(key, message.id);
  }
  for (const message of incoming) {
    const key = actionKey(message);
    const optimisticId = key ? actionToId.get(key) : undefined;
    if (optimisticId && optimisticId !== message.id) byId.delete(optimisticId);
    const previous = byId.get(message.id);
    const next = { ...previous, ...message, delivery: message.delivery, error: message.error };
    if (previous?.read_at && !message.read_at) next.read_at = previous.read_at;
    byId.set(message.id, next);
    if (key) actionToId.set(key, message.id);
  }
  return [...byId.values()].sort(compareMessages);
}

export function failedMessage(current: DisplayMessage[], id: string, error: string): DisplayMessage[] {
  return current.map((message) => message.id === id ? { ...message, delivery: "failed", error } : message);
}
