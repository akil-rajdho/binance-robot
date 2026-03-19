# Bitcoin Robot — Algorithm & Order Lifecycle

## Overview

The bot trades BTC_PERP on WhiteBit exchange using a short-selling strategy. It monitors price action, places limit sell orders when conditions are met, and manages take-profit (TP) and stop-loss (SL) orders for open positions.

## State Machine

The bot operates as a 3-state machine:

```
IDLE → ORDER_PLACED → POSITION_OPEN → IDLE
```

### State: IDLE
- Monitors BTC price via WebSocket feed
- Evaluates 7 entry conditions (see Entry Conditions below)
- When all conditions pass: places a short limit sell order → transitions to ORDER_PLACED

### State: ORDER_PLACED
- A limit sell order is active on WhiteBit
- Polls every 5 seconds to check if the order was filled
- Cancel timer: after `orderCancelMinutes` (default 10), cancels the order → back to IDLE
- If filled: places TP and SL orders → transitions to POSITION_OPEN
- If cancelled externally: marks as CANCELLED → back to IDLE

### State: POSITION_OPEN
- A short position is open with TP and SL orders on WhiteBit
- Polls every 5 seconds to check if TP or SL was filled
- **If TP fills**: cancel SL, record profit, back to IDLE
- **If SL fills**: cancel TP, record loss, back to IDLE
- **Profit tightening**: if position profitable >1 minute, tighten TP to currentPrice+$15

---

## Section 1: Open Position Management

### 1.1 — TP/SL Placement & Tightening

When a position is opened (either by the bot or adopted from WhiteBit):

1. Place **Take Profit** — limit BUY order below current price
   - For bot-created: `entryPrice - tpDistance` (default $70)
   - For adopted positions in profit: `currentPrice - tpDistance`
2. Place **Stop Loss** — stop-limit BUY order above entry
   - Price: `entryPrice + slDistance` (default $150)
   - Limit: SL price + $10 (slippage buffer)
3. If position is profitable for >1 minute:
   - Cancel existing TP
   - Place tight TP at `currentPrice + $15`
   - SL remains as safety net

### 1.2 — Order Lifecycle & Cancellation

**Critical rule**: TP and SL are a pair. When one fills, the other MUST be cancelled.

The system maintains references:
- `activeTradeID` — DB trade record ID
- `activeOrderPrice` — entry price
- `tpOrderID` — WhiteBit TP order ID
- `slOrderID` — WhiteBit SL order ID

**On TP fill**:
1. Cancel SL order on WhiteBit
2. Record exit price and P&L in DB
3. Verify no residual orders/positions remain
4. Transition to IDLE

**On SL fill**:
1. Cancel TP order on WhiteBit
2. Record exit price and P&L in DB
3. Verify no residual orders/positions remain
4. Transition to IDLE

**Sync interval**: Every 5 seconds via `pollOrderStatus` ticker.

### 1.3 — Duplicate Prevention

- Never place a new entry order if state is not IDLE
- Never place TP/SL if they already exist (check order IDs)
- After TP fill: verify position is closed on WhiteBit, cancel any residual orders
- After SL fill: verify position is closed on WhiteBit, cancel any residual orders
- On bot enable: check for existing positions/orders before placing new ones (SyncOnEnable)

---

## Section 2: No Open Position (IDLE State)

### 2.1 — Entry Algorithm

The bot monitors BTC/USDT price and evaluates these conditions every tick:

#### Entry Conditions (evaluated in order)

| # | Condition | Config Key | Default |
|---|-----------|-----------|---------|
| 1 | Bot enabled | `bot_enabled` | false |
| 2 | Price below 10-min high | — | — |
| 3 | Min gap from high | `min_gap_pct` | 0.1% |
| 4 | Cancel cooldown elapsed | `cancel_cooldown_minutes` | 5 min |
| 5 | Impulse strength | `min_impulse_pct` | 0.2% |
| 6 | ATR volatility below max | `max_atr_usdt` | $300 |
| 7 | High confirmation timer | `high_confirm_seconds` | 5s |

When ALL conditions pass:
1. Calculate order price: `currentPrice + (currentPrice * entryOffsetPct)`
   - Minimum offset: `entryOffsetMin` (default $50)
2. Place short limit sell order at rounded price (0.1 step)
3. Start cancel timer for `orderCancelMinutes`
4. Save trade to DB as OPEN
5. Transition to ORDER_PLACED

### 2.2 — Order Fill Detection

While in ORDER_PLACED, every 5 seconds:
1. Check if order is in active orders list → still waiting
2. Check execution history → filled → place TP/SL → POSITION_OPEN
3. Not in either → cancelled externally → mark CANCELLED → IDLE

If cancel timer fires before fill:
1. Check if order was filled first (safeCancelOrder)
2. If filled: trigger fill flow (TP/SL placement)
3. If not filled: cancel on WhiteBit, mark CANCELLED, back to IDLE

---

## Configuration (Settings)

| Setting | Key | Default | Description |
|---------|-----|---------|-------------|
| Position Size | `position_size_usdt` | 550 | USDT per trade |
| Leverage | `leverage` | 1 | Leverage multiplier |
| Entry Offset % | `entry_offset_pct` | 0.2% | Offset above price for entry |
| Entry Offset Min | `entry_offset_min` | $50 | Minimum dollar offset |
| Entry Offset Step | `entry_offset_step` | $20 | Decrease on cancel |
| Order Cancel Minutes | `order_cancel_minutes` | 10 | Auto-cancel timer |
| TP Distance | `tp_distance` | $70 | Take profit distance |
| SL Distance | `sl_distance` | $150 | Stop loss distance |
| Min Gap % | `min_gap_pct` | 0.1% | Min gap from 10m high |
| Min Impulse % | `min_impulse_pct` | 0.2% | Min impulse strength |
| Max ATR | `max_atr_usdt` | $300 | Max ATR threshold |
| Cancel Cooldown | `cancel_cooldown_minutes` | 5 | Wait after cancel |
| High Confirm | `high_confirm_seconds` | 5 | High must persist |
| Daily Loss Limit | `daily_loss_limit_pct` | 5% | Circuit breaker |

---

## Position Adoption (SyncOnEnable)

When the bot is enabled (STOP → START), it checks for existing state:

1. **DB Recovery**: Check for OPEN trades in database, restore state
2. **Active Orders**: Check WhiteBit for active sell orders, adopt as ORDER_PLACED
3. **Open Positions**: Check WhiteBit for open short positions, adopt as POSITION_OPEN
   - Wait for price feed (up to 30s)
   - Place TP at `currentPrice - tpDistance`
   - Place SL at `entryPrice + slDistance`
   - Use actual position amount (not "0")

---

## Tech Stack

- **Backend**: Go (port 8080) — state machine, WhiteBit API, PostgreSQL, Redis, WebSocket
- **Frontend**: Next.js (port 3000) — real-time dashboard
- **Deploy**: Docker Compose on Hetzner CX22, Nginx reverse proxy
- **Exchange**: WhiteBit (BTC_PERP market, collateral trading)

## Key Files

- `backend/internal/algorithm/statemachine.go` — main bot logic
- `backend/internal/algorithm/pricewindow.go` — 10-min high tracking
- `backend/internal/orders/manager.go` — WhiteBit order management
- `backend/internal/whitebit/client.go` — WhiteBit API client
- `backend/internal/database/db.go` — PostgreSQL persistence
- `frontend/src/components/` — dashboard UI components

## WhiteBit API Notes

- Market: `BTC_PERP` (bot) / `BTC-PERP` (WhiteBit positions response)
- Price step: 0.1 (all prices must be rounded)
- Amount "0" = close entire position (works for bot-created, may fail for adopted)
- Conditional orders endpoint (`/api/v4/orders/conditional`) not available
- Cancel conditional: `/api/v4/order/conditional-cancel`
- Positions: `/api/v4/collateral-account/positions/open`
- Position side determined by amount sign (negative = short)
