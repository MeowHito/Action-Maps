'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { forgotPassword } from '@/lib/auth';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError(null);
    const result = await forgotPassword(email.trim());
    setLoading(false);
    if (result.ok) {
      setDone(true);
    } else {
      setError(result.error ?? 'เกิดข้อผิดพลาด');
    }
  };

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-[#faf8ff] px-4"
      style={{ fontFamily: 'var(--font-sans), Inter, sans-serif' }}
    >
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center gap-1.5 mb-10">
          <span className="material-symbols-outlined text-[#004cca] scale-90">explore</span>
          <span
            className="text-lg font-black tracking-tighter text-[#004cca] uppercase"
            style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
          >
            GPX ACTION
          </span>
        </div>

        {done ? (
          <div className="text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#e4f6ea] mx-auto mb-6">
              <span className="material-symbols-outlined text-3xl text-[#17803d]">mark_email_read</span>
            </div>
            <h1
              className="text-2xl font-black tracking-tighter text-[#191b24] mb-2"
              style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
            >
              ส่งอีเมลแล้ว
            </h1>
            <p className="text-sm text-[#424656] mb-8">
              ถ้าอีเมลนี้มีบัญชีอยู่ ระบบจะส่งลิงก์รีเซ็ตรหัสผ่านไปให้<br />
              ลิงก์จะหมดอายุใน <strong>1 ชั่วโมง</strong>
            </p>
            <Link
              href="/join"
              className="block w-full kinetic-gradient text-white font-bold uppercase tracking-widest py-3.5 rounded-lg shadow-md text-sm text-center"
              style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
            >
              กลับไปหน้า Sign In
            </Link>
          </div>
        ) : (
          <>
            <h1
              className="text-2xl font-black tracking-tighter text-[#191b24] mb-1"
              style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
            >
              ลืมรหัสผ่าน
            </h1>
            <p className="text-sm text-[#424656] mb-8">
              ใส่อีเมลที่ลงทะเบียนไว้ ระบบจะส่งลิงก์รีเซ็ตให้
            </p>

            <form onSubmit={onSubmit} className="space-y-5">
              <div className="relative">
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email address"
                  className="w-full bg-transparent border-0 border-b-2 border-[#c2c6d9] focus:border-[#004cca] focus:ring-0 focus:outline-none px-0 py-2 font-medium text-base placeholder:text-[#737687] transition-all"
                  style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
                />
                <span className="absolute right-0 top-1/2 -translate-y-1/2 material-symbols-outlined text-[#737687] text-lg">
                  mail
                </span>
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
                style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
              >
                {loading ? 'กำลังส่ง…' : 'ส่งลิงก์รีเซ็ต'}
              </button>
            </form>

            <p className="mt-6 text-center text-xs text-[#737687]">
              จำได้แล้ว?{' '}
              <Link href="/join" className="text-[#004cca] font-semibold hover:underline">
                Sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
