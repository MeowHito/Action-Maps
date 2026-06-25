'use client';

import { useEffect, useState } from 'react';
import { api, type EventCodes } from '@/lib/api';

type CodeKey = 'adminCode' | 'uploadCode' | 'viewCode';

const FIELDS: { key: CodeKey; label: string; icon: string; hint: string }[] = [
  { key: 'adminCode', label: 'รหัสแอดมิน', icon: 'admin_panel_settings', hint: 'จัดการ/อัปโหลด/ลบ' },
  { key: 'uploadCode', label: 'รหัสอัปโหลด', icon: 'add_a_photo', hint: 'อัปโหลดรูปได้อย่างเดียว' },
  { key: 'viewCode', label: 'รหัสดูอย่างเดียว', icon: 'visibility', hint: 'ดูแผนที่อย่างเดียว' },
];

/** Inline panel for an event owner / super-admin to view and change the three
 *  access codes. Codes are revealed (not hashed) so a forgotten code can be
 *  read back; legacy hashed codes show a notice and must be reset to be shown. */
export default function EventCodesPanel({ slug }: { slug: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [codes, setCodes] = useState<EventCodes | null>(null);
  const [values, setValues] = useState<Record<CodeKey, string>>({
    adminCode: '',
    uploadCode: '',
    viewCode: '',
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const c = await api.getEventCodes(slug);
        if (!alive) return;
        setCodes(c);
        setValues({
          adminCode: c.adminCode.value,
          uploadCode: c.uploadCode.value,
          viewCode: c.viewCode.value,
        });
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [slug]);

  const onSave = async () => {
    try {
      setSaving(true);
      setError(null);
      // Send only fields that changed from what the server returned.
      const payload: Partial<Record<CodeKey, string>> = {};
      for (const f of FIELDS) {
        const original = codes?.[f.key].value ?? '';
        const legacy = codes?.[f.key].legacy ?? false;
        if (values[f.key] !== original || legacy) payload[f.key] = values[f.key];
      }
      if (Object.keys(payload).length === 0) {
        setSaved(true);
        setTimeout(() => setSaved(false), 1600);
        return;
      }
      await api.updateEventCodes(slug, payload);
      const refreshed = await api.getEventCodes(slug);
      setCodes(refreshed);
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 rounded-xl border border-[#c2c6d9]/40 bg-[#f7f8ff] p-3">
      <div className="mb-2 flex items-center justify-between">
        <p
          className="text-[10px] font-bold uppercase tracking-widest text-[#737687]"
          style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
        >
          รหัสเข้าร่วม
        </p>
        <button
          type="button"
          onClick={() => setReveal((r) => !r)}
          className="flex items-center gap-1 text-[11px] text-[#004cca] hover:underline"
        >
          <span className="material-symbols-outlined text-sm">
            {reveal ? 'visibility_off' : 'visibility'}
          </span>
          {reveal ? 'ซ่อน' : 'แสดงรหัส'}
        </button>
      </div>

      {loading ? (
        <p className="py-3 text-center text-xs text-[#737687]">กำลังโหลด…</p>
      ) : (
        <div className="space-y-3">
          {FIELDS.map((f) => {
            const legacy = codes?.[f.key].legacy ?? false;
            return (
              <div key={f.key} className="relative">
                <label className="mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold text-[#424656]">
                  <span
                    className="material-symbols-outlined text-[#004cca]"
                    style={{ fontSize: 15, fontVariationSettings: "'FILL' 1" }}
                  >
                    {f.icon}
                  </span>
                  {f.label}
                  <span className="font-normal text-[#9a9db0]">· {f.hint}</span>
                </label>
                <input
                  type={reveal ? 'text' : 'password'}
                  value={values[f.key]}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [f.key]: e.target.value }))
                  }
                  autoComplete="off"
                  placeholder={
                    legacy
                      ? 'รหัสเดิม (ระบบเก่า) ดูไม่ได้ — ตั้งใหม่เพื่อให้ดูได้'
                      : 'ไม่ได้ตั้งรหัส — เว้นว่าง = เข้าได้เลย'
                  }
                  className="w-full rounded-lg border border-[#c2c6d9] bg-white px-3 py-1.5 text-sm focus:border-[#004cca] focus:outline-none focus:ring-1 focus:ring-[#004cca]/30"
                  style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
                />
                {legacy && (
                  <p className="mt-0.5 text-[10px] text-amber-600">
                    รหัสเดิมถูกเข้ารหัสแบบเก่า แสดงไม่ได้ — พิมพ์รหัสใหม่แล้วบันทึก
                  </p>
                )}
              </div>
            );
          })}

          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="rounded-lg bg-[#004cca] px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-white active:scale-[0.98] disabled:opacity-60"
              style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
            >
              {saving ? 'กำลังบันทึก…' : 'บันทึกรหัส'}
            </button>
            {saved && (
              <span className="flex items-center gap-1 text-xs text-green-600">
                <span className="material-symbols-outlined text-sm">check_circle</span>
                บันทึกแล้ว
              </span>
            )}
          </div>
          <p className="text-[10px] text-[#9a9db0]">
            เว้นช่องว่างไว้แล้วบันทึก = ลบรหัสนั้น (ใครก็เข้าได้ในระดับนั้น)
          </p>
        </div>
      )}
    </div>
  );
}
