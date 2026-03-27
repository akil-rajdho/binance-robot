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
          <p className="text-sm text-[#64748b] leading-relaxed whitespace-pre-line">{description}</p>
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
  const [highConfirmSeconds, setHighConfirmSeconds] = useState('');
  const [trailingTpDistance, setTrailingTpDistance] = useState('');
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
        setHighConfirmSeconds(settings.high_confirm_seconds ?? '');
        setTrailingTpDistance(settings.trailing_tp_distance ?? '');
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
        high_confirm_seconds: highConfirmSeconds,
        trailing_tp_distance: trailingTpDistance,
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

            <SettingField
              id="trailingTpDistance"
              label="Trailing TP Distance ($)"
              description={`Once the position reaches the TP zone (price drops by TP Distance from entry), the bot cancels the fixed TP order and starts trailing the price downward. It tracks the lowest price seen and closes the position when price bounces back up by this amount.\n\nExample: Entry at $69,500, TP Distance $200, Trailing $30. Price drops to $69,300 (TP zone reached) — trailing activates. Price continues to $69,100 — trailing low updated. Price bounces to $69,130 (+$30 from low) — position closed at $69,130 with $370 profit instead of $200.\n\nThis lets winners run beyond the fixed TP while locking in profit on reversal. Set to 0 to disable trailing and use fixed TP only.`}
            >
              <input id="trailingTpDistance" type="number" min="0" step="any" value={trailingTpDistance}
                onChange={e => setTrailingTpDistance(e.target.value)} placeholder="e.g. 30" className={inputClass} />
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
              id="highConfirmSeconds"
              label="High Confirmation Delay (seconds)"
              description={`Waits this many seconds after a new 10-minute high is seen before placing any order. This is your primary spike protection.\n\nExample — without this filter: BTC is at $84,900. A whale buy pushes it to $85,400 for 8 seconds, then it crashes back to $84,800. The bot sees the new high of $85,400 and instantly places a short at $85,250. The whale is done — price never comes back up to fill your order. The order sits and cancels, wasting the cooldown window.\n\nExample — with 120 seconds: Same spike happens. The bot sees the $85,400 high but waits 2 minutes. Within 30 seconds price is back at $84,800 and the high resets. No order was ever placed. The bot correctly ignored a fake move.\n\nRecommended: 120 (2 minutes). Set to 0 to disable.`}
            >
              <input id="highConfirmSeconds" type="number" step="1" min="0" value={highConfirmSeconds}
                onChange={e => setHighConfirmSeconds(e.target.value)} placeholder="e.g. 120" className={inputClass} />
            </SettingField>

            <SettingField
              id="minGapPct"
              label="Minimum Gap Before Entry"
              description={`Requires the current price to be at least this percentage below the 10-minute high before placing an order. Prevents entries when price is hovering right at the high with no room to confirm a reversal.\n\nExample — without this filter: BTC 10-min high is $85,000. Current price is $84,980 — just $20 below. The bot places a short. But price is still essentially at the high; it may easily tick up $20 more and trigger your stop loss before it ever moves down.\n\nExample — with 0.001 (0.1%): The bot only places a short when price has dropped at least $85 below the high (0.1% of $85,000). So the high is $85,000 but price must reach $84,915 or below first. This confirms that price has already started to pull back, giving your short a better starting position.\n\nEnter as a decimal: 0.001 = 0.1%, 0.002 = 0.2%.`}
            >
              <input id="minGapPct" type="number" step="0.0001" value={minGapPct}
                onChange={e => setMinGapPct(e.target.value)} placeholder="e.g. 0.001 (0.1%)" className={inputClass} />
            </SettingField>

            <SettingField
              id="entryOffsetPct"
              label="Entry Offset % (price-relative override)"
              description={`Calculates the initial order offset as a percentage of the current BTC price instead of a fixed dollar amount. Because BTC price changes over time, a fixed $150 offset means very different things at $40,000 vs $100,000. This setting keeps the offset proportional.\n\nExample: You set 0.002 (0.2%). If BTC is at $85,000, the initial offset is $170 ($85,000 × 0.002). If BTC later rises to $95,000, the offset automatically becomes $190. Without this, you would need to manually update the dollar offset as BTC price moves.\n\nLeave blank to use the fixed "Initial Offset ($)" value from the Order Placement section instead. If both are set, this percentage override takes priority.`}
            >
              <input id="entryOffsetPct" type="number" step="0.0001" value={entryOffsetPct}
                onChange={e => setEntryOffsetPct(e.target.value)} placeholder="e.g. 0.002 (0.2%)" className={inputClass} />
            </SettingField>

            <SettingField
              id="minImpulsePct"
              label="Minimum Impulse Filter"
              description={`Requires the 10-minute high to be at least this percentage above the price at the start of the 10-minute window. This confirms a real upward move happened, filtering out flat-market false signals where price drifts sideways and the "high" is barely above the open.\n\nExample — without this filter: BTC opens the 10-min window at $84,950 and drifts up to $85,000 over 10 minutes — a $50 move. The bot treats $85,000 as a valid high and starts looking for a short. But this is just random noise in a sideways market, not a real impulse. The strategy is designed for genuine moves up followed by reversals, not $50 drifts.\n\nExample — with 0.003 (0.3%): The high must be at least $255 above the window open (0.3% of $85,000). So the window must open at say $84,700 and reach at least $84,955. A real $300+ move confirms genuine buying pressure that the bot can trade the reversal of.\n\nEnter as a decimal: 0.002 = 0.2%, 0.003 = 0.3%.`}
            >
              <input id="minImpulsePct" type="number" step="0.0001" value={minImpulsePct}
                onChange={e => setMinImpulsePct(e.target.value)} placeholder="e.g. 0.002 (0.2%)" className={inputClass} />
            </SettingField>

            <SettingField
              id="cancelCooldownMinutes"
              label="Cancel Cooldown (minutes)"
              description={`Forces a waiting period after any order cancellation before the bot is allowed to place a new order. This prevents the bot from churning — placing and cancelling orders repeatedly in a choppy market where price keeps moving just out of reach.\n\nExample — without cooldown: BTC is choppy around $85,000. The bot places a short at $85,150, price never fills, cancels after 10 min. Immediately places another at $85,050, still no fill, cancels again. This repeats 6 times in an hour, consuming your daily cancel budget and potentially flagging your account for excessive order activity.\n\nExample — with 5 minute cooldown: After each cancellation, the bot sits out for 5 minutes. This limits re-entry to a maximum of once every 15 minutes (10 min order lifetime + 5 min cooldown), giving the market time to develop a clearer direction before trying again.\n\nSet to 0 or leave blank to allow immediate re-entry.`}
            >
              <input id="cancelCooldownMinutes" type="number" step="1" value={cancelCooldownMinutes}
                onChange={e => setCancelCooldownMinutes(e.target.value)} placeholder="e.g. 5" className={inputClass} />
            </SettingField>

            <SettingField
              id="maxAtrUsdt"
              label="ATR Volatility Halt (USDT)"
              description={`Stops the bot from entering new trades when the market is moving too violently. ATR (Average True Range) measures the average dollar range of the last 14 candles — it tells you how much BTC typically moves in a single candle period. A high ATR means big, unpredictable swings.\n\nExample — without this filter: A major news event hits and BTC starts moving $500–$800 per candle. The bot places a short with a $200 stop loss. In this volatility, the $200 stop loss gets hit almost instantly on a single candle wick even if the overall direction would have been profitable. You take a maximum loss on a trade that should have worked.\n\nExample — with ATR halt at $300: During normal conditions the ATR is $150–$200, and the bot trades normally. During the news event the ATR jumps to $650. The bot detects this and pauses all new entries. It resumes automatically once the ATR calms back below $300. Your stop losses are sized for normal volatility ($150–$200 ATR), so you only trade when they make sense.\n\nSet to 0 or leave blank to disable. Typical values: $250–$400 depending on your stop loss size.`}
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
