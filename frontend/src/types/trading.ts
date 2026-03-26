// Bot states
export type BotState = 'IDLE' | 'ORDER_PLACED' | 'POSITION_OPEN';

// Algorithm state (matches Go AlgoState struct)
export interface AlgoState {
  state: BotState;
  currentPrice: number;
  high10min: number;
  conditionMet: boolean;
  nextOrderPrice: number;
  entryOffset: number; // current offset above price used for order placement
  activeOrderId: number;
  activeOrderPrice: number;
  tpPrice: number;
  slPrice: number;
  cancelAt: string; // ISO datetime string
  botEnabled: boolean;
  filterStatus?: string; // human-readable description of blocking filter (empty if all pass)
  currentAtr?: number;  // average true range of last candle buffer (0 or absent if insufficient data)
  positionSizeUsdt?: number; // configured position size in USDT
  leverage?: number;         // configured leverage multiplier

  // Filter thresholds (from config)
  minGapPct?: number;
  minImpulsePct?: number;
  maxAtrUsdt?: number;
  cancelCooldownMins?: number;
  highConfirmSeconds?: number;

  // Current filter values (live)
  currentGap?: number;
  currentGapPct?: number;
  requiredGap?: number;
  currentImpulse?: number;
  cooldownRemaining?: number;
  highConfirmRemaining?: number;

  // Last API error
  lastError?: string;
  lastErrorAt?: string; // ISO datetime
}

// Candlestick data
export interface Candle {
  time: number; // Unix timestamp (seconds)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Trade from order history
export interface Trade {
  id: number;
  entryTime: string;
  entryPrice: number;
  orderPrice: number;
  tpPrice: number;
  slPrice: number;
  exitTime?: string;
  exitPrice?: number;
  pnl?: number;
  status: 'OPEN' | 'TP_HIT' | 'SL_HIT' | 'CANCELLED';
  cancelPrice?: number; // BTC price when order was cancelled (0 or absent if not cancelled)
  reasoning: string; // raw JSON string
}

// Reasoning snapshot (parsed from Trade.reasoning)
export interface ReasoningSnapshot {
  timestamp: string;
  current_price: number;
  high_10min: number;
  difference: number;
  condition_met: boolean;
  order_price: number;
  tp_price: number;
  sl_price: number;
  position_size_usdt: number;
  leverage: number;
}

// WebSocket message from backend
export interface WSMessage {
  type: 'price_tick' | 'candle' | 'algo_state' | 'order_update' | 'pnl_update' | 'api_error';
  data: unknown;
}

// Price tick data
export interface PriceTick {
  price: number;
}

// Trading state for the entire dashboard
export interface TradingState {
  connected: boolean;
  currentPrice: number;
  priceChange24h: number; // percentage
  algoState: AlgoState | null;
  candles: Candle[];
  activeTrade: Trade | null;
  trades: Trade[];
  todayPnl: number;
  totalPnl: number;
  winRate: number; // 0-1
}

// Settings from /api/config
export interface BotSettings {
  position_size_usdt: string;
  leverage: string;
  daily_loss_limit_pct: string;
  bot_enabled: string;
  starting_balance: string;
  entry_offset_initial: string;
  entry_offset_step: string;
  entry_offset_min: string;
  order_cancel_minutes: string;
  tp_distance: string;
  sl_distance: string;
  min_gap_pct: string;
  cancel_cooldown_minutes: string;
  entry_offset_pct: string;
  min_impulse_pct: string;
  max_atr_usdt: string;
}
