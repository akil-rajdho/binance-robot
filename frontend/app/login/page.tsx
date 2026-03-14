'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../src/contexts/AuthContext';

export default function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // If already authenticated, go to dashboard
  if (isAuthenticated) {
    router.replace('/');
    return null;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(password);
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#070B14] flex items-center justify-center px-4">
      <div className="w-full max-w-[400px]">
        {/* Logo / Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#1E7CF8]/10 border border-[#1E7CF8]/20 mb-4">
            <span className="text-3xl leading-none">₿</span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Bitcoin Robot</h1>
          <p className="mt-1 text-sm text-[#94a3b8]">Enter your password to continue</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-[#1E2A3D] bg-[#0A0F1C] p-6 shadow-2xl">
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="password" className="block text-sm font-medium text-[#94a3b8]">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full rounded-lg border border-[#1E2A3D] bg-[#1A2332] px-4 py-3 text-sm text-white placeholder-[#4b5563] focus:border-[#1E7CF8] focus:outline-none focus:ring-2 focus:ring-[#1E7CF8]/20 transition"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || password.length === 0}
              className="w-full rounded-lg bg-[#1E7CF8] px-4 py-3 text-sm font-semibold text-white transition-all hover:bg-blue-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                  </svg>
                  Signing in...
                </span>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
