import sharp from "sharp";

// Gemini's PNGs are about 1 MB each; a 768px JPEG looks the same on a TV and loads fast on venue wifi.
export async function toJpeg(data: Buffer, size = 768): Promise<Buffer> {
  return sharp(data).resize(size, size, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
}
