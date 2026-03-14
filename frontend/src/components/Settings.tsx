'use client';

import { useState, useEffect } from 'react';

const API_URL = process.env.NEXT_PUBLIC_BACKEND_API || 'http://localhost:8080';

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (settings: Record<string, string>) => Promise<void>;
}

const LEVERAGE_OPTIONS = ['1', '2', '3', '5', '10', '20'];

export default function Settings({ open, onClose, onSave }: Props) {
  const [positionSize, setPositionSize] = useState('');
  const [leverage, setLeverage] = useState('1');
  const [dailyLossLimit, setDailyLossLimit] = useState('');
  const [startingBalance, setStartingBalance] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Determine if API keys are configured (env-level, not user-editable)
  // We check for a window-level flag that the page can inject, or default to unknown
  const apiKeysConfigured =
    typeof window !== 'undefined' &&
    (window as Window & { __API_KEYS_CONFIGURED__?: boolean }).__API_KEYS_CONFIGURED__ === true;

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Reset success state when reopening
  useEffect(() => {
    if (open) {
      setSaveSuccess(false);
      setSaveError(null);
    }
  }, [open]);

  // Pre-load current settings from backend when the drawer opens
  useEffect(() => {
    if (!open) return;
    fetch(`${API_URL}/api/config`)
      .then(r => r.json())
      .then((settings: Record<string, string>) => {
        setPositionSize(settings.position_size_usdt || '700');
        setLeverage(settings.leverage || '1');
        setDailyLossLimit(settings.daily_loss_limit_pct || '5');
        setStartingBalance(settings.starting_balance || '700');
      })
      .catch(console.error);
  }, [open]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      await onSave({
        position_size_usdt: positionSize,
        leverage,
        daily_loss_limit_pct: dailyLossLimit,
        starting_balance: startingBalance,
      });
      setSaveSuccess(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Drawer */}
      <aside
        className={`fixed top-0 right-0 z-50 h-full w-full max-w-sm bg-white shadow-2xl border-l border-gray-200 flex flex-col transition-transform duration-300 ease-in-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        aria-label="Settings drawer"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">Settings</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            aria-label="Close settings"
          >
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 2l12 12M14 2L2 14" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {/* API Key Status */}
          <div className={`rounded-md border px-3 py-2.5 flex items-center gap-2 text-sm ${
            apiKeysConfigured
              ? 'bg-green-50 border-green-100 text-green-700'
              : 'bg-red-50 border-red-100 text-red-600'
          }`}>
            <span
              className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
                apiKeysConfigured ? 'bg-green-500' : 'bg-red-500'
              }`}
            />
            {apiKeysConfigured
              ? 'API keys configured'
              : 'No API keys — set in .env file'}
          </div>

          {/* Position Size */}
          <div className="space-y-1.5">
            <label htmlFor="positionSize" className="block text-sm font-medium text-gray-700">
              Position Size (USDT)
            </label>
            <input
              id="positionSize"
              type="number"
              min="1"
              step="any"
              value={positionSize}
              onChange={(e) => setPositionSize(e.target.value)}
              placeholder="e.g. 700"
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 transition"
            />
          </div>

          {/* Leverage */}
          <div className="space-y-1.5">
            <label htmlFor="leverage" className="block text-sm font-medium text-gray-700">
              Leverage
            </label>
            <select
              id="leverage"
              value={leverage}
              onChange={(e) => setLeverage(e.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 transition"
            >
              {LEVERAGE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}x
                </option>
              ))}
            </select>
          </div>

          {/* Daily Loss Limit */}
          <div className="space-y-1.5">
            <label htmlFor="dailyLossLimit" className="block text-sm font-medium text-gray-700">
              Daily Loss Limit (%)
            </label>
            <input
              id="dailyLossLimit"
              type="number"
              min="0"
              max="100"
              step="any"
              value={dailyLossLimit}
              onChange={(e) => setDailyLossLimit(e.target.value)}
              placeholder="e.g. 5"
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 transition"
            />
          </div>

          {/* Starting Balance */}
          <div className="space-y-1.5">
            <label htmlFor="startingBalance" className="block text-sm font-medium text-gray-700">
              Starting Balance (USDT)
            </label>
            <input
              id="startingBalance"
              type="number"
              min="0"
              step="any"
              value={startingBalance}
              onChange={(e) => setStartingBalance(e.target.value)}
              placeholder="e.g. 10000"
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 transition"
            />
          </div>

          {/* Feedback messages */}
          {saveError && (
            <p className="text-sm text-red-600 rounded-md bg-red-50 border border-red-100 px-3 py-2">
              {saveError}
            </p>
          )}
          {saveSuccess && (
            <p className="text-sm text-green-600 rounded-md bg-green-50 border border-green-100 px-3 py-2">
              Settings saved successfully.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-5 py-4 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </aside>
    </>
  );
}
