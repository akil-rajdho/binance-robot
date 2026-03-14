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
      <span className="text-gray-500">{label}</span>
      <span className={`font-mono font-semibold ${colorClass}`}>{formatPrice(price)}</span>
    </div>
  );
}

export default function ActivePosition({ algoState }: Props) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!algoState || algoState.state !== 'ORDER_PLACED') return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [algoState]);

  const hasActive =
    algoState &&
    (algoState.state === 'ORDER_PLACED' || algoState.state === 'POSITION_OPEN');

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">
          {algoState?.state === 'ORDER_PLACED' ? 'Active Order' : 'Open Position'}
        </h2>
        {hasActive && (
          <span className="inline-flex items-center rounded-full bg-red-50 border border-red-200 px-2.5 py-0.5 text-xs font-bold text-red-700">
            SHORT
          </span>
        )}
      </div>

      {!hasActive ? (
        <p className="text-sm text-gray-400 py-2">No active position</p>
      ) : (
        <div className="space-y-3">
          {/* Price levels */}
          <div className="bg-gray-50 rounded-md p-3 space-y-2">
            <PriceRow
              label={algoState.state === 'ORDER_PLACED' ? 'Order Price' : 'Entry Price'}
              price={algoState.activeOrderPrice}
              colorClass="text-gray-800"
            />
            <PriceRow label="Take Profit" price={algoState.tpPrice} colorClass="text-green-600" />
            <PriceRow label="Stop Loss" price={algoState.slPrice} colorClass="text-red-500" />
          </div>

          {/* Distance indicators */}
          {algoState.tpPrice > 0 && algoState.slPrice > 0 && algoState.activeOrderPrice > 0 && (
            <div className="text-xs text-gray-500 flex gap-3">
              <span>
                TP dist:{' '}
                <span className="text-green-600 font-medium">
                  {formatPrice(Math.abs(algoState.activeOrderPrice - algoState.tpPrice))}
                </span>
              </span>
              <span>
                SL dist:{' '}
                <span className="text-red-500 font-medium">
                  {formatPrice(Math.abs(algoState.slPrice - algoState.activeOrderPrice))}
                </span>
              </span>
            </div>
          )}

          {/* ORDER_PLACED countdown */}
          {algoState.state === 'ORDER_PLACED' && algoState.cancelAt && (
            <div className="flex items-center gap-2 rounded-md bg-orange-50 border border-orange-100 px-3 py-2 text-sm">
              <span className="text-orange-600">Cancels in</span>
              <span className="font-mono font-bold text-orange-700">
                {formatCountdown(algoState.cancelAt)}
              </span>
            </div>
          )}

          {/* POSITION_OPEN unrealized P&L */}
          {algoState.state === 'POSITION_OPEN' && (
            <div className="flex items-center justify-between rounded-md bg-gray-50 border border-gray-100 px-3 py-2 text-sm">
              <span className="text-gray-500">Unrealized P&amp;L</span>
              <span className="font-mono font-semibold text-gray-400">–</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
