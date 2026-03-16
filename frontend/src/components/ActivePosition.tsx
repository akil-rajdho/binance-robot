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

function PriceRow({ label, price, colorClass }: { label: string; price: number; colorClass: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-[#94a3b8]">{label}</span>
      <span className={`font-mono font-semibold ${colorClass}`}>{formatPrice(price)}</span>
    </div>
  );
}

// Unrealized PnL for a SHORT position (USDT-margined futures)
// pnl = (entry - current) / entry * positionSize * leverage
function calcUnrealizedPnl(entry: number, current: number, positionSize: number, leverage: number): number {
  if (entry <= 0 || positionSize <= 0 || leverage <= 0) return 0;
  return ((entry - current) / entry) * positionSize * leverage;
}

export default function ActivePosition({ algoState }: Props) {
  const [, setTick] = useState(0);

  // Re-render every second for countdown + live PnL
  useEffect(() => {
    if (!algoState || algoState.state === 'IDLE') return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [algoState]);

  const hasActive =
    algoState &&
    (algoState.state === 'ORDER_PLACED' || algoState.state === 'POSITION_OPEN');

  // Live unrealized PnL (for POSITION_OPEN) or potential PnL at current price (for ORDER_PLACED)
  const posSize = algoState?.positionSizeUsdt ?? 0;
  const lev = algoState?.leverage ?? 0;
  const entry = algoState?.activeOrderPrice ?? 0;
  const current = algoState?.currentPrice ?? 0;

  // For ORDER_PLACED: show what PnL would be if the order filled and was now at current price
  // For POSITION_OPEN: show actual unrealized PnL
  const unrealizedPnl = hasActive && entry > 0 ? calcUnrealizedPnl(entry, current, posSize, lev) : null;
  const pnlColor = unrealizedPnl == null ? '' : unrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400';

  // Distance from current price to order price (positive = price needs to rise to fill)
  const distToFill = entry > 0 && current > 0 ? entry - current : null;

  return (
    <div className="rounded-lg border border-[#1E2A3D] bg-[#111827] p-2 md:p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[#e2e8f0]">
          {algoState?.state === 'ORDER_PLACED' ? 'Active Order' : 'Open Position'}
        </h2>
        {hasActive && (
          <span className="inline-flex items-center rounded-full bg-red-900/30 border border-red-800 px-2.5 py-0.5 text-xs font-bold text-red-400">
            SHORT
          </span>
        )}
      </div>

      {!hasActive ? (
        <p className="text-sm text-[#4b5563] py-2">No active position</p>
      ) : (
        <div className="space-y-3">
          {/* Price levels */}
          <div className="bg-[#0D1421] rounded-md p-2 md:p-3 space-y-2">
            <PriceRow
              label={algoState.state === 'ORDER_PLACED' ? 'Order Price' : 'Entry Price'}
              price={algoState.activeOrderPrice}
              colorClass="text-white"
            />
            <PriceRow label="Take Profit" price={algoState.tpPrice} colorClass="text-green-400" />
            <PriceRow label="Stop Loss" price={algoState.slPrice} colorClass="text-red-400" />
          </div>

          {/* Distance indicators */}
          {algoState.tpPrice > 0 && algoState.slPrice > 0 && algoState.activeOrderPrice > 0 && (
            <div className="hidden md:flex text-xs text-[#94a3b8] gap-3">
              <span>
                TP dist:{' '}
                <span className="text-green-400 font-medium">
                  {formatPrice(Math.abs(algoState.activeOrderPrice - algoState.tpPrice))}
                </span>
              </span>
              <span>
                SL dist:{' '}
                <span className="text-red-400 font-medium">
                  {formatPrice(Math.abs(algoState.slPrice - algoState.activeOrderPrice))}
                </span>
              </span>
            </div>
          )}

          {/* ORDER_PLACED: distance to fill + potential PnL */}
          {algoState.state === 'ORDER_PLACED' && (
            <div className="space-y-2">
              {/* Distance to fill */}
              {distToFill !== null && (
                <div className="flex items-center justify-between rounded-md bg-[#0D1421] border border-[#1E2A3D] px-2 py-2 text-sm md:px-3">
                  <span className="text-[#94a3b8] text-xs md:text-sm">
                    {distToFill > 0 ? 'Needs to rise' : 'Past entry'}
                  </span>
                  <span className={`font-mono font-semibold text-xs md:text-sm ${distToFill > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
                    {distToFill > 0 ? '+' : ''}{formatPrice(distToFill)}
                  </span>
                </div>
              )}

              {/* Potential PnL at current price */}
              {unrealizedPnl !== null && posSize > 0 && (
                <div className="flex items-center justify-between rounded-md bg-[#0D1421] border border-[#1E2A3D] px-2 py-2 text-sm md:px-3">
                  <span className="text-[#94a3b8] text-xs md:text-sm">P&amp;L if filled now</span>
                  <span className={`font-mono font-bold text-xs md:text-sm ${pnlColor}`}>
                    {unrealizedPnl >= 0 ? '+' : ''}{formatPrice(unrealizedPnl)}
                  </span>
                </div>
              )}

              {/* Countdown */}
              {algoState.cancelAt && (
                <div className="flex items-center gap-2 rounded-md bg-yellow-900/20 border border-yellow-800 px-2 py-2 text-sm md:px-3">
                  <span className="text-yellow-400 text-xs md:text-sm">Cancels in</span>
                  <span className="font-mono font-bold text-orange-400">
                    {formatCountdown(algoState.cancelAt)}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* POSITION_OPEN: live unrealized PnL */}
          {algoState.state === 'POSITION_OPEN' && (
            <div className="space-y-2">
              {unrealizedPnl !== null && posSize > 0 ? (
                <div className={`flex items-center justify-between rounded-md border px-2 py-2 text-sm md:px-3 ${
                  unrealizedPnl >= 0
                    ? 'bg-green-900/20 border-green-800/60'
                    : 'bg-red-900/20 border-red-800/60'
                }`}>
                  <span className="text-[#94a3b8] text-xs md:text-sm">Unrealized P&amp;L</span>
                  <span className={`font-mono font-bold ${pnlColor}`}>
                    {unrealizedPnl >= 0 ? '+' : ''}{formatPrice(unrealizedPnl)}
                    <span className="text-xs font-normal text-[#64748b] ml-1">
                      ({((unrealizedPnl / (posSize * lev)) * 100).toFixed(2)}%)
                    </span>
                  </span>
                </div>
              ) : (
                <div className="flex items-center justify-between rounded-md bg-[#0D1421] border border-[#1E2A3D] px-2 py-2 text-sm md:px-3">
                  <span className="text-[#94a3b8] text-xs md:text-sm">Unrealized P&amp;L</span>
                  <span className="font-mono font-semibold text-[#4b5563]">–</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
