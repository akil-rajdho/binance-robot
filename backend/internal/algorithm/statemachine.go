package algorithm

import (
	"context"
	"fmt"
	"log"
	"math"
	"sync"
	"time"
)

// roundPrice rounds a price to the nearest 0.1 (WhiteBit BTC_PERP min price step).
func roundPrice(p float64) float64 {
	return math.Round(p*10) / 10
}

type BotState int

const (
	StateIdle        BotState = iota
	StateOrderPlaced          // 1
	StatePositionOpen         // 2
)

func (s BotState) String() string {
	switch s {
	case StateIdle:
		return "IDLE"
	case StateOrderPlaced:
		return "ORDER_PLACED"
	case StatePositionOpen:
		return "POSITION_OPEN"
	default:
		return fmt.Sprintf("UNKNOWN(%d)", int(s))
	}
}

func (s BotState) MarshalJSON() ([]byte, error) {
	return []byte(`"` + s.String() + `"`), nil
}

// AlgoState is a snapshot of the algorithm's current thinking — broadcast to dashboard.
type AlgoState struct {
	State            BotState  `json:"state"`
	CurrentPrice     float64   `json:"currentPrice"`
	High10min        float64   `json:"high10min"`
	ConditionMet     bool      `json:"conditionMet"`    // currentPrice < high10min
	NextOrderPrice   float64   `json:"nextOrderPrice"`  // currentPrice + 150 (if condition met)
	ActiveOrderID    int64     `json:"activeOrderId"`   // 0 if none
	ActiveOrderPrice float64   `json:"activeOrderPrice"`
	TPPrice          float64   `json:"tpPrice"`
	SLPrice          float64   `json:"slPrice"`
	CancelAt         time.Time `json:"cancelAt"` // when the open order will be cancelled
	BotEnabled       bool      `json:"botEnabled"`
	EntryOffset      float64   `json:"entryOffset"` // current entry offset above price for order placement
	FilterStatus     string    `json:"filterStatus"` // human-readable reason why entry is currently blocked (empty = ready to enter)
	CurrentATR       float64   `json:"currentAtr"`   // average true range of last ATR candle buffer (0 if insufficient data)
	PositionSizeUsdt float64   `json:"positionSizeUsdt"` // configured position size in USDT
	Leverage         int       `json:"leverage"`         // configured leverage multiplier

	// Filter thresholds (from config)
	MinGapPct          float64 `json:"minGapPct"`          // configured min gap percentage
	MinImpulsePct      float64 `json:"minImpulsePct"`      // configured min impulse percentage
	MaxATRUsdt         float64 `json:"maxAtrUsdt"`         // configured max ATR threshold
	CancelCooldownMins float64 `json:"cancelCooldownMins"` // configured cooldown minutes
	HighConfirmSeconds int     `json:"highConfirmSeconds"` // configured high confirmation seconds

	// Current filter values (live)
	CurrentGap           float64 `json:"currentGap"`           // current price gap from high (high - price)
	CurrentGapPct        float64 `json:"currentGapPct"`        // current gap as percentage of high
	RequiredGap          float64 `json:"requiredGap"`          // minGapPct * high (dollar amount needed)
	CurrentImpulse       float64 `json:"currentImpulse"`       // current impulse value (high - windowOpen) / windowOpen
	CooldownRemaining    float64 `json:"cooldownRemaining"`    // seconds remaining in cooldown (0 if none)
	HighConfirmRemaining float64 `json:"highConfirmRemaining"` // seconds remaining for high confirmation (0 if confirmed)

	// Last error from WhiteBit API (empty if no recent error)
	LastError   string    `json:"lastError,omitempty"`
	LastErrorAt time.Time `json:"lastErrorAt,omitempty"`
}

// ReasoningSnapshot is stored in DB when an order is placed.
type ReasoningSnapshot struct {
	Timestamp        time.Time `json:"timestamp"`
	CurrentPrice     float64   `json:"current_price"`
	High10min        float64   `json:"high_10min"`
	Difference       float64   `json:"difference"`
	ConditionMet     bool      `json:"condition_met"`
	OrderPrice       float64   `json:"order_price"`
	TPPrice          float64   `json:"tp_price"`
	SLPrice          float64   `json:"sl_price"`
	PositionSizeUSDT float64   `json:"position_size_usdt"`
	Leverage         int       `json:"leverage"`
}

// atrCandle holds the OHLC fields needed for ATR computation.
type atrCandle struct {
	High  float64
	Low   float64
	Close float64
}

// ActiveOrder represents an active order on the exchange for the current market.
type ActiveOrder struct {
	OrderID int64
	Price   float64
	Side    string // "buy" or "sell"
}

// OpenPosition represents an open position detected on the exchange.
type OpenPosition struct {
	Market    string
	Side      string  // "short" or "long"
	Amount    float64 // BTC amount
	BasePrice float64 // average entry price
}

// OrderManager is the interface the state machine calls to place/cancel orders.
type OrderManager interface {
	PlaceShortLimitOrder(ctx context.Context, price float64, amount string) (orderID int64, err error)
	CancelOrder(ctx context.Context, orderID int64) error
	PlaceTakeProfit(ctx context.Context, positionID int64, price float64, amount string) (orderID int64, err error)
	PlaceStopLoss(ctx context.Context, positionID int64, price float64, amount string) (orderID int64, err error)
	// IsOrderFilled returns (filled, cancelled, fillPrice, error).
	// filled=true: order was executed. cancelled=true: order is gone but not executed.
	// Both false means the order is still active.
	IsOrderFilled(ctx context.Context, orderID int64) (filled bool, cancelled bool, fillPrice float64, err error)
	IsOrderFilled2(ctx context.Context, orderID int64) (filled bool, err error) // for TP/SL
	// Deprecated: PlaceMarketClose uses a market order which should NOT be used for TP/SL.
	// Kept for interface compatibility but not called by the state machine.
	PlaceMarketClose(ctx context.Context) (orderID int64, err error)
	// GetActiveShortOrders returns all active sell orders for the market.
	GetActiveShortOrders(ctx context.Context) ([]ActiveOrder, error)
	// GetOpenPositions returns open short positions on the exchange.
	GetOpenPositions(ctx context.Context) ([]OpenPosition, error)
}

// OpenTrade holds the fields the state machine needs to recover an in-flight trade
// after a server restart. It is returned by DBStore.GetOpenTrades.
type OpenTrade struct {
	ID         int64
	OrderPrice float64
	EntryPrice float64
	TPPrice    float64
	SLPrice    float64
	OrderID    int64
	TPOrderID  int64
	SLOrderID  int64
	Status     string
}

// DBStore is the interface for persisting trades.
type DBStore interface {
	// SaveReasoningSnapshot inserts a new OPEN trade row and returns its ID.
	// orderID is the WhiteBit entry order ID to persist alongside the snapshot.
	SaveReasoningSnapshot(snapshot ReasoningSnapshot, orderID int64) (tradeID int64, err error)
	// UpdateTrade closes a trade by recording exit price, pnl, and final status.
	UpdateTrade(tradeID int64, exitPrice float64, pnl float64, status string) error
	// UpdateCancelPrice records the BTC spot price at the time the order was cancelled.
	UpdateCancelPrice(tradeID int64, price float64) error
	// UpdateEntryPrice records the actual fill price once the entry order is confirmed.
	UpdateEntryPrice(tradeID int64, entryPrice float64) error
	// UpdateOrderIDs persists TP and SL order IDs once a position is open.
	UpdateOrderIDs(tradeID int64, tpOrderID, slOrderID int64) error
	// GetOpenTrades returns all trades with status='OPEN', ordered by id DESC.
	GetOpenTrades() ([]OpenTrade, error)
	GetSetting(key string) (string, error)
	UpdateTodayPnL(pnl float64) (todayPnL float64, err error)
	GetTodayPnL() (float64, error)
	GetStartingBalance() (float64, error)
}

type StateMachine struct {
	mu           sync.Mutex
	state        BotState
	priceWindow  *PriceWindow
	candleWindow *PriceWindow
	orderMgr     OrderManager
	db          DBStore

	// current order tracking
	activeOrderID    int64
	activeOrderPrice float64
	activeTradeID    int64
	tpOrderID        int64
	slOrderID        int64
	cancelTimer      *time.Timer
	cancelAt         time.Time

	// cached current price for GetAlgoState
	currentPrice float64
	tpPrice      float64
	slPrice      float64

	// position tracking
	positionAmount string // actual BTC amount of the position (e.g., "0.007")

	// profit duration tracking
	profitStartTime time.Time // when the position first became profitable
	inProfit        bool      // whether the position is currently in profit
	tpTightened     bool      // true after forceClosePosition tightened TP; prevents re-tightening

	// config (read from DB)
	positionSizeUSDT  float64
	leverage          int
	dailyLossLimitPct float64
	botEnabled        bool

	entryOffsetInitial float64 // configurable starting offset (default 150)
	entryOffsetStep    float64 // decrease by this on cancel (default 20)
	entryOffsetMin     float64 // floor (default 50)
	orderCancelMinutes float64 // cancel after N minutes (default 10)
	tpDistance         float64 // TP = entry - tpDistance (default 75)
	slDistance         float64 // SL = entry + slDistance (default 150)

	minGapPct          float64   // min (high-price)/high before entry (default 0.001 = 0.1%)
	cancelCooldownMins float64   // minutes to wait after cancel before re-entering (default 5)
	entryOffsetPct     float64   // percentage-based initial entry offset (default 0.002 = 0.2%)
	minImpulsePct      float64   // min (high-windowOpen)/windowOpen impulse filter (default 0.002)
	lastCancelAt       time.Time // timestamp of last order cancel

	maxATRUsdt   float64 // ATR halt threshold: skip entry if 14-candle ATR > this (default 300)

	highConfirmSeconds int // seconds a new 10m high must persist before placing an order (0 = disabled)

	// ATR candle buffer (rolling 15 candles: 14 periods need 15 candle highs/lows/closes)
	atrCandles   []atrCandle // ring of last 15 candles for ATR computation

	// high confirmation tracking
	confirmedHigh      float64   // last high value seen; used for highConfirmSeconds timer
	highFirstSeen      time.Time // when confirmedHigh was last set
	lastFilterLogAt    time.Time // throttle for filter-block log messages (once per minute)

	entryOffset          float64   // current offset for entry price (dynamic runtime state)
	lastActiveOrderCheck time.Time // throttle: at most one active-order guard check per 30s

	// error tracking for dashboard display
	lastError   string
	lastErrorAt time.Time

	// callbacks
	OnStateChange func(AlgoState) // broadcast to dashboard

	ctx    context.Context
	cancel context.CancelFunc
}

func NewStateMachine(priceWindow *PriceWindow, orderMgr OrderManager, db DBStore) *StateMachine {
	ctx, cancel := context.WithCancel(context.Background())
	return &StateMachine{
		state:              StateIdle,
		priceWindow:        priceWindow,
		orderMgr:           orderMgr,
		db:                 db,
		ctx:                ctx,
		cancel:             cancel,
		entryOffsetInitial: 150.0,
		entryOffsetStep:    20.0,
		entryOffsetMin:     50.0,
		orderCancelMinutes: 15.0,
		tpDistance:         70.0,
		slDistance:         150.0,
		entryOffset:        150.0,
		minGapPct:          0.001,
		cancelCooldownMins: 5.0,
		entryOffsetPct:     0.002,
		minImpulsePct:      0.002,
		candleWindow:       NewPriceWindow(10 * time.Minute),
		maxATRUsdt:         300.0,
		atrCandles:         make([]atrCandle, 0, 15),
	}
}

// recordError stores an API error for display on the dashboard. Must be called with sm.mu held.
func (sm *StateMachine) recordError(err error) {
	sm.lastError = err.Error()
	sm.lastErrorAt = time.Now()
	log.Printf("[StateMachine] API error recorded: %v", err)
}

// clearError clears the last error. Must be called with sm.mu held.
func (sm *StateMachine) clearError() {
	sm.lastError = ""
	sm.lastErrorAt = time.Time{}
}

// OnCandle is called by the price feed for each candle update.
// It feeds the candle high into the candle window and updates the ATR buffer.
func (sm *StateMachine) OnCandle(high, low, close_ float64, ts time.Time) {
	// Update candle window (has its own lock, no sm.mu needed)
	sm.candleWindow.AddAt(high, ts)

	// Update ATR buffer under sm.mu
	sm.mu.Lock()
	sm.atrCandles = append(sm.atrCandles, atrCandle{High: high, Low: low, Close: close_})
	if len(sm.atrCandles) > 15 {
		sm.atrCandles = sm.atrCandles[len(sm.atrCandles)-15:]
	}
	sm.mu.Unlock()
}

// Start begins the polling loop that syncs order/position status with WhiteBit.
// Poll interval is 30 s — safety fallback; WebSocket events are the primary
// fill detection path.
func (sm *StateMachine) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(30 * time.Second) // safety fallback; WebSocket events are primary
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-sm.ctx.Done():
				return
			case <-ticker.C:
				sm.pollOrderStatus(ctx)
			}
		}
	}()
}

// pollOrderStatus checks order/position status and transitions state accordingly.
func (sm *StateMachine) pollOrderStatus(ctx context.Context) {
	sm.mu.Lock()
	state := sm.state
	botEnabled := sm.botEnabled
	sm.mu.Unlock()

	switch state {
	case StateIdle:
		// Check for untracked positions on WhiteBit (e.g., filled while bot was restarting)
		if botEnabled {
			sm.checkForUntrackedPositions(ctx)
		}
	case StateOrderPlaced:
		sm.checkOrderFilled(ctx)
	case StatePositionOpen:
		sm.checkPositionClosed(ctx)
	}
}

// checkForUntrackedPositions detects open positions on WhiteBit that the bot isn't tracking.
// Called during IDLE polls. If a short position exists, adopts it with TP/SL.
func (sm *StateMachine) checkForUntrackedPositions(ctx context.Context) {
	positions, err := sm.orderMgr.GetOpenPositions(ctx)
	if err != nil {
		sm.mu.Lock()
		sm.recordError(err)
		sm.mu.Unlock()
		return // non-fatal, will retry next poll
	}

	var shortPos *OpenPosition
	for i, p := range positions {
		if p.Side == "short" {
			shortPos = &positions[i]
			break
		}
		if p.Side == "long" {
			log.Printf("[StateMachine] WARNING: unmanaged LONG position found: %.3f BTC @ $%.2f", p.Amount, p.BasePrice)
		}
	}

	if shortPos == nil {
		return
	}

	sm.mu.Lock()
	if sm.state != StateIdle || !sm.botEnabled {
		sm.mu.Unlock()
		return
	}
	price := sm.currentPrice
	tpDist := sm.tpDistance
	slDist := sm.slDistance
	posSize := sm.positionSizeUSDT
	leverage := sm.leverage
	sm.mu.Unlock()

	if price <= 0 {
		return // no price data yet
	}

	// Check DB for existing OPEN trades to avoid duplicates
	existingTrades, _ := sm.db.GetOpenTrades()
	if len(existingTrades) > 0 {
		// Already have a tracked trade — try recovery instead
		if err := sm.RecoverOpenTrades(ctx); err != nil {
			log.Printf("[StateMachine] checkForUntrackedPositions: recovery error: %v", err)
		}
		return
	}

	log.Printf("[StateMachine] Detected untracked short position: %.3f BTC @ $%.2f — adopting", shortPos.Amount, shortPos.BasePrice)

	entryPrice := shortPos.BasePrice
	tpPrice := roundPrice(entryPrice - tpDist)   // TP below entry (profit for short)
	slPrice := roundPrice(entryPrice + slDist)    // SL above entry (loss for short)
	posAmount := fmt.Sprintf("%.3f", shortPos.Amount)

	snapshot := ReasoningSnapshot{
		Timestamp:        time.Now(),
		CurrentPrice:     price,
		High10min:        0,
		Difference:       0,
		ConditionMet:     true,
		OrderPrice:       entryPrice,
		TPPrice:          tpPrice,
		SLPrice:          slPrice,
		PositionSizeUSDT: posSize,
		Leverage:         leverage,
	}
	tradeID, dbErr := sm.db.SaveReasoningSnapshot(snapshot, 0)
	if dbErr != nil {
		log.Printf("[StateMachine] checkForUntrackedPositions: SaveReasoningSnapshot error: %v", dbErr)
		return
	}

	tpOrderID, tpErr := sm.orderMgr.PlaceTakeProfit(ctx, 0, tpPrice, posAmount)
	if tpErr != nil {
		log.Printf("[StateMachine] checkForUntrackedPositions: PlaceTakeProfit error: %v", tpErr)
		sm.db.UpdateTrade(tradeID, 0, 0, "CANCELLED")
		return
	}
	slOrderID, slErr := sm.orderMgr.PlaceStopLoss(ctx, 0, slPrice, posAmount)
	if slErr != nil {
		log.Printf("[StateMachine] checkForUntrackedPositions: PlaceStopLoss error: %v", slErr)
		// Cancel the TP we just placed
		sm.orderMgr.CancelOrder(ctx, tpOrderID)
		sm.db.UpdateTrade(tradeID, 0, 0, "CANCELLED")
		return
	}

	sm.db.UpdateOrderIDs(tradeID, tpOrderID, slOrderID)
	sm.db.UpdateEntryPrice(tradeID, entryPrice)

	sm.mu.Lock()
	if sm.state != StateIdle {
		sm.mu.Unlock()
		return
	}
	sm.state = StatePositionOpen
	sm.activeOrderID = 0
	sm.activeOrderPrice = entryPrice
	sm.activeTradeID = tradeID
	sm.tpOrderID = tpOrderID
	sm.slOrderID = slOrderID
	sm.tpPrice = tpPrice
	sm.slPrice = slPrice
	sm.positionAmount = posAmount
	algoState := sm.buildAlgoState()
	sm.mu.Unlock()

	log.Printf("[StateMachine] Adopted position @ $%.2f → POSITION_OPEN (TP=$%.1f, SL=$%.1f)", entryPrice, tpPrice, slPrice)
	sm.notifyStateChange(algoState)
}

func (sm *StateMachine) checkOrderFilled(ctx context.Context) {
	sm.mu.Lock()
	if sm.state != StateOrderPlaced {
		sm.mu.Unlock()
		return
	}
	orderID := sm.activeOrderID
	orderPrice := sm.activeOrderPrice
	tradeID := sm.activeTradeID
	sm.mu.Unlock()

	filled, cancelled, fillPrice, err := sm.orderMgr.IsOrderFilled(ctx, orderID)
	if err != nil {
		log.Printf("[StateMachine] IsOrderFilled error for order %d: %v", orderID, err)
		sm.mu.Lock()
		sm.recordError(err)
		sm.mu.Unlock()
		return
	}

	if cancelled {
		// Order was cancelled externally on WhiteBit — mark as CANCELLED in DB and return to IDLE.
		log.Printf("[StateMachine] Order %d was cancelled on WhiteBit externally → IDLE", orderID)
		sm.mu.Lock()
		cancelAtPrice := sm.currentPrice
		sm.mu.Unlock()
		if dbErr := sm.db.UpdateTrade(tradeID, 0, 0, "CANCELLED"); dbErr != nil {
			log.Printf("[StateMachine] UpdateTrade(CANCELLED) error: %v", dbErr)
		}
		if dbErr := sm.db.UpdateCancelPrice(tradeID, cancelAtPrice); dbErr != nil {
			log.Printf("[StateMachine] UpdateCancelPrice error for trade %d: %v", tradeID, dbErr)
		}
		sm.mu.Lock()
		if sm.state == StateOrderPlaced {
			if sm.cancelTimer != nil {
				sm.cancelTimer.Stop()
				sm.cancelTimer = nil
			}
			sm.activeOrderID = 0
			sm.activeOrderPrice = 0
			sm.activeTradeID = 0
			sm.tpPrice = 0
			sm.slPrice = 0
			sm.lastCancelAt = time.Now()
			sm.state = StateIdle
			algoState := sm.buildAlgoState()
			sm.mu.Unlock()
			sm.notifyStateChange(algoState)
		} else {
			sm.mu.Unlock()
		}
		return
	}

	if !filled {
		return
	}

	// Order is filled — place TP and SL
	// Use fillPrice if available, otherwise fall back to orderPrice
	entryPrice := fillPrice
	if entryPrice == 0 {
		entryPrice = orderPrice
	}

	sm.mu.Lock()
	tpDist := sm.tpDistance
	slDist := sm.slDistance
	sm.mu.Unlock()

	tpPrice := roundPrice(entryPrice - tpDist)
	slPrice := roundPrice(entryPrice + slDist)

	tpID, err := sm.orderMgr.PlaceTakeProfit(ctx, orderID, tpPrice, "0")
	if err != nil {
		log.Printf("[StateMachine] PlaceTakeProfit error: %v", err)
		sm.mu.Lock()
		sm.recordError(err)
		sm.mu.Unlock()
		return
	}

	slID, err := sm.orderMgr.PlaceStopLoss(ctx, orderID, slPrice, "0")
	if err != nil {
		log.Printf("[StateMachine] PlaceStopLoss error: %v", err)
		sm.mu.Lock()
		sm.recordError(err)
		sm.mu.Unlock()
		return
	}

	sm.mu.Lock()
	if sm.state != StateOrderPlaced {
		sm.mu.Unlock()
		return
	}
	// Stop the cancel timer — order is filled before it fired
	if sm.cancelTimer != nil {
		sm.cancelTimer.Stop()
		sm.cancelTimer = nil
	}
	sm.tpOrderID = tpID
	sm.slOrderID = slID
	sm.tpPrice = tpPrice
	sm.slPrice = slPrice
	sm.activeTradeID = tradeID
	sm.inProfit = false
	sm.profitStartTime = time.Time{}
	sm.tpTightened = false
	sm.positionAmount = fmt.Sprintf("%.3f", sm.positionSizeUSDT/entryPrice*float64(sm.leverage))
	// Reset entry offset on successful fill.
	sm.entryOffset = sm.entryOffsetInitial
	sm.state = StatePositionOpen
	algoState := sm.buildAlgoState()
	sm.mu.Unlock()

	// Persist TP and SL order IDs so recovery can find them after a restart.
	if dbErr := sm.db.UpdateOrderIDs(tradeID, tpID, slID); dbErr != nil {
		log.Printf("[StateMachine] UpdateOrderIDs error for trade %d: %v", tradeID, dbErr)
	}
	// Record the actual fill price now that the order is confirmed.
	if dbErr := sm.db.UpdateEntryPrice(tradeID, entryPrice); dbErr != nil {
		log.Printf("[StateMachine] UpdateEntryPrice error for trade %d: %v", tradeID, dbErr)
	}

	log.Printf("[StateMachine] Order %d filled at %.2f → POSITION_OPEN (TP=%.2f, SL=%.2f)", orderID, entryPrice, tpPrice, slPrice)
	sm.notifyStateChange(algoState)
}

// safeCancelOrder attempts to cancel an order. If the order was already filled,
// it triggers the fill-detection flow instead. Returns true if the order was
// successfully cancelled, false if it was filled or cancel status is unknown.
// Must NOT be called with sm.mu held.
func (sm *StateMachine) safeCancelOrder(orderID int64, label string) bool {
	cancelErr := sm.orderMgr.CancelOrder(sm.ctx, orderID)
	if cancelErr == nil {
		return true // successfully cancelled
	}
	log.Printf("[StateMachine] %s: CancelOrder(%d) failed: %v — checking if filled", label, orderID, cancelErr)

	// Cancel failed — check if the order was filled
	filled, _, fillPrice, fillErr := sm.orderMgr.IsOrderFilled(sm.ctx, orderID)
	if fillErr != nil {
		log.Printf("[StateMachine] %s: IsOrderFilled(%d) error: %v — treating as cancelled", label, orderID, fillErr)
		return true // assume cancelled to avoid stuck state
	}

	if filled {
		log.Printf("[StateMachine] %s: Order %d was FILLED at %.2f — triggering fill flow", label, orderID, fillPrice)
		// Trigger the fill detection flow via checkOrderFilled
		// checkOrderFilled will handle transitioning to POSITION_OPEN
		sm.checkOrderFilled(sm.ctx)
		return false // order was filled, not cancelled
	}

	// Not filled, not cancelled successfully — order may still be active or in unknown state
	log.Printf("[StateMachine] %s: Order %d cancel failed but not filled — treating as cancelled", label, orderID)
	return true
}

func (sm *StateMachine) checkPositionClosed(ctx context.Context) {
	sm.mu.Lock()
	if sm.state != StatePositionOpen {
		sm.mu.Unlock()
		return
	}

	// Check if the position has been continuously profitable for more than 1 minute.
	// Skip if TP was already tightened — no need to tighten again.
	if sm.inProfit && !sm.profitStartTime.IsZero() && !sm.tpTightened && time.Since(sm.profitStartTime) > time.Minute {
		log.Printf("[StateMachine] Position has been profitable for >1 minute. Force-closing position.")
		sm.mu.Unlock()
		sm.forceClosePosition(ctx)
		return
	}

	tpID := sm.tpOrderID
	slID := sm.slOrderID
	entryPrice := sm.activeOrderPrice
	tpPrice := sm.tpPrice
	slPrice := sm.slPrice
	tradeID := sm.activeTradeID
	sm.mu.Unlock()

	// --- TP detection: regular limit order, can check active orders + execution history ---
	tpFilled, err := sm.orderMgr.IsOrderFilled2(ctx, tpID)
	if err != nil {
		log.Printf("[StateMachine] IsOrderFilled2(TP %d) error: %v", tpID, err)
		sm.mu.Lock()
		sm.recordError(err)
		sm.mu.Unlock()
		return
	}

	// --- SL detection: conditional order, can't query directly on WhiteBit.
	// Instead, check if the short position still exists. If position is gone
	// and TP wasn't filled → SL must have been triggered. ---
	slFilled := false
	if !tpFilled {
		positions, posErr := sm.orderMgr.GetOpenPositions(ctx)
		if posErr != nil {
			log.Printf("[StateMachine] GetOpenPositions error during SL check: %v", posErr)
			sm.mu.Lock()
			sm.recordError(posErr)
			sm.mu.Unlock()
			return
		}
		hasShortPosition := false
		for _, p := range positions {
			if p.Side == "short" {
				hasShortPosition = true
				break
			}
		}
		if !hasShortPosition {
			log.Printf("[StateMachine] Position gone, TP not filled → SL triggered (SL order %d)", slID)
			slFilled = true
		}
	}

	if !tpFilled && !slFilled {
		return
	}

	// Compute exit price, PnL, and status; cancel the opposing order.
	var exitPrice float64
	var pnl float64
	var status string
	contractSize := sm.positionSizeUSDT / sm.activeOrderPrice * float64(sm.leverage)

	if tpFilled {
		exitPrice = tpPrice
		pnl = (entryPrice - exitPrice) * contractSize
		status = "TP_HIT"
		if cancelErr := sm.orderMgr.CancelOrder(ctx, slID); cancelErr != nil {
			log.Printf("[StateMachine] CancelOrder(SL %d) error: %v", slID, cancelErr)
		}
		log.Printf("[StateMachine] TP hit for trade %d — exitPrice=%.2f, pnl=%.2f", tradeID, exitPrice, pnl)
	} else {
		exitPrice = slPrice
		pnl = (entryPrice - exitPrice) * contractSize
		status = "SL_HIT"
		if cancelErr := sm.orderMgr.CancelOrder(ctx, tpID); cancelErr != nil {
			log.Printf("[StateMachine] CancelOrder(TP %d) error: %v", tpID, cancelErr)
		}
		log.Printf("[StateMachine] SL hit for trade %d — exitPrice=%.2f, pnl=%.2f", tradeID, exitPrice, pnl)
	}

	// Cancel all remaining active orders for the market to prevent residuals
	activeOrders, aoErr := sm.orderMgr.GetActiveShortOrders(ctx)
	if aoErr != nil {
		log.Printf("[StateMachine] Post-close GetActiveShortOrders error: %v", aoErr)
	} else {
		for _, ao := range activeOrders {
			log.Printf("[StateMachine] Cancelling residual order #%d", ao.OrderID)
			if cancelErr := sm.orderMgr.CancelOrder(ctx, ao.OrderID); cancelErr != nil {
				log.Printf("[StateMachine] CancelOrder(residual %d) error: %v", ao.OrderID, cancelErr)
			}
		}
	}

	// Persist trade update
	if updateErr := sm.db.UpdateTrade(tradeID, exitPrice, pnl, status); updateErr != nil {
		log.Printf("[StateMachine] UpdateTrade error: %v", updateErr)
	}

	// Update today's running PnL
	todayPnL, pnlErr := sm.db.UpdateTodayPnL(pnl)
	if pnlErr != nil {
		log.Printf("[StateMachine] UpdateTodayPnL error: %v", pnlErr)
	}

	sm.mu.Lock()
	sm.state = StateIdle
	sm.activeOrderID = 0
	sm.activeOrderPrice = 0
	sm.activeTradeID = 0
	sm.tpOrderID = 0
	sm.slOrderID = 0
	sm.tpPrice = 0
	sm.slPrice = 0
	sm.tpTightened = false
	sm.positionAmount = ""
	sm.entryOffset = sm.entryOffsetInitial // reset adaptive offset after successful trade close
	algoState := sm.buildAlgoState()
	sm.mu.Unlock()

	log.Printf("[StateMachine] Position closed (%s) → IDLE", status)
	sm.notifyStateChange(algoState)

	// Verify position is actually closed and no residual orders/positions exist
	go func() {
		time.Sleep(2 * time.Second) // brief delay for exchange propagation
		bgCtx := context.Background()

		// Second-pass order cancellation to catch any orders that appeared after the first sweep
		lateOrders, lateErr := sm.orderMgr.GetActiveShortOrders(bgCtx)
		if lateErr != nil {
			log.Printf("[StateMachine] Post-close late order check error: %v", lateErr)
		} else {
			for _, ao := range lateOrders {
				log.Printf("[StateMachine] Cancelling late residual order #%d", ao.OrderID)
				sm.orderMgr.CancelOrder(bgCtx, ao.OrderID)
			}
		}

		// Check for residual positions
		positions, err := sm.orderMgr.GetOpenPositions(bgCtx)
		if err != nil {
			log.Printf("[StateMachine] Post-close position check error: %v", err)
			return
		}
		for _, p := range positions {
			if p.Side == "long" {
				log.Printf("[StateMachine] WARNING: residual LONG position found after close (likely created by TP buy): %.3f BTC @ $%.2f — manual intervention required", p.Amount, p.BasePrice)
			} else if p.Side == "short" {
				log.Printf("[StateMachine] WARNING: residual SHORT position found after close: %.3f BTC @ $%.2f", p.Amount, p.BasePrice)
			}
		}
	}()

	// Circuit breaker check
	if pnlErr == nil {
		sm.checkCircuitBreaker(todayPnL)
	}
}

// forceClosePosition tightens the take-profit to lock in the current profit.
// Instead of a risky market order, it cancels the existing far TP and places a
// new tight limit BUY at currentPrice+$15, keeping the SL active as a safety net.
// The normal checkPositionClosed loop will detect the fill and handle the close.
func (sm *StateMachine) forceClosePosition(ctx context.Context) {
	sm.mu.Lock()
	tpOrderID := sm.tpOrderID
	currentPrice := sm.currentPrice
	entryPrice := sm.activeOrderPrice
	posSize := sm.positionSizeUSDT
	leverage := sm.leverage
	amount := sm.positionAmount
	sm.mu.Unlock()

	tightTP := currentPrice + 15.0

	// Use stored position amount; fall back to calculated if not set
	if amount == "" {
		if entryPrice > 0 {
			amount = fmt.Sprintf("%.3f", posSize/entryPrice*float64(leverage))
		} else {
			amount = "0"
		}
	}

	log.Printf("[StateMachine] Position profitable >1min at $%.2f — tightening TP #%d → $%.2f",
		currentPrice, tpOrderID, tightTP)

	// Cancel the existing far TP order (ignore errors — order may already be filled/gone)
	if tpOrderID != 0 {
		if err := sm.orderMgr.CancelOrder(ctx, tpOrderID); err != nil {
			log.Printf("[StateMachine] Warning: failed to cancel old TP #%d: %v — proceeding to place new TP", tpOrderID, err)
		}
	}

	// Place a new tight limit BUY at currentPrice + $15 to lock in profit
	tightTP = roundPrice(tightTP)
	log.Printf("[StateMachine] Placing tight TP: price=$%.1f amount=%s", tightTP, amount)
	newTPOrderID, err := sm.orderMgr.PlaceTakeProfit(ctx, 0, tightTP, amount)
	if err != nil {
		log.Printf("[StateMachine] ERROR: failed to place tight TP at $%.2f: %v", tightTP, err)
		return
	}
	log.Printf("[StateMachine] Tight TP #%d placed at $%.2f (position remains open until fill)", newTPOrderID, tightTP)

	// Update state: replace the TP order ID and price; keep SL and everything else
	sm.mu.Lock()
	sm.tpOrderID = newTPOrderID
	sm.tpPrice = tightTP
	// Persist the updated TP order ID to DB
	if dbErr := sm.db.UpdateOrderIDs(sm.activeTradeID, newTPOrderID, sm.slOrderID); dbErr != nil {
		log.Printf("[StateMachine] forceClosePosition: UpdateOrderIDs error: %v", dbErr)
	}
	// Mark TP as tightened so we never re-tighten; reset profit timer
	sm.tpTightened = true
	sm.inProfit = false
	sm.profitStartTime = time.Time{}
	algoState := sm.buildAlgoState()
	sm.mu.Unlock()

	sm.notifyStateChange(algoState)
}

// checkCircuitBreaker disables the bot if today's loss exceeds the configured limit.
func (sm *StateMachine) checkCircuitBreaker(todayPnL float64) {
	startingBalance, err := sm.db.GetStartingBalance()
	if err != nil {
		log.Printf("[StateMachine] GetStartingBalance error: %v", err)
		return
	}
	if startingBalance == 0 {
		return
	}

	sm.mu.Lock()
	limitPct := sm.dailyLossLimitPct
	sm.mu.Unlock()

	ratio := todayPnL / startingBalance
	if ratio < -(limitPct / 100.0) {
		sm.mu.Lock()
		sm.botEnabled = false
		sm.mu.Unlock()
		log.Printf("[StateMachine] CIRCUIT BREAKER triggered: todayPnL=%.2f, startingBalance=%.2f, ratio=%.4f < -%.4f", todayPnL, startingBalance, ratio, limitPct)
	}
}

// OnPrice is called by the price feed on each new last-price tick.
func (sm *StateMachine) OnPrice(price float64) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	sm.currentPrice = price

	if !sm.botEnabled {
		return
	}

	switch sm.state {
	case StateIdle:
		sm.priceWindow.Add(price)
		high := sm.candleWindow.High()
		// Also consider price-tick window: candle updates lag behind lastprice_update,
		// so the current price can temporarily exceed the last candle high. Taking the
		// max of both ensures the 10m high is never lower than any recent price tick.
		if priceHigh := sm.priceWindow.High(); priceHigh > high {
			high = priceHigh
		}
		if high == 0 {
			return
		}

		// Price must be below the 10m high for a short entry signal
		if price >= high {
			return
		}

		// Active order guard: check unconditionally (before all entry filters) so that
		// manually-placed orders are always adopted regardless of highConfirmSeconds,
		// gap filter, cooldown, etc. Throttled to at most once every 30 seconds.
		if time.Since(sm.lastActiveOrderCheck) >= 30*time.Second {
			sm.lastActiveOrderCheck = time.Now()
			activeOrders, guardErr := sm.orderMgr.GetActiveShortOrders(sm.ctx)
			if guardErr != nil {
				log.Printf("[StateMachine] GetActiveShortOrders guard error: %v", guardErr)
				sm.recordError(guardErr)
			} else if len(activeOrders) > 0 {
				found := activeOrders[0]
				orderPrice := found.Price
				tpPrice := roundPrice(orderPrice - sm.tpDistance)
				slPrice := roundPrice(orderPrice + sm.slDistance)
				snapshot := ReasoningSnapshot{
					Timestamp:        time.Now(),
					CurrentPrice:     price,
					High10min:        high,
					Difference:       high - price,
					ConditionMet:     true,
					OrderPrice:       orderPrice,
					TPPrice:          tpPrice,
					SLPrice:          slPrice,
					PositionSizeUSDT: sm.positionSizeUSDT,
					Leverage:         sm.leverage,
				}
				tradeID, dbErr := sm.db.SaveReasoningSnapshot(snapshot, found.OrderID)
				if dbErr != nil {
					log.Printf("[StateMachine] Adopt manual order: SaveReasoningSnapshot error: %v", dbErr)
				}
				cancelAt := time.Now().Add(time.Duration(sm.orderCancelMinutes) * time.Minute)
				sm.activeOrderID = found.OrderID
				sm.activeOrderPrice = orderPrice
				sm.activeTradeID = tradeID
				sm.tpPrice = tpPrice
				sm.slPrice = slPrice
				sm.cancelAt = cancelAt
				sm.state = StateOrderPlaced
				sm.cancelTimer = time.AfterFunc(time.Duration(sm.orderCancelMinutes)*time.Minute, func() {
					sm.mu.Lock()
					if sm.state != StateOrderPlaced {
						sm.mu.Unlock()
						return
					}
					cancelledTradeID := sm.activeTradeID
					cancelledAtPrice := sm.currentPrice
					orderID := sm.activeOrderID
					sm.mu.Unlock()

					if !sm.safeCancelOrder(orderID, "Cancel timer (adopted)") {
						return // order was filled, checkOrderFilled handled the transition
					}

					sm.mu.Lock()
					if sm.state != StateOrderPlaced {
						sm.mu.Unlock()
						return
					}
					if sm.entryOffset > sm.entryOffsetMin {
						sm.entryOffset -= sm.entryOffsetStep
					}
					sm.lastCancelAt = time.Now()
					log.Printf("[StateMachine] Cancel timer fired (adopted order) → IDLE, entryOffset now %.0f", sm.entryOffset)
					sm.activeOrderID = 0
					sm.activeOrderPrice = 0
					sm.activeTradeID = 0
					sm.tpPrice = 0
					sm.slPrice = 0
					sm.state = StateIdle
					algoState := sm.buildAlgoState()
					sm.mu.Unlock()
					if dbErr := sm.db.UpdateTrade(cancelledTradeID, 0, 0, "CANCELLED"); dbErr != nil {
						log.Printf("[StateMachine] Cancel timer (adopted): UpdateTrade(CANCELLED) error: %v", dbErr)
					}
					if dbErr := sm.db.UpdateCancelPrice(cancelledTradeID, cancelledAtPrice); dbErr != nil {
						log.Printf("[StateMachine] UpdateCancelPrice error for trade %d: %v", cancelledTradeID, dbErr)
					}
					go sm.notifyStateChange(algoState)
				})
				log.Printf("[StateMachine] Adopted manual order %d at %.2f → ORDER_PLACED", found.OrderID, orderPrice)
				algoState := sm.buildAlgoState()
				go sm.notifyStateChange(algoState)
				return
			}
		}

		// Throttled logging helper: logs filter blocks at most once per minute.
		logBlocked := func(format string, args ...interface{}) {
			if time.Since(sm.lastFilterLogAt) >= time.Minute {
				sm.lastFilterLogAt = time.Now()
				log.Printf("[StateMachine] IDLE blocked — "+format, args...)
			}
		}

		// Minimum gap filter — avoid entries on tiny dips
		gapRequired := high * sm.minGapPct
		if (high - price) < gapRequired {
			logBlocked("gap too small: price=%.2f high=%.2f gap=%.2f required=%.2f (minGapPct=%.4f)", price, high, high-price, gapRequired, sm.minGapPct)
			return
		}

		// Post-cancel cooldown — avoid rapid re-entries after failed orders
		if !sm.lastCancelAt.IsZero() && time.Since(sm.lastCancelAt) < time.Duration(sm.cancelCooldownMins)*time.Minute {
			logBlocked("cancel cooldown active, %.0fs remaining", time.Until(sm.lastCancelAt.Add(time.Duration(sm.cancelCooldownMins)*time.Minute)).Seconds())
			return
		}

		// Momentum filter — only enter when the 10m high was an impulse move, not a slow drift
		if sm.minImpulsePct > 0 {
			windowOpen := sm.priceWindow.Open()
			if windowOpen > 0 {
				impulse := (high - windowOpen) / windowOpen
				if impulse < sm.minImpulsePct {
					logBlocked("impulse too weak: %.4f%% < %.4f%% required (high=%.2f windowOpen=%.2f)", impulse*100, sm.minImpulsePct*100, high, windowOpen)
					return
				}
			}
		}

		// ATR volatility halt: skip entry when market is too volatile
		if sm.maxATRUsdt > 0 {
			if atr := sm.computeCurrentATR(); atr > 0 && atr > sm.maxATRUsdt {
				logBlocked("ATR halt: atr=%.2f > maxATRUsdt=%.2f", atr, sm.maxATRUsdt)
				return // ATR volatility halt
			}
		}

		// high_confirm_seconds: wait for the 10m high to stabilise before entering.
		// Only reset the timer when a genuinely NEW HIGHER high is formed (price spiked up).
		// When the high merely decreases because an old candle aged out of the rolling window,
		// keep the confirmation timer running — the market hasn't made a new upward move.
		if high > sm.confirmedHigh {
			// New higher high — require fresh confirmation period.
			sm.confirmedHigh = high
			sm.highFirstSeen = time.Now()
		} else {
			// High unchanged or decreased (old peak aged out of rolling window).
			// Update the stored value but do NOT reset the timer — the market hasn't spiked.
			sm.confirmedHigh = high
		}
		if sm.highConfirmSeconds > 0 && time.Since(sm.highFirstSeen) < time.Duration(sm.highConfirmSeconds)*time.Second {
			logBlocked("waiting for high confirmation: high=%.2f confirmed %.0fs ago, need %.0fs", high, time.Since(sm.highFirstSeen).Seconds(), float64(sm.highConfirmSeconds))
			return
		}

		// Suggestion 5: adaptive offset — use percentage of current price for the initial offset
		offset := sm.entryOffset
		if sm.entryOffsetPct > 0 && sm.entryOffset >= sm.entryOffsetInitial {
			dynamicOffset := price * sm.entryOffsetPct
			if dynamicOffset < sm.entryOffsetMin {
				dynamicOffset = sm.entryOffsetMin
			}
			offset = dynamicOffset
		}

		// No existing active orders — place new order.
		orderPrice := roundPrice(price + offset)
		amount := fmt.Sprintf("%.3f", sm.positionSizeUSDT/price*float64(sm.leverage))

		orderID, err := sm.orderMgr.PlaceShortLimitOrder(sm.ctx, orderPrice, amount)
		if err != nil {
			log.Printf("[StateMachine] PlaceShortLimitOrder error: %v — cooling down 60s", err)
			sm.recordError(err)
			// Set a cooldown to prevent spamming on every tick (e.g., insufficient balance)
			sm.lastCancelAt = time.Now()
			return
		}
		sm.clearError() // successful order placement clears any previous error

		tpPrice := orderPrice - sm.tpDistance
		slPrice := orderPrice + sm.slDistance

		snapshot := ReasoningSnapshot{
			Timestamp:        time.Now(),
			CurrentPrice:     price,
			High10min:        high,
			Difference:       high - price,
			ConditionMet:     true,
			OrderPrice:       orderPrice,
			TPPrice:          tpPrice,
			SLPrice:          slPrice,
			PositionSizeUSDT: sm.positionSizeUSDT,
			Leverage:         sm.leverage,
		}
		tradeID, dbErr := sm.db.SaveReasoningSnapshot(snapshot, orderID)
		if dbErr != nil {
			log.Printf("[StateMachine] SaveReasoningSnapshot error: %v", dbErr)
		}

		cancelAt := time.Now().Add(time.Duration(sm.orderCancelMinutes) * time.Minute)
		sm.activeOrderID = orderID
		sm.activeOrderPrice = orderPrice
		sm.activeTradeID = tradeID
		sm.tpPrice = tpPrice
		sm.slPrice = slPrice
		sm.cancelAt = cancelAt
		sm.state = StateOrderPlaced

		// Start cancel timer
		sm.cancelTimer = time.AfterFunc(time.Duration(sm.orderCancelMinutes)*time.Minute, func() {
			sm.mu.Lock()
			if sm.state != StateOrderPlaced {
				sm.mu.Unlock()
				return
			}
			cancelledTradeID := sm.activeTradeID
			cancelledAtPrice := sm.currentPrice
			orderID := sm.activeOrderID
			sm.mu.Unlock()

			if !sm.safeCancelOrder(orderID, "Cancel timer") {
				return // order was filled, checkOrderFilled handled the transition
			}

			sm.mu.Lock()
			// Re-check state — checkOrderFilled might have transitioned us
			if sm.state != StateOrderPlaced {
				sm.mu.Unlock()
				return
			}
			if sm.entryOffset > sm.entryOffsetMin {
				sm.entryOffset -= sm.entryOffsetStep
			}
			sm.lastCancelAt = time.Now()
			log.Printf("[StateMachine] Cancel timer fired → IDLE, entryOffset now %.0f", sm.entryOffset)
			sm.activeOrderID = 0
			sm.activeOrderPrice = 0
			sm.activeTradeID = 0
			sm.tpPrice = 0
			sm.slPrice = 0
			sm.state = StateIdle
			algoState := sm.buildAlgoState()
			sm.mu.Unlock()
			if dbErr := sm.db.UpdateTrade(cancelledTradeID, 0, 0, "CANCELLED"); dbErr != nil {
				log.Printf("[StateMachine] Cancel timer: UpdateTrade(CANCELLED) error: %v", dbErr)
			}
			if dbErr := sm.db.UpdateCancelPrice(cancelledTradeID, cancelledAtPrice); dbErr != nil {
				log.Printf("[StateMachine] UpdateCancelPrice error for trade %d: %v", cancelledTradeID, dbErr)
			}
			go sm.notifyStateChange(algoState)
		})

		log.Printf("[StateMachine] Placed short limit order %d at %.2f (price=%.2f, high=%.2f, offset=%.2f)", orderID, orderPrice, price, high, offset)
		algoState := sm.buildAlgoState()
		go sm.notifyStateChange(algoState)

	case StateOrderPlaced:
		sm.priceWindow.Add(price)

	case StatePositionOpen:
		// Track how long the position has been continuously profitable.
		isCurrentlyProfitable := price < sm.activeOrderPrice
		if isCurrentlyProfitable && !sm.inProfit {
			// Just became profitable — start the timer.
			sm.inProfit = true
			sm.profitStartTime = time.Now()
			log.Printf("[StateMachine] Position entered profit at $%.2f (entry: $%.2f)", price, sm.activeOrderPrice)
		} else if !isCurrentlyProfitable && sm.inProfit {
			// Left the profit zone — reset timer.
			sm.inProfit = false
			sm.profitStartTime = time.Time{}
			log.Printf("[StateMachine] Position left profit zone at $%.2f", price)
		}
	}
}

// SetEnabled starts or stops the bot.
func (sm *StateMachine) SetEnabled(enabled bool) {
	sm.mu.Lock()
	sm.botEnabled = enabled
	if enabled {
		sm.entryOffset = sm.entryOffsetInitial // reset adaptive offset on re-enable
	}
	log.Printf("[StateMachine] botEnabled set to %v", enabled)
	state := sm.buildAlgoState() // buildAlgoState requires the lock to be held
	sm.mu.Unlock()
	sm.notifyStateChange(state)
}

// SyncOnEnable checks for open trades in the DB and active orders on WhiteBit when the bot
// is enabled. Should be called (in a goroutine) immediately after SetEnabled(true).
// If the state machine is already tracking an order or position, this is a no-op.
func (sm *StateMachine) SyncOnEnable() {
	sm.mu.Lock()
	if sm.state != StateIdle || !sm.botEnabled {
		sm.mu.Unlock()
		return
	}
	price := sm.currentPrice
	high := sm.priceWindow.High()
	posSize := sm.positionSizeUSDT
	leverage := sm.leverage
	tpDist := sm.tpDistance
	slDist := sm.slDistance
	cancelMins := sm.orderCancelMinutes
	sm.mu.Unlock()

	// Clean up any orphaned OPEN trades (failed adoption attempts or stale state)
	if openTrades, err := sm.db.GetOpenTrades(); err == nil {
		for _, t := range openTrades {
			if t.OrderID == 0 && t.TPOrderID == 0 && t.SLOrderID == 0 {
				log.Printf("[StateMachine] SyncOnEnable: cleaning up orphaned trade #%d (no order IDs)", t.ID)
				sm.db.UpdateTrade(t.ID, 0, 0, "CANCELLED")
			}
		}
	}

	// Warn about non-short positions (bot only manages shorts)
	defer func() {
		if positions, err := sm.orderMgr.GetOpenPositions(sm.ctx); err == nil {
			for _, p := range positions {
				if p.Side == "long" {
					log.Printf("[StateMachine] WARNING: unmanaged LONG position found: %.3f BTC @ $%.2f — close manually!", p.Amount, p.BasePrice)
				}
			}
		}
	}()

	// First: check DB for any open trades we might have missed.
	if err := sm.RecoverOpenTrades(sm.ctx); err != nil {
		log.Printf("[StateMachine] SyncOnEnable: RecoverOpenTrades error: %v", err)
	}

	// If recovery already moved us out of IDLE, nothing more to do.
	sm.mu.Lock()
	if sm.state != StateIdle {
		sm.mu.Unlock()
		log.Printf("[StateMachine] SyncOnEnable: state restored to %v from DB recovery", sm.state)
		return
	}
	sm.mu.Unlock()

	// Second: check WhiteBit for any manually placed active sell orders.
	log.Println("[StateMachine] SyncOnEnable: checking WhiteBit for active orders...")
	activeOrders, err := sm.orderMgr.GetActiveShortOrders(sm.ctx)
	if err != nil {
		log.Printf("[StateMachine] SyncOnEnable: GetActiveShortOrders error: %v", err)
		sm.mu.Lock()
		sm.recordError(err)
		sm.mu.Unlock()
		return
	}

	if len(activeOrders) == 0 {
		log.Println("[StateMachine] SyncOnEnable: no active orders found — checking for open positions...")

		// Third: check WhiteBit for any open positions we're not tracking.
		log.Println("[StateMachine] SyncOnEnable: checking WhiteBit for open positions...")
		positions, posErr := sm.orderMgr.GetOpenPositions(sm.ctx)
		if posErr != nil {
			log.Printf("[StateMachine] SyncOnEnable: GetOpenPositions error: %v", posErr)
			return
		}

		// Look for a short position
		var shortPos *OpenPosition
		for i, p := range positions {
			if p.Side == "short" {
				shortPos = &positions[i]
				break
			}
		}

		if shortPos == nil {
			log.Println("[StateMachine] SyncOnEnable: no open positions found — remaining IDLE")
			return
		}

		log.Printf("[StateMachine] SyncOnEnable: found untracked short position: %.3f BTC @ $%.2f (current price: $%.2f)", shortPos.Amount, shortPos.BasePrice, price)

		// Wait for a valid market price before adopting (price feed may not be connected yet)
		if price <= 0 {
			log.Println("[StateMachine] SyncOnEnable: waiting for price feed before adopting position...")
			for i := 0; i < 30; i++ { // wait up to 30 seconds
				time.Sleep(time.Second)
				sm.mu.Lock()
				price = sm.currentPrice
				sm.mu.Unlock()
				if price > 0 {
					break
				}
			}
			if price <= 0 {
				log.Println("[StateMachine] SyncOnEnable: no price data after 30s — cannot adopt position safely")
				return
			}
			log.Printf("[StateMachine] SyncOnEnable: price feed connected, current price: $%.2f", price)
		}

		// Check if we already have an OPEN trade for this position — avoid creating duplicates
		existingTrades, _ := sm.db.GetOpenTrades()
		if len(existingTrades) > 0 {
			log.Printf("[StateMachine] SyncOnEnable: found existing OPEN trade #%d — skipping duplicate adoption, attempting recovery", existingTrades[0].ID)
			if err := sm.RecoverOpenTrades(sm.ctx); err != nil {
				log.Printf("[StateMachine] SyncOnEnable: recovery of existing trade failed: %v", err)
			}
			return
		}

		// Adopt the position: create a DB trade entry and transition to POSITION_OPEN
		entryPrice := shortPos.BasePrice

		// For a short: TP below entry (profit), SL above entry (loss)
		tpPrice := roundPrice(entryPrice - tpDist)
		slPrice := roundPrice(entryPrice + slDist)

		posAmount := fmt.Sprintf("%.3f", shortPos.Amount) // actual BTC amount, not "0"
		log.Printf("[StateMachine] SyncOnEnable: adopting with TP=$%.1f SL=$%.1f amount=%s (entry=$%.2f, current=$%.2f)", tpPrice, slPrice, posAmount, entryPrice, price)

		snapshot := ReasoningSnapshot{
			Timestamp:        time.Now(),
			CurrentPrice:     price,
			High10min:        high,
			Difference:       high - price,
			ConditionMet:     price > 0 && high > 0 && price < high,
			OrderPrice:       entryPrice,
			TPPrice:          tpPrice,
			SLPrice:          slPrice,
			PositionSizeUSDT: posSize,
			Leverage:         leverage,
		}
		tradeID, dbErr := sm.db.SaveReasoningSnapshot(snapshot, 0) // orderID 0 since position was external
		if dbErr != nil {
			log.Printf("[StateMachine] SyncOnEnable: SaveReasoningSnapshot for position error: %v", dbErr)
			return
		}

		// Place TP and SL orders for the adopted position (pass actual amount, not "0")
		tpOrderID, tpErr := sm.orderMgr.PlaceTakeProfit(sm.ctx, 0, tpPrice, posAmount)
		if tpErr != nil {
			log.Printf("[StateMachine] SyncOnEnable: PlaceTakeProfit error: %v", tpErr)
		}
		slOrderID, slErr := sm.orderMgr.PlaceStopLoss(sm.ctx, 0, slPrice, posAmount)
		if slErr != nil {
			log.Printf("[StateMachine] SyncOnEnable: PlaceStopLoss error: %v", slErr)
		}

		if tpErr != nil || slErr != nil {
			log.Printf("[StateMachine] SyncOnEnable: failed to place TP/SL for adopted position — marking trade as CANCELLED")
			if dbErr := sm.db.UpdateTrade(tradeID, 0, 0, "CANCELLED"); dbErr != nil {
				log.Printf("[StateMachine] SyncOnEnable: UpdateTrade(CANCELLED) error: %v", dbErr)
			}
			return
		}

		// Update DB with TP/SL order IDs
		if dbErr := sm.db.UpdateOrderIDs(tradeID, tpOrderID, slOrderID); dbErr != nil {
			log.Printf("[StateMachine] SyncOnEnable: UpdateOrderIDs error: %v", dbErr)
		}
		if dbErr := sm.db.UpdateEntryPrice(tradeID, entryPrice); dbErr != nil {
			log.Printf("[StateMachine] SyncOnEnable: UpdateEntryPrice error: %v", dbErr)
		}

		sm.mu.Lock()
		if sm.state != StateIdle {
			sm.mu.Unlock()
			log.Printf("[StateMachine] SyncOnEnable: state changed while adopting position — skipping")
			return
		}
		sm.state = StatePositionOpen
		sm.activeOrderID = 0
		sm.activeOrderPrice = entryPrice
		sm.activeTradeID = tradeID
		sm.tpOrderID = tpOrderID
		sm.slOrderID = slOrderID
		sm.tpPrice = tpPrice
		sm.slPrice = slPrice
		sm.positionAmount = posAmount
		algoState := sm.buildAlgoState()
		sm.mu.Unlock()

		log.Printf("[StateMachine] SyncOnEnable: adopted position @ $%.2f → POSITION_OPEN (TP=$%.2f, SL=$%.2f)", entryPrice, tpPrice, slPrice)
		sm.notifyStateChange(algoState)
		return
	}

	found := activeOrders[0]
	orderPrice := found.Price
	tpPrice := roundPrice(orderPrice - tpDist)
	slPrice := roundPrice(orderPrice + slDist)

	snapshot := ReasoningSnapshot{
		Timestamp:        time.Now(),
		CurrentPrice:     price,
		High10min:        high,
		Difference:       high - price,
		ConditionMet:     price > 0 && high > 0 && price < high,
		OrderPrice:       orderPrice,
		TPPrice:          tpPrice,
		SLPrice:          slPrice,
		PositionSizeUSDT: posSize,
		Leverage:         leverage,
	}
	tradeID, dbErr := sm.db.SaveReasoningSnapshot(snapshot, found.OrderID)
	if dbErr != nil {
		log.Printf("[StateMachine] SyncOnEnable: SaveReasoningSnapshot error: %v", dbErr)
	}

	cancelAt := time.Now().Add(time.Duration(cancelMins) * time.Minute)

	sm.mu.Lock()
	// Re-check state hasn't changed since we released the lock.
	if sm.state != StateIdle {
		sm.mu.Unlock()
		log.Printf("[StateMachine] SyncOnEnable: state changed to %v while checking WhiteBit — skipping adopt", sm.state)
		return
	}
	sm.activeOrderID = found.OrderID
	sm.activeOrderPrice = orderPrice
	sm.activeTradeID = tradeID
	sm.tpPrice = tpPrice
	sm.slPrice = slPrice
	sm.cancelAt = cancelAt
	sm.lastActiveOrderCheck = time.Now()
	sm.state = StateOrderPlaced
	sm.cancelTimer = time.AfterFunc(time.Duration(sm.orderCancelMinutes)*time.Minute, func() {
		sm.mu.Lock()
		if sm.state != StateOrderPlaced {
			sm.mu.Unlock()
			return
		}
		cancelledTradeID := sm.activeTradeID
		cancelledAtPrice := sm.currentPrice
		orderID := sm.activeOrderID
		sm.mu.Unlock()

		if !sm.safeCancelOrder(orderID, "SyncOnEnable cancel timer") {
			return // order was filled, checkOrderFilled handled the transition
		}

		sm.mu.Lock()
		if sm.state != StateOrderPlaced {
			sm.mu.Unlock()
			return
		}
		if sm.entryOffset > sm.entryOffsetMin {
			sm.entryOffset -= sm.entryOffsetStep
		}
		log.Printf("[StateMachine] SyncOnEnable cancel timer fired → IDLE, entryOffset now %.0f", sm.entryOffset)
		sm.activeOrderID = 0
		sm.activeOrderPrice = 0
		sm.activeTradeID = 0
		sm.tpPrice = 0
		sm.slPrice = 0
		sm.lastCancelAt = time.Now()
		sm.state = StateIdle
		algoState := sm.buildAlgoState()
		sm.mu.Unlock()
		if dbErr := sm.db.UpdateTrade(cancelledTradeID, 0, 0, "CANCELLED"); dbErr != nil {
			log.Printf("[StateMachine] SyncOnEnable cancel timer: UpdateTrade(CANCELLED) error: %v", dbErr)
		}
		if dbErr := sm.db.UpdateCancelPrice(cancelledTradeID, cancelledAtPrice); dbErr != nil {
			log.Printf("[StateMachine] UpdateCancelPrice error for trade %d: %v", cancelledTradeID, dbErr)
		}
		go sm.notifyStateChange(algoState)
	})
	algoState := sm.buildAlgoState()
	sm.mu.Unlock()

	log.Printf("[StateMachine] SyncOnEnable: adopted manual order %d at %.2f → ORDER_PLACED", found.OrderID, orderPrice)
	sm.notifyStateChange(algoState)
}

// LoadConfig refreshes config from DB (positionSize, leverage, dailyLossLimit, botEnabled, and trading params).
func (sm *StateMachine) LoadConfig() error {
	posSizeStr, err := sm.db.GetSetting("position_size_usdt")
	if err != nil {
		return fmt.Errorf("GetSetting(position_size_usdt): %w", err)
	}

	leverageStr, err := sm.db.GetSetting("leverage")
	if err != nil {
		return fmt.Errorf("GetSetting(leverage): %w", err)
	}

	dailyLossStr, err := sm.db.GetSetting("daily_loss_limit_pct")
	if err != nil {
		return fmt.Errorf("GetSetting(daily_loss_limit_pct): %w", err)
	}

	botEnabledStr, err := sm.db.GetSetting("bot_enabled")
	if err != nil {
		return fmt.Errorf("GetSetting(bot_enabled): %w", err)
	}

	entryOffsetInitialStr, err := sm.db.GetSetting("entry_offset_initial")
	if err != nil {
		return fmt.Errorf("GetSetting(entry_offset_initial): %w", err)
	}

	entryOffsetStepStr, err := sm.db.GetSetting("entry_offset_step")
	if err != nil {
		return fmt.Errorf("GetSetting(entry_offset_step): %w", err)
	}

	entryOffsetMinStr, err := sm.db.GetSetting("entry_offset_min")
	if err != nil {
		return fmt.Errorf("GetSetting(entry_offset_min): %w", err)
	}

	orderCancelMinutesStr, err := sm.db.GetSetting("order_cancel_minutes")
	if err != nil {
		return fmt.Errorf("GetSetting(order_cancel_minutes): %w", err)
	}

	tpDistanceStr, err := sm.db.GetSetting("tp_distance")
	if err != nil {
		return fmt.Errorf("GetSetting(tp_distance): %w", err)
	}

	slDistanceStr, err := sm.db.GetSetting("sl_distance")
	if err != nil {
		return fmt.Errorf("GetSetting(sl_distance): %w", err)
	}

	minGapPctStr, err := sm.db.GetSetting("min_gap_pct")
	if err != nil {
		return fmt.Errorf("GetSetting(min_gap_pct): %w", err)
	}

	cancelCooldownMinsStr, err := sm.db.GetSetting("cancel_cooldown_minutes")
	if err != nil {
		return fmt.Errorf("GetSetting(cancel_cooldown_minutes): %w", err)
	}

	entryOffsetPctStr, err := sm.db.GetSetting("entry_offset_pct")
	if err != nil {
		return fmt.Errorf("GetSetting(entry_offset_pct): %w", err)
	}

	minImpulsePctStr, err := sm.db.GetSetting("min_impulse_pct")
	if err != nil {
		return fmt.Errorf("GetSetting(min_impulse_pct): %w", err)
	}

	maxATRUsdtStr, err := sm.db.GetSetting("max_atr_usdt")
	if err != nil {
		return fmt.Errorf("GetSetting(max_atr_usdt): %w", err)
	}

	highConfirmSecondsStr, err := sm.db.GetSetting("high_confirm_seconds")
	if err != nil {
		return fmt.Errorf("GetSetting(high_confirm_seconds): %w", err)
	}

	var posSize float64
	if _, scanErr := fmt.Sscanf(posSizeStr, "%f", &posSize); scanErr != nil {
		return fmt.Errorf("parse position_size_usdt %q: %w", posSizeStr, scanErr)
	}

	var leverage int
	if _, scanErr := fmt.Sscanf(leverageStr, "%d", &leverage); scanErr != nil {
		return fmt.Errorf("parse leverage %q: %w", leverageStr, scanErr)
	}

	var dailyLoss float64
	if _, scanErr := fmt.Sscanf(dailyLossStr, "%f", &dailyLoss); scanErr != nil {
		return fmt.Errorf("parse daily_loss_limit_pct %q: %w", dailyLossStr, scanErr)
	}

	var entryOffsetInitial float64
	if _, scanErr := fmt.Sscanf(entryOffsetInitialStr, "%f", &entryOffsetInitial); scanErr != nil {
		return fmt.Errorf("parse entry_offset_initial %q: %w", entryOffsetInitialStr, scanErr)
	}

	var entryOffsetStep float64
	if _, scanErr := fmt.Sscanf(entryOffsetStepStr, "%f", &entryOffsetStep); scanErr != nil {
		return fmt.Errorf("parse entry_offset_step %q: %w", entryOffsetStepStr, scanErr)
	}

	var entryOffsetMin float64
	if _, scanErr := fmt.Sscanf(entryOffsetMinStr, "%f", &entryOffsetMin); scanErr != nil {
		return fmt.Errorf("parse entry_offset_min %q: %w", entryOffsetMinStr, scanErr)
	}

	var orderCancelMinutes float64
	if _, scanErr := fmt.Sscanf(orderCancelMinutesStr, "%f", &orderCancelMinutes); scanErr != nil {
		return fmt.Errorf("parse order_cancel_minutes %q: %w", orderCancelMinutesStr, scanErr)
	}

	var tpDistance float64
	if _, scanErr := fmt.Sscanf(tpDistanceStr, "%f", &tpDistance); scanErr != nil {
		return fmt.Errorf("parse tp_distance %q: %w", tpDistanceStr, scanErr)
	}

	var slDistance float64
	if _, scanErr := fmt.Sscanf(slDistanceStr, "%f", &slDistance); scanErr != nil {
		return fmt.Errorf("parse sl_distance %q: %w", slDistanceStr, scanErr)
	}

	var minGapPct float64
	if _, scanErr := fmt.Sscanf(minGapPctStr, "%f", &minGapPct); scanErr != nil {
		return fmt.Errorf("parse min_gap_pct %q: %w", minGapPctStr, scanErr)
	}

	var cancelCooldownMins float64
	if _, scanErr := fmt.Sscanf(cancelCooldownMinsStr, "%f", &cancelCooldownMins); scanErr != nil {
		return fmt.Errorf("parse cancel_cooldown_minutes %q: %w", cancelCooldownMinsStr, scanErr)
	}

	var entryOffsetPct float64
	if _, scanErr := fmt.Sscanf(entryOffsetPctStr, "%f", &entryOffsetPct); scanErr != nil {
		return fmt.Errorf("parse entry_offset_pct %q: %w", entryOffsetPctStr, scanErr)
	}

	var minImpulsePct float64
	if _, scanErr := fmt.Sscanf(minImpulsePctStr, "%f", &minImpulsePct); scanErr != nil {
		return fmt.Errorf("parse min_impulse_pct %q: %w", minImpulsePctStr, scanErr)
	}

	var maxATRUsdt float64
	if _, scanErr := fmt.Sscanf(maxATRUsdtStr, "%f", &maxATRUsdt); scanErr != nil {
		return fmt.Errorf("parse max_atr_usdt %q: %w", maxATRUsdtStr, scanErr)
	}

	var highConfirmSeconds int
	if _, scanErr := fmt.Sscanf(highConfirmSecondsStr, "%d", &highConfirmSeconds); scanErr != nil {
		return fmt.Errorf("parse high_confirm_seconds %q: %w", highConfirmSecondsStr, scanErr)
	}

	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.positionSizeUSDT = posSize
	sm.leverage = leverage
	sm.dailyLossLimitPct = dailyLoss
	sm.botEnabled = botEnabledStr == "true" || botEnabledStr == "1"
	sm.entryOffsetInitial = entryOffsetInitial
	sm.entryOffsetStep = entryOffsetStep
	sm.entryOffsetMin = entryOffsetMin
	sm.orderCancelMinutes = orderCancelMinutes
	sm.tpDistance = tpDistance
	sm.slDistance = slDistance
	sm.minGapPct = minGapPct
	sm.cancelCooldownMins = cancelCooldownMins
	sm.entryOffsetPct = entryOffsetPct
	sm.minImpulsePct = minImpulsePct
	sm.maxATRUsdt = maxATRUsdt
	sm.highConfirmSeconds = highConfirmSeconds

	log.Printf("[StateMachine] Config loaded: positionSize=%.2f, leverage=%d, dailyLossLimit=%.4f, botEnabled=%v, entryOffsetInitial=%.0f, entryOffsetStep=%.0f, entryOffsetMin=%.0f, orderCancelMinutes=%.0f, tpDistance=%.0f, slDistance=%.0f, minGapPct=%.4f, cooldownMins=%.0f, offsetPct=%.4f, impulsePct=%.4f, maxATR=%.0f, highConfirmSeconds=%d",
		sm.positionSizeUSDT, sm.leverage, sm.dailyLossLimitPct, sm.botEnabled,
		sm.entryOffsetInitial, sm.entryOffsetStep, sm.entryOffsetMin, sm.orderCancelMinutes,
		sm.tpDistance, sm.slDistance, sm.minGapPct, sm.cancelCooldownMins, sm.entryOffsetPct, sm.minImpulsePct, sm.maxATRUsdt, sm.highConfirmSeconds)
	return nil
}

// GetAlgoState returns a snapshot of current state for broadcasting.
func (sm *StateMachine) GetAlgoState() AlgoState {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	return sm.buildAlgoState()
}

// computeCurrentATR returns the average true range across the current atrCandles buffer.
// Returns 0 if there are fewer than 2 candles (insufficient data for a single TR period).
// Must be called with sm.mu held.
func (sm *StateMachine) computeCurrentATR() float64 {
	if len(sm.atrCandles) < 2 {
		return 0
	}
	var atrSum float64
	count := 0
	for i := 1; i < len(sm.atrCandles); i++ {
		prevClose := sm.atrCandles[i-1].Close
		tr := sm.atrCandles[i].High - sm.atrCandles[i].Low
		if up := sm.atrCandles[i].High - prevClose; up > 0 && up > tr {
			tr = up
		}
		if down := prevClose - sm.atrCandles[i].Low; down > 0 && down > tr {
			tr = down
		}
		atrSum += tr
		count++
	}
	if count == 0 {
		return 0
	}
	return atrSum / float64(count)
}

// buildAlgoState constructs an AlgoState snapshot. Must be called with sm.mu held.
func (sm *StateMachine) buildAlgoState() AlgoState {
	high := sm.candleWindow.High()
	if priceHigh := sm.priceWindow.High(); priceHigh > high {
		high = priceHigh
	}
	price := sm.currentPrice
	conditionMet := price > 0 && high > 0 && price < high
	var nextOrderPrice float64
	if conditionMet {
		nextOrderPrice = price + sm.entryOffset
	}

	// Compute a human-readable description of what's currently blocking entry.
	filterStatus := sm.computeFilterStatus(price, high)

	// Current filter values
	gap := 0.0
	gapPct := 0.0
	requiredGap := 0.0
	if high > 0 && price > 0 {
		gap = high - price
		gapPct = gap / high
		requiredGap = sm.minGapPct * high
	}

	impulse := 0.0
	windowOpen := sm.priceWindow.Open()
	if windowOpen > 0 && high > 0 {
		impulse = (high - windowOpen) / windowOpen
	}

	cooldownRemaining := 0.0
	if !sm.lastCancelAt.IsZero() {
		remaining := time.Until(sm.lastCancelAt.Add(time.Duration(sm.cancelCooldownMins) * time.Minute))
		if remaining > 0 {
			cooldownRemaining = remaining.Seconds()
		}
	}

	highConfirmRemaining := 0.0
	if sm.highConfirmSeconds > 0 {
		waited := time.Since(sm.highFirstSeen)
		required := time.Duration(sm.highConfirmSeconds) * time.Second
		if waited < required {
			highConfirmRemaining = (required - waited).Seconds()
		}
	}

	return AlgoState{
		State:            sm.state,
		CurrentPrice:     price,
		High10min:        high,
		ConditionMet:     conditionMet,
		NextOrderPrice:   nextOrderPrice,
		ActiveOrderID:    sm.activeOrderID,
		ActiveOrderPrice: sm.activeOrderPrice,
		TPPrice:          sm.tpPrice,
		SLPrice:          sm.slPrice,
		CancelAt:         sm.cancelAt,
		BotEnabled:       sm.botEnabled,
		EntryOffset:      sm.entryOffset,
		FilterStatus:     filterStatus,
		CurrentATR:       sm.computeCurrentATR(),
		PositionSizeUsdt: sm.positionSizeUSDT,
		Leverage:         sm.leverage,

		// Filter thresholds
		MinGapPct:          sm.minGapPct,
		MinImpulsePct:      sm.minImpulsePct,
		MaxATRUsdt:         sm.maxATRUsdt,
		CancelCooldownMins: sm.cancelCooldownMins,
		HighConfirmSeconds: sm.highConfirmSeconds,

		// Current filter values
		CurrentGap:           gap,
		CurrentGapPct:        gapPct,
		RequiredGap:          requiredGap,
		CurrentImpulse:       impulse,
		CooldownRemaining:    cooldownRemaining,
		HighConfirmRemaining: highConfirmRemaining,

		LastError:   sm.lastError,
		LastErrorAt: sm.lastErrorAt,
	}
}

// computeFilterStatus returns a short string describing the first active filter blocking entry.
// Returns "" if all filters would pass (entry is ready). Must be called with sm.mu held.
func (sm *StateMachine) computeFilterStatus(price, high float64) string {
	if !sm.botEnabled {
		return "Bot disabled"
	}
	if sm.state != StateIdle {
		return "" // not in idle — not relevant
	}
	if price == 0 || high == 0 {
		return "Waiting for price data"
	}
	if price >= high {
		return fmt.Sprintf("Price $%.0f ≥ 10m high $%.0f — waiting for pullback", price, high)
	}

	gapRequired := high * sm.minGapPct
	gap := high - price
	if gap < gapRequired {
		return fmt.Sprintf("Gap $%.0f < $%.0f required (%.2f%% threshold)", gap, gapRequired, sm.minGapPct*100)
	}

	if !sm.lastCancelAt.IsZero() {
		remaining := time.Until(sm.lastCancelAt.Add(time.Duration(sm.cancelCooldownMins) * time.Minute))
		if remaining > 0 {
			return fmt.Sprintf("Cancel cooldown: %s remaining", remaining.Round(time.Second))
		}
	}

	if sm.minImpulsePct > 0 {
		windowOpen := sm.priceWindow.Open()
		if windowOpen > 0 {
			impulse := (high - windowOpen) / windowOpen
			if impulse < sm.minImpulsePct {
				return fmt.Sprintf("Impulse %.3f%% < %.3f%% required", impulse*100, sm.minImpulsePct*100)
			}
		}
	}

	if sm.maxATRUsdt > 0 && len(sm.atrCandles) >= 2 {
		var atrSum float64
		count := 0
		for i := 1; i < len(sm.atrCandles); i++ {
			prevClose := sm.atrCandles[i-1].Close
			tr := sm.atrCandles[i].High - sm.atrCandles[i].Low
			if up := sm.atrCandles[i].High - prevClose; up > 0 && up > tr {
				tr = up
			}
			if down := prevClose - sm.atrCandles[i].Low; down > 0 && down > tr {
				tr = down
			}
			atrSum += tr
			count++
		}
		if count > 0 {
			atr := atrSum / float64(count)
			if atr > sm.maxATRUsdt {
				return fmt.Sprintf("ATR $%.0f > $%.0f limit (too volatile)", atr, sm.maxATRUsdt)
			}
		}
	}

	if sm.highConfirmSeconds > 0 {
		waited := time.Since(sm.highFirstSeen)
		required := time.Duration(sm.highConfirmSeconds) * time.Second
		if waited < required {
			remaining := (required - waited).Round(time.Second)
			return fmt.Sprintf("Confirming high $%.0f — %s remaining", high, remaining)
		}
	}

	return "" // all filters pass
}

// notifyStateChange calls OnStateChange if set. Safe to call without holding the mutex.
func (sm *StateMachine) notifyStateChange(state AlgoState) {
	if sm.OnStateChange != nil {
		sm.OnStateChange(state)
	}
}

// GetReasoningText returns a plain-English description of what the algorithm is currently doing.
func (sm *StateMachine) GetReasoningText() string {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	price := sm.currentPrice
	high := sm.candleWindow.High()
	if priceHigh := sm.priceWindow.High(); priceHigh > high {
		high = priceHigh
	}
	state := sm.state

	switch state {
	case StateIdle:
		if !sm.botEnabled {
			return "Bot is disabled. Enable it from the dashboard to start trading."
		}
		if price == 0 {
			return "Waiting for first price tick from WhiteBit..."
		}
		if high == 0 {
			return fmt.Sprintf("Monitoring BTC at $%.2f. Building 10-minute price history — high not yet available.", price)
		}
		diff := high - price
		if price < high {
			// Check each filter in the same order as the real placement logic.
			gapRequired := high * sm.minGapPct
			if diff < gapRequired {
				return fmt.Sprintf(
					"Condition MET: BTC at $%.2f is $%.2f below the 10m high of $%.2f. "+
						"BLOCKED — gap too small ($%.2f < $%.2f required, %.2f%% threshold). "+
						"Lower 'Min Gap %%' in Settings to allow entry.",
					price, diff, high, diff, gapRequired, sm.minGapPct*100,
				)
			}
			if !sm.lastCancelAt.IsZero() && time.Since(sm.lastCancelAt) < time.Duration(sm.cancelCooldownMins)*time.Minute {
				remaining := time.Until(sm.lastCancelAt.Add(time.Duration(sm.cancelCooldownMins) * time.Minute)).Round(time.Second)
				return fmt.Sprintf(
					"Condition MET: BTC at $%.2f is $%.2f below the 10m high of $%.2f. "+
						"BLOCKED — post-cancel cooldown active, %s remaining.",
					price, diff, high, remaining,
				)
			}
			if sm.minImpulsePct > 0 {
				windowOpen := sm.priceWindow.Open()
				if windowOpen > 0 {
					impulse := (high - windowOpen) / windowOpen
					if impulse < sm.minImpulsePct {
						return fmt.Sprintf(
							"Condition MET: BTC at $%.2f is $%.2f below the 10m high of $%.2f. "+
								"BLOCKED — impulse too weak (%.3f%% < %.3f%% required). "+
								"The 10m high was not a sharp enough move. Lower 'Min Impulse %%' in Settings.",
							price, diff, high, impulse*100, sm.minImpulsePct*100,
						)
					}
				}
			}
			if sm.highConfirmSeconds > 0 {
				waited := time.Since(sm.highFirstSeen)
				required := time.Duration(sm.highConfirmSeconds) * time.Second
				if waited < required {
					remaining := (required - waited).Round(time.Second)
					return fmt.Sprintf(
						"Condition MET: BTC at $%.2f is $%.2f below the 10m high of $%.2f. "+
							"WAITING — confirming high stability, %s remaining before placing order at $%.2f. "+
							"(Timer only resets on new higher highs, not when old peaks age out.)",
						price, diff, high, remaining, price+sm.entryOffset,
					)
				}
			}
			return fmt.Sprintf(
				"Condition MET: BTC at $%.2f is $%.2f below the 10m high of $%.2f. Placing a short limit order at $%.2f (entry + $%.0f).",
				price, diff, high, price+sm.entryOffset, sm.entryOffset,
			)
		}
		return fmt.Sprintf(
			"Monitoring BTC at $%.2f. 10m high is $%.2f. Price is $%.2f above the high — waiting for price to drop below the 10m high to place a short order.",
			price, high, price-high,
		)

	case StateOrderPlaced:
		remaining := time.Until(sm.cancelAt).Round(time.Second)
		return fmt.Sprintf(
			"Short limit order #%d placed at $%.2f. Waiting for fill. Will auto-cancel in %s if unfilled.",
			sm.activeOrderID, sm.activeOrderPrice, remaining,
		)

	case StatePositionOpen:
		return fmt.Sprintf(
			"Position open — short at $%.2f. TP at $%.2f | SL at $%.2f. Monitoring for close.",
			sm.activeOrderPrice, sm.tpPrice, sm.slPrice,
		)

	default:
		return "Unknown state."
	}
}

// RecoverOpenTrades checks the database for any trades still marked OPEN and restores
// the appropriate state machine state. It should be called once at startup, after
// LoadConfig and before Start.
func (sm *StateMachine) RecoverOpenTrades(ctx context.Context) error {
	trades, err := sm.db.GetOpenTrades()
	if err != nil {
		return fmt.Errorf("RecoverOpenTrades: GetOpenTrades: %w", err)
	}

	if len(trades) == 0 {
		log.Println("[Recovery] No open trades to recover")
		return nil
	}

	// Only recover the most recent open trade (highest ID = last element since ordered ASC).
	trade := trades[len(trades)-1]

	// Mark any older open trades as CANCELLED to clean up orphaned rows.
	for i := 0; i < len(trades)-1; i++ {
		old := trades[i]
		log.Printf("[Recovery] Cancelling orphaned open trade #%d (superseded by trade #%d)", old.ID, trade.ID)
		if dbErr := sm.db.UpdateTrade(old.ID, 0, 0, "CANCELLED"); dbErr != nil {
			log.Printf("[Recovery] Warning: failed to cancel orphaned trade #%d: %v", old.ID, dbErr)
		}
	}

	log.Printf("[Recovery] Examining trade #%d (orderID=%d, tpOrderID=%d, slOrderID=%d)",
		trade.ID, trade.OrderID, trade.TPOrderID, trade.SLOrderID)

	// --- Case B / C: Position was open (TP and SL order IDs are present) ---
	if trade.TPOrderID != 0 && trade.SLOrderID != 0 {
		tpFilled, tpErr := sm.orderMgr.IsOrderFilled2(ctx, trade.TPOrderID)
		if tpErr != nil {
			log.Printf("[Recovery] Warning: IsOrderFilled2(TP %d) error: %v — assuming still active", trade.TPOrderID, tpErr)
			tpFilled = false
		}

		slFilled, slErr := sm.orderMgr.IsOrderFilled2(ctx, trade.SLOrderID)
		if slErr != nil {
			log.Printf("[Recovery] Warning: IsOrderFilled2(SL %d) error: %v — assuming still active", trade.SLOrderID, slErr)
			slFilled = false
		}

		if tpFilled || slFilled {
			// Case C: Position closed while server was down.
			var exitPrice float64
			var status string
			if tpFilled {
				exitPrice = trade.TPPrice
				status = "TP_HIT"
			} else {
				exitPrice = trade.SLPrice
				status = "SL_HIT"
			}

			entryPrice := trade.EntryPrice
			if entryPrice == 0 {
				entryPrice = trade.OrderPrice
			}

			sm.mu.Lock()
			posSize := sm.positionSizeUSDT
			lev := sm.leverage
			sm.mu.Unlock()

			var contractSize float64
			if trade.OrderPrice > 0 {
				contractSize = posSize / trade.OrderPrice * float64(lev)
			}
			pnl := (entryPrice - exitPrice) * contractSize

			if dbErr := sm.db.UpdateTrade(trade.ID, exitPrice, pnl, status); dbErr != nil {
				log.Printf("[Recovery] Warning: UpdateTrade for trade #%d: %v", trade.ID, dbErr)
			}
			log.Printf("[Recovery] Trade #%d was closed while server was offline, status=%s, pnl=$%.2f",
				trade.ID, status, pnl)

			// Cancel all remaining active orders to prevent residuals from the offline close
			activeOrders, aoErr := sm.orderMgr.GetActiveShortOrders(ctx)
			if aoErr != nil {
				log.Printf("[Recovery] Post-close GetActiveShortOrders error: %v", aoErr)
			} else {
				for _, ao := range activeOrders {
					log.Printf("[Recovery] Cancelling residual order #%d", ao.OrderID)
					sm.orderMgr.CancelOrder(ctx, ao.OrderID)
				}
			}
			return nil
		}

		// Case B: Neither TP nor SL filled — position is still open.
		sm.mu.Lock()
		sm.state = StatePositionOpen
		sm.activeOrderID = trade.OrderID
		sm.activeOrderPrice = trade.OrderPrice
		sm.activeTradeID = trade.ID
		sm.tpOrderID = trade.TPOrderID
		sm.slOrderID = trade.SLOrderID
		sm.tpPrice = trade.TPPrice
		sm.slPrice = trade.SLPrice
		if trade.OrderPrice > 0 {
			sm.positionAmount = fmt.Sprintf("%.3f", sm.positionSizeUSDT/trade.OrderPrice*float64(sm.leverage))
		}
		sm.mu.Unlock()

		log.Printf("[Recovery] Restored POSITION_OPEN state for trade #%d (TP=%d, SL=%d)",
			trade.ID, trade.TPOrderID, trade.SLOrderID)
		return nil
	}

	// --- Case A / D: Entry order placed but position not yet open ---
	if trade.OrderID != 0 {
		filled, cancelled, _, fillErr := sm.orderMgr.IsOrderFilled(ctx, trade.OrderID)
		if fillErr != nil {
			log.Printf("[Recovery] Warning: IsOrderFilled(%d) error: %v — skipping recovery", trade.OrderID, fillErr)
			return nil
		}

		if cancelled {
			log.Printf("[Recovery] Order %d for trade #%d was cancelled while offline — marking CANCELLED", trade.OrderID, trade.ID)
			if dbErr := sm.db.UpdateTrade(trade.ID, 0, 0, "CANCELLED"); dbErr != nil {
				log.Printf("[Recovery] Warning: UpdateTrade(CANCELLED) for trade #%d: %v", trade.ID, dbErr)
			}
			return nil
		}

		if filled {
			// Entry filled but no TP/SL recorded — server crashed between fill detection and
			// UpdateOrderIDs. The poll loop will pick this up once we restore ORDER_PLACED state
			// and call checkOrderFilled, which will place TP/SL again.
			// Restore as ORDER_PLACED so the next poll correctly transitions to POSITION_OPEN.
			sm.mu.Lock()
			sm.state = StateOrderPlaced
			sm.activeOrderID = trade.OrderID
			sm.activeOrderPrice = trade.OrderPrice
			sm.activeTradeID = trade.ID
			sm.tpPrice = trade.TPPrice
			sm.slPrice = trade.SLPrice
			sm.cancelAt = time.Now().Add(time.Duration(sm.orderCancelMinutes) * time.Minute)
			sm.mu.Unlock()

			log.Printf("[Recovery] Trade #%d entry order #%d appears filled but no TP/SL — restored ORDER_PLACED for re-processing",
				trade.ID, trade.OrderID)
			return nil
		}

		// IsOrderFilled returns false — check whether the order is still active or was cancelled.
		// IsOrderFilled returns (false, 0, nil) for both "still active" and "cancelled".
		// We treat it as still waiting (Case A).
		sm.mu.Lock()
		sm.state = StateOrderPlaced
		sm.activeOrderID = trade.OrderID
		sm.activeOrderPrice = trade.OrderPrice
		sm.activeTradeID = trade.ID
		sm.tpPrice = trade.TPPrice
		sm.slPrice = trade.SLPrice
		sm.cancelAt = time.Now().Add(time.Duration(sm.orderCancelMinutes) * time.Minute)
		sm.mu.Unlock()

		// Start a fresh 10-minute cancel timer.
		sm.cancelTimer = time.AfterFunc(time.Duration(sm.orderCancelMinutes)*time.Minute, func() {
			sm.mu.Lock()
			if sm.state != StateOrderPlaced {
				sm.mu.Unlock()
				return
			}
			cancelledTradeID := sm.activeTradeID
			cancelledAtPrice := sm.currentPrice
			orderID := sm.activeOrderID
			sm.mu.Unlock()

			if !sm.safeCancelOrder(orderID, "Recovery cancel timer") {
				return // order was filled, checkOrderFilled handled the transition
			}

			sm.mu.Lock()
			if sm.state != StateOrderPlaced {
				sm.mu.Unlock()
				return
			}
			sm.activeOrderID = 0
			sm.activeOrderPrice = 0
			sm.activeTradeID = 0
			sm.tpPrice = 0
			sm.slPrice = 0
			if sm.entryOffset > sm.entryOffsetMin {
				sm.entryOffset -= sm.entryOffsetStep
			}
			sm.lastCancelAt = time.Now()
			sm.state = StateIdle
			algoState := sm.buildAlgoState()
			sm.mu.Unlock()
			if dbErr := sm.db.UpdateTrade(cancelledTradeID, 0, 0, "CANCELLED"); dbErr != nil {
				log.Printf("[Recovery] Cancel timer: UpdateTrade(CANCELLED) error: %v", dbErr)
			}
			if dbErr := sm.db.UpdateCancelPrice(cancelledTradeID, cancelledAtPrice); dbErr != nil {
				log.Printf("[Recovery] UpdateCancelPrice error for trade %d: %v", cancelledTradeID, dbErr)
			}
			go sm.notifyStateChange(algoState)
			log.Printf("[Recovery] Cancel timer fired for recovered order → IDLE, entryOffset now %.0f", sm.entryOffset)
		})

		log.Printf("[Recovery] Restored ORDER_PLACED state for trade #%d, order #%d at $%.2f",
			trade.ID, trade.OrderID, trade.OrderPrice)
		return nil
	}

	// trade.OrderID == 0: no order ID recorded — cannot recover, mark as CANCELLED.
	log.Printf("[Recovery] Trade #%d has no order ID — marking as CANCELLED", trade.ID)
	if dbErr := sm.db.UpdateTrade(trade.ID, 0, 0, "CANCELLED"); dbErr != nil {
		log.Printf("[Recovery] Warning: UpdateTrade(CANCELLED) for trade #%d: %v", trade.ID, dbErr)
	}
	return nil
}

// OnOrderExecuted handles a WebSocket order execution event.
// Called when an order fills on WhiteBit. This is the fast path for fill detection.
func (sm *StateMachine) OnOrderExecuted(orderID int64, fillPrice float64, side string) {
	sm.mu.Lock()

	switch {
	case sm.state == StateOrderPlaced && orderID == sm.activeOrderID:
		// Entry order filled — place TP/SL
		log.Printf("[StateMachine] WS: Entry order %d filled at $%.2f", orderID, fillPrice)
		sm.mu.Unlock()
		sm.checkOrderFilled(sm.ctx)
		return

	case sm.state == StatePositionOpen && orderID == sm.tpOrderID:
		// TP filled — cancel SL, close position
		log.Printf("[StateMachine] WS: TP order %d filled at $%.2f", orderID, fillPrice)
		slID := sm.slOrderID
		sm.mu.Unlock()
		// Cancel the SL
		if slID != 0 {
			if err := sm.orderMgr.CancelOrder(sm.ctx, slID); err != nil {
				log.Printf("[StateMachine] WS: CancelOrder(SL %d) error: %v", slID, err)
			}
		}
		// Let checkPositionClosed handle the full close flow on next poll
		// (it has all the PnL calculation and DB update logic)
		return

	case sm.state == StatePositionOpen && orderID == sm.slOrderID:
		// SL filled — cancel TP, close position
		log.Printf("[StateMachine] WS: SL order %d filled at $%.2f", orderID, fillPrice)
		tpID := sm.tpOrderID
		sm.mu.Unlock()
		// Cancel the TP
		if tpID != 0 {
			if err := sm.orderMgr.CancelOrder(sm.ctx, tpID); err != nil {
				log.Printf("[StateMachine] WS: CancelOrder(TP %d) error: %v", tpID, err)
			}
		}
		return

	default:
		sm.mu.Unlock()
	}
}

// OnOrderPending handles WebSocket order pending events.
// EventType: 1=new, 2=modified, 3=removed (cancelled)
func (sm *StateMachine) OnOrderPending(eventType int, orderID int64) {
	if eventType != 3 {
		return // only care about removals (cancellations)
	}

	sm.mu.Lock()
	if sm.state == StateOrderPlaced && orderID == sm.activeOrderID {
		log.Printf("[StateMachine] WS: Entry order %d removed/cancelled externally", orderID)
		sm.mu.Unlock()
		// Let checkOrderFilled handle the transition (it checks if filled vs cancelled)
		sm.checkOrderFilled(sm.ctx)
		return
	}
	sm.mu.Unlock()
}
