'use client';

import { useEffect, useRef } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  LineStyle,
  UTCTimestamp,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  LineData,
} from 'lightweight-charts';
import { Candle, Trade } from '../types/trading';

interface Props {
  candles: Candle[];
  high10min: number;
  trades: Trade[];
}

export default function PriceChart({ candles, high10min, trades }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  // Initialize chart once
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: '#ffffff' },
        textColor: '#374151',
      },
      grid: {
        vertLines: { color: '#f0f0f0' },
        horzLines: { color: '#f0f0f0' },
      },
      width: containerRef.current.clientWidth,
      height: 300,
      rightPriceScale: {
        borderColor: '#e5e7eb',
      },
      timeScale: {
        borderColor: '#e5e7eb',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: '#9ca3af', style: LineStyle.Dashed },
        horzLine: { color: '#9ca3af', style: LineStyle.Dashed },
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#16a34a',
      borderDownColor: '#dc2626',
      wickUpColor: '#16a34a',
      wickDownColor: '#dc2626',
    });

    const lineSeries = chart.addSeries(LineSeries, {
      color: '#3b82f6',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: true,
      title: '10m High',
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    lineSeriesRef.current = lineSeries;

    // ResizeObserver for responsive width
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        chart.applyOptions({ width });
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      lineSeriesRef.current = null;
    };
  }, []);

  // Update candle data when prop changes
  useEffect(() => {
    if (!candleSeriesRef.current || candles.length === 0) return;

    const data: CandlestickData<UTCTimestamp>[] = candles.map((c) => ({
      time: c.time as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    candleSeriesRef.current.setData(data);
  }, [candles]);

  // Update 10-min high line when high10min or candles change
  useEffect(() => {
    if (!lineSeriesRef.current || candles.length === 0 || high10min <= 0) return;

    const firstTime = candles[0].time as UTCTimestamp;
    const lastTime = candles[candles.length - 1].time as UTCTimestamp;

    const lineData: LineData<UTCTimestamp>[] = [
      { time: firstTime, value: high10min },
      { time: lastTime, value: high10min },
    ];

    lineSeriesRef.current.setData(lineData);
  }, [high10min, candles]);

  // Trade markers — use createSeriesMarkers if needed; for simplicity add price lines
  useEffect(() => {
    if (!candleSeriesRef.current) return;
    // Remove existing price lines and re-add for each open trade entry
    // We cannot remove all price lines directly, but we can set markers
    // For now, entry markers are shown as price lines on the candle series
    const series = candleSeriesRef.current;
    // Remove old price lines by tracking them — simplified approach
    trades.forEach((trade) => {
      if (trade.status === 'OPEN') {
        series.createPriceLine({
          price: trade.entryPrice || trade.orderPrice,
          color: '#f97316',
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: `Entry #${trade.id}`,
        });
      }
    });
  }, [trades]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-700">BTC/USDT</h2>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-0.5 bg-blue-400" style={{ borderTop: '2px dashed #3b82f6' }} />
            10m High
          </span>
        </div>
      </div>
      <div ref={containerRef} className="w-full" />
    </div>
  );
}
