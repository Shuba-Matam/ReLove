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
  for (const message of current) {
    byId.set(message.id, message);
    if (message.client_action_id) actionToId.set(message.client_action_id, message.id);
  }
  for (const message of incoming) {
    const optimisticId = message.client_action_id ? actionToId.get(message.client_action_id) : undefined;
    if (optimisticId && optimisticId !== message.id) byId.delete(optimisticId);
    const previous = byId.get(message.id);
    byId.set(message.id, { ...previous, ...message, delivery: message.delivery, error: message.error });
    if (message.client_action_id) actionToId.set(message.client_action_id, message.id);
  }
  return [...byId.values()].sort(compareMessages);
}

export function failedMessage(current: DisplayMessage[], id: string, error: string): DisplayMessage[] {
  return current.map((message) => message.id === id ? { ...message, delivery: "failed", error } : message);
}
