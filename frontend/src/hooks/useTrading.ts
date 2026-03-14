'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  TradingState,
  WSMessage,
  AlgoState,
  Candle,
  Trade,
  PriceTick,
} from '../types/trading';

const WS_URL =
  process.env.NEXT_PUBLIC_BACKEND_WS || 'ws://localhost:8080/ws';
const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_API || 'http://localhost:8080/api';

const MAX_CANDLES = 200; // keep last 200 candles in memory

const initialState: TradingState = {
  connected: false,
  currentPrice: 0,
  priceChange24h: 0,
  algoState: null,
  candles: [],
  activeTrade: null,
  trades: [],
  todayPnl: 0,
  totalPnl: 0,
  winRate: 0,
};

// ── PnL helpers ────────────────────────────────────────────────────────────────

function isToday(isoString: string): boolean {
  const tradeDate = new Date(isoString).toDateString();
  const today = new Date().toDateString();
  return tradeDate === today;
}

function computePnlStats(trades: Trade[]): {
  todayPnl: number;
  totalPnl: number;
  winRate: number;
} {
  let todayPnl = 0;
  let totalPnl = 0;
  let wins = 0;
  let closedCount = 0;

  for (const trade of trades) {
    const closed =
      trade.status === 'TP_HIT' || trade.status === 'SL_HIT';
    if (!closed) continue;

    const pnl = trade.pnl ?? 0;
    totalPnl += pnl;
    closedCount++;

    if (trade.status === 'TP_HIT') wins++;

    if (isToday(trade.entryTime)) {
      todayPnl += pnl;
    }
  }

  const winRate = closedCount > 0 ? wins / closedCount : 0;
  return { todayPnl, totalPnl, winRate };
}

// ── Synthetic active trade ─────────────────────────────────────────────────────

function buildActiveTrade(algoState: AlgoState): Trade {
  return {
    id: algoState.activeOrderId,
    entryTime: new Date().toISOString(),
    entryPrice: algoState.activeOrderPrice,
    orderPrice: algoState.activeOrderPrice,
    tpPrice: algoState.tpPrice,
    slPrice: algoState.slPrice,
    status: 'OPEN',
    reasoning: '',
  };
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useTrading(token: string | null, onActivity?: () => void): TradingState & {
  startBot: () => Promise<void>;
  stopBot: () => Promise<void>;
  updateSettings: (settings: Record<string, string>) => Promise<void>;
  refetchTrades: () => Promise<void>;
} {
  const [state, setState] = useState<TradingState>(initialState);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  const tokenRef = useRef(token);

  // Keep tokenRef current so callbacks always use the latest token
  tokenRef.current = token;

  const authHeaders = useCallback((): Record<string, string> => {
    const t = tokenRef.current;
    return t ? { Authorization: `Bearer ${t}` } : {};
  }, []);

  // ── Fetch helpers ────────────────────────────────────────────────────────────

  const fetchTrades = useCallback(async () => {
    try {
      onActivity?.();
      const res = await fetch(`${API_URL}/trades`, {
        headers: authHeaders(),
      });
      if (!res.ok) return;
      const trades: Trade[] = await res.json();
      const { todayPnl, totalPnl, winRate } = computePnlStats(trades);
      setState((prev) => ({ ...prev, trades, todayPnl, totalPnl, winRate }));
    } catch {
      // network errors are non-fatal
    }
  }, [authHeaders, onActivity]);

  const fetchStatus = useCallback(async () => {
    try {
      onActivity?.();
      const res = await fetch(`${API_URL}/status`, {
        headers: authHeaders(),
      });
      if (!res.ok) return;
      const algoState: AlgoState = await res.json();
      const activeTrade =
        algoState.state === 'POSITION_OPEN'
          ? buildActiveTrade(algoState)
          : null;
      setState((prev) => ({
        ...prev,
        algoState,
        activeTrade,
        currentPrice: algoState.currentPrice > 0 ? algoState.currentPrice : prev.currentPrice,
      }));
    } catch {
      // network errors are non-fatal
    }
  }, [authHeaders, onActivity]);

  // ── WebSocket connection ─────────────────────────────────────────────────────

  const connect = useCallback(() => {
    if (unmountedRef.current) return;

    const t = tokenRef.current;
    const wsUrl = t ? `${WS_URL}?token=${encodeURIComponent(t)}` : WS_URL;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (unmountedRef.current) {
        ws.close();
        return;
      }
      setState((prev) => ({ ...prev, connected: true }));
      // Refresh data on every (re)connect in case events were missed while disconnected
      void fetchTrades();
      void fetchStatus();
    };

    ws.onmessage = (event: MessageEvent) => {
      if (unmountedRef.current) return;
      let msg: WSMessage;
      try {
        msg = JSON.parse(event.data as string) as WSMessage;
      } catch {
        return;
      }

      switch (msg.type) {
        case 'price_tick': {
          const tick = msg.data as PriceTick;
          setState((prev) => ({ ...prev, currentPrice: tick.price }));
          break;
        }

        case 'candle': {
          const candle = msg.data as Candle;
          setState((prev) => {
            // Replace candle with same timestamp or append
            const existing = prev.candles.findIndex(
              (c) => c.time === candle.time,
            );
            let updated: Candle[];
            if (existing >= 0) {
              updated = [...prev.candles];
              updated[existing] = candle;
            } else {
              updated = [...prev.candles, candle];
            }
            // Sort by time and cap at MAX_CANDLES
            updated.sort((a, b) => a.time - b.time);
            if (updated.length > MAX_CANDLES) {
              updated = updated.slice(updated.length - MAX_CANDLES);
            }
            return { ...prev, candles: updated };
          });
          break;
        }

        case 'algo_state': {
          const algoState = msg.data as AlgoState;
          const activeTrade =
            algoState.state === 'POSITION_OPEN'
              ? buildActiveTrade(algoState)
              : null;
          setState((prev) => ({
            ...prev,
            algoState,
            activeTrade,
            currentPrice: algoState.currentPrice > 0 ? algoState.currentPrice : prev.currentPrice,
          }));
          break;
        }

        // order_update / pnl_update: trigger a trades refresh
        case 'order_update':
        case 'pnl_update': {
          void fetchTrades();
          break;
        }

        default:
          break;
      }
    };

    const scheduleReconnect = () => {
      if (unmountedRef.current) return;
      setState((prev) => ({ ...prev, connected: false }));
      reconnectTimer.current = setTimeout(() => {
        if (!unmountedRef.current) connect();
      }, 2000);
    };

    ws.onclose = scheduleReconnect;
    ws.onerror = scheduleReconnect;
  }, [fetchTrades, fetchStatus]);

  // ── Mount / unmount ──────────────────────────────────────────────────────────

  useEffect(() => {
    unmountedRef.current = false;

    // Initial data fetch
    void fetchTrades();
    void fetchStatus();

    // WebSocket
    connect();

    return () => {
      unmountedRef.current = true;
      if (reconnectTimer.current !== null) {
        clearTimeout(reconnectTimer.current);
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Actions ──────────────────────────────────────────────────────────────────

  const startBot = useCallback(async () => {
    onActivity?.();
    await fetch(`${API_URL}/bot/start`, {
      method: 'POST',
      headers: authHeaders(),
    });
  }, [authHeaders, onActivity]);

  const stopBot = useCallback(async () => {
    onActivity?.();
    await fetch(`${API_URL}/bot/stop`, {
      method: 'POST',
      headers: authHeaders(),
    });
  }, [authHeaders, onActivity]);

  const updateSettings = useCallback(
    async (settings: Record<string, string>) => {
      onActivity?.();
      await fetch(`${API_URL}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(settings),
      });
    },
    [authHeaders, onActivity],
  );

  const refetchTrades = useCallback(async () => {
    await fetchTrades();
  }, [fetchTrades]);

  return {
    ...state,
    startBot,
    stopBot,
    updateSettings,
    refetchTrades,
  };
}
