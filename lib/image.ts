import exifr from 'exifr';

const MAX_DIM = 1600;
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

/** Convert HEIC/HEIF → JPEG blob. Pass-through if already a regular image. */
export async function convertHeicIfNeeded(file: File): Promise<Blob> {
  const isHeic =
    /\.hei[cf]$/i.test(file.name) ||
    file.type === 'image/heic' ||
    file.type === 'image/heif';
  if (!isHeic) return file;
  const heic2any = (await import('heic2any')).default;
  const out = await heic2any({
    blob: file,
    toType: 'image/jpeg',
    quality: 0.9,
  });
  return Array.isArray(out) ? out[0] : out;
}

/** Resize to a max dimension and re-encode as JPEG. */
export async function resizeToJpeg(
  blob: Blob,
  maxDim = MAX_DIM,
  quality = JPEG_QUALITY,
): Promise<{ blob: Blob; width: number; height: number }> {
  const img = await loadImage(blob);
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d not available');
  ctx.drawImage(img, 0, 0, w, h);
  const out = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
      'image/jpeg',
      quality,
    );
  });
  return { blob: out, width: w, height: h };
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}
