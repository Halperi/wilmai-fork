export function hash(value: unknown): string {
  // FNV-1a: only to notice changed content, not for security.
  let h = 0x811c9dc5;
  const s = JSON.stringify(value);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
