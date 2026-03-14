'use client';

import { useEffect, useState } from 'react';
import { AlgoState } from '../types/trading';

interface Props {
  algoState: AlgoState | null;
}

function formatPrice(price: number): string {
  return price.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCountdown(cancelAt: string): string {
  const diff = new Date(cancelAt).getTime() - Date.now();
  if (diff <= 0) return '0:00';
  const totalSeconds = Math.floor(diff / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

const STATE_LABELS: Record<string, string> = {
  IDLE: 'IDLE',
  ORDER_PLACED: 'ORDER PLACED',
  POSITION_OPEN: 'POSITION OPEN',
};

const STATE_BADGE_COLORS: Record<string, string> = {
  IDLE: 'bg-gray-800 text-gray-400 border-[#1E2A3D]',
  ORDER_PLACED: 'bg-yellow-900/30 text-yellow-400 border-yellow-800',
  POSITION_OPEN: 'bg-green-900/30 text-green-400 border-green-800',
};

const CARD_ACCENT: Record<string, string> = {
  IDLE: 'border-l-blue-500',
  ORDER_PLACED: 'border-l-orange-400',
  POSITION_OPEN: 'border-l-green-400',
};

export default function AlgorithmBrain({ algoState }: Props) {
  const [, setTick] = useState(0);

  // Re-render every second to update countdown
  useEffect(() => {
    if (!algoState || algoState.state !== 'ORDER_PLACED') return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [algoState]);

  if (!algoState) {
    return (
      <div className="rounded-lg border border-[#1E2A3D] bg-[#111827] p-4">
        <h2 className="text-sm font-semibold text-[#e2e8f0] mb-3">Algorithm Brain</h2>
        <p className="text-sm text-[#4b5563]">No data yet...</p>
      </div>
    );
  }

  const state = algoState.state;
  const accentClass = CARD_ACCENT[state] ?? 'border-l-blue-500';
  const spread = algoState.high10min - algoState.currentPrice;

  return (
    <div className={`rounded-lg border border-[#1E2A3D] border-l-4 ${accentClass} bg-[#111827] p-4 flex flex-col gap-3`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[#e2e8f0]">Algorithm Brain</h2>
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATE_BADGE_COLORS[state] ?? STATE_BADGE_COLORS.IDLE}`}
        >
          {STATE_LABELS[state] ?? state}
        </span>
      </div>

      {/* Condition evaluation */}
      <div className="bg-[#0D1421] rounded-md p-3 space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-[#94a3b8]">Current</span>
          <span className="font-mono font-medium text-white">{formatPrice(algoState.currentPrice)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#94a3b8]">10m High</span>
          <span className="font-mono font-medium text-white">{formatPrice(algoState.high10min)}</span>
        </div>
        <div className="flex justify-between border-t border-[#1E2A3D] pt-1 mt-1">
          <span className="text-[#94a3b8]">Spread</span>
          <span className={`font-mono font-semibold ${spread >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {spread >= 0
              ? `${formatPrice(spread)} below high`
              : `${formatPrice(Math.abs(spread))} above high`}
          </span>
        </div>
        {algoState.conditionMet && algoState.entryOffset !== undefined && (
          <div className="flex justify-between border-t border-[#1E2A3D] pt-1 mt-1">
            <span className="text-[#94a3b8]">Next Order</span>
            <span className="font-mono text-sm font-semibold text-orange-400">
              {formatPrice(algoState.currentPrice + algoState.entryOffset)}
              <span className="text-xs text-[#94a3b8] ml-1">(+${algoState.entryOffset})</span>
            </span>
          </div>
        )}
      </div>

      {/* State-specific info */}
      {state === 'IDLE' && (
        <div className="space-y-1">
          <p className="text-sm text-[#1E7CF8] flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#1E7CF8] animate-pulse" />
            Monitoring... waiting for condition
          </p>
          {algoState.entryOffset !== undefined && algoState.entryOffset !== 150 && (
            <p className="text-xs text-orange-400">
              Entry offset reduced to +${algoState.entryOffset} (was $150 — reset on next fill)
            </p>
          )}
        </div>
      )}

      {state === 'ORDER_PLACED' && (
        <div className="text-sm space-y-1">
          <p className="text-yellow-400 font-medium">
            Order @ {formatPrice(algoState.activeOrderPrice)} placed
          </p>
          {algoState.cancelAt && (
            <p className="text-[#94a3b8]">
              Cancels in{' '}
              <span className="font-mono font-semibold text-orange-400">
                {formatCountdown(algoState.cancelAt)}
              </span>
            </p>
          )}
        </div>
      )}

      {state === 'POSITION_OPEN' && (
        <div className="text-sm space-y-1">
          <p className="text-green-400 font-medium">
            Position open @ {formatPrice(algoState.activeOrderPrice)}
          </p>
          <p className="text-[#94a3b8]">
            <span className="text-green-400 font-medium">TP: {formatPrice(algoState.tpPrice)}</span>
            {' | '}
            <span className="text-red-400 font-medium">SL: {formatPrice(algoState.slPrice)}</span>
          </p>
        </div>
      )}
    </div>
  );
}
