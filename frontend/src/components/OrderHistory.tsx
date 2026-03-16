'use client';

import { Trade } from '../types/trading';

interface Props {
  trades: Trade[];
  onWhyClick: (trade: Trade) => void;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ss = d.getSeconds().toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatPrice(price: number): string {
  return price.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPnl(pnl?: number): string {
  if (pnl === undefined || pnl === null) return '–';
  const sign = pnl >= 0 ? '+' : '';
  return `${sign}${pnl.toFixed(2)}`;
}

function pnlColor(pnl?: number): string {
  if (pnl === undefined || pnl === null) return 'text-[#4b5563]';
  if (pnl > 0) return 'text-green-400';
  if (pnl < 0) return 'text-red-400';
  return 'text-[#94a3b8]';
}

const STATUS_STYLES: Record<Trade['status'], string> = {
  TP_HIT: 'bg-green-900/30 text-green-400 border-green-800',
  SL_HIT: 'bg-red-900/30 text-red-400 border-red-800',
  CANCELLED: 'bg-gray-800 text-gray-400 border-[#1E2A3D]',
  OPEN: 'bg-blue-900/30 text-blue-400 border-blue-800',
};

const STATUS_LABELS: Record<Trade['status'], string> = {
  TP_HIT: 'TP HIT',
  SL_HIT: 'SL HIT',
  CANCELLED: 'CANCELLED',
  OPEN: 'OPEN',
};

export default function OrderHistory({ trades, onWhyClick }: Props) {
  const displayTrades = trades.slice(0, 20);

  return (
    <div className="rounded-lg border border-[#1E2A3D] bg-[#111827] p-2 md:p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[#e2e8f0]">Order History</h2>
        {trades.length > 20 && (
          <span className="text-xs text-[#4b5563]">Showing 20 of {trades.length}</span>
        )}
      </div>

      {displayTrades.length === 0 ? (
        <p className="text-sm text-[#4b5563] py-3 text-center">No trades yet</p>
      ) : (
        <>
          {/* Mobile card view */}
          <div className="flex flex-col gap-2 md:hidden">
            {displayTrades.map((trade) => (
              <div
                key={trade.id}
                className="rounded-lg border border-[#1E2A3D] bg-[#0D1421] p-3 space-y-2"
              >
                {/* Top row: time + status */}
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-[#94a3b8] tabular-nums">
                    {formatTime(trade.entryTime)}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${STATUS_STYLES[trade.status]}`}
                  >
                    {STATUS_LABELS[trade.status]}
                  </span>
                </div>

                {/* Prices row */}
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="text-[#4b5563] mb-0.5">Entry</p>
                    <p className="font-mono text-[#e2e8f0]">
                      {trade.status === 'OPEN' || trade.status === 'CANCELLED'
                        ? formatPrice(trade.orderPrice)
                        : formatPrice(trade.entryPrice || trade.orderPrice)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[#4b5563] mb-0.5">Exit</p>
                    <p className="font-mono text-[#94a3b8]">
                      {trade.exitPrice !== undefined && trade.exitPrice !== null
                        ? formatPrice(trade.exitPrice)
                        : '–'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[#4b5563] mb-0.5">P&amp;L</p>
                    <p className={`font-mono font-semibold ${pnlColor(trade.pnl)}`}>
                      {formatPnl(trade.pnl)}
                    </p>
                  </div>
                </div>

                {trade.status === 'CANCELLED' && trade.cancelPrice && trade.cancelPrice > 0 && (
                  <div className="text-xs">
                    <span className="text-[#4b5563]">Cancelled @</span>
                    <span className="font-mono text-[#94a3b8] ml-1">{formatPrice(trade.cancelPrice)}</span>
                  </div>
                )}

                {/* Why button */}
                <button
                  onClick={() => onWhyClick(trade)}
                  className="min-h-[44px] w-full rounded-md border border-[#1E2A3D] bg-[#111827] text-xs font-medium text-[#1E7CF8] hover:text-blue-400 transition-colors"
                >
                  Why?
                </button>
              </div>
            ))}
          </div>

          {/* Desktop table view */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1E2A3D]">
                  <th className="text-left py-2 pr-3 text-xs font-medium text-[#94a3b8] whitespace-nowrap">Time</th>
                  <th className="text-left py-2 pr-3 text-xs font-medium text-[#94a3b8]">Side</th>
                  <th className="text-right py-2 pr-3 text-xs font-medium text-[#94a3b8]">Order / Fill</th>
                  <th className="text-right py-2 pr-3 text-xs font-medium text-[#94a3b8]">Exit</th>
                  <th className="text-right py-2 pr-3 text-xs font-medium text-[#94a3b8]">Cancel @</th>
                  <th className="text-right py-2 pr-3 text-xs font-medium text-[#94a3b8]">P&amp;L</th>
                  <th className="text-left py-2 pr-3 text-xs font-medium text-[#94a3b8]">Status</th>
                  <th className="py-2 text-xs font-medium text-[#94a3b8]"></th>
                </tr>
              </thead>
              <tbody>
                {displayTrades.map((trade) => (
                  <tr key={trade.id} className="border-b border-[#1E2A3D]/50 hover:bg-[#1A2332]/50 transition-colors">
                    <td className="py-2 pr-3 text-[#94a3b8] tabular-nums whitespace-nowrap font-mono text-xs">
                      {formatTime(trade.entryTime)}
                    </td>
                    <td className="py-2 pr-3">
                      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold bg-red-900/30 text-red-400 border border-red-800">
                        SHORT
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-[#e2e8f0] whitespace-nowrap">
                      {trade.status === 'OPEN' || trade.status === 'CANCELLED'
                        ? formatPrice(trade.orderPrice)
                        : formatPrice(trade.entryPrice || trade.orderPrice)}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-[#94a3b8] whitespace-nowrap">
                      {trade.exitPrice !== undefined && trade.exitPrice !== null
                        ? formatPrice(trade.exitPrice)
                        : '–'}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-[#94a3b8] whitespace-nowrap">
                      {trade.status === 'CANCELLED' && trade.cancelPrice && trade.cancelPrice > 0
                        ? formatPrice(trade.cancelPrice)
                        : '–'}
                    </td>
                    <td className={`py-2 pr-3 text-right font-mono font-semibold whitespace-nowrap ${pnlColor(trade.pnl)}`}>
                      {formatPnl(trade.pnl)}
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${STATUS_STYLES[trade.status]}`}
                      >
                        {STATUS_LABELS[trade.status]}
                      </span>
                    </td>
                    <td className="py-2">
                      <button
                        onClick={() => onWhyClick(trade)}
                        className="text-xs font-medium text-[#1E7CF8] hover:text-blue-400 hover:underline transition-colors whitespace-nowrap"
                      >
                        Why?
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
