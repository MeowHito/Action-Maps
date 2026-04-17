'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet-gpx';
import { api } from '@/lib/api';
import { getSocket, joinEvent } from '@/lib/socket';
import {
  convertHeicIfNeeded,
  extractGps,
  resizeToJpeg,
} from '@/lib/image';
import type { EventDoc, PhotoDoc, RouteDoc } from '@/lib/types';

type MarkerClusterGroup = L.MarkerClusterGroup;
type AnyMarker = L.Marker & { _photoId?: string; options: L.MarkerOptions & { imgUrl?: string } };

const TRACK_COLORS = [
  '#ff4d4d',
  '#33cc33',
  '#3399ff',
  '#ff9933',
  '#cc33ff',
  '#00cccc',
  '#ff3399',
];

export default function MapClient({ slug }: { slug: string }) {
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<MarkerClusterGroup | null>(null);
  const photoMarkersRef = useRef<Map<string, AnyMarker>>(new Map());
  const routeLayersRef = useRef<Map<string, L.Layer>>(new Map());

  const [event, setEvent] = useState<EventDoc | null>(null);
  const [photos, setPhotos] = useState<PhotoDoc[]>([]);
  const [routes, setRoutes] = useState<RouteDoc[]>([]);
  const [markerSize, setMarkerSize] = useState(45);
  const [loading, setLoading] = useState<string | null>('Loading event…');
  const [error, setError] = useState<string | null>(null);
  const [albumOpen, setAlbumOpen] = useState(false);
  const [routesOpen, setRoutesOpen] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number>(-1);

  // ---- Map init ----
  useEffect(() => {
    if (!mapElRef.current || mapRef.current) return;

    // Fix default marker icon URLs (leaflet-gpx uses them even when we null out start/end)
    delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })
      ._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl:
        'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      shadowUrl:
        'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    });

    const map = L.map(mapElRef.current, { zoomControl: false }).setView(
      [13.7367, 100.5231],
      6,
    );
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);
    L.control.zoom({ position: 'topright' }).addTo(map);

    const cluster = L.markerClusterGroup({
      showCoverageOnHover: false,
      iconCreateFunction: (c) => {
        const children = c.getAllChildMarkers() as AnyMarker[];
        const imgUrl = children[children.length - 1]?.options?.imgUrl ?? '';
        return L.divIcon({
          html: `<div class="photo-marker-wrapper"><div class="photo-marker" style="background-image:url('${imgUrl}')"></div><div class="cluster-count">${c.getChildCount()}</div></div>`,
          className: 'custom-cluster-icon',
          iconSize: L.point(45, 45),
        });
      },
    });
    map.addLayer(cluster);

    mapRef.current = map;
    clusterRef.current = cluster;

    return () => {
      map.remove();
      mapRef.current = null;
      clusterRef.current = null;
    };
  }, []);

  // ---- Marker size reactivity ----
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--marker-size',
      `${markerSize}px`,
    );
  }, [markerSize]);

  // ---- Photo helpers ----
  const addPhoto = useCallback((p: PhotoDoc) => {
    const cluster = clusterRef.current;
    if (!cluster) return;
    if (photoMarkersRef.current.has(p._id)) return;

    const icon = L.divIcon({
      html: `<div class="photo-marker-wrapper"><div class="photo-marker" data-id="${p._id}" style="background-image:url('${p.url}')"></div></div>`,
      className: '',
      iconSize: [45, 45],
      iconAnchor: [22, 22],
    });
    const marker = L.marker([p.lat, p.lng], {
      icon,
      // @ts-expect-error - stash custom field for cluster icon to read
      imgUrl: p.url,
    }) as AnyMarker;
    marker._photoId = p._id;
    marker.on('click', () => {
      setLightboxIdx((prevIdx) => {
        // Re-find index at click time using latest photos via functional update:
        // but since we use state, better to resolve it in click handler below.
        return prevIdx;
      });
      // Find index in the *current* photos state:
      setPhotos((cur) => {
        const idx = cur.findIndex((x) => x._id === p._id);
        if (idx >= 0) setLightboxIdx(idx);
        return cur;
      });
    });
    cluster.addLayer(marker);
    photoMarkersRef.current.set(p._id, marker);
  }, []);

  const removePhotoMarker = useCallback((id: string) => {
    const m = photoMarkersRef.current.get(id);
    if (m && clusterRef.current) clusterRef.current.removeLayer(m);
    photoMarkersRef.current.delete(id);
  }, []);

  // ---- Route helpers ----
  const addRoute = useCallback(async (r: RouteDoc) => {
    const map = mapRef.current;
    if (!map) return;
    if (routeLayersRef.current.has(r._id)) return;
    try {
      const res = await fetch(r.url);
      const text = await res.text();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const GPX = (L as any).GPX as new (
        data: string,
        options: unknown,
      ) => L.Layer & { on: (ev: string, fn: (e: unknown) => void) => L.Layer };
      const layer = new GPX(text, {
        async: true,
        marker_options: { startIconUrl: null, endIconUrl: null, shadowUrl: null },
        polyline_options: { color: r.color, opacity: 0.85, weight: 4 },
      }).on('loaded', (e) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const target = (e as any).target;
          if (map && target?.getBounds) map.fitBounds(target.getBounds());
        } catch {
          /* no-op */
        }
      });
      (layer as L.Layer).addTo(map);
      routeLayersRef.current.set(r._id, layer);
    } catch (err) {
      console.warn('Failed to load GPX', r.name, err);
    }
  }, []);

  const removeRouteLayer = useCallback((id: string) => {
    const map = mapRef.current;
    const layer = routeLayersRef.current.get(id);
    if (layer && map) map.removeLayer(layer);
    routeLayersRef.current.delete(id);
  }, []);

  // ---- Initial data load ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading('Loading event…');
        const [ev, ps, rs] = await Promise.all([
          api.getEvent(slug),
          api.listPhotos(slug),
          api.listRoutes(slug),
        ]);
        if (cancelled) return;
        setEvent(ev);
        setPhotos(ps);
        setRoutes(rs);
        ps.forEach(addPhoto);
        rs.forEach((r) => void addRoute(r));
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, addPhoto, addRoute]);

  // ---- Realtime sync ----
  useEffect(() => {
    const socket = getSocket();
    const leave = joinEvent(slug);

    const onPhotoCreated = (p: PhotoDoc) => {
      setPhotos((cur) => (cur.find((x) => x._id === p._id) ? cur : [...cur, p]));
      addPhoto(p);
    };
    const onPhotoDeleted = ({ id }: { id: string }) => {
      setPhotos((cur) => cur.filter((x) => x._id !== id));
      removePhotoMarker(id);
    };
    const onRouteCreated = (r: RouteDoc) => {
      setRoutes((cur) => (cur.find((x) => x._id === r._id) ? cur : [...cur, r]));
      void addRoute(r);
    };
    const onRouteDeleted = ({ id }: { id: string }) => {
      setRoutes((cur) => cur.filter((x) => x._id !== id));
      removeRouteLayer(id);
    };

    socket.on('photo:created', onPhotoCreated);
    socket.on('photo:deleted', onPhotoDeleted);
    socket.on('route:created', onRouteCreated);
    socket.on('route:deleted', onRouteDeleted);
    return () => {
      socket.off('photo:created', onPhotoCreated);
      socket.off('photo:deleted', onPhotoDeleted);
      socket.off('route:created', onRouteCreated);
      socket.off('route:deleted', onRouteDeleted);
      leave();
    };
  }, [slug, addPhoto, addRoute, removePhotoMarker, removeRouteLayer]);

  // ---- Uploads ----
  const onUploadPhotos = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const list = Array.from(files);
    let added = 0;
    let skipped = 0;
    for (let i = 0; i < list.length; i++) {
      setLoading(`Processing photo ${i + 1}/${list.length}…`);
      try {
        const file = list[i];
        const converted = await convertHeicIfNeeded(file);
        const gps = await extractGps(converted);
        if (!gps) {
          skipped++;
          continue;
        }
        const resized = await resizeToJpeg(converted);
        const blob = new File(
          [resized.blob],
          file.name.replace(/\.hei[cf]$/i, '.jpg'),
          { type: 'image/jpeg' },
        );
        await api.uploadPhoto(slug, blob, gps.lat, gps.lng, {
          width: resized.width,
          height: resized.height,
          takenAt: gps.takenAt,
        });
        added++;
        // the socket 'photo:created' event will handle state update
      } catch (err) {
        console.error(err);
        skipped++;
      }
    }
    setLoading(null);
    if (skipped > 0) {
      alert(`Uploaded ${added} photo(s). Skipped ${skipped} (no GPS or error).`);
    }
  };

  const onUploadGpx = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const list = Array.from(files);
    for (let i = 0; i < list.length; i++) {
      setLoading(`Uploading route ${i + 1}/${list.length}…`);
      try {
        const f = list[i];
        const color = TRACK_COLORS[(routes.length + i) % TRACK_COLORS.length];
        await api.uploadRoute(slug, f, f.name.replace(/\.gpx$/i, ''), color);
      } catch (err) {
        console.error(err);
        alert(`Failed to upload ${list[i].name}: ${(err as Error).message}`);
      }
    }
    setLoading(null);
  };

  const onDeletePhoto = async (id: string) => {
    try {
      await api.deletePhoto(id);
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const onDeleteRoute = async (id: string) => {
    if (!confirm('Delete this route?')) return;
    try {
      await api.deleteRoute(id);
    } catch (err) {
      alert((err as Error).message);
    }
  };

  // ---- UI ----
  const currentPhoto =
    lightboxIdx >= 0 && lightboxIdx < photos.length ? photos[lightboxIdx] : null;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      <div ref={mapElRef} className="absolute inset-0 z-0" />

      {/* Top bar */}
      <div className="absolute left-3 top-3 z-[1000] flex max-w-[70vw] items-center gap-2 rounded-full bg-white/95 px-3 py-1.5 text-sm font-semibold shadow-md">
        <Link
          href="/"
          className="text-blue-600 hover:underline"
          title="Back to events"
        >
          ←
        </Link>
        <span className="truncate">
          {event?.name ?? slug}
        </span>
        <span className="text-xs font-normal text-zinc-500">/{slug}</span>
      </div>

      {/* Bottom floating panel */}
      <div className="absolute bottom-3 left-1/2 z-[1000] w-[96%] max-w-md -translate-x-1/2 rounded-xl bg-white/98 p-2 shadow-lg">
        <div className="grid grid-cols-4 gap-1.5">
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 py-2 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-100">
            <span className="text-base">🗺️</span>
            <span>Add GPX</span>
            <input
              type="file"
              accept=".gpx"
              multiple
              className="hidden"
              onChange={(e) => {
                void onUploadGpx(e.target.files);
                e.currentTarget.value = '';
              }}
            />
          </label>

          <button
            onClick={() => setRoutesOpen(true)}
            className="flex flex-col items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 py-2 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-100"
          >
            <span className="text-base">⛓️</span>
            <span>
              Routes <b>({routes.length})</b>
            </span>
          </button>

          <label className="flex cursor-pointer flex-col items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 py-2 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-100">
            <span className="text-base">📸</span>
            <span>Add photo</span>
            <input
              type="file"
              accept="image/*,image/heic,image/heif"
              multiple
              className="hidden"
              onChange={(e) => {
                void onUploadPhotos(e.target.files);
                e.currentTarget.value = '';
              }}
            />
          </label>

          <button
            onClick={() => setAlbumOpen(true)}
            className="flex flex-col items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 py-2 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-100"
          >
            <span className="text-base">🖼️</span>
            <span>
              Photos <b>({photos.length})</b>
            </span>
          </button>
        </div>
        <div className="mt-2 flex items-center gap-2 text-[10px] font-bold text-zinc-600">
          <span>🔍 small</span>
          <input
            type="range"
            min={20}
            max={90}
            value={markerSize}
            onChange={(e) => setMarkerSize(parseInt(e.target.value, 10))}
            className="flex-1 accent-blue-600"
          />
          <span>big 🔎</span>
        </div>
      </div>

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 z-[4000] flex items-center justify-center bg-black/50 text-sm font-bold text-white">
          {loading}
        </div>
      )}
      {error && (
        <div className="absolute left-1/2 top-20 z-[2000] -translate-x-1/2 rounded-md bg-red-600 px-4 py-2 text-sm text-white shadow-lg">
          {error}
        </div>
      )}

      {/* Routes modal */}
      {routesOpen && (
        <Modal title="Routes" onClose={() => setRoutesOpen(false)}>
          {routes.length === 0 ? (
            <p className="p-5 text-sm text-zinc-500">No routes yet.</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {routes.map((r) => (
                <li
                  key={r._id}
                  className="flex items-center justify-between px-4 py-3 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: r.color }}
                    />
                    <span className="truncate">{r.name}</span>
                  </span>
                  <button
                    onClick={() => onDeleteRoute(r._id)}
                    className="text-xs font-semibold text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}

      {/* Album modal */}
      {albumOpen && (
        <Modal
          title={`Photos (${photos.length})`}
          onClose={() => setAlbumOpen(false)}
        >
          {photos.length === 0 ? (
            <p className="p-5 text-sm text-zinc-500">No photos yet.</p>
          ) : (
            <div className="grid grid-cols-4 gap-px overflow-y-auto">
              {photos.map((p, i) => (
                <button
                  key={p._id}
                  onClick={() => {
                    setAlbumOpen(false);
                    mapRef.current?.setView([p.lat, p.lng], 18);
                    setTimeout(() => setLightboxIdx(i), 350);
                  }}
                  className="aspect-square bg-zinc-200 bg-cover bg-center"
                  style={{ backgroundImage: `url('${p.url}')` }}
                  aria-label={`Photo ${i + 1}`}
                />
              ))}
            </div>
          )}
        </Modal>
      )}

      {/* Lightbox */}
      {currentPhoto && (
        <div className="absolute inset-0 z-[3000] flex flex-col items-center justify-center bg-black/95">
          <div className="absolute top-3 flex w-[92%] max-w-3xl items-center justify-between">
            <button
              onClick={() => setLightboxIdx(-1)}
              className="rounded-md bg-white/90 px-3 py-1.5 text-xs font-semibold"
            >
              Close
            </button>
            <button
              onClick={async () => {
                await onDeletePhoto(currentPhoto._id);
                // After delete, socket will remove it from list; shift index.
                setLightboxIdx((idx) => {
                  const next = idx >= photos.length - 1 ? photos.length - 2 : idx;
                  return next < 0 ? -1 : next;
                });
              }}
              className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white"
            >
              Delete
            </button>
          </div>

          <button
            onClick={() =>
              setLightboxIdx((i) => (i > 0 ? i - 1 : i))
            }
            className="absolute left-4 top-1/2 z-[3003] flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/20 text-xl font-bold text-white"
            aria-label="Previous"
          >
            ‹
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={currentPhoto.url}
            alt=""
            className="max-h-[75vh] max-w-full object-contain"
          />
          <button
            onClick={() =>
              setLightboxIdx((i) => (i < photos.length - 1 ? i + 1 : i))
            }
            className="absolute right-4 top-1/2 z-[3003] flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/20 text-xl font-bold text-white"
            aria-label="Next"
          >
            ›
          </button>

          <a
            href={`https://www.google.com/maps?q=${currentPhoto.lat},${currentPhoto.lng}`}
            target="_blank"
            rel="noreferrer"
            className="mt-4 flex items-center gap-1 rounded-full bg-white px-4 py-2 text-xs font-bold text-blue-600 shadow-lg"
          >
            📍 View in Google Maps
          </a>
        </div>
      )}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="absolute inset-0 z-[2000] flex flex-col bg-white">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <button
          onClick={onClose}
          className="text-xl font-bold text-zinc-500 hover:text-zinc-900"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
