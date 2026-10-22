'use client';

import { useEffect, useId, useState } from 'react';
import { CHANGELOG, LATEST_RELEASE } from '@/lib/changelog';

// localStorage: version the user ticked "don't show again" for (per browser).
const HIDE_KEY = 'am_whats_new_hidden';
// sessionStorage: version already closed in this tab, so it doesn't pop up
// again on every event opened in the same visit.
const CLOSED_KEY = 'am_whats_new_closed';

const headlineFont = { fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' };

// Storage can throw (private mode, blocked site data) — never let that break the map.
function readStorage(kind: 'local' | 'session', key: string): string | null {
  try {
    return (kind === 'local' ? localStorage : sessionStorage).getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(kind: 'local' | 'session', key: string, value: string) {
  try {
    (kind === 'local' ? localStorage : sessionStorage).setItem(key, value);
  } catch {
    /* no-op */
  }
}

const thaiDate = (iso: string) =>
  new Date(iso).toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

export default function WhatsNewModal() {
  const version = LATEST_RELEASE?.version;
  const [open, setOpen] = useState(
    () =>
      !!version &&
      readStorage('local', HIDE_KEY) !== version &&
      readStorage('session', CLOSED_KEY) !== version,
  );
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const titleId = useId();

  const close = () => {
    if (!version) return;
    writeStorage('session', CLOSED_KEY, version);
    if (dontShowAgain) writeStorage('local', HIDE_KEY, version);
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!open || !LATEST_RELEASE) return null;
  const older = CHANGELOG.slice(1);

  return (
    <div
      className="whats-new-backdrop fixed inset-0 z-[6000] flex items-end justify-center bg-[#191b24]/55 p-3 backdrop-blur-sm sm:items-center"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="whats-new-card flex max-h-[88vh] w-full max-w-sm flex-col overflow-hidden rounded-3xl bg-[#faf8ff] shadow-2xl"
        style={{ fontFamily: 'Inter, sans-serif' }}
      >
        {/* Header */}
        <div className="kinetic-gradient relative shrink-0 overflow-hidden px-5 pb-5 pt-5 text-white">
          <span
            className="material-symbols-outlined pointer-events-none absolute -right-3 -top-3 select-none text-white/10"
            style={{ fontSize: 110, fontVariationSettings: "'FILL' 1" }}
            aria-hidden
          >
            auto_awesome
          </span>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/15 transition-colors hover:bg-white/25"
          >
            <span className="material-symbols-outlined text-lg text-white">close</span>
          </button>
          <div
            className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest"
            style={headlineFont}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 13, fontVariationSettings: "'FILL' 1" }}>
              new_releases
            </span>
            v{LATEST_RELEASE.version}
          </div>
          <h2
            id={titleId}
            className="mt-2 text-2xl font-black uppercase leading-tight tracking-tight"
            style={headlineFont}
          >
            มีอะไรใหม่
          </h2>
          <p className="mt-0.5 text-xs text-white/80">
            อัปเดตเมื่อ {thaiDate(LATEST_RELEASE.date)}
          </p>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <ul className="space-y-1">
            {LATEST_RELEASE.items.map((item) => (
              <li key={item.title} className="flex gap-3 rounded-2xl px-1.5 py-2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#004cca]/10 text-[#004cca]">
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 20, fontVariationSettings: "'FILL' 1" }}
                  >
                    {item.icon}
                  </span>
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[#191b24]" style={headlineFont}>
                    {item.title}
                  </p>
                  <p className="text-xs leading-relaxed text-[#424656]">{item.detail}</p>
                </div>
              </li>
            ))}
          </ul>

          {older.length > 0 && (
            <details className="mt-2 rounded-2xl border border-[#c2c6d9]/40 bg-white px-3 py-2">
              <summary className="cursor-pointer text-xs font-semibold text-[#424656]">
                เวอร์ชันก่อนหน้า
              </summary>
              <div className="mt-2 space-y-3">
                {older.map((rel) => (
                  <div key={rel.version}>
                    <p className="text-[11px] font-bold text-[#004cca]" style={headlineFont}>
                      v{rel.version} · {thaiDate(rel.date)}
                    </p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-[#424656]">
                      {rel.items.map((item) => (
                        <li key={item.title}>{item.title}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[#c2c6d9]/30 px-4 py-3">
          <label className="flex cursor-pointer select-none items-center gap-2 text-xs text-[#424656]">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="h-4 w-4 accent-[#004cca]"
            />
            ไม่ต้องแสดงอีก
          </label>
          <button
            type="button"
            onClick={close}
            className="kinetic-gradient rounded-full px-5 py-2 text-xs font-bold uppercase tracking-wider text-white shadow-md transition-transform active:scale-95"
            style={headlineFont}
          >
            เข้าใจแล้ว
          </button>
        </div>
      </div>
    </div>
  );
}
