'use client';

import { useEffect } from 'react';
import { Trade, ReasoningSnapshot } from '../types/trading';

interface Props {
  trade: Trade | null;
  onClose: () => void;
}

function formatPrice(price: number): string {
  return price.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

const STATUS_LABELS: Record<Trade['status'], string> = {
  TP_HIT: 'Take Profit Hit',
  SL_HIT: 'Stop Loss Hit',
  CANCELLED: 'Cancelled',
  OPEN: 'Still Open',
};

const STATUS_COLORS: Record<Trade['status'], string> = {
  TP_HIT: 'text-green-400',
  SL_HIT: 'text-red-400',
  CANCELLED: 'text-[#94a3b8]',
  OPEN: 'text-[#60a5fa]',
};

export default function ReasoningModal({ trade, onClose }: Props) {
  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!trade) return null;

  let reasoning: ReasoningSnapshot | null = null;
  try {
    reasoning = JSON.parse(trade.reasoning) as ReasoningSnapshot;
  } catch {
    // invalid JSON — we'll show a fallback
  }

  const spread = reasoning ? reasoning.high_10min - reasoning.current_price : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal panel */}
      <div className="relative z-10 w-full max-w-md rounded-xl border border-[#1E2A3D] bg-[#111827] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#1E2A3D] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">Trade Reasoning</h2>
            <p className="text-xs text-[#94a3b8] mt-0.5">
              Trade #{trade.id} — {trade.status}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-[#94a3b8] hover:bg-[#1A2332] hover:text-white transition-colors"
            aria-label="Close"
          >
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 2l12 12M14 2L2 14" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {!reasoning ? (
            <div className="rounded-md bg-[#0D1421] border border-[#1E2A3D] p-3">
              <p className="text-sm text-[#94a3b8] font-mono break-all">{trade.reasoning || 'No reasoning data'}</p>
            </div>
          ) : (
            <>
              {/* Timestamp */}
              <div className="text-xs text-[#4b5563]">
                Decision at {formatTimestamp(reasoning.timestamp)}
              </div>

              {/* Condition evaluation */}
              <div className={`rounded-md p-3 space-y-2 ${reasoning.condition_met ? 'bg-green-900/20 border border-green-800' : 'bg-red-900/20 border border-red-800'}`}>
                <p className={`text-xs font-semibold uppercase tracking-wide ${reasoning.condition_met ? 'text-green-400' : 'text-red-400'}`}>
                  {reasoning.condition_met ? '✓ Entry condition met' : '✗ Entry condition not met'}
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                  <span className="text-[#94a3b8]">BTC price at entry</span>
                  <span className="font-mono text-[#e2e8f0]">{formatPrice(reasoning.current_price)}</span>
                  <span className="text-[#94a3b8]">10-min high</span>
                  <span className="font-mono text-[#e2e8f0]">{formatPrice(reasoning.high_10min)}</span>
                  {spread !== null && (
                    <>
                      <span className="text-[#94a3b8]">Gap below high</span>
                      <span className="font-mono text-[#e2e8f0]">{formatPrice(Math.abs(spread))}</span>
                    </>
                  )}
                </div>
                <p className="text-xs text-[#64748b]">
                  The bot enters when the current price dips below the highest price seen in the last 10 minutes.
                </p>
              </div>

              {/* Order details */}
              <div className="rounded-md bg-[#0D1E3A] border border-blue-900 p-3 space-y-2">
                <p className="text-xs font-semibold text-[#93c5fd] uppercase tracking-wide">
                  Order Details
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                  <span className="text-[#94a3b8]">Order type</span>
                  <span className="text-[#e2e8f0] font-medium">Short (sell) limit</span>
                  <span className="text-[#94a3b8]">Order placed at</span>
                  <span className="font-mono text-[#e2e8f0] font-semibold">{formatPrice(reasoning.order_price)}</span>
                  <span className="text-[#94a3b8]">Take profit at</span>
                  <span className="font-mono text-green-400 font-medium">{formatPrice(reasoning.tp_price)}</span>
                  <span className="text-[#94a3b8]">Stop loss at</span>
                  <span className="font-mono text-red-400 font-medium">{formatPrice(reasoning.sl_price)}</span>
                  <span className="text-[#94a3b8]">Position size</span>
                  <span className="font-mono text-[#e2e8f0]">{formatPrice(reasoning.position_size_usdt)}</span>
                  <span className="text-[#94a3b8]">Leverage</span>
                  <span className="text-[#e2e8f0]">{reasoning.leverage}x</span>
                </div>
              </div>

              {/* Outcome */}
              <div className="rounded-md bg-[#0D1421] border border-[#1E2A3D] p-3">
                <p className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wide mb-2">Outcome</p>
                <p className={`text-sm font-medium ${STATUS_COLORS[trade.status]}`}>
                  {STATUS_LABELS[trade.status]}
                  {trade.pnl !== undefined && trade.pnl !== null && (
                    <span className={trade.pnl >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {' '}— {trade.pnl >= 0 ? '+' : ''}{trade.pnl.toFixed(2)} USDT
                    </span>
                  )}
                </p>
                {trade.exitPrice !== undefined && trade.exitPrice !== null && (
                  <p className="text-sm text-[#94a3b8] mt-1">
                    Exit price: <span className="font-mono">{formatPrice(trade.exitPrice)}</span>
                  </p>
                )}
                {trade.status === 'CANCELLED' && trade.cancelPrice !== undefined && trade.cancelPrice > 0 && (
                  <p className="text-sm text-[#94a3b8] mt-1">
                    BTC price at cancel: <span className="font-mono">{formatPrice(trade.cancelPrice)}</span>
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[#1E2A3D] px-5 py-3 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-md bg-[#1A2332] border border-[#1E2A3D] px-4 py-2 text-sm font-medium text-[#e2e8f0] hover:bg-[#1E2A3D] transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
