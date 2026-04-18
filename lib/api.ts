import type { EventDoc, PhotoDoc, RouteDoc } from './types';

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json() as Promise<T>;
}

const jsonHeaders = { 'Content-Type': 'application/json' };

export const api = {
  base: API_BASE,

  // ---- Events ----
  listEvents: () =>
    fetch(`${API_BASE}/api/events`, { cache: 'no-store' }).then(
      handle<EventDoc[]>,
    ),
  createEvent: (data: {
    slug: string;
    name: string;
    description?: string;
  }) =>
    fetch(`${API_BASE}/api/events`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(data),
    }).then(handle<EventDoc>),
  getEvent: (slug: string) =>
    fetch(`${API_BASE}/api/events/${slug}`, { cache: 'no-store' }).then(
      handle<EventDoc>,
    ),
  deleteEvent: (slug: string) =>
    fetch(`${API_BASE}/api/events/${slug}`, { method: 'DELETE' }).then(
      handle<{ ok: true }>,
    ),

  // ---- Routes ----
  listRoutes: (slug: string) =>
    fetch(`${API_BASE}/api/events/${slug}/routes`, { cache: 'no-store' }).then(
      handle<RouteDoc[]>,
    ),
  uploadRoute: (
    slug: string,
    file: File | Blob,
    name: string,
    color?: string,
  ) => {
    const fd = new FormData();
    fd.append('file', file, (file as File).name ?? 'route.gpx');
    fd.append('name', name);
    if (color) fd.append('color', color);
    return fetch(`${API_BASE}/api/events/${slug}/routes`, {
      method: 'POST',
      body: fd,
    }).then(handle<RouteDoc>);
  },
  deleteRoute: (id: string) =>
    fetch(`${API_BASE}/api/routes/${id}`, { method: 'DELETE' }).then(
      handle<{ ok: true }>,
    ),

  // ---- Photos ----
  listPhotos: (slug: string) =>
    fetch(`${API_BASE}/api/events/${slug}/photos`, { cache: 'no-store' }).then(
      handle<PhotoDoc[]>,
    ),
  uploadPhoto: (
    slug: string,
    file: File | Blob,
    lat: number,
    lng: number,
    extra: {
      width?: number;
      height?: number;
      takenAt?: string;
      onProgress?: (loaded: number, total: number) => void;
      signal?: AbortSignal;
    } = {},
  ) => {
    const fd = new FormData();
    fd.append('file', file, (file as File).name ?? 'photo.jpg');
    fd.append('lat', String(lat));
    fd.append('lng', String(lng));
    if (extra.width) fd.append('width', String(extra.width));
    if (extra.height) fd.append('height', String(extra.height));
    if (extra.takenAt) fd.append('takenAt', extra.takenAt);
    // Use XHR so we can observe upload progress. iOS Safari's `fetch()` gives
    // no signal between "request started" and "response received", which makes
    // a slow cellular upload look like the app has frozen.
    return new Promise<PhotoDoc>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/api/events/${slug}/photos`);
      xhr.responseType = 'text';
      // Server-side HEIC decode + sharp can take 10-20 s for a 4 MB iPhone
      // photo; give mobile uploads plenty of headroom before we give up.
      xhr.timeout = 120_000;
      if (extra.onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) extra.onProgress!(e.loaded, e.total);
        };
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText) as PhotoDoc);
          } catch (e) {
            reject(e);
          }
        } else {
          reject(
            new Error(
              `${xhr.status} ${xhr.statusText}: ${xhr.responseText?.slice(0, 400) ?? ''}`,
            ),
          );
        }
      };
      xhr.onerror = () => reject(new Error('network error during upload'));
      xhr.ontimeout = () => reject(new Error('upload timed out after 120 s'));
      xhr.onabort = () => reject(new Error('upload aborted'));
      if (extra.signal) {
        if (extra.signal.aborted) xhr.abort();
        else extra.signal.addEventListener('abort', () => xhr.abort());
      }
      xhr.send(fd);
    });
  },
  deletePhoto: (id: string) =>
    fetch(`${API_BASE}/api/photos/${id}`, { method: 'DELETE' }).then(
      handle<{ ok: true }>,
    ),
};
