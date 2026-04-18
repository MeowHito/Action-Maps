'use client';

import { useEffect, useState, FormEvent } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { EventDoc } from '@/lib/types';

export default function Home() {
  const [events, setEvents] = useState<EventDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      setEvents(await api.listEvents());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const onCreate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const slug = String(fd.get('slug') ?? '').trim();
    const name = String(fd.get('name') ?? '').trim();
    if (!slug || !name) return;
    try {
      setCreating(true);
      setError(null);
      await api.createEvent({ slug, name });
      form.reset();
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const onDelete = async (slug: string) => {
    if (!confirm(`Delete event "${slug}" and ALL its photos/routes?`)) return;
    try {
      await api.deleteEvent(slug);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const featured = events.slice(0, 3);

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,rgba(248,250,255,0.98)_0%,rgba(233,239,255,0.96)_100%)] text-slate-950">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-3 md:pl-20 lg:px-8 lg:pl-24">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-blue-600/10 text-lg font-black text-blue-700">
              G
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-blue-600">
                Telemetry Active
              </p>
              <h1 className="text-lg font-black uppercase tracking-tight text-slate-950">
                GPX ACTION
              </h1>
            </div>
          </div>
          <div className="hidden items-center gap-3 md:flex">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
              Bound to {api.base}
            </span>
            <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800">
              Team Console
            </button>
          </div>
        </div>
      </header>

      <div className="hidden md:fixed md:inset-y-0 md:left-0 md:z-30 md:flex md:w-16 md:flex-col md:items-center md:justify-between md:border-r md:border-slate-200/70 md:bg-white/75 md:px-3 md:py-6 md:backdrop-blur-2xl">
        <div className="flex flex-col items-center gap-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-600 text-sm font-black text-white">
            GA
          </div>
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600/12 text-sm font-bold text-blue-700">
            Map
          </div>
          <div className="text-xs font-semibold text-slate-400">GPX</div>
          <div className="text-xs font-semibold text-slate-400">Cam</div>
        </div>
        <div className="text-xs font-semibold text-slate-400">Me</div>
      </div>

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 pb-28 pt-6 md:ml-16 md:px-6 md:pb-12 md:pt-8 lg:px-8">
        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="overflow-hidden rounded-[28px] border border-blue-100 bg-[radial-gradient(circle_at_top_left,rgba(226,236,255,0.95),rgba(255,255,255,0.98)_58%)] p-6 shadow-[0_20px_70px_-35px_rgba(37,99,235,0.45)] sm:p-8">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white/70 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-blue-700">
              <span className="inline-block h-2 w-2 rounded-full bg-blue-600" />
              Telemetry Active
            </div>
            <h2 className="max-w-3xl text-4xl font-black leading-[0.95] tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
              GPX Action Team
              <br />
              <span className="text-blue-700">Photographer</span>
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-6 text-slate-600 sm:text-base">
              Upload GPX files and geotagged photos to create kinetic shared maps
              for your team. Spin up a new journey, publish the route, and let the
              gallery sync around the trail in real time.
            </p>

            <form onSubmit={onCreate} className="mt-8 max-w-2xl space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 shadow-sm">
                  <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Map slug
                  </span>
                  <input
                    name="slug"
                    placeholder="summit-push-2026"
                    pattern="[a-z0-9]+(-[a-z0-9]+)*"
                    title="lowercase, numbers, and dashes"
                    required
                    className="w-full border-0 bg-transparent p-0 font-mono text-sm text-slate-900 outline-none placeholder:text-slate-400"
                  />
                </label>
                <label className="block rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 shadow-sm">
                  <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Map name
                  </span>
                  <input
                    name="name"
                    placeholder="Summit Push"
                    required
                    className="w-full border-0 bg-transparent p-0 text-sm font-medium text-slate-900 outline-none placeholder:text-slate-400"
                  />
                </label>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="max-w-md text-xs leading-5 text-slate-500">
                  The slug becomes the permanent route room and live collaboration
                  URL for your team.
                </p>
                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-2xl bg-[linear-gradient(135deg,#004cca_0%,#0062ff_100%)] px-6 py-3 text-sm font-black uppercase tracking-[0.18em] text-white shadow-[0_16px_30px_-20px_rgba(0,98,255,0.9)] transition hover:scale-[1.01] disabled:opacity-50"
                >
                  {creating ? 'Launching…' : 'Start a New Journey'}
                </button>
              </div>

              {error && (
                <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </p>
              )}
            </form>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_20px_60px_-45px_rgba(15,23,42,0.45)]">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600/12 text-sm font-black text-blue-700">
                +
              </div>
              <h3 className="text-lg font-black tracking-tight text-slate-950">
                Sync Visuals
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Auto-timestamp photos against the route so every frame falls into
                position on the map.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">
                  GPX Logic
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-700">
                  Publish trail files, route color, and live overlays in one feed.
                </p>
              </div>
              <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">
                  Team Link
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-700">
                  Each event becomes a shared room ready for collaborative field
                  uploads.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_18px_50px_-40px_rgba(15,23,42,0.45)]">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">
                  System Overview
                </p>
                <h3 className="mt-2 text-2xl font-black tracking-tight text-slate-950">
                  Mission board
                </h3>
              </div>
              <button
                onClick={load}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-blue-200 hover:text-blue-700"
              >
                Refresh
              </button>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                  Events
                </p>
                <p className="mt-3 text-3xl font-black tracking-tight text-slate-950">
                  {loading ? '…' : events.length}
                </p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                  Status
                </p>
                <p className="mt-3 text-sm font-semibold text-blue-700">
                  {loading ? 'Syncing telemetry' : 'Realtime link ready'}
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {featured.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                  No missions yet. Start a new journey above to create the first
                  live map.
                </div>
              ) : (
                featured.map((ev) => (
                  <Link
                    key={ev._id}
                    href={`/event/${ev.slug}`}
                    className="block rounded-2xl border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] px-4 py-4 transition hover:border-blue-200 hover:shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black tracking-tight text-slate-950">
                          {ev.name}
                        </p>
                        <p className="mt-1 truncate font-mono text-xs text-slate-500">
                          /{ev.slug}
                        </p>
                      </div>
                      <span className="rounded-full bg-blue-600/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-blue-700">
                        Open
                      </span>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>

          <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_18px_50px_-40px_rgba(15,23,42,0.45)]">
            <div className="flex items-end justify-between gap-4 border-b border-slate-200 px-6 py-5">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">
                  Active journeys
                </p>
                <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">
                  Event ledger
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {loading
                    ? 'Gathering entries…'
                    : `${events.length} event${events.length === 1 ? '' : 's'} synced`}
                </p>
              </div>
            </div>

            {loading ? (
              <p className="px-6 py-10 text-center text-sm text-slate-500">
                Loading…
              </p>
            ) : events.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <p className="mx-auto max-w-sm text-base leading-7 text-slate-500">
                  The map room is empty for now. Create your first event to begin
                  the trail archive.
                </p>
              </div>
            ) : (
              <ul>
                {events.map((ev, i) => (
                  <li
                    key={ev._id}
                    className={`group flex flex-col gap-4 px-6 py-5 transition hover:bg-blue-50/40 sm:flex-row sm:items-center sm:justify-between ${
                      i > 0 ? 'border-t border-slate-200' : ''
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-4">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-sm font-black text-slate-500">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <div className="min-w-0">
                        <Link
                          href={`/event/${ev.slug}`}
                          className="block truncate text-base font-black tracking-tight text-slate-950 transition group-hover:text-blue-700"
                        >
                          {ev.name}
                        </Link>
                        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span className="font-mono">/{ev.slug}</span>
                          <span>•</span>
                          <span>{new Date(ev.createdAt).toLocaleDateString()}</span>
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <Link
                        href={`/event/${ev.slug}`}
                        className="rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-bold uppercase tracking-[0.14em] text-white transition hover:bg-blue-700"
                      >
                        Open
                      </Link>
                      <button
                        onClick={() => onDelete(ev.slug)}
                        aria-label={`Delete ${ev.slug}`}
                        className="rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </section>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/90 px-2 pb-5 pt-2 backdrop-blur-2xl md:hidden">
        <div className="mx-auto flex max-w-md items-center justify-around">
          <div className="rounded-2xl bg-blue-600/12 px-4 py-2 text-center text-[11px] font-black uppercase tracking-[0.16em] text-blue-700">
            Explore
          </div>
          <div className="px-4 py-2 text-center text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
            Tracks
          </div>
          <div className="px-4 py-2 text-center text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
            Capture
          </div>
          <div className="px-4 py-2 text-center text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
            Profile
          </div>
        </div>
      </nav>
    </div>
  );
}
