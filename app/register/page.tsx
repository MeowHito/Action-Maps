'use client';

import { useState, FormEvent, useEffect } from 'react';
import Link from 'next/link';
import { register, isLoggedIn } from '@/lib/auth';

export default function RegisterPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (isLoggedIn()) {
      window.location.replace('/');
    }
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username.trim()) return;
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    const result = await register(username.trim(), password);
    if (result.ok) {
      setDone(true);
    } else {
      setError(result.error ?? 'Registration failed');
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center bg-[#faf8ff] px-4"
        style={{ fontFamily: 'var(--font-sans), Inter, sans-serif' }}
      >
        <div className="w-full max-w-sm text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#e4f6ea] mx-auto mb-6">
            <span className="material-symbols-outlined text-3xl text-[#17803d]">
              check_circle
            </span>
          </div>
          <h1
            className="text-2xl font-black tracking-tighter text-[#191b24] mb-2"
            style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
          >
            Account created!
          </h1>
          <p className="text-sm text-[#424656] mb-8">
            You can now sign in with your new account.
          </p>
          <Link
            href="/join"
            className="block w-full kinetic-gradient text-white font-bold uppercase tracking-widest py-3.5 rounded-lg shadow-md text-sm text-center"
            style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
          >
            Go to Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-[#faf8ff] px-4"
      style={{ fontFamily: 'var(--font-sans), Inter, sans-serif' }}
    >
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center gap-1.5 mb-10">
          <span className="material-symbols-outlined text-[#004cca] scale-90">
            explore
          </span>
          <span
            className="text-lg font-black tracking-tighter text-[#004cca] uppercase"
            style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
          >
            GPX ACTION
          </span>
        </div>

        {/* Heading */}
        <h1
          className="text-2xl font-black tracking-tighter text-[#191b24] mb-1"
          style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
        >
          Create account
        </h1>
        <p className="text-sm text-[#424656] mb-8">
          Set up your GPX Action account.
        </p>

        {/* Form */}
        <form onSubmit={onSubmit} className="space-y-5">
          <div className="relative">
            <input
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              className="w-full bg-transparent border-0 border-b-2 border-[#c2c6d9] focus:border-[#004cca] focus:ring-0 focus:outline-none px-0 py-2 font-medium text-base placeholder:text-[#737687] transition-all"
              style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
            />
            <span className="absolute right-0 top-1/2 -translate-y-1/2 material-symbols-outlined text-[#737687] text-lg">
              person
            </span>
          </div>

          <div className="relative">
            <input
              type={showPass ? 'text' : 'password'}
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (min 6 characters)"
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
              placeholder="Confirm password"
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
            disabled={loading}
            className="w-full kinetic-gradient text-white font-bold uppercase tracking-widest py-3.5 rounded-lg shadow-md active:scale-[0.98] transition-transform text-sm disabled:opacity-60"
            style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
          >
            {loading ? 'Creating…' : 'Create Account'}
          </button>
        </form>

        {/* Login link */}
        <p className="mt-6 text-center text-xs text-[#737687]">
          Already have an account?{' '}
          <Link
            href="/join"
            className="text-[#004cca] font-semibold hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
