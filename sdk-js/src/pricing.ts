/** Mirrors Python's wikitrace.pricing — same numbers. */

const PRICES: Record<string, [number, number]> = {
  "gpt-4o": [2.5, 10.0],
  "gpt-4o-mini": [0.15, 0.6],
  "gpt-4-turbo": [10.0, 30.0],
  "gpt-4": [30.0, 60.0],
  "gpt-3.5-turbo": [0.5, 1.5],
  "o1": [15.0, 60.0],
  "o1-mini": [3.0, 12.0],
  "o3-mini": [1.1, 4.4],
  "o3": [10.0, 40.0],
  "claude-opus-4-7": [15.0, 75.0],
  "claude-opus-4": [15.0, 75.0],
  "claude-sonnet-4-6": [3.0, 15.0],
  "claude-sonnet-4": [3.0, 15.0],
  "claude-haiku-4-5": [1.0, 5.0],
  "claude-3-5-sonnet": [3.0, 15.0],
  "claude-3-5-haiku": [0.8, 4.0],
  "claude-3-opus": [15.0, 75.0],
  "claude-3-haiku": [0.25, 1.25],
  "gemini-2.0-flash": [0.1, 0.4],
  "gemini-1.5-pro": [1.25, 5.0],
  "gemini-1.5-flash": [0.075, 0.3],
};

export function setPrice(model: string, inPer1m: number, outPer1m: number): void {
  PRICES[model] = [inPer1m, outPer1m];
}

export function getPrice(model: string): [number, number] | null {
  if (PRICES[model]) return PRICES[model];
  let bestKey: string | null = null;
  for (const key of Object.keys(PRICES)) {
    if (model.startsWith(key) && (bestKey === null || key.length > bestKey.length)) {
      bestKey = key;
    }
  }
  return bestKey ? PRICES[bestKey]! : null;
}

export function computeCost(model: string, inputTokens: number, outputTokens: number): number | null {
  const p = getPrice(model);
  if (!p) return null;
  const usd = (inputTokens / 1_000_000) * p[0] + (outputTokens / 1_000_000) * p[1];
  return Math.round(usd * 1_000_000) / 1_000_000;
}
