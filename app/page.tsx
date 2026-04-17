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

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-14 sm:py-20">
      {/* ---------- Masthead ---------- */}
      <header className="text-center">
        <p className="eyebrow mb-3">Est. 2026 · Real-time · GPX · GPS Photos</p>
        <div className="mx-auto mb-4 h-px w-16 bg-[color:var(--rule)]" />
        <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight text-[color:var(--ink)] sm:text-6xl">
          Route &amp;{' '}
          <span className="italic text-[color:var(--accent-ink)]">Photo</span>{' '}
          Tracker
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-[color:var(--ink-soft)]">
          A quiet place to host your trail events — upload GPX courses, pin
          geotagged photographs from the field, and follow along as others
          contribute, all in real time.
        </p>
        <div className="mx-auto mt-6 h-px w-16 bg-[color:var(--rule)]" />
      </header>

      {/* ---------- Create event ---------- */}
      <section className="overflow-hidden rounded-lg border border-[color:var(--rule)] bg-[color:var(--card)] shadow-[0_1px_0_rgba(0,0,0,0.02),0_10px_30px_-20px_rgba(60,45,20,0.2)]">
        <div className="flex items-baseline justify-between border-b border-[color:var(--rule)] px-6 py-4">
          <h2 className="text-xl font-semibold tracking-tight text-[color:var(--ink)]">
            Begin a new event
          </h2>
          <span className="eyebrow">Chapter I</span>
        </div>
        <form onSubmit={onCreate} className="px-6 py-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="eyebrow mb-1.5 block">Slug</span>
              <input
                name="slug"
                placeholder="chiang-mai-trail-2026"
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                title="lowercase, numbers, and dashes"
                required
                className="w-full rounded-md border border-[color:var(--rule)] bg-white px-3 py-2.5 font-mono text-sm text-[color:var(--ink)] placeholder-[color:var(--muted)] outline-none transition focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:var(--accent)]/15"
              />
            </label>
            <label className="block">
              <span className="eyebrow mb-1.5 block">Display name</span>
              <input
                name="name"
                placeholder="Chiang Mai Trail 2026"
                required
                className="w-full rounded-md border border-[color:var(--rule)] bg-white px-3 py-2.5 text-sm text-[color:var(--ink)] placeholder-[color:var(--muted)] outline-none transition focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:var(--accent)]/15"
              />
            </label>
          </div>
          <div className="mt-5 flex items-center justify-between gap-4">
            <p className="text-xs text-[color:var(--muted)]">
              The <em>slug</em> becomes the event&rsquo;s permanent URL.
            </p>
            <button
              type="submit"
              disabled={creating}
              className="rounded-md bg-[color:var(--accent)] px-5 py-2.5 text-sm font-semibold tracking-wide text-white shadow-sm transition hover:bg-[color:var(--accent-ink)] disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create event →'}
            </button>
          </div>
          {error && (
            <p className="mt-4 rounded-md border border-[color:var(--danger)]/30 bg-[color:var(--danger)]/5 px-3 py-2 text-sm text-[color:var(--danger)]">
              {error}
            </p>
          )}
        </form>
      </section>

      {/* ---------- Events ledger ---------- */}
      <section className="overflow-hidden rounded-lg border border-[color:var(--rule)] bg-[color:var(--card)]">
        <div className="flex items-baseline justify-between border-b border-[color:var(--rule)] px-6 py-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-[color:var(--ink)]">
              The Ledger
            </h2>
            <p className="mt-0.5 text-xs text-[color:var(--muted)]">
              {loading
                ? 'Gathering entries…'
                : `${events.length} event${events.length === 1 ? '' : 's'} on record`}
            </p>
          </div>
          <button
            onClick={load}
            className="eyebrow text-[color:var(--accent)] transition hover:text-[color:var(--accent-ink)]"
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <p className="px-6 py-10 text-center text-sm italic text-[color:var(--muted)]">
            Loading…
          </p>
        ) : events.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="mx-auto max-w-sm font-serif text-lg italic text-[color:var(--ink-soft)]">
              &ldquo;The page is blank — waiting for the first footprint.&rdquo;
            </p>
            <p className="mt-3 text-xs text-[color:var(--muted)]">
              Create an event above to begin.
            </p>
          </div>
        ) : (
          <ul>
            {events.map((ev, i) => (
              <li
                key={ev._id}
                className={`group flex items-center justify-between gap-4 px-6 py-4 transition hover:bg-[color:var(--paper)] ${
                  i > 0 ? 'border-t border-[color:var(--rule)]' : ''
                }`}
              >
                <div className="flex min-w-0 items-center gap-4">
                  <span className="hidden w-8 shrink-0 font-serif text-sm italic text-[color:var(--muted)] sm:block">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="min-w-0">
                    <Link
                      href={`/event/${ev.slug}`}
                      className="block truncate text-base font-semibold text-[color:var(--ink)] transition group-hover:text-[color:var(--accent-ink)]"
                    >
                      {ev.name}
                    </Link>
                    <p className="mt-0.5 flex items-center gap-2 truncate text-xs text-[color:var(--muted)]">
                      <span className="font-mono">/{ev.slug}</span>
                      <span className="text-[color:var(--rule)]">·</span>
                      <span>{new Date(ev.createdAt).toLocaleDateString()}</span>
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Link
                    href={`/event/${ev.slug}`}
                    className="rounded-md px-3 py-1.5 text-xs font-semibold tracking-wide text-[color:var(--accent-ink)] transition hover:bg-[color:var(--accent)]/10"
                  >
                    Open →
                  </Link>
                  <button
                    onClick={() => onDelete(ev.slug)}
                    aria-label={`Delete ${ev.slug}`}
                    className="rounded-md px-2.5 py-1.5 text-xs font-medium text-[color:var(--muted)] transition hover:bg-[color:var(--danger)]/10 hover:text-[color:var(--danger)]"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------- Footer ---------- */}
      <footer className="flex flex-col items-center gap-2 pt-4 text-center">
        <div className="h-px w-10 bg-[color:var(--rule)]" />
        <p className="font-serif text-xs italic text-[color:var(--muted)]">
          Bound to <code className="font-mono not-italic">{api.base}</code>
        </p>
      </footer>
    </div>
  );
}
