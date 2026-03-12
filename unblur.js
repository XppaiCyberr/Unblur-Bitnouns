import sharp from 'sharp';

const GRID = 32;
const OUTPUT_SIZE = 512;

/**
 * Process a blurry/low-res image by sampling a 32×32 grid (center pixel per cell)
 * and upscaling to 512×512 with nearest-neighbor for sharp pixel-art output.
 * @param {Buffer} imageBuffer - Raw image data (any format Sharp supports)
 * @returns {Promise<Buffer>} Processed image as PNG buffer
 */
export async function unblurImage(imageBuffer) {
  const pipeline = sharp(imageBuffer);
  const { data, info } = await pipeline
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const cellW = width / GRID;
  const cellH = height / GRID;

  const smallSize = GRID * GRID * channels;
  const smallBuffer = Buffer.alloc(smallSize);

  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const cx = Math.floor((x + 0.5) * cellW);
      const cy = Math.floor((y + 0.5) * cellH);
      const srcIdx = (cy * width + cx) * channels;
      const dstIdx = (y * GRID + x) * channels;
      for (let c = 0; c < channels; c++) {
        smallBuffer[dstIdx + c] = data[srcIdx + c];
      }
    }
  }

  const processed = await sharp(smallBuffer, {
    raw: { width: GRID, height: GRID, channels }
  })
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, { kernel: sharp.kernel.nearest })
    .png()
    .toBuffer();

  return processed;
}
