import { createHash, timingSafeEqual } from 'node:crypto';

// Constant-time string comparison for secrets (admin keys, tokens).
//
// Hashing both sides to a fixed 32-byte digest first means:
//   - timingSafeEqual never throws on a length mismatch (it requires equal-
//     length buffers), and
//   - the comparison leaks no length information.
// The SHA-256 cost is identical for both inputs regardless of content, so the
// total time does not depend on how many leading bytes happen to match — unlike
// the short-circuiting `===`, which is a classic timing side-channel.
export function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}
