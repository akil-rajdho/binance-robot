'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../src/contexts/AuthContext';
import { Trade, ReasoningSnapshot } from '../../src/types/trading';
import ReasoningModal from '../../src/components/ReasoningModal';

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_API || 'http://localhost:8080/api';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(price: number): string {
  return price.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDate(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    time: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
}

function pnlClass(pnl?: number | null): string {
  if (pnl == null) return 'text-[#94a3b8]';
  if (pnl > 0) return 'text-green-400';
  if (pnl < 0) return 'text-red-400';
  return 'text-[#94a3b8]';
}

const STATUS_STYLES: Record<Trade['status'], { badge: string; dot: string; label: string }> = {
  TP_HIT:    { badge: 'bg-green-900/30 text-green-400 border-green-800',   dot: 'bg-green-400',   label: 'TP HIT' },
  SL_HIT:    { badge: 'bg-red-900/30 text-red-400 border-red-800',         dot: 'bg-red-400',     label: 'SL HIT' },
  CANCELLED: { badge: 'bg-gray-800 text-gray-400 border-[#1E2A3D]',        dot: 'bg-gray-500',    label: 'CANCELLED' },
  OPEN:      { badge: 'bg-blue-900/30 text-blue-400 border-blue-800',      dot: 'bg-blue-400 animate-pulse', label: 'OPEN' },
};

// ── Stats ─────────────────────────────────────────────────────────────────────

function computeStats(trades: Trade[]) {
  let totalPnl = 0;
  let wins = 0;
  let losses = 0;
  let closed = 0;

  for (const t of trades) {
    if (t.status === 'TP_HIT' || t.status === 'SL_HIT') {
      const pnl = t.pnl ?? 0;
      totalPnl += pnl;
      closed++;
      if (t.status === 'TP_HIT') wins++;
      else losses++;
    }
  }

  const winRate = closed > 0 ? (wins / closed) * 100 : 0;
  const avgPnl = closed > 0 ? totalPnl / closed : 0;
  return { totalPnl, wins, losses, closed, winRate, avgPnl, total: trades.length };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HistoryPage() {
  const { token, logout, updateActivity } = useAuth();
  const router = useRouter();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [reasoningTrade, setReasoningTrade] = useState<Trade | null>(null);
  const [filter, setFilter] = useState<'ALL' | Trade['status']>('ALL');
  const [search, setSearch] = useState('');

  const handleLogout = () => {
    logout();
    router.replace('/login');
  };

  const fetchTrades = useCallback(async () => {
    try {
      updateActivity();
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`${API_URL}/trades?limit=0`, { headers });
      if (!res.ok) return;
      const data = (await res.json()) as Trade[];
      setTrades(data);
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }, [token, updateActivity]);

  useEffect(() => {
    void fetchTrades();
  }, [fetchTrades]);

  const stats = computeStats(trades);

  const displayed = trades.filter((t) => {
    if (filter !== 'ALL' && t.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        String(t.id).includes(q) ||
        String(t.orderPrice).includes(q) ||
        t.status.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="min-h-screen bg-[#070B14]">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-[#1E2A3D] bg-[#0A0F1C] px-3 py-3 shadow-lg md:px-6">
        <div className="mx-auto max-w-screen-xl flex items-center justify-between">
          <div className="flex items-center gap-3 md:gap-4">
            <Link
              href="/"
              className="flex items-center gap-1.5 text-[#94a3b8] hover:text-white transition-colors text-sm"
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 12L6 8l4-4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="hidden sm:inline">Dashboard</span>
            </Link>
            <span className="text-[#1E2A3D]">|</span>
            <h1 className="text-sm font-semibold text-white md:text-base">Order History</h1>
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            <span className="text-xs text-[#4b5563]">{trades.length} total</span>
            <button
              onClick={handleLogout}
              className="min-h-[44px] rounded-md border border-[#1E2A3D] bg-[#1A2332] px-3 py-2 text-sm font-medium text-[#94a3b8] transition-colors hover:border-red-800/60 hover:bg-red-900/20 hover:text-red-400"
              aria-label="Logout"
              title="Logout"
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h3" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M10 11l3-3-3-3M13 8H6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-screen-xl space-y-4 p-2 pb-20 md:space-y-6 md:p-6 md:pb-6">

        {/* Stats row — 2 cols on mobile, 4 on sm+ */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:gap-4">
          <StatCard
            label="Total P&L"
            value={(stats.totalPnl >= 0 ? '+' : '') + stats.totalPnl.toFixed(2) + ' USDT'}
            valueClass={stats.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}
          />
          <StatCard
            label="Win Rate"
            value={stats.closed > 0 ? stats.winRate.toFixed(1) + '%' : '—'}
            valueClass={stats.winRate >= 50 ? 'text-green-400' : stats.closed > 0 ? 'text-red-400' : 'text-[#94a3b8]'}
            sub={`${stats.wins}W / ${stats.losses}L`}
          />
          <StatCard
            label="Avg P&L"
            value={stats.closed > 0 ? (stats.avgPnl >= 0 ? '+' : '') + stats.avgPnl.toFixed(2) + ' USDT' : '—'}
            valueClass={stats.avgPnl >= 0 ? 'text-green-400' : 'text-red-400'}
          />
          <StatCard
            label="Closed"
            value={String(stats.closed)}
            valueClass="text-white"
            sub={`${trades.filter(t => t.status === 'OPEN').length} open`}
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-[#1E2A3D] bg-[#111827] p-1 overflow-x-auto">
            {(['ALL', 'TP_HIT', 'SL_HIT', 'OPEN', 'CANCELLED'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`min-h-[36px] rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                  filter === f
                    ? 'bg-[#1E7CF8] text-white'
                    : 'text-[#94a3b8] hover:text-white'
                }`}
              >
                {f === 'ALL' ? 'All' : f === 'TP_HIT' ? 'TP Hit' : f === 'SL_HIT' ? 'SL Hit' : f === 'OPEN' ? 'Open' : 'Cancelled'}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-h-[36px] rounded-lg border border-[#1E2A3D] bg-[#111827] px-3 py-1.5 text-xs text-[#e2e8f0] placeholder-[#4b5563] outline-none focus:border-[#1E7CF8] transition-colors w-full sm:w-52"
          />
          <span className="text-xs text-[#4b5563] ml-auto">{displayed.length} results</span>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-20 text-[#4b5563] text-sm">
            Loading trades...
          </div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-2">
            <span className="text-3xl">📭</span>
            <p className="text-[#94a3b8] text-sm">No trades match your filter</p>
          </div>
        ) : (
          <>
            {/* Mobile: card view */}
            <div className="flex flex-col gap-3 md:hidden">
              {displayed.map((trade) => {
                const st = STATUS_STYLES[trade.status];
                const { date, time } = fmtDate(trade.entryTime);

                return (
                  <div
                    key={trade.id}
                    className="rounded-xl border border-[#1E2A3D] bg-[#111827] p-3 space-y-3"
                  >
                    {/* Top: id + status */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#4b5563] font-mono">#{trade.id}</span>
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${st.badge}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                        {st.label}
                      </span>
                    </div>

                    {/* Date/time */}
                    <div>
                      <p className="text-xs font-medium text-[#e2e8f0]">{date}</p>
                      <p className="text-xs text-[#4b5563] font-mono mt-0.5">{time}</p>
                    </div>

                    {/* Prices grid */}
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <p className="text-[#4b5563] mb-0.5">Entry</p>
                        <p className="font-mono text-[#e2e8f0]">
                          {trade.entryPrice ? fmt(trade.entryPrice) : fmt(trade.orderPrice)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[#4b5563] mb-0.5">Exit</p>
                        <p className="font-mono text-[#e2e8f0]">
                          {trade.exitPrice != null ? fmt(trade.exitPrice) : '—'}
                        </p>
                      </div>
                      <div>
                        <p className="text-[#4b5563] mb-0.5">P&L</p>
                        <p className={`font-mono font-semibold ${pnlClass(trade.pnl)}`}>
                          {trade.pnl != null
                            ? (trade.pnl >= 0 ? '+' : '') + trade.pnl.toFixed(2)
                            : '—'}
                        </p>
                      </div>
                    </div>

                    {/* Reasoning button */}
                    <button
                      onClick={() => setReasoningTrade(trade)}
                      className="min-h-[44px] w-full rounded-lg border border-[#1E2A3D] bg-[#0D1421] text-xs font-medium text-[#94a3b8] hover:border-[#1E7CF8] hover:text-[#1E7CF8] transition-all"
                    >
                      View Reasoning
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Desktop: table view */}
            <div className="hidden md:block rounded-xl border border-[#1E2A3D] bg-[#111827] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#1E2A3D] bg-[#0D1421]">
                      <th className="text-left px-4 py-3 text-xs font-medium text-[#94a3b8] uppercase tracking-wide whitespace-nowrap">#</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-[#94a3b8] uppercase tracking-wide whitespace-nowrap">Date / Time</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-[#94a3b8] uppercase tracking-wide">Side</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-[#94a3b8] uppercase tracking-wide whitespace-nowrap">Order Price</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-[#94a3b8] uppercase tracking-wide whitespace-nowrap">Entry</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-[#94a3b8] uppercase tracking-wide">TP</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-[#94a3b8] uppercase tracking-wide">SL</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-[#94a3b8] uppercase tracking-wide whitespace-nowrap">Exit Price</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-[#94a3b8] uppercase tracking-wide">P&amp;L</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-[#94a3b8] uppercase tracking-wide">Status</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1E2A3D]/60">
                    {displayed.map((trade) => {
                      const st = STATUS_STYLES[trade.status];
                      const { date, time } = fmtDate(trade.entryTime);
                      let reasoning: ReasoningSnapshot | null = null;
                      try { reasoning = JSON.parse(trade.reasoning) as ReasoningSnapshot; } catch { /* skip */ }

                      return (
                        <tr
                          key={trade.id}
                          className="hover:bg-[#1A2332]/60 transition-colors group"
                        >
                          <td className="px-4 py-3 text-[#4b5563] font-mono text-xs tabular-nums">
                            #{trade.id}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <p className="text-[#e2e8f0] text-xs font-medium">{date}</p>
                            <p className="text-[#4b5563] text-xs font-mono mt-0.5">{time}</p>
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold bg-red-900/30 text-red-400 border border-red-800">
                              SHORT
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-[#e2e8f0] whitespace-nowrap text-xs">
                            {fmt(trade.orderPrice)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono whitespace-nowrap text-xs">
                            {trade.entryPrice ? (
                              <span className="text-[#1E7CF8]">{fmt(trade.entryPrice)}</span>
                            ) : (
                              <span className="text-[#4b5563]">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-green-400 whitespace-nowrap text-xs">
                            {reasoning ? fmt(reasoning.tp_price) : fmt(trade.tpPrice)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-red-400 whitespace-nowrap text-xs">
                            {reasoning ? fmt(reasoning.sl_price) : fmt(trade.slPrice)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono whitespace-nowrap text-xs">
                            {trade.exitPrice != null ? (
                              <span className="text-[#e2e8f0]">{fmt(trade.exitPrice)}</span>
                            ) : (
                              <span className="text-[#4b5563]">—</span>
                            )}
                          </td>
                          <td className={`px-4 py-3 text-right font-mono font-semibold whitespace-nowrap text-xs ${pnlClass(trade.pnl)}`}>
                            {trade.pnl != null
                              ? (trade.pnl >= 0 ? '+' : '') + trade.pnl.toFixed(2)
                              : '—'}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${st.badge}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                              {st.label}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => setReasoningTrade(trade)}
                              className="rounded-lg border border-[#1E2A3D] bg-[#0D1421] px-3 py-1 text-xs font-medium text-[#94a3b8] hover:border-[#1E7CF8] hover:text-[#1E7CF8] transition-all opacity-0 group-hover:opacity-100"
                            >
                              Reasoning
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>

      {/* Bottom navigation — mobile only */}
      <nav className="fixed bottom-0 left-0 right-0 z-20 flex items-center justify-around border-t border-[#1E2A3D] bg-[#0A0F1C] py-2 md:hidden">
        <Link
          href="/"
          className="flex min-h-[44px] flex-col items-center justify-center gap-0.5 px-4 text-[#94a3b8]"
        >
          <span className="text-xl">📊</span>
          <span className="text-xs font-medium">Dashboard</span>
        </Link>
        <Link
          href="/history"
          className="flex min-h-[44px] flex-col items-center justify-center gap-0.5 px-4 text-[#1E7CF8]"
        >
          <span className="text-xl">📜</span>
          <span className="text-xs font-medium">History</span>
        </Link>
        <button
          onClick={handleLogout}
          className="flex min-h-[44px] flex-col items-center justify-center gap-0.5 px-4 text-[#94a3b8]"
        >
          <span className="text-xl">⚙️</span>
          <span className="text-xs font-medium">Settings</span>
        </button>
      </nav>

      <ReasoningModal trade={reasoningTrade} onClose={() => setReasoningTrade(null)} />
    </div>
  );
}

function StatCard({
  label,
  value,
  valueClass,
  sub,
}: {
  label: string;
  value: string;
  valueClass: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-[#1E2A3D] bg-[#111827] px-3 py-3 md:px-4 md:py-4">
      <p className="text-xs text-[#94a3b8] mb-1">{label}</p>
      <p className={`text-lg font-bold tabular-nums md:text-xl ${valueClass}`}>{value}</p>
      {sub && <p className="text-xs text-[#4b5563] mt-0.5">{sub}</p>}
    </div>
  );
}
