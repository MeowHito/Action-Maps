'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState, FormEvent } from 'react';
import { isLoggedIn, getEventToken, setEventToken, clearEventToken } from '@/lib/auth';
import { api } from '@/lib/api';
import type { EventRole } from '@/lib/types';

const MapClient = dynamic(() => import('./MapClient'), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-full items-center justify-center text-sm text-zinc-500">
      Loading map…
    </div>
  ),
});

const headlineFont = { fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' };

export default function EventPageClient({ slug }: { slug: string }) {
  const [role, setRole] = useState<EventRole | null>(null);
  const [checking, setChecking] = useState(true);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showCode, setShowCode] = useState(false);

  useEffect(() => {
    const init = async () => {
      const stored = getEventToken(slug);
      if (stored) {
        setRole(stored.role);
        setChecking(false);
        return;
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
          <div className="flex items-center gap-1.5 mb-8">
            <span className="material-symbols-outlined text-[#004cca] scale-90">explore</span>
            <span className="text-lg font-black tracking-tighter text-[#004cca] uppercase" style={headlineFont}>
              GPX ACTION
            </span>
          </div>

          <div className="mb-1 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#004cca]/10">
              <span className="material-symbols-outlined text-[#004cca]" style={{ fontSize: 20, fontVariationSettings: "'FILL' 1" }}>
                lock
              </span>
            </div>
            <div>
              <h1 className="text-lg font-black tracking-tighter text-[#191b24]" style={headlineFont}>
                Event Access
              </h1>
              <p className="text-[11px] text-[#737687]">/{slug}</p>
            </div>
          </div>

          <p className="text-xs text-[#424656] mb-6 mt-3">
            ใส่รหัสเพื่อเข้าถึงกิจกรรมนี้
          </p>

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
    </div>
  );
}
