import exifr from 'exifr';

const MAX_DIM = 1280;
const JPEG_QUALITY = 0.82;

export interface GpsData {
  lat: number;
  lng: number;
  takenAt?: string;
}

/** Read DateTimeOriginal / CreateDate from EXIF, returning an ISO string or null. */
export async function extractTakenAt(file: Blob): Promise<string | null> {
  const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
    Promise.race([
      p,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
    ]);
  try {
    const meta = (await withTimeout(
      exifr.parse(file, ['DateTimeOriginal', 'CreateDate']),
      8000,
    )) as { DateTimeOriginal?: Date; CreateDate?: Date } | null | undefined;
    const ts = meta?.DateTimeOriginal ?? meta?.CreateDate;
    if (ts instanceof Date && !isNaN(ts.getTime())) return ts.toISOString();
  } catch {
    /* ignore */
  }
  return null;
}

/** Extract GPS + timestamp from an image's EXIF. Returns null if no coords. */
export async function extractGps(file: Blob): Promise<GpsData | null> {
  // iOS Safari can take several seconds parsing a 4 MB HEIC's EXIF box; cap it
  // so the upload flow keeps moving, but generously — a premature timeout here
  // silently drops the real photo GPS and falls back to device location.
  const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
    Promise.race([
      p,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
    ]);

  // exifr.gps() is the dedicated GPS extractor — it always reads the raw
  // GPSLatitude / GPSLongitude / *Ref tags and returns signed decimals. Using
  // exifr.parse() with `pick: ['latitude', 'longitude']` does NOT work because
  // `pick` filters segment reads by tag name, and `latitude`/`longitude` are
  // computed virtual fields — the raw GPS tags never get loaded, so the
  // virtual fields come back undefined. This was the root cause of iOS photos
  // showing wrong coordinates (falling back to device location).
  let lat: number | undefined;
  let lng: number | undefined;
  try {
    const gps = (await withTimeout(exifr.gps(file), 15000)) as
      | { latitude?: number; longitude?: number }
      | null
      | undefined;
    if (
      gps &&
      Number.isFinite(gps.latitude) &&
      Number.isFinite(gps.longitude) &&
      // Reject the (0, 0) "Null Island" sentinel that some cameras/apps write
      // when they failed to acquire a fix (common with Onroyd/Garmin exports).
      !(gps.latitude === 0 && gps.longitude === 0) &&
      Math.abs(gps.latitude as number) <= 90 &&
      Math.abs(gps.longitude as number) <= 180
    ) {
      lat = gps.latitude;
      lng = gps.longitude;
    }
  } catch {
    /* fall through — no GPS */
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  let takenAt: string | undefined;
  try {
    const meta = (await withTimeout(
      exifr.parse(file, ['DateTimeOriginal', 'CreateDate']),
      8000,
    )) as { DateTimeOriginal?: Date; CreateDate?: Date } | null | undefined;
    const ts = meta?.DateTimeOriginal ?? meta?.CreateDate;
    if (ts instanceof Date && !isNaN(ts.getTime())) takenAt = ts.toISOString();
  } catch {
    /* timestamp optional */
  }

  return { lat: lat as number, lng: lng as number, takenAt };
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

/** Serialize any thrown value into a human-readable message. */
function errMsg(e: unknown): string {
  if (!e) return 'unknown';
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  if (typeof e === 'string') return e;
  if (typeof e === 'object') {
    const anyE = e as { message?: unknown; code?: unknown; name?: unknown };
    if (typeof anyE.message === 'string') {
      return anyE.name ? `${anyE.name}: ${anyE.message}` : anyE.message;
    }
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }
  return String(e);
}

/**
 * Resize to a max dimension and re-encode as JPEG.
 * Strategy:
 *   - Non-HEIC: decode via createImageBitmap (fast path)
 *   - HEIC: try createImageBitmap first (Safari iOS 17+ native).
 *           If it throws, fall back to heic2any → createImageBitmap.
 *   - If all decode paths fail, throw a detailed error containing every stage.
 */
export async function resizeToJpeg(
  blob: Blob,
  maxDim = MAX_DIM,
  quality = JPEG_QUALITY,
): Promise<{ blob: Blob; width: number; height: number }> {
  const name = (blob as File).name ?? '';
  const heic = isHeic({ name, type: blob.type });

  let bitmap: ImageBitmap | null = null;
  let nativeErr: unknown = null;
  let heicErr: unknown = null;
  let htmlErr: unknown = null;

  // 1) Native createImageBitmap (works for JPEG/PNG/WEBP; HEIC on Safari 17+).
  try {
    bitmap = await createImageBitmap(blob);
    if (!bitmap || bitmap.width === 0 || bitmap.height === 0) {
      bitmap?.close?.();
      bitmap = null;
      throw new Error('empty bitmap');
    }
  } catch (e) {
    nativeErr = e;
    bitmap = null;
    console.warn('[image] createImageBitmap failed', name, errMsg(e));
  }

  // 2) HEIC → JPEG via heic2any (desktop Chrome, older Safari)
  if (!bitmap && heic) {
    try {
      const converted = await convertHeicBlobViaLib(blob);
      bitmap = await createImageBitmap(converted);
    } catch (e) {
      heicErr = e;
      bitmap = null;
      console.error('[image] heic2any conversion failed', name, errMsg(e), e);
    }
  }

  // 3) HTMLImageElement fallback (JPEG/PNG/etc.; cannot decode HEIC on Chrome)
  if (!bitmap) {
    try {
      const img = await loadHtmlImage(blob);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas 2d not available');
      ctx.drawImage(img, 0, 0);
      bitmap = await createImageBitmap(canvas);
      canvas.width = 0;
      canvas.height = 0;
    } catch (e) {
      htmlErr = e;
      const parts = [
        `native=${errMsg(nativeErr)}`,
        heic ? `heic2any=${errMsg(heicErr)}` : null,
        `htmlImage=${errMsg(htmlErr)}`,
      ].filter(Boolean);
      throw new Error(
        `Cannot decode ${name || 'image'} (type='${blob.type || 'unknown'}', heic=${heic}): ${parts.join(' | ')}`,
      );
    }
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

function loadHtmlImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('HTMLImageElement load failed'));
    };
    img.src = url;
  });
}

/** True if any of the selected files is a HEIC/HEIF. */
export function hasAnyHeic(files: File[]): boolean {
  return files.some((f) => isHeic(f));
}

/** Public HEIC detector (by name or mimetype). */
export function isHeicFile(file: { name?: string; type?: string }): boolean {
  return isHeic(file);
}

/**
 * Prepare a File for upload.
 *  - HEIC/HEIF → return the original blob untouched (backend handles decode with sharp).
 *  - Everything else → resize + re-encode to JPEG on the client (faster upload, less bandwidth).
 */
export async function processForUpload(
  file: File,
): Promise<{ blob: Blob; filename: string; mimeType: string; width: number; height: number }> {
  // HEIC → send raw to server. iOS Safari's createImageBitmap on large iPhone
  // HEIC files can hang indefinitely (the webkit decoder walks every auxiliary
  // image), and heic2any is heavy enough to freeze mobile Safari. The server
  // has libheif 1.19 + heif-dec CLI that decodes every iPhone variant fast.
  if (isHeic(file)) {
    return {
      blob: file,
      filename: file.name,
      mimeType: file.type || 'image/heic',
      width: 0,
      height: 0,
    };
  }
  const resized = await resizeToJpeg(file);
  return {
    blob: resized.blob,
    filename: file.name.replace(/\.(png|webp|gif)$/i, '.jpg'),
    mimeType: 'image/jpeg',
    width: resized.width,
    height: resized.height,
  };
}
