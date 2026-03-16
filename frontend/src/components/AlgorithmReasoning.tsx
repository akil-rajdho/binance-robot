'use client';

import { useState, useEffect } from 'react';
import { AlgoState, Trade } from '../types/trading';

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_API || 'http://localhost:8080/api';

interface AlgorithmReasoningProps {
  token?: string | null;
  onActivity?: () => void;
  algoState?: AlgoState | null;
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

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  OPEN:      { label: 'OPEN',      cls: 'bg-yellow-900/40 text-yellow-300 border border-yellow-700' },
  TP_HIT:    { label: 'TP HIT',    cls: 'bg-green-900/40 text-green-300 border border-green-700' },
  SL_HIT:    { label: 'SL HIT',    cls: 'bg-red-900/40 text-red-300 border border-red-700' },
  CANCELLED: { label: 'CANCELLED', cls: 'bg-gray-800 text-gray-400 border border-gray-700' },
};

const STATE_BADGE: Record<string, { label: string; cls: string }> = {
  IDLE:          { label: 'IDLE',          cls: 'bg-gray-800 text-gray-400 border border-[#2d3f56]' },
  ORDER_PLACED:  { label: 'ORDER PLACED',  cls: 'bg-yellow-900/40 text-yellow-300 border border-yellow-700' },
  POSITION_OPEN: { label: 'POSITION OPEN', cls: 'bg-green-900/40 text-green-300 border border-green-700' },
};

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtPrice(n: number) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function timeStr(d: Date) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

export default function AlgorithmReasoning({ token, onActivity, algoState }: AlgorithmReasoningProps) {
  const [current, setCurrent] = useState<ReasoningData | null>(null);
  const [entries, setEntries] = useState<DecisionEntry[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    let mounted = true;
    const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

    const fetchAll = async () => {
      try {
        onActivity?.();
        const [rRes, tRes] = await Promise.all([
          fetch(`${API_URL}/reasoning`, { headers: authHeaders }),
          fetch(`${API_URL}/trades?limit=8`, { headers: authHeaders }),
        ]);
        if (!rRes.ok || !tRes.ok) return;
        const reasoning = (await rRes.json()) as ReasoningData;
        const trades = (await tRes.json()) as Trade[];
        if (!mounted) return;
        setCurrent(reasoning);
        setLastUpdated(new Date());
        setEntries([...trades].reverse().map(tradeToEntry));
      } catch { /* non-fatal */ }
    };

    void fetchAll();
    const interval = setInterval(() => void fetchAll(), 4000);
    return () => { mounted = false; clearInterval(interval); };
  }, [token, onActivity]);

  const stateKey = current?.state ?? 'IDLE';
  const stateStyle = STATE_BADGE[stateKey] ?? STATE_BADGE.IDLE;

  // Derive live filter metrics from algoState
  const price = algoState?.currentPrice ?? 0;
  const high = algoState?.high10min ?? 0;
  const gap = high > 0 && price > 0 ? high - price : null;
  const atr = algoState?.currentAtr;
  const filterStatus = algoState?.filterStatus;
  const botEnabled = algoState?.botEnabled ?? false;

  return (
    <div className="rounded-xl border border-[#1E2A3D] bg-[#111827] shadow-lg overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1E2A3D] bg-[#0d1421]">
        <div className="flex items-center gap-2">
          <span className="text-base">🧠</span>
          <h2 className="text-sm font-semibold text-[#e2e8f0] tracking-wide">Algorithm Reasoning</h2>
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

      {/* ── Body: 2 columns on md+ ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[#1E2A3D]">

        {/* LEFT — Current thinking */}
        <div className="p-4 flex flex-col gap-3">

          {/* Reasoning text */}
          <div className="bg-[#0d1e3a] rounded-lg px-4 py-3 border border-[#1a2d4a]">
            <p className="text-sm text-[#93c5fd] leading-relaxed">
              {current ? current.text : 'Connecting to algorithm...'}
            </p>
          </div>

          {/* Filter block warning */}
          {botEnabled && filterStatus && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-900/20 border border-amber-700/50 px-3 py-2.5">
              <span className="text-amber-400 mt-0.5 shrink-0">⚠</span>
              <p className="text-xs text-amber-300 leading-relaxed">{filterStatus}</p>
            </div>
          )}

          {/* Live filter metrics */}
          {(gap !== null || atr != null) && (
            <div className="grid grid-cols-2 gap-2">
              {gap !== null && high > 0 && (
                <div className="rounded-lg bg-[#0d1421] border border-[#1E2A3D] px-3 py-2">
                  <p className="text-xs text-[#64748b] mb-1">Price gap from high</p>
                  <p className="font-mono text-sm font-semibold text-white">
                    ${fmt(gap)}
                    <span className="text-xs font-normal text-[#64748b] ml-1">
                      ({high > 0 ? ((gap / high) * 100).toFixed(3) : '—'}%)
                    </span>
                  </p>
                </div>
              )}
              {atr != null && atr > 0 && (
                <div className="rounded-lg bg-[#0d1421] border border-[#1E2A3D] px-3 py-2">
                  <p className="text-xs text-[#64748b] mb-1">ATR (volatility)</p>
                  <p className={`font-mono text-sm font-semibold ${atr > 300 ? 'text-red-400' : 'text-green-400'}`}>
                    ${fmt(atr)}
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
