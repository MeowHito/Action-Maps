'use client';

import { useEffect, useState, FormEvent } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { EventDoc } from '@/lib/types';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function Home() {
  const [events, setEvents] = useState<EventDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [tracksOpen, setTracksOpen] = useState(false);

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
    const name = String(fd.get('name') ?? '').trim();
    if (!name) return;
    const slug = slugify(name) || `map-${Date.now()}`;
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

  const onShare = async (ev: EventDoc) => {
    const url = `${window.location.origin}/event/${ev.slug}`;
    const shareData = {
      title: `GPX ACTION · ${ev.name}`,
      text: `Check out this journey: ${ev.name}`,
      url,
    };
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share(shareData);
        return;
      }
    } catch {
      /* user cancelled or share failed — fall through to copy */
    }
    try {
      await navigator.clipboard.writeText(url);
      alert(`Link copied:\n${url}`);
    } catch {
      prompt('Copy this link:', url);
    }
  };

  return (
    <div
      className="min-h-screen overflow-x-hidden bg-[#faf8ff] text-[#191b24] selection:bg-[#b4c5ff]"
      style={{ fontFamily: 'var(--font-sans), Inter, sans-serif' }}
    >
      {/* ---------- Header ---------- */}
      <header className="fixed top-0 left-0 w-full z-40 bg-[#faf8ff]/80 backdrop-blur-xl flex justify-between items-center px-4 py-3 md:pl-20 border-b border-[#c2c6d9]/30">
        <div className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[#004cca] scale-90">
            explore
          </span>
          <h1
            className="text-lg font-black tracking-tighter text-[#004cca] uppercase"
            style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
          >
            GPX ACTION
          </h1>
        </div>
      </header>

      {/* ---------- Main ---------- */}
      <main className="pt-10 pb-28 md:pb-12 px-4 md:ml-16">
        {/* Hero + create */}
        <section className="mt-2 mb-6 relative">
          <div className="max-w-md mx-auto">
           

            <h2
              className="text-2xl font-black tracking-tighter text-[#191b24] leading-[0.95] mb-2"
              style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
            ><br />
              <span className="text-[#004cca]">Action Team Photographer</span>
            </h2>
            <p className="text-[#424656] text-sm leading-snug mb-6 max-w-[95%]">
              Upload GPX files and photos to create interactive shared maps.
            </p>

            <form onSubmit={onCreate} className="space-y-4">
              <div className="relative">
                <input
                  name="name"
                  required
                  className="w-full bg-transparent border-0 border-b-2 border-[#c2c6d9] focus:border-[#004cca] focus:ring-0 focus:outline-none px-0 py-2 font-medium text-base placeholder:text-[#737687] transition-all"
                  style={{
                    fontFamily: 'var(--font-headline), Space Grotesk, sans-serif',
                  }}
                  placeholder="Map Name "
                  type="text"
                />
                <span className="absolute right-0 top-1/2 -translate-y-1/2 material-symbols-outlined text-[#737687] text-lg">
                  edit
                </span>
              </div>
              <button
                type="submit"
                disabled={creating}
                className="w-full kinetic-gradient text-white font-bold uppercase tracking-widest py-3.5 rounded-lg shadow-md active:scale-[0.98] transition-transform text-sm disabled:opacity-60"
                style={{
                  fontFamily: 'var(--font-headline), Space Grotesk, sans-serif',
                }}
              >
                {creating ? 'Launching…' : 'Create Map'}
              </button>
              {error && (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {error}
                </p>
              )}
            </form>
          </div>
        </section>

        {/* Feature cards */}
        <section className="grid grid-cols-2 gap-3 max-w-md mx-auto">
          <div className="col-span-2 p-4 bg-[#f2f3ff] rounded-xl flex gap-4 items-start border border-[#c2c6d9]/20">
            <span
              className="material-symbols-outlined text-[#004cca] text-xl mt-0.5"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              add_a_photo
            </span>
            <div>
              <h3
                className="font-bold text-base mb-0.5"
                style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
              >
                Sync Visuals
              </h3>
              <p className="text-[12px] leading-tight text-[#424656]">
                Auto-timestamp photos to your GPS track for precise location mapping.
              </p>
            </div>
          </div>
          
        </section>

        {/* Event ledger */}
        <section className="mt-8 max-w-md mx-auto">
          <div className="flex items-baseline justify-between mb-3">
            <h3
              className="text-sm font-bold uppercase tracking-[0.18em] text-[#191b24]"
              style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
            >
              Maps History
            </h3>
            <button
              onClick={load}
              className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#004cca] hover:underline"
              style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
            >
              Refresh
            </button>
          </div>

          {loading ? (
            <p className="py-6 text-center text-xs text-[#737687]">Loading…</p>
          ) : events.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#c2c6d9] bg-[#f2f3ff]/60 px-4 py-6 text-center text-xs text-[#737687]">
              No journeys yet. Create your first one above.
            </div>
          ) : (
            <ul className="space-y-2">
              {events.map((ev) => (
                <li
                  key={ev._id}
                  className="group flex items-center justify-between gap-3 rounded-xl border border-[#c2c6d9]/30 bg-white px-3.5 py-3 transition hover:border-[#004cca]/40 hover:shadow-sm"
                >
                  <Link
                    href={`/event/${ev.slug}`}
                    className="flex min-w-0 flex-1 items-center gap-3"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#f2f3ff] text-[#004cca]">
                      <span className="material-symbols-outlined text-base">
                        map
                      </span>
                    </span>
                    <div className="min-w-0">
                      <p
                        className="truncate text-sm font-bold text-[#191b24] group-hover:text-[#004cca]"
                        style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
                      >
                        {ev.name}
                      </p>
                      <p className="mt-0.5 truncate text-[10px] text-[#737687]">
                        /{ev.slug} ·{' '}
                        {new Date(ev.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </Link>
                  <button
                    onClick={() => onShare(ev)}
                    aria-label={`Share ${ev.slug}`}
                    title="Share link"
                    className="shrink-0 rounded-lg p-1.5 text-[#737687] hover:bg-[#f2f3ff] hover:text-[#004cca]"
                  >
                    <span className="material-symbols-outlined text-base">
                      share
                    </span>
                  </button>
                  <button
                    onClick={() => onDelete(ev.slug)}
                    aria-label={`Delete ${ev.slug}`}
                    title="Delete journey"
                    className="shrink-0 rounded-lg p-1.5 text-[#737687] hover:bg-red-50 hover:text-red-600"
                  >
                    <span className="material-symbols-outlined text-base">
                      delete
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      {/* ---------- Desktop footer ---------- */}
      <footer className="w-full py-6 hidden md:flex flex-col items-center gap-2 px-6 border-t border-[#c2c6d9]/20 bg-white md:ml-16">
        <div
          className="font-bold text-sm text-[#004cca] tracking-wide"
          style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
        >
          GPX ACTION TEAM
        </div>
        
        <p className="text-[10px] text-[#737687] text-center mt-1">
          © 2026 GPX Action Team
        </p>
      </footer>

      {/* ---------- Mobile bottom nav ---------- */}
      <nav className="fixed bottom-0 w-full z-50 border-t border-[#c2c6d9]/20 bg-[#faf8ff]/90 backdrop-blur-2xl flex justify-around items-center px-2 pb-5 pt-2 shadow-[0_-4px_20px_rgb(0,0,0,0.05)] md:hidden">
        <a
          className="flex flex-col items-center justify-center text-[#004cca] bg-[#0062ff]/10 rounded-xl px-4 py-1.5 active:scale-90 transition-transform"
          href="#"
        >
          <span
            className="material-symbols-outlined text-xl"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            explore
          </span>
          <span
            className="text-[9px] font-bold uppercase tracking-widest mt-0.5"
            style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
          >
            Explore
          </span>
        </a>
        <button
          onClick={() => setTracksOpen(true)}
          className={`flex flex-col items-center justify-center px-4 py-1.5 transition-all active:scale-90 ${
            tracksOpen
              ? 'text-[#004cca] bg-[#0062ff]/10 rounded-xl'
              : 'text-[#737687] hover:text-[#004cca]'
          }`}
        >
          <span
            className="material-symbols-outlined text-xl"
            style={tracksOpen ? { fontVariationSettings: "'FILL' 1" } : undefined}
          >
            route
          </span>
          <span
            className="text-[9px] font-bold uppercase tracking-widest mt-0.5"
            style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
          >
            Tracks
          </span>
        </button>
        
        <a
          className="flex flex-col items-center justify-center text-[#737687] px-4 py-1.5 hover:text-[#004cca] transition-all active:scale-90"
          href="#"
        >
          <span className="material-symbols-outlined text-xl">person</span>
          <span
            className="text-[9px] font-bold uppercase tracking-widest mt-0.5"
            style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
          >
            Profile
          </span>
        </a>
      </nav>

      {/* ---------- Desktop side rail ---------- */}
      <div className="hidden md:flex fixed top-0 left-0 h-full w-16 bg-[#faf8ff]/90 backdrop-blur-2xl border-r border-[#c2c6d9]/20 flex-col items-center py-6 gap-6 z-50">
        <span className="material-symbols-outlined text-[#004cca] text-2xl">
          explore
        </span>
        <div className="flex flex-col gap-6 flex-1 justify-center items-center">
          <span
            className="material-symbols-outlined text-[#004cca] bg-[#0062ff]/20 p-2.5 rounded-xl cursor-pointer"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            map
          </span>
          <button
            onClick={() => setTracksOpen(true)}
            aria-label="Open tracks list"
            className={`material-symbols-outlined transition-colors cursor-pointer bg-transparent border-0 ${
              tracksOpen
                ? 'text-[#004cca] bg-[#0062ff]/20 p-2.5 rounded-xl'
                : 'text-[#737687] hover:text-[#004cca]'
            }`}
            style={tracksOpen ? { fontVariationSettings: "'FILL' 1" } : undefined}
          >
            route
          </button>
          <span className="material-symbols-outlined text-[#737687] hover:text-[#004cca] transition-colors cursor-pointer">
            photo_camera
          </span>
        </div>
        <span className="material-symbols-outlined text-[#737687] hover:text-[#004cca] transition-colors cursor-pointer">
          account_circle
        </span>
      </div>

      {/* ---------- Tracks modal (full-screen list with search) ---------- */}
      {tracksOpen && (() => {
        const filtered = events;

        return (
          <div className="fixed inset-0 z-[2000] flex flex-col bg-[#faf8ff]">
            {/* Header */}
            <div className="flex flex-shrink-0 items-center justify-between border-b border-[#c2c6d9]/30 bg-[#faf8ff]/90 px-4 py-3 backdrop-blur-xl">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg shadow-sm kinetic-gradient">
                  <span
                    className="material-symbols-outlined text-white"
                    style={{ fontSize: 16, fontVariationSettings: "'FILL' 1" }}
                  >
                    route
                  </span>
                </div>
                <div>
                  <h3
                    className="text-sm font-bold text-[#191b24]"
                    style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
                  >
                    All Maps
                  </h3>
                  <p className="text-[10px] text-[#424656]">
                    {filtered.length} of {events.length} map
                    {events.length !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setTracksOpen(false);
                }}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[#ecedfa] transition-colors hover:bg-[#e7e7f4]"
              >
                <span className="material-symbols-outlined text-lg text-[#424656]">
                  close
                </span>
              </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto px-4 py-3 pb-28 md:pb-6">
              {loading ? (
                <p className="py-6 text-center text-xs text-[#737687]">
                  Loading…
                </p>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[#c2c6d9] bg-[#f2f3ff]/60 px-4 py-10 text-center">
                  <span className="material-symbols-outlined text-3xl text-[#737687]">
                    map
                  </span>
                  <p className="text-xs text-[#737687]">
                    ยังไม่มีแมพ สร้างแมพแรกด้านบน
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {filtered.map((ev) => (
                    <li
                      key={ev._id}
                      className="group flex items-center justify-between gap-3 rounded-xl border border-[#c2c6d9]/30 bg-white px-3.5 py-3 transition hover:border-[#004cca]/40 hover:shadow-sm"
                    >
                      <Link
                        href={`/event/${ev.slug}`}
                        onClick={() => {
                          setTracksOpen(false);
                        }}
                        className="flex min-w-0 flex-1 items-center gap-3"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#f2f3ff] text-[#004cca]">
                          <span className="material-symbols-outlined text-base">
                            map
                          </span>
                        </span>
                        <div className="min-w-0">
                          <p
                            className="truncate text-sm font-bold text-[#191b24] group-hover:text-[#004cca]"
                            style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
                          >
                            {ev.name}
                          </p>
                          <p className="mt-0.5 truncate text-[10px] text-[#737687]">
                            /{ev.slug} ·{' '}
                            {new Date(ev.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </Link>
                      <button
                        onClick={() => onShare(ev)}
                        aria-label={`Share ${ev.slug}`}
                        title="Share link"
                        className="shrink-0 rounded-lg p-1.5 text-[#737687] hover:bg-[#f2f3ff] hover:text-[#004cca]"
                      >
                        <span className="material-symbols-outlined text-base">
                          share
                        </span>
                      </button>
                      <button
                        onClick={async () => {
                          await onDelete(ev.slug);
                        }}
                        aria-label={`Delete ${ev.slug}`}
                        title="Delete map"
                        className="shrink-0 rounded-lg p-1.5 text-[#737687] hover:bg-red-50 hover:text-red-600"
                      >
                        <span className="material-symbols-outlined text-base">
                          delete
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <nav className="fixed bottom-0 left-0 right-0 z-[2100] border-t border-[#c2c6d9]/20 bg-[#faf8ff]/95 px-2 pb-5 pt-2 shadow-[0_-4px_20px_rgb(0,0,0,0.05)] backdrop-blur-2xl md:hidden">
              <div className="flex items-center justify-around">
                <button
                  onClick={() => setTracksOpen(false)}
                  className="flex flex-col items-center justify-center text-[#737687] px-4 py-1.5 hover:text-[#004cca] transition-all active:scale-90"
                >
                  <span className="material-symbols-outlined text-xl">explore</span>
                  <span
                    className="mt-0.5 text-[9px] font-bold uppercase tracking-widest"
                    style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
                  >
                    Explore
                  </span>
                </button>
                <button className="flex flex-col items-center justify-center rounded-xl bg-[#0062ff]/10 px-4 py-1.5 text-[#004cca] active:scale-90 transition-transform">
                  <span
                    className="material-symbols-outlined text-xl"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    route
                  </span>
                  <span
                    className="mt-0.5 text-[9px] font-bold uppercase tracking-widest"
                    style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
                  >
                    Tracks
                  </span>
                </button>
                <a
                  className="flex flex-col items-center justify-center text-[#737687] px-4 py-1.5 hover:text-[#004cca] transition-all active:scale-90"
                  href="#"
                >
                  <span className="material-symbols-outlined text-xl">person</span>
                  <span
                    className="mt-0.5 text-[9px] font-bold uppercase tracking-widest"
                    style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
                  >
                    Profile
                  </span>
                </a>
              </div>
            </nav>
          </div>
        );
      })()}
    </div>
  );
}
