export function priceWarning(price: number): string | null {
  if (!Number.isSafeInteger(price) || price < 0) return "Use a whole rupee amount of zero or more.";
  if (price === 0) return "This item will be listed as free.";
  if (price > 200000) return "This price seems high. Are you sure about it?";
  return null;
}

const prohibited = [/\b(?:firearm|ammunition|cocaine|heroin|methamphetamine)\b/i, /\b(?:stolen goods|fake id|exam answers|leaked exam)\b/i];
export function hasProhibitedContent(text: string): boolean {
  return prohibited.some((pattern) => pattern.test(text.normalize("NFKC")));
}

/**
 * Mask validation matches spec: dimensions, tiny <1.5%, near-full-frame >95%, fragmented
 * when components>20 or largest/filled<0.85. Original is preserved until derived JPEG is valid.
 */
export type MaskCheck = { valid: boolean; reason: "ok" | "dimensions" | "tiny" | "full_frame" | "fragmented"; coverage: number; components: number };
export function checkMask(mask: Uint8Array, width: number, height: number): MaskCheck {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 4000000 || mask.length !== width * height) return { valid: false, reason: "dimensions", coverage: 0, components: 0 };
  let filled = 0;
  for (const value of mask) if (value > 0) filled++;
  const coverage = filled / mask.length;
  if (coverage < 0.015) return { valid: false, reason: "tiny", coverage, components: 0 };
  if (coverage > 0.95) return { valid: false, reason: "full_frame", coverage, components: 0 };
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let components = 0;
  let largest = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    components++;
    let head = 0; let tail = 1;
    queue[0] = start; visited[start] = 1;
    while (head < tail) {
      const pixel = queue[head++]; const x = pixel % width;
      const neighbors = [x > 0 ? pixel - 1 : -1, x < width - 1 ? pixel + 1 : -1, pixel - width, pixel + width];
      for (const neighbor of neighbors) if (neighbor >= 0 && neighbor < mask.length && mask[neighbor] && !visited[neighbor]) { visited[neighbor] = 1; queue[tail++] = neighbor; }
    }
    largest = Math.max(largest, tail);
  }
  const fragmented = components > 20 || largest / filled < 0.85;
  return { valid: !fragmented, reason: fragmented ? "fragmented" : "ok", coverage, components };
}
