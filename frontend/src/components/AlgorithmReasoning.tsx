'use client';

import { useState, useEffect, useRef } from 'react';
import { Trade } from '../types/trading';

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_API || 'http://localhost:8080/api';

interface AlgorithmReasoningProps {
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

interface LogEntry {
  id: string;
  time: Date;
  text: string;
  badge: string;
  badgeClass: string;
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  OPEN:      { label: 'OPEN',      cls: 'bg-yellow-900/30 text-yellow-400' },
  TP_HIT:    { label: 'TP HIT',    cls: 'bg-green-900/30 text-green-400' },
  SL_HIT:    { label: 'SL HIT',    cls: 'bg-red-900/30 text-red-400' },
  CANCELLED: { label: 'CANCELLED', cls: 'bg-gray-800 text-gray-400' },
};

const STATE_BADGE: Record<string, { label: string; cls: string }> = {
  IDLE:          { label: 'IDLE',          cls: 'bg-gray-800 text-gray-400' },
  ORDER_PLACED:  { label: 'ORDER PLACED',  cls: 'bg-yellow-900/30 text-yellow-400' },
  POSITION_OPEN: { label: 'POSITION OPEN', cls: 'bg-blue-900/30 text-blue-400' },
};

function tradeToEntry(trade: Trade): LogEntry {
  let snapshot: ReasoningSnapshot | null = null;
  try {
    snapshot = JSON.parse(trade.reasoning) as ReasoningSnapshot;
  } catch {
    // ignore parse errors
  }

  const b = STATUS_BADGE[trade.status] ?? STATUS_BADGE.OPEN;
  const time = snapshot ? new Date(snapshot.timestamp) : new Date(trade.entryTime);

  let text = '';
  if (snapshot) {
    text = `Order #${trade.id} — Short limit at $${snapshot.order_price.toFixed(2)}. ` +
      `BTC was $${snapshot.current_price.toFixed(2)}, 10m high $${snapshot.high_10min.toFixed(2)} ($${snapshot.difference.toFixed(2)} above). ` +
      `TP $${snapshot.tp_price.toFixed(2)} | SL $${snapshot.sl_price.toFixed(2)}.`;
    if (trade.exitPrice != null) {
      const dir = trade.status === 'TP_HIT' ? 'closed at TP' : trade.status === 'SL_HIT' ? 'closed at SL' : 'closed';
      text += ` Position ${dir} at $${trade.exitPrice.toFixed(2)}.`;
      if (trade.pnl != null) {
        const sign = trade.pnl >= 0 ? '+' : '';
        text += ` PnL: ${sign}$${trade.pnl.toFixed(2)}.`;
      }
    }
  } else {
    text = `Order #${trade.id} placed at $${trade.orderPrice.toFixed(2)} — ${trade.status}`;
  }

  return { id: `trade-${trade.id}`, time, text, badge: b.label, badgeClass: b.cls };
}

export default function AlgorithmReasoning({ token, onActivity }: AlgorithmReasoningProps) {
  const [current, setCurrent] = useState<ReasoningData | null>(null);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [expanded, setExpanded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;

    const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

    const fetchAll = async () => {
      try {
        onActivity?.();
        const [rRes, tRes] = await Promise.all([
          fetch(`${API_URL}/reasoning`, { headers: authHeaders }),
          fetch(`${API_URL}/trades`, { headers: authHeaders }),
        ]);
        if (!rRes.ok || !tRes.ok) return;
        const reasoning = (await rRes.json()) as ReasoningData;
        const trades = (await tRes.json()) as Trade[];

        if (!mounted) return;

        setCurrent(reasoning);
        setLastUpdated(new Date());

        // Build history entries from trades (oldest first so timeline reads top→bottom)
        const newEntries = [...trades]
          .reverse()
          .map((t) => tradeToEntry(t));
        setEntries(newEntries);
      } catch {
        // non-fatal
      }
    };

    void fetchAll();
    const interval = setInterval(() => void fetchAll(), 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [token, onActivity]);

  const stateStyle = current
    ? (STATE_BADGE[current.state] ?? STATE_BADGE.IDLE)
    : STATE_BADGE.IDLE;

  return (
    <div className="rounded-xl border border-[#1E2A3D] bg-[#111827] shadow-lg">
      {/* Header — tappable on mobile to expand/collapse */}
      <button
        className="w-full flex items-center justify-between border-b border-[#1E2A3D] px-4 py-3 text-left md:cursor-default"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <h2 className="text-sm font-semibold text-[#94a3b8] uppercase tracking-wide">
          Algorithm Reasoning
        </h2>
        <div className="flex items-center gap-2">
          {current && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${stateStyle.cls}`}>
              {stateStyle.label}
            </span>
          )}
          {lastUpdated && (
            <span className="hidden text-xs text-[#4b5563] md:inline">{lastUpdated.toLocaleTimeString()}</span>
          )}
          {/* Chevron indicator — mobile only */}
          <span className="text-[#4b5563] md:hidden" aria-hidden="true">
            {expanded ? '▲' : '▼'}
          </span>
        </div>
      </button>

      {/* Collapsible body: hidden on mobile when collapsed, always shown on desktop */}
      <div className={expanded ? 'block' : 'hidden md:block'}>
        {/* Current state */}
        <div className="border-b border-[#1E2A3D] bg-[#0D1E3A] px-4 py-3">
          <p className="text-sm font-medium text-[#93c5fd]">
            {current ? current.text : 'Connecting to algorithm...'}
          </p>
        </div>

        {/* History feed */}
        <div className="max-h-48 overflow-y-auto px-4 py-2 space-y-2">
          {entries.length === 0 ? (
            <p className="py-2 text-xs text-[#4b5563] italic">No order history yet.</p>
          ) : (
            entries.map((e) => (
              <div key={e.id} className="flex items-start gap-2 py-1 border-b border-[#1E2A3D]/50 last:border-0">
                <span className="mt-0.5 shrink-0 text-xs text-[#4b5563] tabular-nums w-16">
                  {e.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium ${e.badgeClass}`}>
                  {e.badge}
                </span>
                <p className="text-xs text-[#e2e8f0] leading-relaxed">{e.text}</p>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
