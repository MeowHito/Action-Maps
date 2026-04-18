import exifr from 'exifr';

const MAX_DIM = 1280;
const JPEG_QUALITY = 0.82;

export interface GpsData {
  lat: number;
  lng: number;
  takenAt?: string;
}

/** Extract GPS + timestamp from an image's EXIF. Returns null if no coords. */
export async function extractGps(file: Blob): Promise<GpsData | null> {
  try {
    const data = await exifr.parse(file, {
      gps: true,
      pick: ['latitude', 'longitude', 'DateTimeOriginal', 'CreateDate'],
    });
    if (!data) return null;
    if (typeof data.latitude === 'number' && typeof data.longitude === 'number') {
      const ts = (data.DateTimeOriginal ?? data.CreateDate) as Date | undefined;
      return {
        lat: data.latitude,
        lng: data.longitude,
        takenAt: ts?.toISOString?.(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

function isHeic(file: { name?: string; type?: string }): boolean {
  return (
    /\.hei[cf]$/i.test(file.name ?? '') ||
    file.type === 'image/heic' ||
    file.type === 'image/heif'
  );
}

/**
 * Legacy helper kept for backward-compat. The new pipeline decodes HEIC
 * natively via createImageBitmap inside resizeToJpeg, so most callers can
 * skip this entirely. If you still need a JPEG Blob up-front (rare), this
 * will lazy-load heic2any as a last resort.
 */
export async function convertHeicIfNeeded(file: File): Promise<Blob> {
  if (!isHeic(file)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d not available');
    ctx.drawImage(bmp, 0, 0);
    bmp.close?.();
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
        'image/jpeg',
        0.9,
      );
    });
  } catch {
    // Last resort: heic2any (heavy on iOS memory, can hang Safari)
    const heic2any = (await import('heic2any')).default;
    const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
    return Array.isArray(out) ? out[0] : out;
  }
}

/**
 * Resize to a max dimension and re-encode as JPEG.
 * Uses createImageBitmap (native, GPU-friendly, supports HEIC on Safari 17+)
 * and only falls back to heic2any if the browser cannot decode the blob.
 */
export async function resizeToJpeg(
  blob: Blob,
  maxDim = MAX_DIM,
  quality = JPEG_QUALITY,
): Promise<{ blob: Blob; width: number; height: number }> {
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    // Fallback for browsers that cannot decode HEIC natively (old iOS / Android / desktop Chrome)
    const converted = await convertHeicBlobViaLib(blob);
    bitmap = await createImageBitmap(converted);
  }

  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d not available');
    ctx.drawImage(bitmap, 0, 0, w, h);
    const out = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
        'image/jpeg',
        quality,
      );
    });
    // Explicitly clear the canvas to help Safari GC
    canvas.width = 0;
    canvas.height = 0;
    return { blob: out, width: w, height: h };
  } finally {
    bitmap.close?.();
  }
}

async function convertHeicBlobViaLib(blob: Blob): Promise<Blob> {
  const heic2any = (await import('heic2any')).default;
  const out = await heic2any({ blob, toType: 'image/jpeg', quality: 0.9 });
  return Array.isArray(out) ? out[0] : out;
}
