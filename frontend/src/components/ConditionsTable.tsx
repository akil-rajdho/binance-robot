'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlgoState, Trade } from '../types/trading';

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_API || 'http://localhost:8080/api';

interface Props {
  algoState: AlgoState | null;
  token?: string | null;
  onActivity?: () => void;
}

interface ReasoningData {
  text: string;
  state: string;
  timestamp: string;
}

interface ReasoningSnapshot {
  timestamp: string;
  current_price: number;
  high_10min: number;
  difference: number;
  order_price: number;
  tp_price: number;
  sl_price: number;
  position_size_usdt: number;
  leverage: number;
}

interface DecisionEntry {
  id: string;
  time: Date;
  status: string;
  orderPrice: number;
  tpPrice?: number;
  slPrice?: number;
  exitPrice?: number;
  pnl?: number;
  snapshot: ReasoningSnapshot | null;
}

// ── Helpers ──

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtPrice(n: number) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function timeStr(d: Date) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatCountdown(cancelAt: string): string {
  const diff = new Date(cancelAt).getTime() - Date.now();
  if (diff <= 0) return '0:00';
  const totalSeconds = Math.floor(diff / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function tradeToEntry(trade: Trade): DecisionEntry {
  let snapshot: ReasoningSnapshot | null = null;
  try { snapshot = JSON.parse(trade.reasoning) as ReasoningSnapshot; } catch { /* ignore */ }
  return {
    id: `trade-${trade.id}`,
    time: snapshot ? new Date(snapshot.timestamp) : new Date(trade.entryTime),
    status: trade.status,
    orderPrice: trade.orderPrice,
    tpPrice: snapshot?.tp_price,
    slPrice: snapshot?.sl_price,
    exitPrice: trade.exitPrice ?? undefined,
    pnl: trade.pnl ?? undefined,
    snapshot,
  };
}

// ── Badges ──

const STATE_BADGE: Record<string, { label: string; cls: string }> = {
  IDLE:          { label: 'IDLE',          cls: 'bg-gray-800 text-gray-400 border border-[#2d3f56]' },
  ORDER_PLACED:  { label: 'ORDER PLACED',  cls: 'bg-yellow-900/40 text-yellow-300 border border-yellow-700' },
  POSITION_OPEN: { label: 'POSITION OPEN', cls: 'bg-green-900/40 text-green-300 border border-green-700' },
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  OPEN:      { label: 'OPEN',      cls: 'bg-yellow-900/40 text-yellow-300 border border-yellow-700' },
  TP_HIT:    { label: 'TP HIT',    cls: 'bg-green-900/40 text-green-300 border border-green-700' },
  SL_HIT:    { label: 'SL HIT',    cls: 'bg-red-900/40 text-red-300 border border-red-700' },
  CANCELLED: { label: 'CANCELLED', cls: 'bg-gray-800 text-gray-400 border border-gray-700' },
};

// ── Condition evaluation ──

type ConditionStatus = 'pass' | 'fail' | 'unknown';

interface Condition {
  name: string;
  status: ConditionStatus;
  threshold: string;
  current: string;
  target: string;
}

const FILTER_KEYWORDS: { key: string; matchFn: (fs: string) => boolean }[] = [
  { key: 'bot_enabled',       matchFn: () => false }, // handled separately
  { key: 'price_below_high',  matchFn: () => false }, // handled separately via conditionMet
  { key: 'min_gap',           matchFn: (fs) => /gap/i.test(fs) },
  { key: 'cancel_cooldown',   matchFn: (fs) => /cooldown/i.test(fs) },
  { key: 'impulse_strength',  matchFn: (fs) => /impulse/i.test(fs) },
  { key: 'atr_volatility',    matchFn: (fs) => /atr/i.test(fs) },
  { key: 'high_confirmation', matchFn: (fs) => /confirm/i.test(fs) },
];

function fmtPct(n: number): string {
  return (n * 100).toFixed(3) + '%';
}

function fmtDollar(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtCooldownTime(seconds: number): string {
  if (seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function evaluateConditions(algo: AlgoState): Condition[] {
  const fs = algo.filterStatus ?? '';
  const price = algo.currentPrice;
  const high = algo.high10min;
  const gap = high > 0 && price > 0 ? high - price : 0;
  const gapPct = high > 0 ? gap / high : 0;

  // Determine which filter index is blocking (if any)
  let blockingIdx = -1; // -1 means all pass
  if (!algo.botEnabled) {
    blockingIdx = 0;
  } else if (fs) {
    for (let i = 2; i < FILTER_KEYWORDS.length; i++) {
      if (FILTER_KEYWORDS[i].matchFn(fs)) {
        blockingIdx = i;
        break;
      }
    }
    if (blockingIdx === -1 && !algo.conditionMet) {
      blockingIdx = 1;
    }
  } else if (!algo.conditionMet && price > 0 && high > 0) {
    blockingIdx = 1;
  }

  function statusFor(idx: number): ConditionStatus {
    if (blockingIdx === -1) return 'pass';
    if (idx < blockingIdx) return 'pass';
    if (idx === blockingIdx) return 'fail';
    return 'unknown';
  }

  const conditions: Condition[] = [
    // 1. Bot Enabled
    {
      name: 'Bot Enabled',
      status: algo.botEnabled ? 'pass' : 'fail',
      threshold: '\u2014',
      current: algo.botEnabled ? 'Active' : 'Disabled',
      target: algo.botEnabled ? '\u2014' : 'Enable bot',
    },
    // 2. Price Below High
    {
      name: 'Price Below High',
      status: statusFor(1),
      threshold: high > 0 ? fmtDollar(high) : '\u2014',
      current: (() => {
        if (price <= 0 || high <= 0) return 'Waiting for data';
        if (price < high) return `${fmtDollar(gap)} below (${fmtPct(gapPct)})`;
        return `${fmtDollar(Math.abs(gap))} above high`;
      })(),
      target: (() => {
        if (price >= high && high > 0) return `Drop ${fmtDollar(price - high)}`;
        return '\u2014';
      })(),
    },
    // 3. Min Gap
    {
      name: 'Min Gap',
      status: statusFor(2),
      threshold: (() => {
        if (algo.minGapPct != null) {
          const pctStr = fmtPct(algo.minGapPct);
          if (algo.requiredGap != null && algo.requiredGap > 0) {
            return `${pctStr} (${fmtDollar(algo.requiredGap)})`;
          }
          return pctStr;
        }
        return '\u2014';
      })(),
      current: (() => {
        const curGapPct = algo.currentGapPct ?? (high > 0 ? gapPct : undefined);
        const curGapDollar = algo.currentGap ?? (high > 0 ? gap : undefined);
        if (curGapPct != null && curGapDollar != null) {
          return `${fmtPct(curGapPct)} (${fmtDollar(curGapDollar)})`;
        }
        return 'Pending';
      })(),
      target: (() => {
        const curGapPct = algo.currentGapPct ?? (high > 0 ? gapPct : undefined);
        if (statusFor(2) === 'fail' && curGapPct != null && algo.minGapPct != null) {
          const neededPct = algo.minGapPct - curGapPct;
          const neededDollar = (algo.requiredGap ?? 0) - (algo.currentGap ?? gap);
          return `${fmtPct(neededPct)} (${fmtDollar(Math.max(0, neededDollar))}) more`;
        }
        return '\u2014';
      })(),
    },
    // 4. Cancel Cooldown
    {
      name: 'Cancel Cooldown',
      status: statusFor(3),
      threshold: algo.cancelCooldownMins != null ? `${algo.cancelCooldownMins} min` : '\u2014',
      current: (() => {
        if (statusFor(3) === 'fail') {
          if (algo.cooldownRemaining != null && algo.cooldownRemaining > 0) {
            return `${fmtCooldownTime(algo.cooldownRemaining)} remaining`;
          }
          if (fs) return fs;
        }
        if (statusFor(3) === 'pass') return 'Clear';
        return 'Pending';
      })(),
      target: (() => {
        if (statusFor(3) === 'fail' && algo.cooldownRemaining != null && algo.cooldownRemaining > 0) {
          return `Wait ${fmtCooldownTime(algo.cooldownRemaining)}`;
        }
        return '\u2014';
      })(),
    },
    // 5. Impulse Strength
    {
      name: 'Impulse Strength',
      status: statusFor(4),
      threshold: algo.minImpulsePct != null ? fmtPct(algo.minImpulsePct) : '\u2014',
      current: (() => {
        if (algo.currentImpulse != null) return fmtPct(algo.currentImpulse);
        if (statusFor(4) === 'pass') return 'OK';
        return 'Pending';
      })(),
      target: (() => {
        if (statusFor(4) === 'fail' && algo.currentImpulse != null && algo.minImpulsePct != null) {
          const needed = algo.minImpulsePct - algo.currentImpulse;
          return `${fmtPct(needed)} more`;
        }
        return '\u2014';
      })(),
    },
    // 6. ATR Volatility
    {
      name: 'ATR Volatility',
      status: statusFor(5),
      threshold: algo.maxAtrUsdt != null ? fmtDollar(algo.maxAtrUsdt) : '\u2014',
      current: (() => {
        const atr = algo.currentAtr;
        if (atr != null && atr > 0) return fmtDollar(atr);
        if (statusFor(5) === 'pass') return 'OK';
        return 'Pending';
      })(),
      target: (() => {
        const atr = algo.currentAtr;
        if (statusFor(5) === 'fail' && atr != null && algo.maxAtrUsdt != null) {
          return `${fmtDollar(atr - algo.maxAtrUsdt)} over limit`;
        }
        return '\u2014';
      })(),
    },
    // 7. High Confirmation
    {
      name: 'High Confirmation',
      status: statusFor(6),
      threshold: (() => {
        if (algo.highConfirmSeconds != null) {
          return algo.highConfirmSeconds === 0 ? 'Off' : `${algo.highConfirmSeconds}s`;
        }
        return '\u2014';
      })(),
      current: (() => {
        if (statusFor(6) === 'fail' && algo.highConfirmRemaining != null && algo.highConfirmRemaining > 0) {
          return `${Math.ceil(algo.highConfirmRemaining)}s remaining`;
        }
        if (statusFor(6) === 'pass') return 'Confirmed';
        return 'Pending';
      })(),
      target: (() => {
        if (statusFor(6) === 'fail' && algo.highConfirmRemaining != null && algo.highConfirmRemaining > 0) {
          return `Wait ${Math.ceil(algo.highConfirmRemaining)}s`;
        }
        return '\u2014';
      })(),
    },
  ];

  return conditions;
}

// ── Status dot colors ──

function dotColor(status: ConditionStatus): string {
  switch (status) {
    case 'pass': return 'bg-green-400';
    case 'fail': return 'bg-red-400';
    case 'unknown': return 'bg-gray-500';
  }
}

function detailColor(status: ConditionStatus): string {
  switch (status) {
    case 'pass': return 'text-green-400';
    case 'fail': return 'text-red-400';
    case 'unknown': return 'text-[#64748b]';
  }
}

// ── Component ──

export default function ConditionsTable({ algoState, token, onActivity }: Props) {
  const [current, setCurrent] = useState<ReasoningData | null>(null);
  const [entries, setEntries] = useState<DecisionEntry[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [, setTick] = useState(0);

  // Re-render every second for countdown timers
  useEffect(() => {
    if (!algoState || algoState.state !== 'ORDER_PLACED') return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [algoState?.state]);

  const fetchAll = useCallback(async () => {
    const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    try {
      onActivity?.();
      const [rRes, tRes] = await Promise.all([
        fetch(`${API_URL}/reasoning`, { headers: authHeaders }),
        fetch(`${API_URL}/trades?limit=8`, { headers: authHeaders }),
      ]);
      if (!rRes.ok || !tRes.ok) return;
      const reasoning = (await rRes.json()) as ReasoningData;
      const trades = (await tRes.json()) as Trade[];
      setCurrent(reasoning);
      setLastUpdated(new Date());
      setEntries([...trades].reverse().map(tradeToEntry));
    } catch { /* non-fatal */ }
  }, [token, onActivity]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      if (mounted) await fetchAll();
    };
    void run();
    const interval = setInterval(() => void run(), 4000);
    return () => { mounted = false; clearInterval(interval); };
  }, [fetchAll]);

  const stateKey = algoState?.state ?? 'IDLE';
  const stateStyle = STATE_BADGE[stateKey] ?? STATE_BADGE.IDLE;
  const isIdle = stateKey === 'IDLE';

  const conditions = algoState ? evaluateConditions(algoState) : [];

  return (
    <div className="rounded-xl border border-[#1E2A3D] bg-[#111827] shadow-lg overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1E2A3D] bg-[#0d1421]">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-[#e2e8f0] tracking-wide">Trading Conditions</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${stateStyle.cls}`}>
            {stateStyle.label}
          </span>
          {lastUpdated && (
            <span className="hidden text-xs text-[#4b5563] md:inline tabular-nums">
              {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* ── Conditions Table ── */}
      <div className="px-4 py-3">
        {!algoState ? (
          <p className="text-sm text-[#4b5563]">Connecting...</p>
        ) : !isIdle ? (
          /* Non-IDLE state info */
          <div className="space-y-2">
            {stateKey === 'ORDER_PLACED' && (
              <div className="bg-[#0d1421] rounded-lg border border-[#1E2A3D] p-3 space-y-1.5">
                <p className="text-sm text-yellow-400 font-medium">
                  Limit order placed @ {fmtPrice(algoState.activeOrderPrice)}
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <span className="text-[#64748b]">Current Price</span>
                  <span className="font-mono text-white text-right">{fmtPrice(algoState.currentPrice)}</span>
                  <span className="text-[#64748b]">TP Target</span>
                  <span className="font-mono text-green-400 text-right">{fmtPrice(algoState.tpPrice)}</span>
                  <span className="text-[#64748b]">SL Target</span>
                  <span className="font-mono text-red-400 text-right">{fmtPrice(algoState.slPrice)}</span>
                  {algoState.cancelAt && (
                    <>
                      <span className="text-[#64748b]">Cancels in</span>
                      <span className="font-mono text-orange-400 text-right">{formatCountdown(algoState.cancelAt)}</span>
                    </>
                  )}
                </div>
              </div>
            )}
            {stateKey === 'POSITION_OPEN' && (
              <div className="bg-[#0d1421] rounded-lg border border-[#1E2A3D] p-3 space-y-1.5">
                <p className="text-sm text-green-400 font-medium">
                  Position open @ {fmtPrice(algoState.activeOrderPrice)}
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <span className="text-[#64748b]">Current Price</span>
                  <span className="font-mono text-white text-right">{fmtPrice(algoState.currentPrice)}</span>
                  <span className="text-[#64748b]">TP Target</span>
                  <span className="font-mono text-green-400 text-right">{fmtPrice(algoState.tpPrice)}</span>
                  <span className="text-[#64748b]">SL Target</span>
                  <span className="font-mono text-red-400 text-right">{fmtPrice(algoState.slPrice)}</span>
                  {algoState.positionSizeUsdt != null && (
                    <>
                      <span className="text-[#64748b]">Size</span>
                      <span className="font-mono text-white text-right">${fmt(algoState.positionSizeUsdt)} @ {algoState.leverage ?? '?'}x</span>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* IDLE: show conditions table */
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[#64748b] text-xs uppercase tracking-wider">
                <th className="text-left pb-2 font-medium">Condition</th>
                <th className="text-center pb-2 font-medium w-16">Status</th>
                <th className="text-left pb-2 font-medium">Threshold</th>
                <th className="text-left pb-2 font-medium">Current</th>
                <th className="text-left pb-2 font-medium">Target</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1E2A3D]/40">
              {conditions.map((c) => (
                <tr key={c.name} className="hover:bg-[#0d1421]/50 transition-colors">
                  <td className="py-2 pr-3 text-[#e2e8f0] font-medium whitespace-nowrap">{c.name}</td>
                  <td className="py-2 text-center">
                    <span className={`inline-block w-2.5 h-2.5 rounded-full ${dotColor(c.status)}`} />
                  </td>
                  <td className="py-2 pl-3 text-xs text-[#94a3b8] font-mono">{c.threshold}</td>
                  <td className={`py-2 pl-3 text-xs ${detailColor(c.status)}`}>{c.current}</td>
                  <td className={`py-2 pl-3 text-xs ${c.target === '\u2014' ? 'text-[#4b5563]' : 'text-orange-400'}`}>{c.target}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Bottom section: Reasoning (left) + Decision Log (right) ── */}
      <div className="border-t border-[#1E2A3D] grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[#1E2A3D]">

        {/* LEFT — Current reasoning */}
        <div className="p-4 flex flex-col gap-3">
          <h3 className="text-xs font-semibold text-[#64748b] uppercase tracking-wider">Current Reasoning</h3>
          <div className="bg-[#0d1e3a] rounded-lg px-4 py-3 border border-[#1a2d4a]">
            <p className="text-sm text-[#93c5fd] leading-relaxed">
              {current ? current.text : 'Connecting to algorithm...'}
            </p>
          </div>
          {/* Live metrics when IDLE */}
          {isIdle && algoState && (
            <div className="grid grid-cols-2 gap-2">
              {algoState.currentPrice > 0 && algoState.high10min > 0 && (
                <div className="rounded-lg bg-[#0d1421] border border-[#1E2A3D] px-3 py-2">
                  <p className="text-xs text-[#64748b] mb-1">Price / 10m High</p>
                  <p className="font-mono text-xs font-semibold text-white">
                    {fmtPrice(algoState.currentPrice)} / {fmtPrice(algoState.high10min)}
                  </p>
                </div>
              )}
              {algoState.currentAtr != null && algoState.currentAtr > 0 && (
                <div className="rounded-lg bg-[#0d1421] border border-[#1E2A3D] px-3 py-2">
                  <p className="text-xs text-[#64748b] mb-1">ATR</p>
                  <p className={`font-mono text-xs font-semibold ${(algoState.currentAtr ?? 0) > 300 ? 'text-red-400' : 'text-green-400'}`}>
                    ${fmt(algoState.currentAtr)}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT — Decision log */}
        <div className="flex flex-col">
          <div className="px-4 py-2.5 border-b border-[#1E2A3D]">
            <h3 className="text-xs font-semibold text-[#64748b] uppercase tracking-wider">Decision Log</h3>
          </div>
          <div className="overflow-y-auto max-h-[220px]">
            {entries.length === 0 ? (
              <p className="px-4 py-4 text-xs text-[#4b5563] italic">No decisions yet.</p>
            ) : (
              <div className="divide-y divide-[#1E2A3D]/60">
                {entries.map((e) => {
                  const b = STATUS_BADGE[e.status] ?? STATUS_BADGE.OPEN;
                  const pnlSign = (e.pnl ?? 0) >= 0 ? '+' : '';
                  return (
                    <div key={e.id} className="px-4 py-2.5 hover:bg-[#0d1421]/50 transition-colors">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs text-[#4b5563] tabular-nums shrink-0 w-10">
                          {timeStr(e.time)}
                        </span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${b.cls}`}>
                          {b.label}
                        </span>
                        <span className="font-mono text-xs text-white">
                          {fmtPrice(e.orderPrice)}
                        </span>
                        {e.pnl != null && (
                          <span className={`ml-auto font-mono text-xs font-bold ${e.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {pnlSign}{fmtPrice(e.pnl)}
                          </span>
                        )}
                      </div>
                      {e.snapshot && (
                        <p className="text-xs text-[#64748b] pl-12 leading-relaxed">
                          BTC {fmtPrice(e.snapshot.current_price)} · 10m high {fmtPrice(e.snapshot.high_10min)}
                          {e.exitPrice != null && ` · exit ${fmtPrice(e.exitPrice)}`}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
