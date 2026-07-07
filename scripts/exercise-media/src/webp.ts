import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

export const MAX_BYTES = 400 * 1024; // spec §5: ~200–400 KB each
const TARGET_WIDTH = 1280; // 4:3 → 1280×960
const QUALITIES = [82, 72, 62, 52, 42];

/** PNG → WebP, stepping quality down until the file fits the budget. */
export async function convertToWebp(
  srcPath: string,
  destPath: string,
): Promise<{ bytes: number; quality: number }> {
  for (const [i, quality] of QUALITIES.entries()) {
    const buf = await sharp(srcPath)
      .resize({ width: TARGET_WIDTH, withoutEnlargement: true })
      .webp({ quality })
      .toBuffer();
    const isLast = i === QUALITIES.length - 1;
    if (buf.length <= MAX_BYTES || isLast) {
      if (buf.length > MAX_BYTES) {
        console.warn(
          `WARN ${path.basename(destPath)}: ${buf.length} bytes still exceeds ${MAX_BYTES} at q${quality} — committing anyway, consider regenerating a simpler image.`,
        );
      }
      fs.writeFileSync(destPath, buf);
      return { bytes: buf.length, quality };
    }
  }
  throw new Error('unreachable');
}
