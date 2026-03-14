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
  TP_HIT: 'text-green-600',
  SL_HIT: 'text-red-600',
  CANCELLED: 'text-gray-500',
  OPEN: 'text-blue-600',
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
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal panel */}
      <div className="relative z-10 w-full max-w-md rounded-xl border border-gray-200 bg-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Trade Reasoning</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Trade #{trade.id} — {trade.status}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
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
            <div className="rounded-md bg-gray-50 border border-gray-200 p-3">
              <p className="text-sm text-gray-500 font-mono break-all">{trade.reasoning || 'No reasoning data'}</p>
            </div>
          ) : (
            <>
              {/* Timestamp */}
              <div className="text-xs text-gray-400">
                Decision at {formatTimestamp(reasoning.timestamp)}
              </div>

              {/* Condition evaluation */}
              <div className="rounded-md bg-green-50 border border-green-100 p-3 space-y-1">
                <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-2">
                  Condition Evaluation
                </p>
                <p className="text-sm text-gray-700">
                  {reasoning.condition_met ? '✓' : '✗'} Condition {reasoning.condition_met ? 'met' : 'not met'}:{' '}
                  <span className="font-mono">{formatPrice(reasoning.current_price)}</span>{' '}
                  {reasoning.condition_met ? '<' : '≥'}{' '}
                  <span className="font-mono">{formatPrice(reasoning.high_10min)}</span>{' '}
                  (10m high
                  {spread !== null && (
                    <>, spread: <span className="font-mono">{formatPrice(Math.abs(spread))}</span></>
                  )}
                  )
                </p>
              </div>

              {/* Order details */}
              <div className="rounded-md bg-blue-50 border border-blue-100 p-3 space-y-2">
                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-2">
                  Order Details
                </p>
                <p className="text-sm text-gray-700">
                  Order placed:{' '}
                  <span className="font-semibold">SHORT limit @ {formatPrice(reasoning.order_price)}</span>
                </p>
                <p className="text-sm text-gray-700">
                  Targets:{' '}
                  <span className="text-green-600 font-medium">TP @ {formatPrice(reasoning.tp_price)}</span>
                  {' | '}
                  <span className="text-red-500 font-medium">SL @ {formatPrice(reasoning.sl_price)}</span>
                </p>
                <p className="text-sm text-gray-700">
                  Position size:{' '}
                  <span className="font-medium">{formatPrice(reasoning.position_size_usdt)}</span>
                  {' | '}
                  Leverage:{' '}
                  <span className="font-medium">{reasoning.leverage}x</span>
                </p>
              </div>

              {/* Outcome */}
              <div className="rounded-md bg-gray-50 border border-gray-100 p-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Outcome</p>
                <p className={`text-sm font-medium ${STATUS_COLORS[trade.status]}`}>
                  {STATUS_LABELS[trade.status]}
                  {trade.pnl !== undefined && trade.pnl !== null && (
                    <span className={trade.pnl >= 0 ? 'text-green-600' : 'text-red-600'}>
                      {' '}— {trade.pnl >= 0 ? '+' : ''}{trade.pnl.toFixed(2)} USDT
                    </span>
                  )}
                </p>
                {trade.exitPrice !== undefined && trade.exitPrice !== null && (
                  <p className="text-sm text-gray-500 mt-1">
                    Exit price: <span className="font-mono">{formatPrice(trade.exitPrice)}</span>
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-5 py-3 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
