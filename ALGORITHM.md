# Bitcoin Robot — Algorithm & Order Lifecycle

## Overview

The bot trades BTC_PERP on WhiteBit exchange using a short-selling strategy. It monitors price action, places limit sell orders when conditions are met, and manages take-profit (TP) and stop-loss (SL) orders for open positions.

## State Machine

```
IDLE → ORDER_PLACED → POSITION_OPEN → IDLE
```

---

## SECTION 1: Open Position Management

### 1.1 — TP/SL Placement & Tightening

When a position is opened (either by the bot or adopted from WhiteBit):

1. Place **Take Profit** — limit BUY order at TP price
   - For bot-created: `entryPrice - tpDistance` (default $70)
   - For adopted positions in profit: `currentPrice - tpDistance`
   - Amount: actual position size (e.g., "0.007"), NOT "0"
2. Place **Stop Loss** — stop-limit BUY order above entry
   - Activation price: `entryPrice + slDistance` (default $150)
   - Limit: SL price + $10 (slippage buffer)
   - Amount: actual position size
3. **TP Tightening**: if TP not filled within reasonable time (position profitable >1 min):
   - Cancel existing TP on WhiteBit
   - Place new TP closer to current price: `currentPrice + $15`
   - Only tighten once per position (`tpTightened` flag)
   - SL remains active as safety net

### 1.2 — Order Lifecycle & Linked References

**Critical rule**: TP, SL, and position are linked. When one side fills, the other MUST be cancelled.

The system maintains these linked references:

| Field | Description |
|-------|-------------|
| `activeTradeID` | DB trade record ID |
| `activeOrderPrice` | Entry price of the position |
| `tpOrderID` | WhiteBit TP limit buy order ID |
| `slOrderID` | WhiteBit SL stop-limit buy order ID |

**Sync interval**: Every **15 seconds** via `pollOrderStatus` ticker.

**On TP fill**:
1. Cancel SL order on WhiteBit (conditional cancel)
2. Record exit price and P&L in DB
3. Verify position is closed on WhiteBit (no residual short positions)
4. Verify no residual long positions were created (TP buy can create a long if amount mismatches)
5. Cancel any remaining open orders for the market
6. Transition to IDLE

**On SL fill**:
1. Cancel TP order on WhiteBit (regular limit cancel)
2. Record exit price and P&L in DB
3. Verify position is closed on WhiteBit (no residual short positions)
4. Cancel any remaining open orders for the market
5. Transition to IDLE

### 1.3 — Duplicate & Residual Prevention

**Preventing duplicate orders**:
- Never place TP/SL if order IDs already exist in state
- Before adoption: check DB for existing OPEN trades first
- `tpTightened` flag prevents placing tight TP more than once

**Preventing residual positions/orders after close**:
- After TP/SL fill, call `GetOpenPositions()` to verify no positions remain
- If a LONG position is found after TP fill → log WARNING (user must close manually)
- After close, call `GetActiveCollateralLimitOrders()` to cancel any leftover orders
- Missing orders (not in active, not in execution history) → treat as filled, don't wait forever

**On bot enable (SyncOnEnable)**:
- Clean up orphaned OPEN trades (no order IDs) → mark CANCELLED
- Check for existing OPEN trades in DB before creating new ones
- Warn about unmanaged LONG positions

---

## SECTION 2: No Open Position (IDLE State)

### 2.1 — Entry Algorithm

The bot monitors BTC/USDT price via WebSocket and evaluates entry conditions every tick:

#### Entry Conditions (evaluated in order, first failure blocks)

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
1. Calculate order price: `roundPrice(currentPrice + currentPrice * entryOffsetPct)`
   - Minimum offset: `entryOffsetMin` (default $50)
   - All prices rounded to 0.1 step (WhiteBit requirement)
2. Place short limit sell order on WhiteBit
3. Start cancel timer for `orderCancelMinutes` (default 10)
4. Save trade to DB as OPEN
5. Transition to ORDER_PLACED

### 2.2 — Order Fill Detection (ORDER_PLACED state)

Every **15 seconds** (`pollOrderStatus`):
1. Check if order is in active orders list → still waiting
2. Check execution history → filled → get fill price → place TP/SL → POSITION_OPEN
3. Not in either → order was cancelled/expired → mark CANCELLED → IDLE

**Cancel timer** fires after `orderCancelMinutes`:
1. `safeCancelOrder`: try CancelOrder on WhiteBit
2. If cancel fails: check if order was filled (`IsOrderFilled`)
3. If filled: trigger fill flow (place TP/SL, transition to POSITION_OPEN)
4. If not filled: mark CANCELLED, back to IDLE

---

## Position Adoption (SyncOnEnable)

When the bot is enabled (STOP → START):

1. **Clean orphans**: Mark OPEN trades with no order IDs as CANCELLED
2. **DB Recovery**: Check for OPEN trades with TP/SL IDs, restore POSITION_OPEN state
3. **Active Orders**: Check WhiteBit for active sell orders → adopt as ORDER_PLACED
4. **Open Positions**: Check WhiteBit for open short positions → adopt as POSITION_OPEN
   - Wait for price feed (up to 30s)
   - Check DB for existing OPEN trade first (prevent duplicates)
   - Place TP at `currentPrice - tpDistance` (below market)
   - Place SL at `entryPrice + slDistance` (above entry)
   - Use actual position amount (not "0")
5. **Warn about longs**: Log WARNING if unmanaged LONG positions exist

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

## Admin Commands

**Delete all trade history and start fresh:**
```bash
docker compose exec postgres psql -U bitcoin -d bitcoinrobot -c "DELETE FROM trades;"
docker compose restart backend
```

**Check open positions on WhiteBit:**
```bash
docker compose logs backend --tail=50 | grep -i "position"
```

**Check order status:**
```bash
docker compose logs backend --tail=50 | grep -i "TP\|SL\|filled\|cancel\|error"
```

**Force redeploy:**
```bash
cd /root/binance-robot && git pull && docker compose up --build -d
```

---

## Tech Stack

- **Backend**: Go (port 8080) — state machine, WhiteBit API, PostgreSQL, Redis, WebSocket
- **Frontend**: Next.js (port 3000) — real-time dashboard
- **Deploy**: Docker Compose on Hetzner CX22 (Ubuntu), Nginx reverse proxy
- **Exchange**: WhiteBit (BTC_PERP market, collateral trading)
- **Dashboard**: akil.cooleta.al

## Key Files

| File | Purpose |
|------|---------|
| `backend/internal/algorithm/statemachine.go` | Main bot logic, state machine |
| `backend/internal/algorithm/pricewindow.go` | 10-min high tracking |
| `backend/internal/orders/manager.go` | WhiteBit order management |
| `backend/internal/whitebit/client.go` | WhiteBit API client |
| `backend/internal/database/db.go` | PostgreSQL persistence |
| `frontend/src/components/` | Dashboard UI components |
| `ALGORITHM.md` | This file — algorithm documentation |

## WhiteBit API Notes

- Market: `BTC_PERP` (bot internal) / `BTC-PERP` (positions response) — normalized in code
- Price step: **0.1** (all prices must be rounded via `roundPrice()`)
- Amount `"0"` = close entire position (works for bot-created orders, fails for adopted)
- Use actual BTC amount for adopted positions (e.g., `"0.007"`)
- `/api/v4/orders/conditional` — NOT available (404), don't use
- `/api/v4/order/conditional-cancel` — works for cancelling SL stop-limits
- `/api/v4/collateral-account/positions/open` — returns open positions
- Position side: determined by `amount` sign (negative = short, positive = long)
- TP buy limit above market → fills immediately (use price BELOW market for shorts)
