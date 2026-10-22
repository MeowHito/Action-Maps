'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState, FormEvent } from 'react';
import { isLoggedIn, getEventToken, setEventToken, clearEventToken } from '@/lib/auth';
import { api } from '@/lib/api';
import type { EventDoc, EventRole } from '@/lib/types';
import WhatsNewModal from './WhatsNewModal';

const MapClient = dynamic(() => import('./MapClient'), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-full items-center justify-center text-sm text-zinc-500">
      Loading map…
    </div>
  ),
});

const headlineFont = { fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' };

const thaiDate = (iso: string) =>
  new Date(iso).toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

function formatEventDates(startsAt?: string | null, endsAt?: string | null) {
  if (!startsAt) return null;
  const start = thaiDate(startsAt);
  if (!endsAt) return start;
  const end = thaiDate(endsAt);
  return end === start ? start : `${start} – ${end}`;
}

export default function EventPageClient({ slug }: { slug: string }) {
  const [role, setRole] = useState<EventRole | null>(null);
  const [checking, setChecking] = useState(true);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showCode, setShowCode] = useState(false);
  // Public event metadata (name / dates) so the code gate can announce the
  // event instead of only showing the slug.
  const [eventMeta, setEventMeta] = useState<EventDoc | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getEvent(slug)
      .then((ev) => {
        if (!cancelled) setEventMeta(ev);
      })
      .catch(() => {
        /* keep slug fallback */
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    const init = async () => {
      const stored = getEventToken(slug);
      if (stored) {
        setRole(stored.role);
        setChecking(false);
        return;
      }
      // Try silent probe: events with no codes auto-grant admin
      try {
        const res = await api.verifyEventCode(slug, '');
        setEventToken(slug, res.role, res.token);
        setRole(res.role);
        setChecking(false);
        return;
      } catch {
        // Event has codes configured — fall through
      }

      if (isLoggedIn()) {
        try {
          const res = await api.siteAdminEventToken(slug);
          setEventToken(slug, res.role, res.token);
          setRole(res.role);
        } catch {
          // SITE_ADMIN_SECRET not configured — fall through to code gate
        }
      }
      setChecking(false);
    };
    void init();
  }, [slug]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.verifyEventCode(slug, code.trim());
      setEventToken(slug, res.role, res.token);
      setRole(res.role);
    } catch {
      setError('รหัสไม่ถูกต้อง กรุณาลองใหม่');
    } finally {
      setLoading(false);
    }
  };

  const onChangeCode = () => {
    clearEventToken(slug);
    setRole(null);
    setCode('');
    setError(null);
  };

  const eventDateLabel = formatEventDates(eventMeta?.startsAt, eventMeta?.endsAt);

  if (checking) {
    return (
      <div className="flex h-screen w-full items-center justify-center text-sm text-zinc-500">
        Loading…
      </div>
    );
  }

  if (!role) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center bg-[#faf8ff] px-4"
        style={{ fontFamily: 'var(--font-sans), Inter, sans-serif' }}
      >
        <div className="w-full max-w-xs">
          <div className="mb-5 flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[#004cca] scale-90">explore</span>
            <span className="text-sm font-black tracking-tighter text-[#004cca] uppercase" style={headlineFont}>
              GPX ACTION
            </span>
          </div>

          {/* Event announcement */}
          <div className="kinetic-gradient relative mb-6 overflow-hidden rounded-2xl px-5 py-6 text-white shadow-lg shadow-[#004cca]/30">
            <span
              className="material-symbols-outlined pointer-events-none absolute -right-4 -top-4 text-white/10 select-none"
              style={{ fontSize: 120, fontVariationSettings: "'FILL' 1" }}
              aria-hidden
            >
              landscape
            </span>
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/70" style={headlineFont}>
              Event
            </p>
            <h1
              className="mt-1 break-words text-[28px] font-black uppercase leading-[1.05] tracking-tight"
              style={headlineFont}
            >
              {eventMeta?.name ?? slug}
            </h1>
            {eventDateLabel && (
              <p className="mt-2 flex items-center gap-1 text-xs font-medium text-white/85">
                <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
                  calendar_month
                </span>
                {eventDateLabel}
              </p>
            )}
            {eventMeta?.description && (
              <p className="mt-2 line-clamp-2 text-xs text-white/80">{eventMeta.description}</p>
            )}
          </div>

          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#004cca]/10">
              <span className="material-symbols-outlined text-[#004cca]" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>
                lock
              </span>
            </div>
            <div>
              <p className="text-sm font-bold text-[#191b24]" style={headlineFont}>
                ใส่รหัสเพื่อเข้าถึงกิจกรรมนี้
              </p>
              <p className="text-[11px] text-[#737687]">/{slug}</p>
            </div>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="relative">
              <input
                type={showCode ? 'text' : 'password'}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="รหัสเข้าร่วม"
                required
                autoFocus
                className="w-full bg-transparent border-0 border-b-2 border-[#c2c6d9] focus:border-[#004cca] focus:ring-0 focus:outline-none px-0 py-2 pr-8 font-medium text-base placeholder:text-[#737687] transition-all"
                style={headlineFont}
              />
              <button
                type="button"
                onClick={() => setShowCode((v) => !v)}
                className="absolute right-0 top-1/2 -translate-y-1/2 material-symbols-outlined text-[#737687] text-lg bg-transparent border-0 cursor-pointer"
              >
                {showCode ? 'visibility_off' : 'visibility'}
              </button>
            </div>

            {error && (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full kinetic-gradient text-white font-bold uppercase tracking-widest py-3.5 rounded-lg shadow-md active:scale-[0.98] transition-transform text-sm disabled:opacity-60"
              style={headlineFont}
            >
              {loading ? 'กำลังตรวจสอบ…' : 'เข้าร่วม'}
            </button>
          </form>

          <div className="mt-4 flex justify-center gap-1 text-[10px] text-[#737687]">
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>info</span>
            <span>ติดต่อผู้จัดกิจกรรมเพื่อขอรหัส</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {role !== 'admin' && (
        <div className="fixed top-3 right-3 z-[5000]">
          <button
            onClick={onChangeCode}
            className="flex items-center gap-1 rounded-full border border-[#c2c6d9]/40 bg-white/90 backdrop-blur-sm px-2.5 py-1 text-[10px] text-[#737687] shadow-sm hover:text-red-600 transition-colors"
            style={headlineFont}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 12 }}>lock_reset</span>
            เปลี่ยนรหัส
          </button>
        </div>
      )}
      <MapClient slug={slug} role={role} />
      <WhatsNewModal />
    </div>
  );
}
