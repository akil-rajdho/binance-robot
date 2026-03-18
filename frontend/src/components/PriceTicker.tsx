'use client';

import { useRef, useEffect, useState } from 'react';

interface Props {
  currentPrice: number;
  avgDailyPrice: number;
  maxDailyPrice: number;
  conditionMet: boolean;
  botEnabled: boolean;
  connected: boolean;
}

function formatPrice(price: number): string {
  return price.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function PriceTicker({
  currentPrice,
  avgDailyPrice,
  maxDailyPrice,
  conditionMet,
  botEnabled,
  connected,
}: Props) {
  const prevPriceRef = useRef<number>(currentPrice);
  const [priceDirection, setPriceDirection] = useState<'up' | 'down' | 'same'>('same');

  useEffect(() => {
    if (currentPrice > prevPriceRef.current) {
      setPriceDirection('up');
    } else if (currentPrice < prevPriceRef.current) {
      setPriceDirection('down');
    } else {
      setPriceDirection('same');
    }
    prevPriceRef.current = currentPrice;
  }, [currentPrice]);

  const directionArrow = priceDirection === 'up' ? '▲' : priceDirection === 'down' ? '▼' : '●';
  const directionColor =
    priceDirection === 'up'
      ? 'text-green-500'
      : priceDirection === 'down'
      ? 'text-red-500'
      : 'text-[#4b5563]';

  return (
    <div className="rounded-lg border border-[#1E2A3D] bg-[#111827] p-2 md:p-4 flex flex-col gap-3 h-full">
      {/* Top row: label + connection status */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[#94a3b8] uppercase tracking-wide">BTC/USDT</span>
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-block w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}
          />
          <span className={`text-xs ${connected ? 'text-green-400' : 'text-red-400'}`}>
            {connected ? 'Live' : 'Disconnected'}
          </span>
        </div>
      </div>

      {/* Three-column price display */}
      <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[#1E2A3D]">
        {/* Current Price */}
        <div className="flex flex-col gap-1 py-2 md:py-0 md:pr-4">
          <span className="text-xs font-medium text-[#94a3b8] uppercase tracking-wide">Current Price</span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white tabular-nums md:text-3xl">
              {formatPrice(currentPrice)}
            </span>
            <span className={`text-lg font-semibold ${directionColor}`}>{directionArrow}</span>
          </div>
        </div>

        {/* Avg Daily Price */}
        <div className="flex flex-col gap-1 py-2 md:py-0 md:px-4">
          <span className="text-xs font-medium text-[#94a3b8] uppercase tracking-wide">Avg Daily</span>
          <span className="text-2xl font-bold text-white tabular-nums md:text-3xl">
            {formatPrice(avgDailyPrice)}
          </span>
        </div>

        {/* Max Daily Price */}
        <div className="flex flex-col gap-1 py-2 md:py-0 md:pl-4">
          <span className="text-xs font-medium text-[#94a3b8] uppercase tracking-wide">Max Daily</span>
          <span className="text-2xl font-bold text-white tabular-nums md:text-3xl">
            {formatPrice(maxDailyPrice)}
          </span>
        </div>
      </div>

      {/* Condition badges */}
      <div className="flex items-center gap-2 flex-wrap">
        {conditionMet ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-900/30 px-2.5 py-0.5 text-xs font-semibold text-green-400 border border-green-800">
            ✓ CONDITION MET
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-800 px-2.5 py-0.5 text-xs font-semibold text-gray-400 border border-[#1E2A3D]">
            ✗ NOT MET
          </span>
        )}

        {!botEnabled && (
          <span className="inline-flex items-center gap-1 rounded-full bg-yellow-900/30 px-2.5 py-0.5 text-xs font-semibold text-yellow-400 border border-yellow-800">
            BOT DISABLED
          </span>
        )}
      </div>
    </div>
  );
}
