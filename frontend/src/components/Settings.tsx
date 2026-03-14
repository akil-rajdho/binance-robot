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

function SettingField({
  id,
  label,
  description,
  children,
}: {
  id: string;
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="py-5 border-b border-[#1E2A3D] last:border-0">
      <div className="flex flex-col md:flex-row md:items-start md:gap-8">
        <div className="md:w-80 mb-3 md:mb-0 flex-shrink-0">
          <label htmlFor={id} className="block text-sm font-semibold text-white mb-1">
            {label}
          </label>
          <p className="text-sm text-[#64748b] leading-relaxed">{description}</p>
        </div>
        <div className="flex-1 max-w-xs">{children}</div>
      </div>
    </div>
  );
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="pb-4 mb-1">
      <h2 className="text-base font-bold text-white mb-1">{title}</h2>
      <p className="text-sm text-[#64748b]">{description}</p>
    </div>
  );
}

const inputClass =
  'w-full min-h-[44px] rounded-lg border border-[#1E2A3D] bg-[#1A2332] px-3 py-2 text-sm text-white placeholder-[#4b5563] focus:border-[#1E7CF8] focus:outline-none focus:ring-2 focus:ring-[#1E7CF8]/20 transition';

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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      setSaveSuccess(false);
      setSaveError(null);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  useEffect(() => {
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    onActivity?.();
    fetch(`${API_URL}/status`, { headers })
      .then(r => r.json())
      .then((data: { hasApiKeys?: boolean }) => setApiKeysConfigured(data.hasApiKeys === true))
      .catch(() => setApiKeysConfigured(false));
  }, [token, onActivity]);

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
      window.scrollTo(0, 0);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#0D1421] overflow-y-auto">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-[#0D1421]/95 backdrop-blur border-b border-[#1E2A3D]">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <h1 className="text-base font-bold text-white">Settings</h1>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="min-h-[36px] rounded-lg border border-[#1E2A3D] bg-[#1A2332] px-4 text-sm font-medium text-[#94a3b8] hover:bg-[#1E2A3D] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="min-h-[36px] rounded-lg bg-[#1E7CF8] px-4 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Saving…' : 'Save Settings'}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-12">

        {/* Status banner */}
        <div className={`rounded-xl border px-4 py-3 flex items-center gap-3 text-sm ${
          apiKeysConfigured === true
            ? 'bg-green-900/20 border-green-800 text-green-400'
            : apiKeysConfigured === false
            ? 'bg-red-900/20 border-red-800 text-red-400'
            : 'bg-[#111827] border-[#1E2A3D] text-[#94a3b8]'
        }`}>
          <span className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${
            apiKeysConfigured === true ? 'bg-green-500' : apiKeysConfigured === false ? 'bg-red-500' : 'bg-[#4b5563]'
          }`} />
          {apiKeysConfigured === true
            ? 'WhiteBit API keys are configured. The bot can place live orders.'
            : apiKeysConfigured === false
            ? 'No API keys detected. Set WHITEBIT_API_KEY and WHITEBIT_API_SECRET in your .env file on the server, then restart the backend.'
            : 'Checking API key status…'}
        </div>

        {/* Save feedback */}
        {saveError && (
          <div className="rounded-xl border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
            {saveError}
          </div>
        )}
        {saveSuccess && (
          <div className="rounded-xl border border-green-800 bg-green-900/20 px-4 py-3 text-sm text-green-400">
            Settings saved. Changes take effect immediately — no restart required.
          </div>
        )}

        {/* ── Section 1: Position & Risk ── */}
        <section>
          <SectionHeader
            title="Position & Risk"
            description="Control how much capital the bot commits per trade and how large your total daily loss exposure can grow before trading is paused."
          />
          <div className="rounded-xl border border-[#1E2A3D] bg-[#111827] divide-y divide-[#1E2A3D] px-6">

            <SettingField
              id="positionSize"
              label="Position Size (USDT)"
              description="The notional value of each trade in USDT before leverage is applied. For example, a position size of 700 USDT with 2× leverage controls $1,400 worth of BTC. Keep this well within your available margin to avoid liquidation risk."
            >
              <input id="positionSize" type="number" min="1" step="any" value={positionSize}
                onChange={e => setPositionSize(e.target.value)} placeholder="e.g. 700" className={inputClass} />
            </SettingField>

            <SettingField
              id="leverage"
              label="Leverage"
              description="Multiplier applied to your position size. Higher leverage amplifies both profits and losses. At 1× you are fully collateralised and cannot be liquidated by normal price moves. Most traders start at 1× or 2× until they have confidence in the strategy's win rate."
            >
              <select id="leverage" value={leverage} onChange={e => setLeverage(e.target.value)} className={inputClass}>
                {LEVERAGE_OPTIONS.map(opt => (
                  <option key={opt} value={opt}>{opt}×</option>
                ))}
              </select>
            </SettingField>

            <SettingField
              id="dailyLossLimit"
              label="Daily Loss Limit (%)"
              description="If the bot's cumulative realised loss for the calendar day exceeds this percentage of the starting balance, it will stop opening new positions until midnight. This acts as a circuit breaker, capping the maximum drawdown you are exposed to in a single day. Set to 0 to disable."
            >
              <input id="dailyLossLimit" type="number" min="0" max="100" step="any" value={dailyLossLimit}
                onChange={e => setDailyLossLimit(e.target.value)} placeholder="e.g. 5" className={inputClass} />
            </SettingField>

            <SettingField
              id="startingBalance"
              label="Starting Balance (USDT)"
              description="The reference balance used to calculate P&L percentages and the daily loss limit. Set this to the USDT balance you had in your account when you started the bot. It does not transfer funds — it is a bookkeeping baseline only."
            >
              <input id="startingBalance" type="number" min="0" step="any" value={startingBalance}
                onChange={e => setStartingBalance(e.target.value)} placeholder="e.g. 700" className={inputClass} />
            </SettingField>

          </div>
        </section>

        {/* ── Section 2: Order Placement ── */}
        <section>
          <SectionHeader
            title="Order Placement"
            description="Control where and when limit orders are placed relative to the 10-minute high. The bot places a short sell slightly above the current price. If the order is not filled quickly, it is cancelled and the offset is reduced to get closer to market price."
          />
          <div className="rounded-xl border border-[#1E2A3D] bg-[#111827] divide-y divide-[#1E2A3D] px-6">

            <SettingField
              id="currentOffset"
              label="Current Offset (live)"
              description="The offset currently being used by the running bot in real time. This is read-only — it reflects how the bot has adapted during the current session. It resets to the initial offset when the bot is restarted."
            >
              <div className="w-full rounded-lg border border-[#1E2A3D] bg-[#0D1421] px-3 py-2.5 text-sm text-[#94a3b8]">
                {currentEntryOffset != null ? `$${currentEntryOffset}` : '—'}
              </div>
            </SettingField>

            <SettingField
              id="entryOffsetInitial"
              label="Initial Offset ($)"
              description="When the bot starts fresh (or after a fill), it places the first order this many dollars above the current price. A larger initial offset gives more room to confirm the high, but may mean fewer fills. Typical values are $100–$200."
            >
              <input id="entryOffsetInitial" type="number" min="0" step="any" value={entryOffsetInitial}
                onChange={e => setEntryOffsetInitial(e.target.value)} placeholder="e.g. 150" className={inputClass} />
            </SettingField>

            <SettingField
              id="entryOffsetStep"
              label="Decrease Step ($)"
              description="Each time an unfilled order is cancelled, the bot reduces the offset by this amount and places a new order closer to the current price. This allows the bot to gradually 'walk down' toward market price rather than waiting indefinitely at a fixed level."
            >
              <input id="entryOffsetStep" type="number" min="0" step="any" value={entryOffsetStep}
                onChange={e => setEntryOffsetStep(e.target.value)} placeholder="e.g. 20" className={inputClass} />
            </SettingField>

            <SettingField
              id="entryOffsetMin"
              label="Minimum Offset ($)"
              description="The offset will never decrease below this floor no matter how many cancellations have occurred. This prevents the bot from placing orders too close to market price, where slippage and noise can cause unwanted fills."
            >
              <input id="entryOffsetMin" type="number" min="0" step="any" value={entryOffsetMin}
                onChange={e => setEntryOffsetMin(e.target.value)} placeholder="e.g. 50" className={inputClass} />
            </SettingField>

            <SettingField
              id="orderCancelMinutes"
              label="Cancel After (minutes)"
              description="If a placed order has not been filled within this many minutes, the bot cancels it and places a new one at a lower offset. Shorter values make the bot more aggressive about chasing price; longer values give more time for price to come to the order."
            >
              <input id="orderCancelMinutes" type="number" min="1" step="1" value={orderCancelMinutes}
                onChange={e => setOrderCancelMinutes(e.target.value)} placeholder="e.g. 10" className={inputClass} />
            </SettingField>

          </div>
        </section>

        {/* ── Section 3: Take Profit & Stop Loss ── */}
        <section>
          <SectionHeader
            title="Take Profit & Stop Loss"
            description="Once a short position is open, these settings define the two price levels the bot watches. The take profit closes the trade at a profit; the stop loss closes it to limit the loss. Both are expressed as a fixed dollar distance from the fill price."
          />
          <div className="rounded-xl border border-[#1E2A3D] bg-[#111827] divide-y divide-[#1E2A3D] px-6">

            <SettingField
              id="tpDistance"
              label="Take Profit Distance ($)"
              description="The bot places a take-profit order this many dollars below the entry fill price. For a short, profit is made when price falls. For example, if you entered at $85,000 with a TP distance of $50, the take-profit is set at $84,950. Smaller values mean quicker, smaller wins."
            >
              <input id="tpDistance" type="number" min="0" step="any" value={tpDistance}
                onChange={e => setTpDistance(e.target.value)} placeholder="e.g. 50" className={inputClass} />
            </SettingField>

            <SettingField
              id="slDistance"
              label="Stop Loss Distance ($)"
              description="The bot places a stop-loss order this many dollars above the entry fill price. If price moves against the short beyond this level, the position is closed to prevent further loss. For example, entry at $85,000 with SL distance of $200 closes the trade if price rises to $85,200."
            >
              <input id="slDistance" type="number" min="0" step="any" value={slDistance}
                onChange={e => setSlDistance(e.target.value)} placeholder="e.g. 200" className={inputClass} />
            </SettingField>

          </div>
        </section>

        {/* ── Section 4: Market Filters ── */}
        <section>
          <SectionHeader
            title="Market Filters"
            description="Optional guards that prevent the bot from entering trades in unfavourable market conditions — flat markets with no clear direction, or highly volatile periods where price moves too fast to manage risk reliably. Leave blank to disable individual filters."
          />
          <div className="rounded-xl border border-[#1E2A3D] bg-[#111827] divide-y divide-[#1E2A3D] px-6">

            <SettingField
              id="minGapPct"
              label="Minimum Gap Before Entry"
              description="The current price must be at least this fraction below the 10-minute high before the bot will place an order. This ensures there is a meaningful gap between where price is now and the recent high, reducing the chance of entering on noise rather than a real pullback. Enter as a decimal — e.g. 0.001 means a 0.1% gap is required."
            >
              <input id="minGapPct" type="number" step="0.0001" value={minGapPct}
                onChange={e => setMinGapPct(e.target.value)} placeholder="e.g. 0.001 (0.1%)" className={inputClass} />
            </SettingField>

            <SettingField
              id="entryOffsetPct"
              label="Entry Offset % (override)"
              description="When set, the initial order offset is calculated as this percentage of the current BTC price rather than using the fixed dollar initial offset. This makes the offset self-adjusting as BTC price changes over time. For example, 0.002 at $85,000 gives an offset of $170. Leave blank to use the fixed initial offset instead."
            >
              <input id="entryOffsetPct" type="number" step="0.0001" value={entryOffsetPct}
                onChange={e => setEntryOffsetPct(e.target.value)} placeholder="e.g. 0.002 (0.2%)" className={inputClass} />
            </SettingField>

            <SettingField
              id="minImpulsePct"
              label="Minimum Impulse Filter"
              description="The 10-minute high must have risen at least this fraction above the opening price of the 10-minute window to confirm a genuine upward impulse. Without this filter, the bot can trigger on sideways-drifting markets where the 'high' is barely above the open. Enter as a decimal — e.g. 0.002 means the high must be at least 0.2% above the window open."
            >
              <input id="minImpulsePct" type="number" step="0.0001" value={minImpulsePct}
                onChange={e => setMinImpulsePct(e.target.value)} placeholder="e.g. 0.002 (0.2%)" className={inputClass} />
            </SettingField>

            <SettingField
              id="cancelCooldownMinutes"
              label="Cancel Cooldown (minutes)"
              description="After an order is cancelled (either because it expired or was manually stopped), the bot waits this many minutes before placing the next order. This prevents rapid-fire re-entry during choppy conditions where the bot keeps placing and cancelling. Set to 0 or leave blank to re-enter immediately."
            >
              <input id="cancelCooldownMinutes" type="number" step="1" value={cancelCooldownMinutes}
                onChange={e => setCancelCooldownMinutes(e.target.value)} placeholder="e.g. 5" className={inputClass} />
            </SettingField>

            <SettingField
              id="maxAtrUsdt"
              label="ATR Volatility Halt (USDT)"
              description="The 14-candle Average True Range (ATR) measures how many dollars BTC moves per candle on average. If the ATR exceeds this threshold, the bot pauses new entries until volatility settles. This prevents trading during news-driven spikes where stop-losses are easily hit. A typical value is $300–$500. Set to 0 or leave blank to disable this filter entirely."
            >
              <input id="maxAtrUsdt" type="number" step="1" value={maxAtrUsdt}
                onChange={e => setMaxAtrUsdt(e.target.value)} placeholder="e.g. 300" className={inputClass} />
            </SettingField>

          </div>
        </section>

        {/* Bottom save button */}
        <div className="flex justify-end gap-3 pb-8">
          <button
            onClick={onClose}
            className="min-h-[44px] rounded-lg border border-[#1E2A3D] bg-[#1A2332] px-6 text-sm font-medium text-[#94a3b8] hover:bg-[#1E2A3D] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="min-h-[44px] rounded-lg bg-[#1E7CF8] px-6 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
        </div>

      </div>
    </div>
  );
}
