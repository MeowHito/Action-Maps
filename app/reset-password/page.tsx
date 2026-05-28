'use client';

import { useState, FormEvent, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { resetPassword } from '@/lib/auth';

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) setError('ลิงก์ไม่ถูกต้อง กรุณาขอรีเซ็ตใหม่');
  }, [token]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      setError('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
      return;
    }
    if (password !== confirm) {
      setError('รหัสผ่านไม่ตรงกัน');
      return;
    }
    setLoading(true);
    setError(null);
    const result = await resetPassword(token, password);
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
              <span className="material-symbols-outlined text-3xl text-[#17803d]">lock_reset</span>
            </div>
            <h1
              className="text-2xl font-black tracking-tighter text-[#191b24] mb-2"
              style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
            >
              รีเซ็ตสำเร็จ
            </h1>
            <p className="text-sm text-[#424656] mb-8">ตั้งรหัสผ่านใหม่เรียบร้อยแล้ว</p>
            <Link
              href="/join"
              className="block w-full kinetic-gradient text-white font-bold uppercase tracking-widest py-3.5 rounded-lg shadow-md text-sm text-center"
              style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
            >
              Sign In
            </Link>
          </div>
        ) : (
          <>
            <h1
              className="text-2xl font-black tracking-tighter text-[#191b24] mb-1"
              style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
            >
              ตั้งรหัสผ่านใหม่
            </h1>
            <p className="text-sm text-[#424656] mb-8">ใส่รหัสผ่านใหม่ของคุณ</p>

            <form onSubmit={onSubmit} className="space-y-5">
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="รหัสผ่านใหม่ (อย่างน้อย 6 ตัว)"
                  className="w-full bg-transparent border-0 border-b-2 border-[#c2c6d9] focus:border-[#004cca] focus:ring-0 focus:outline-none px-0 py-2 pr-8 font-medium text-base placeholder:text-[#737687] transition-all"
                  style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute right-0 top-1/2 -translate-y-1/2 material-symbols-outlined text-[#737687] text-lg bg-transparent border-0 cursor-pointer"
                >
                  {showPass ? 'visibility_off' : 'visibility'}
                </button>
              </div>

              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="ยืนยันรหัสผ่านใหม่"
                  className="w-full bg-transparent border-0 border-b-2 border-[#c2c6d9] focus:border-[#004cca] focus:ring-0 focus:outline-none px-0 py-2 font-medium text-base placeholder:text-[#737687] transition-all"
                  style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
                />
                <span className="absolute right-0 top-1/2 -translate-y-1/2 material-symbols-outlined text-[#737687] text-lg">
                  lock
                </span>
              </div>

              {error && (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || !token}
                className="w-full kinetic-gradient text-white font-bold uppercase tracking-widest py-3.5 rounded-lg shadow-md active:scale-[0.98] transition-transform text-sm disabled:opacity-60"
                style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
              >
                {loading ? 'กำลังบันทึก…' : 'บันทึกรหัสผ่านใหม่'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
