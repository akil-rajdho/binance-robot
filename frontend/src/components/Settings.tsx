'use client';

import { useState, useEffect } from 'react';

const API_URL = process.env.NEXT_PUBLIC_BACKEND_API || 'http://localhost:8080';

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (settings: Record<string, string>) => Promise<void>;
  currentEntryOffset?: number;
  token?: string | null;
  onActivity?: () => void;
}

const LEVERAGE_OPTIONS = ['1', '2', '3', '5', '10', '20'];

export default function Settings({ open, onClose, onSave, currentEntryOffset, token, onActivity }: Props) {
  const [positionSize, setPositionSize] = useState('');
  const [leverage, setLeverage] = useState('1');
  const [dailyLossLimit, setDailyLossLimit] = useState('');
  const [startingBalance, setStartingBalance] = useState('');
  const [entryOffsetInitial, setEntryOffsetInitial] = useState('');
  const [entryOffsetStep, setEntryOffsetStep] = useState('');
  const [entryOffsetMin, setEntryOffsetMin] = useState('');
  const [orderCancelMinutes, setOrderCancelMinutes] = useState('');
  const [tpDistance, setTpDistance] = useState('');
  const [slDistance, setSlDistance] = useState('');
  const [minGapPct, setMinGapPct] = useState('');
  const [cancelCooldownMinutes, setCancelCooldownMinutes] = useState('');
  const [entryOffsetPct, setEntryOffsetPct] = useState('');
  const [minImpulsePct, setMinImpulsePct] = useState('');
  const [maxAtrUsdt, setMaxAtrUsdt] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [apiKeysConfigured, setApiKeysConfigured] = useState<boolean | null>(null);

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

  // Fetch API key status from backend on mount
  useEffect(() => {
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    onActivity?.();
    fetch(`${API_URL}/status`, { headers })
      .then(r => r.json())
      .then((data: { hasApiKeys?: boolean }) => setApiKeysConfigured(data.hasApiKeys === true))
      .catch(() => setApiKeysConfigured(false));
  }, [token, onActivity]);

  // Pre-load current settings from backend when the drawer opens
  useEffect(() => {
    if (!open) return;
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    onActivity?.();
    fetch(`${API_URL}/config`, { headers })
      .then(r => r.json())
      .then((settings: Record<string, string>) => {
        setPositionSize(settings.position_size_usdt || '700');
        setLeverage(settings.leverage || '1');
        setDailyLossLimit(settings.daily_loss_limit_pct || '5');
        setStartingBalance(settings.starting_balance || '700');
        setEntryOffsetInitial(settings.entry_offset_initial || '150');
        setEntryOffsetStep(settings.entry_offset_step || '20');
        setEntryOffsetMin(settings.entry_offset_min || '50');
        setOrderCancelMinutes(settings.order_cancel_minutes || '10');
        setTpDistance(settings.tp_distance || '50');
        setSlDistance(settings.sl_distance || '200');
        setMinGapPct(settings.min_gap_pct ?? '');
        setCancelCooldownMinutes(settings.cancel_cooldown_minutes ?? '');
        setEntryOffsetPct(settings.entry_offset_pct ?? '');
        setMinImpulsePct(settings.min_impulse_pct ?? '');
        setMaxAtrUsdt(settings.max_atr_usdt ?? '');
      })
      .catch(console.error);
  }, [open, token, onActivity]);

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
        entry_offset_initial: entryOffsetInitial,
        entry_offset_step: entryOffsetStep,
        entry_offset_min: entryOffsetMin,
        order_cancel_minutes: orderCancelMinutes,
        tp_distance: tpDistance,
        sl_distance: slDistance,
        min_gap_pct: minGapPct,
        cancel_cooldown_minutes: cancelCooldownMinutes,
        entry_offset_pct: entryOffsetPct,
        min_impulse_pct: minImpulsePct,
        max_atr_usdt: maxAtrUsdt,
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
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Drawer — full width on mobile, max-sm on desktop */}
      <aside
        className={`fixed top-0 right-0 z-50 h-full w-full md:max-w-sm bg-[#111827] shadow-2xl border-l border-[#1E2A3D] flex flex-col transition-transform duration-300 ease-in-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        aria-label="Settings drawer"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#1E2A3D] px-5 py-4">
          <h2 className="text-base font-semibold text-white">Settings</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-[#94a3b8] hover:bg-[#1A2332] hover:text-white transition-colors"
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
            apiKeysConfigured === true
              ? 'bg-green-900/30 border-green-800 text-green-400'
              : apiKeysConfigured === false
              ? 'bg-red-900/30 border-red-800 text-red-400'
              : 'bg-[#0D1421] border-[#1E2A3D] text-[#94a3b8]'
          }`}>
            <span
              className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
                apiKeysConfigured === true ? 'bg-green-500' : apiKeysConfigured === false ? 'bg-red-500' : 'bg-[#4b5563]'
              }`}
            />
            {apiKeysConfigured === true
              ? 'API keys configured'
              : apiKeysConfigured === false
              ? 'No API keys — set in .env file'
              : 'Checking API keys...'}
          </div>

          {/* Position Size */}
          <div className="space-y-1.5">
            <label htmlFor="positionSize" className="block text-sm font-medium text-[#94a3b8]">
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
              className="w-full min-h-[44px] rounded-md border border-[#1E2A3D] bg-[#1A2332] px-3 py-2 text-sm text-white placeholder-[#4b5563] focus:border-[#1E7CF8] focus:outline-none focus:ring-2 focus:ring-[#1E7CF8]/20 transition"
            />
          </div>

          {/* Leverage */}
          <div className="space-y-1.5">
            <label htmlFor="leverage" className="block text-sm font-medium text-[#94a3b8]">
              Leverage
            </label>
            <select
              id="leverage"
              value={leverage}
              onChange={(e) => setLeverage(e.target.value)}
              className="w-full min-h-[44px] rounded-md border border-[#1E2A3D] bg-[#1A2332] px-3 py-2 text-sm text-white focus:border-[#1E7CF8] focus:outline-none focus:ring-2 focus:ring-[#1E7CF8]/20 transition"
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
            <label htmlFor="dailyLossLimit" className="block text-sm font-medium text-[#94a3b8]">
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
              className="w-full min-h-[44px] rounded-md border border-[#1E2A3D] bg-[#1A2332] px-3 py-2 text-sm text-white placeholder-[#4b5563] focus:border-[#1E7CF8] focus:outline-none focus:ring-2 focus:ring-[#1E7CF8]/20 transition"
            />
          </div>

          {/* Starting Balance */}
          <div className="space-y-1.5">
            <label htmlFor="startingBalance" className="block text-sm font-medium text-[#94a3b8]">
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
              className="w-full min-h-[44px] rounded-md border border-[#1E2A3D] bg-[#1A2332] px-3 py-2 text-sm text-white placeholder-[#4b5563] focus:border-[#1E7CF8] focus:outline-none focus:ring-2 focus:ring-[#1E7CF8]/20 transition"
            />
          </div>

          {/* Entry Offset */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wide border-b border-[#1E2A3D] pb-1 mb-3">
              Entry Offset
            </h3>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-[#94a3b8]">
                Current Offset <span className="text-xs text-[#4b5563] font-normal">(live)</span>
              </label>
              <div className="w-full rounded-md border border-[#1E2A3D] bg-[#0D1421] px-3 py-2 text-sm text-[#94a3b8]">
                {currentEntryOffset ?? '—'}
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="entryOffsetInitial" className="block text-sm font-medium text-[#94a3b8]">
                Initial Offset ($)
              </label>
              <input
                id="entryOffsetInitial"
                type="number"
                min="0"
                step="any"
                value={entryOffsetInitial}
                onChange={(e) => setEntryOffsetInitial(e.target.value)}
                placeholder="e.g. 150"
                className="w-full min-h-[44px] rounded-md border border-[#1E2A3D] bg-[#1A2332] px-3 py-2 text-sm text-white placeholder-[#4b5563] focus:border-[#1E7CF8] focus:outline-none focus:ring-2 focus:ring-[#1E7CF8]/20 transition"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="entryOffsetStep" className="block text-sm font-medium text-[#94a3b8]">
                Decrease Step ($)
              </label>
              <input
                id="entryOffsetStep"
                type="number"
                min="0"
                step="any"
                value={entryOffsetStep}
                onChange={(e) => setEntryOffsetStep(e.target.value)}
                placeholder="e.g. 20"
                className="w-full min-h-[44px] rounded-md border border-[#1E2A3D] bg-[#1A2332] px-3 py-2 text-sm text-white placeholder-[#4b5563] focus:border-[#1E7CF8] focus:outline-none focus:ring-2 focus:ring-[#1E7CF8]/20 transition"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="entryOffsetMin" className="block text-sm font-medium text-[#94a3b8]">
                Minimum Offset ($)
              </label>
              <input
                id="entryOffsetMin"
                type="number"
                min="0"
                step="any"
                value={entryOffsetMin}
                onChange={(e) => setEntryOffsetMin(e.target.value)}
                placeholder="e.g. 50"
                className="w-full min-h-[44px] rounded-md border border-[#1E2A3D] bg-[#1A2332] px-3 py-2 text-sm text-white placeholder-[#4b5563] focus:border-[#1E7CF8] focus:outline-none focus:ring-2 focus:ring-[#1E7CF8]/20 transition"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="orderCancelMinutes" className="block text-sm font-medium text-[#94a3b8]">
                Cancel After (min)
              </label>
              <input
                id="orderCancelMinutes"
                type="number"
                min="1"
                step="1"
                value={orderCancelMinutes}
                onChange={(e) => setOrderCancelMinutes(e.target.value)}
                placeholder="e.g. 10"
                className="w-full min-h-[44px] rounded-md border border-[#1E2A3D] bg-[#1A2332] px-3 py-2 text-sm text-white placeholder-[#4b5563] focus:border-[#1E7CF8] focus:outline-none focus:ring-2 focus:ring-[#1E7CF8]/20 transition"
              />
            </div>
          </div>

          {/* Take Profit / Stop Loss */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wide border-b border-[#1E2A3D] pb-1 mb-3">
              Take Profit / Stop Loss
            </h3>
            <div className="space-y-1.5">
              <label htmlFor="tpDistance" className="block text-sm font-medium text-[#94a3b8]">
                TP Distance ($)
              </label>
              <input
                id="tpDistance"
                type="number"
                min="0"
                step="any"
                value={tpDistance}
                onChange={(e) => setTpDistance(e.target.value)}
                placeholder="e.g. 50"
                className="w-full min-h-[44px] rounded-md border border-[#1E2A3D] bg-[#1A2332] px-3 py-2 text-sm text-white placeholder-[#4b5563] focus:border-[#1E7CF8] focus:outline-none focus:ring-2 focus:ring-[#1E7CF8]/20 transition"
              />
              <p className="text-xs text-[#4b5563]">TP = entry − this value</p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="slDistance" className="block text-sm font-medium text-[#94a3b8]">
                SL Distance ($)
              </label>
              <input
                id="slDistance"
                type="number"
                min="0"
                step="any"
                value={slDistance}
                onChange={(e) => setSlDistance(e.target.value)}
                placeholder="e.g. 200"
                className="w-full min-h-[44px] rounded-md border border-[#1E2A3D] bg-[#1A2332] px-3 py-2 text-sm text-white placeholder-[#4b5563] focus:border-[#1E7CF8] focus:outline-none focus:ring-2 focus:ring-[#1E7CF8]/20 transition"
              />
              <p className="text-xs text-[#4b5563]">SL = entry + this value</p>
            </div>
          </div>

          {/* Filters & Volatility Controls */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wide border-b border-[#1E2A3D] pb-1 mb-3">
              Filters &amp; Volatility Controls
            </h3>
            <div className="space-y-1.5">
              <label htmlFor="minGapPct" className="block text-sm font-medium text-[#94a3b8]">
                Min Gap Before Entry
              </label>
              <input
                id="minGapPct"
                type="number"
                step="0.0001"
                value={minGapPct}
                onChange={(e) => setMinGapPct(e.target.value)}
                className="w-full min-h-[44px] rounded-md border border-[#1E2A3D] bg-[#1A2332] px-3 py-2 text-sm text-white placeholder-[#4b5563] focus:border-[#1E7CF8] focus:outline-none focus:ring-2 focus:ring-[#1E7CF8]/20 transition"
              />
              <p className="text-xs text-[#4b5563]">Price must be at least this fraction below the 10-min high before placing an order. E.g. 0.001 = 0.1% gap required.</p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="cancelCooldownMinutes" className="block text-sm font-medium text-[#94a3b8]">
                Cancel Cooldown (minutes)
              </label>
              <input
                id="cancelCooldownMinutes"
                type="number"
                step="0.0001"
                value={cancelCooldownMinutes}
                onChange={(e) => setCancelCooldownMinutes(e.target.value)}
                className="w-full min-h-[44px] rounded-md border border-[#1E2A3D] bg-[#1A2332] px-3 py-2 text-sm text-white placeholder-[#4b5563] focus:border-[#1E7CF8] focus:outline-none focus:ring-2 focus:ring-[#1E7CF8]/20 transition"
              />
              <p className="text-xs text-[#4b5563]">Wait this many minutes after a cancelled order before placing a new one. Prevents rapid re-entry after failed orders.</p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="entryOffsetPct" className="block text-sm font-medium text-[#94a3b8]">
                Entry Offset % (decimal)
              </label>
              <input
                id="entryOffsetPct"
                type="number"
                step="0.0001"
                value={entryOffsetPct}
                onChange={(e) => setEntryOffsetPct(e.target.value)}
                className="w-full min-h-[44px] rounded-md border border-[#1E2A3D] bg-[#1A2332] px-3 py-2 text-sm text-white placeholder-[#4b5563] focus:border-[#1E7CF8] focus:outline-none focus:ring-2 focus:ring-[#1E7CF8]/20 transition"
              />
              <p className="text-xs text-[#4b5563]">Percentage of current price used as the initial order offset. E.g. 0.002 = 0.2% above price. Overrides the fixed initial offset when bot is fresh.</p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="minImpulsePct" className="block text-sm font-medium text-[#94a3b8]">
                Min Impulse Filter (decimal)
              </label>
              <input
                id="minImpulsePct"
                type="number"
                step="0.0001"
                value={minImpulsePct}
                onChange={(e) => setMinImpulsePct(e.target.value)}
                className="w-full min-h-[44px] rounded-md border border-[#1E2A3D] bg-[#1A2332] px-3 py-2 text-sm text-white placeholder-[#4b5563] focus:border-[#1E7CF8] focus:outline-none focus:ring-2 focus:ring-[#1E7CF8]/20 transition"
              />
              <p className="text-xs text-[#4b5563]">The 10-min high must be at least this fraction above the 10-min window open to confirm a genuine impulse. E.g. 0.002 = 0.2%. Filters out flat-market false signals.</p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="maxAtrUsdt" className="block text-sm font-medium text-[#94a3b8]">
                ATR Volatility Halt (USDT)
              </label>
              <input
                id="maxAtrUsdt"
                type="number"
                step="1"
                value={maxAtrUsdt}
                onChange={(e) => setMaxAtrUsdt(e.target.value)}
                className="w-full min-h-[44px] rounded-md border border-[#1E2A3D] bg-[#1A2332] px-3 py-2 text-sm text-white placeholder-[#4b5563] focus:border-[#1E7CF8] focus:outline-none focus:ring-2 focus:ring-[#1E7CF8]/20 transition"
              />
              <p className="text-xs text-[#4b5563]">Stop entering new trades when the 14-candle Average True Range exceeds this value. E.g. 300 means: if BTC is moving more than $300 per candle on average, skip entry. Set to 0 to disable.</p>
            </div>
          </div>

          {/* Feedback messages */}
          {saveError && (
            <p className="text-sm text-red-400 rounded-md bg-red-900/30 border border-red-800 px-3 py-2">
              {saveError}
            </p>
          )}
          {saveSuccess && (
            <p className="text-sm text-green-400 rounded-md bg-green-900/30 border border-green-800 px-3 py-2">
              Settings saved successfully.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[#1E2A3D] px-5 py-4 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 min-h-[44px] rounded-md border border-[#1E2A3D] bg-[#1A2332] px-4 py-2 text-sm font-medium text-[#94a3b8] hover:bg-[#1E2A3D] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 min-h-[44px] rounded-md bg-[#1E7CF8] px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </aside>
    </>
  );
}
