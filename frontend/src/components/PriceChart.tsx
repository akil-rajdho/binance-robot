'use client';

import { useEffect, useRef } from 'react';
import {
  createChart,
  AreaSeries,
  LineSeries,
  LineStyle,
  UTCTimestamp,
  IChartApi,
  ISeriesApi,
  AreaData,
  LineData,
} from 'lightweight-charts';
import { Candle, Trade } from '../types/trading';

interface Props {
  candles: Candle[];
  high10min?: number;
  trades: Trade[];
}

export default function PriceChart({ candles, high10min = 0, trades }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const areaSeriesRef = useRef<ISeriesApi<'Area'> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  // Initialize chart once
  useEffect(() => {
    if (!containerRef.current) return;

    const isMobile = window.innerWidth < 768;
    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: '#0A0F1C' },
        textColor: '#4b6280',
      },
      grid: {
        vertLines: { color: 'transparent' },
        horzLines: { color: '#1E2A3D' },
      },
      width: containerRef.current.clientWidth,
      height: isMobile ? 250 : 400,
      rightPriceScale: {
        borderColor: 'transparent',
        textColor: '#4b6280',
      },
      timeScale: {
        borderColor: 'transparent',
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: true,
      },
      crosshair: {
        vertLine: { color: '#1E7CF8', style: LineStyle.Dashed, width: 1, labelBackgroundColor: '#1E7CF8' },
        horzLine: { color: '#1E7CF8', style: LineStyle.Dashed, width: 1, labelBackgroundColor: '#1E7CF8' },
      },
    });

    // POK-style glowing blue area series
    const areaSeries = chart.addSeries(AreaSeries, {
      lineColor: '#1E7CF8',
      lineWidth: 2,
      topColor: 'rgba(30, 124, 248, 0.35)',
      bottomColor: 'rgba(30, 124, 248, 0.00)',
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      crosshairMarkerBorderColor: '#1E7CF8',
      crosshairMarkerBackgroundColor: '#ffffff',
    });

    // 10m high reference line
    const lineSeries = chart.addSeries(LineSeries, {
      color: 'rgba(148, 163, 184, 0.5)',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: true,
      title: '10m High',
    });

    chartRef.current = chart;
    areaSeriesRef.current = areaSeries;
    lineSeriesRef.current = lineSeries;

    // Responsive width and height
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newMobile = window.innerWidth < 768;
        chart.applyOptions({
          width: entry.contentRect.width,
          height: newMobile ? 250 : 400,
        });
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      areaSeriesRef.current = null;
      lineSeriesRef.current = null;
    };
  }, []);

  // Update area data (close prices) when candles change
  useEffect(() => {
    if (!areaSeriesRef.current || candles.length === 0) return;

    const data: AreaData<UTCTimestamp>[] = candles.map((c) => ({
      time: c.time as UTCTimestamp,
      value: c.close,
    }));

    areaSeriesRef.current.setData(data);
    // Scroll to the latest candle so the chart doesn't appear shifted right on load/navigation
    chartRef.current?.timeScale().scrollToRealTime();
  }, [candles]);

  // Update 10-min high line — only span the last 10 minutes so it reflects the
  // rolling window the algorithm actually uses (not the full 3-hour chart history).
  useEffect(() => {
    if (!lineSeriesRef.current || candles.length === 0 || high10min <= 0) return;

    const lastTime = candles[candles.length - 1].time as UTCTimestamp;
    // 10 minutes = 600 seconds back from the latest candle
    const tenMinAgo = (lastTime - 600) as UTCTimestamp;

    const lineData: LineData<UTCTimestamp>[] = [
      { time: tenMinAgo, value: high10min },
      { time: lastTime, value: high10min },
    ];

    lineSeriesRef.current.setData(lineData);
  }, [high10min, candles]);

  // Entry price lines for open trades
  useEffect(() => {
    if (!areaSeriesRef.current) return;
    trades.forEach((trade) => {
      if (trade.status === 'OPEN') {
        areaSeriesRef.current!.createPriceLine({
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
    <div className="rounded-xl border border-[#1E2A3D] bg-[#0A0F1C] p-2 md:p-4">
      <div className="flex items-center justify-between mb-2 md:mb-3">
        <div>
          <h2 className="text-sm font-semibold text-white">BTC / USDT</h2>
          {candles.length > 0 && (
            <p className="text-xs text-[#94a3b8] mt-0.5">
              {new Date(candles[candles.length - 1].time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs text-[#94a3b8]">
          {high10min > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 border-t border-dashed border-[#94a3b8]/50" />
              <span className="hidden sm:inline">10m High</span>
              <span className="text-[#e2e8f0] font-medium">${high10min.toLocaleString()}</span>
            </span>
          )}
        </div>
      </div>
      <div ref={containerRef} className="w-full" />
    </div>
  );
}
