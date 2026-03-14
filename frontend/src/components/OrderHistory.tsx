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
  if (pnl === undefined || pnl === null) return 'text-gray-400';
  if (pnl > 0) return 'text-green-600';
  if (pnl < 0) return 'text-red-600';
  return 'text-gray-600';
}

const STATUS_STYLES: Record<Trade['status'], string> = {
  TP_HIT: 'bg-green-50 text-green-700 border-green-200',
  SL_HIT: 'bg-red-50 text-red-700 border-red-200',
  CANCELLED: 'bg-gray-100 text-gray-500 border-gray-200',
  OPEN: 'bg-blue-50 text-blue-700 border-blue-200',
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
    <div className="rounded-lg border border-gray-200 bg-white p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Order History</h2>
        {trades.length > 20 && (
          <span className="text-xs text-gray-400">Showing 20 of {trades.length}</span>
        )}
      </div>

      {displayTrades.length === 0 ? (
        <p className="text-sm text-gray-400 py-3 text-center">No trades yet</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-2 pr-3 text-xs font-medium text-gray-500 whitespace-nowrap">Time</th>
                <th className="text-left py-2 pr-3 text-xs font-medium text-gray-500">Side</th>
                <th className="text-right py-2 pr-3 text-xs font-medium text-gray-500">Entry</th>
                <th className="text-right py-2 pr-3 text-xs font-medium text-gray-500">Exit</th>
                <th className="text-right py-2 pr-3 text-xs font-medium text-gray-500">P&amp;L</th>
                <th className="text-left py-2 pr-3 text-xs font-medium text-gray-500">Status</th>
                <th className="py-2 text-xs font-medium text-gray-500"></th>
              </tr>
            </thead>
            <tbody>
              {displayTrades.map((trade) => (
                <tr key={trade.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                  <td className="py-2 pr-3 text-gray-500 tabular-nums whitespace-nowrap font-mono text-xs">
                    {formatTime(trade.entryTime)}
                  </td>
                  <td className="py-2 pr-3">
                    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold bg-red-50 text-red-700 border border-red-200">
                      SHORT
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-gray-700 whitespace-nowrap">
                    {formatPrice(trade.entryPrice || trade.orderPrice)}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-gray-500 whitespace-nowrap">
                    {trade.exitPrice !== undefined && trade.exitPrice !== null
                      ? formatPrice(trade.exitPrice)
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
                      className="text-xs font-medium text-blue-500 hover:text-blue-700 hover:underline transition-colors whitespace-nowrap"
                    >
                      Why?
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
