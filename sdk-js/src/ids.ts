/** Hex-16 ID matching Python's uuid4().hex[:16]. */
export function newId(): string {
  // Crypto-randomness if available, else Math.random fallback.
  const bytes = new Uint8Array(8);
  if (typeof globalThis.crypto !== "undefined" && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Unix-seconds timestamp matching Python's time.time(). */
export function nowTs(): number {
  return Date.now() / 1000;
}
