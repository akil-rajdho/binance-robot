'use client';

import { useRef, useEffect, useState } from 'react';

interface Props {
  currentPrice: number;
  high10min: number;
  conditionMet: boolean;
  nextOrderPrice: number;
  botEnabled: boolean;
  connected: boolean;
}

function formatPrice(price: number): string {
  return price.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function PriceTicker({
  currentPrice,
  high10min,
  conditionMet,
  nextOrderPrice,
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
    <div className="rounded-lg border border-[#1E2A3D] bg-[#111827] p-4 flex flex-col gap-2">
      {/* Top row: connection status */}
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

      {/* Price row */}
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold text-white tabular-nums">
          {formatPrice(currentPrice)}
        </span>
        <span className={`text-lg font-semibold ${directionColor}`}>{directionArrow}</span>
      </div>

      {/* 10m high */}
      <div className="text-sm text-[#94a3b8]">
        <span className="font-medium text-[#e2e8f0]">10m High:</span>{' '}
        <span className="tabular-nums">{formatPrice(high10min)}</span>
      </div>

      {/* Condition status */}
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

      {/* Next order price */}
      {conditionMet && nextOrderPrice > 0 && (
        <div className="text-sm text-[#94a3b8]">
          <span className="font-medium">Next:</span>{' '}
          <span className="font-semibold text-orange-400">
            SHORT @ {formatPrice(nextOrderPrice)}
          </span>
        </div>
      )}
    </div>
  );
}
