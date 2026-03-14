package algorithm

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"
)

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

// OrderManager is the interface the state machine calls to place/cancel orders.
type OrderManager interface {
	PlaceShortLimitOrder(ctx context.Context, price float64, amount string) (orderID int64, err error)
	CancelOrder(ctx context.Context, orderID int64) error
	PlaceTakeProfit(ctx context.Context, positionID int64, price float64) (orderID int64, err error)
	PlaceStopLoss(ctx context.Context, positionID int64, price float64) (orderID int64, err error)
	IsOrderFilled(ctx context.Context, orderID int64) (filled bool, fillPrice float64, err error)
	IsOrderFilled2(ctx context.Context, orderID int64) (filled bool, err error) // for TP/SL
}

// DBStore is the interface for persisting trades.
type DBStore interface {
	SaveReasoningSnapshot(snapshot ReasoningSnapshot) (tradeID int64, err error)
	UpdateTrade(tradeID int64, exitPrice float64, pnl float64, status string) error
	GetSetting(key string) (string, error)
	UpdateTodayPnL(pnl float64) (todayPnL float64, err error)
	GetTodayPnL() (float64, error)
	GetStartingBalance() (float64, error)
}

type StateMachine struct {
	mu          sync.Mutex
	state       BotState
	priceWindow *PriceWindow
	orderMgr    OrderManager
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

	// config (read from DB)
	positionSizeUSDT  float64
	leverage          int
	dailyLossLimitPct float64
	botEnabled        bool

	// callbacks
	OnStateChange func(AlgoState) // broadcast to dashboard

	ctx    context.Context
	cancel context.CancelFunc
}

func NewStateMachine(priceWindow *PriceWindow, orderMgr OrderManager, db DBStore) *StateMachine {
	ctx, cancel := context.WithCancel(context.Background())
	return &StateMachine{
		state:       StateIdle,
		priceWindow: priceWindow,
		orderMgr:    orderMgr,
		db:          db,
		ctx:         ctx,
		cancel:      cancel,
	}
}

// Start begins the polling loop that checks order status every 5 seconds.
func (sm *StateMachine) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(5 * time.Second)
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
	sm.mu.Unlock()

	switch state {
	case StateOrderPlaced:
		sm.checkOrderFilled(ctx)
	case StatePositionOpen:
		sm.checkPositionClosed(ctx)
	}
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

	filled, fillPrice, err := sm.orderMgr.IsOrderFilled(ctx, orderID)
	if err != nil {
		log.Printf("[StateMachine] IsOrderFilled error for order %d: %v", orderID, err)
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

	tpPrice := entryPrice - 50
	slPrice := entryPrice + 200

	tpID, err := sm.orderMgr.PlaceTakeProfit(ctx, orderID, tpPrice)
	if err != nil {
		log.Printf("[StateMachine] PlaceTakeProfit error: %v", err)
		return
	}

	slID, err := sm.orderMgr.PlaceStopLoss(ctx, orderID, slPrice)
	if err != nil {
		log.Printf("[StateMachine] PlaceStopLoss error: %v", err)
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
	sm.state = StatePositionOpen
	algoState := sm.buildAlgoState()
	sm.mu.Unlock()

	log.Printf("[StateMachine] Order %d filled at %.2f → POSITION_OPEN (TP=%.2f, SL=%.2f)", orderID, entryPrice, tpPrice, slPrice)
	sm.notifyStateChange(algoState)
}

func (sm *StateMachine) checkPositionClosed(ctx context.Context) {
	sm.mu.Lock()
	if sm.state != StatePositionOpen {
		sm.mu.Unlock()
		return
	}
	tpID := sm.tpOrderID
	slID := sm.slOrderID
	entryPrice := sm.activeOrderPrice
	tpPrice := sm.tpPrice
	slPrice := sm.slPrice
	tradeID := sm.activeTradeID
	sm.mu.Unlock()

	tpFilled, err := sm.orderMgr.IsOrderFilled2(ctx, tpID)
	if err != nil {
		log.Printf("[StateMachine] IsOrderFilled2(TP %d) error: %v", tpID, err)
		return
	}

	slFilled, err := sm.orderMgr.IsOrderFilled2(ctx, slID)
	if err != nil {
		log.Printf("[StateMachine] IsOrderFilled2(SL %d) error: %v", slID, err)
		return
	}

	if !tpFilled && !slFilled {
		return
	}

	var exitPrice float64
	var pnl float64
	var status string

	if tpFilled {
		exitPrice = tpPrice
		// Short position: profit = (entryPrice - exitPrice) * contractSize
		contractSize := sm.positionSizeUSDT / sm.activeOrderPrice * float64(sm.leverage)
		pnl = (entryPrice - exitPrice) * contractSize
		status = "TP_HIT"
		// Cancel the SL
		if cancelErr := sm.orderMgr.CancelOrder(ctx, slID); cancelErr != nil {
			log.Printf("[StateMachine] CancelOrder(SL %d) error: %v", slID, cancelErr)
		}
		log.Printf("[StateMachine] TP hit for trade %d — exitPrice=%.2f, pnl=%.2f", tradeID, exitPrice, pnl)
	} else {
		// SL filled
		exitPrice = slPrice
		contractSize := sm.positionSizeUSDT / sm.activeOrderPrice * float64(sm.leverage)
		pnl = (entryPrice - exitPrice) * contractSize // negative for a loss on short
		status = "SL_HIT"
		// Cancel the TP
		if cancelErr := sm.orderMgr.CancelOrder(ctx, tpID); cancelErr != nil {
			log.Printf("[StateMachine] CancelOrder(TP %d) error: %v", tpID, cancelErr)
		}
		log.Printf("[StateMachine] SL hit for trade %d — exitPrice=%.2f, pnl=%.2f", tradeID, exitPrice, pnl)
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
	algoState := sm.buildAlgoState()
	sm.mu.Unlock()

	log.Printf("[StateMachine] Position closed (%s) → IDLE", status)
	sm.notifyStateChange(algoState)

	// Circuit breaker check
	if pnlErr == nil {
		sm.checkCircuitBreaker(todayPnL)
	}
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
		high := sm.priceWindow.High()
		if high == 0 {
			return
		}
		if price < high {
			orderPrice := price + 150
			amount := fmt.Sprintf("%.6f", sm.positionSizeUSDT/price*float64(sm.leverage))

			orderID, err := sm.orderMgr.PlaceShortLimitOrder(sm.ctx, orderPrice, amount)
			if err != nil {
				log.Printf("[StateMachine] PlaceShortLimitOrder error: %v", err)
				return
			}

			tpPrice := orderPrice - 50
			slPrice := orderPrice + 200

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
			tradeID, dbErr := sm.db.SaveReasoningSnapshot(snapshot)
			if dbErr != nil {
				log.Printf("[StateMachine] SaveReasoningSnapshot error: %v", dbErr)
			}

			cancelAt := time.Now().Add(10 * time.Minute)
			sm.activeOrderID = orderID
			sm.activeOrderPrice = orderPrice
			sm.activeTradeID = tradeID
			sm.tpPrice = tpPrice
			sm.slPrice = slPrice
			sm.cancelAt = cancelAt
			sm.state = StateOrderPlaced

			// Start 10-minute cancel timer
			sm.cancelTimer = time.AfterFunc(10*time.Minute, func() {
				sm.mu.Lock()
				defer sm.mu.Unlock()

				if sm.state != StateOrderPlaced {
					return
				}
				cancelErr := sm.orderMgr.CancelOrder(sm.ctx, sm.activeOrderID)
				if cancelErr != nil {
					log.Printf("[StateMachine] Cancel timer: CancelOrder(%d) error: %v", sm.activeOrderID, cancelErr)
				}
				sm.activeOrderID = 0
				sm.activeOrderPrice = 0
				sm.activeTradeID = 0
				sm.tpPrice = 0
				sm.slPrice = 0
				sm.state = StateIdle

				algoState := sm.buildAlgoState()
				// Notify outside the lock via goroutine to avoid deadlock
				go sm.notifyStateChange(algoState)
				log.Printf("[StateMachine] Cancel timer fired → IDLE")
			})

			log.Printf("[StateMachine] Placed short limit order %d at %.2f (price=%.2f, high=%.2f)", orderID, orderPrice, price, high)
			algoState := sm.buildAlgoState()
			go sm.notifyStateChange(algoState)

		}

	case StateOrderPlaced:
		sm.priceWindow.Add(price)

	case StatePositionOpen:
		// poll loop handles TP/SL checks
	}
}

// SetEnabled starts or stops the bot.
func (sm *StateMachine) SetEnabled(enabled bool) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.botEnabled = enabled
	log.Printf("[StateMachine] botEnabled set to %v", enabled)
}

// LoadConfig refreshes config from DB (positionSize, leverage, dailyLossLimit, botEnabled).
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

	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.positionSizeUSDT = posSize
	sm.leverage = leverage
	sm.dailyLossLimitPct = dailyLoss
	sm.botEnabled = botEnabledStr == "true" || botEnabledStr == "1"

	log.Printf("[StateMachine] Config loaded: positionSize=%.2f, leverage=%d, dailyLossLimit=%.4f, botEnabled=%v",
		sm.positionSizeUSDT, sm.leverage, sm.dailyLossLimitPct, sm.botEnabled)
	return nil
}

// GetAlgoState returns a snapshot of current state for broadcasting.
func (sm *StateMachine) GetAlgoState() AlgoState {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	return sm.buildAlgoState()
}

// buildAlgoState constructs an AlgoState snapshot. Must be called with sm.mu held.
func (sm *StateMachine) buildAlgoState() AlgoState {
	high := sm.priceWindow.High()
	conditionMet := sm.currentPrice > 0 && high > 0 && sm.currentPrice < high
	var nextOrderPrice float64
	if conditionMet {
		nextOrderPrice = sm.currentPrice + 150
	}
	return AlgoState{
		State:            sm.state,
		CurrentPrice:     sm.currentPrice,
		High10min:        high,
		ConditionMet:     conditionMet,
		NextOrderPrice:   nextOrderPrice,
		ActiveOrderID:    sm.activeOrderID,
		ActiveOrderPrice: sm.activeOrderPrice,
		TPPrice:          sm.tpPrice,
		SLPrice:          sm.slPrice,
		CancelAt:         sm.cancelAt,
		BotEnabled:       sm.botEnabled,
	}
}

// notifyStateChange calls OnStateChange if set. Safe to call without holding the mutex.
func (sm *StateMachine) notifyStateChange(state AlgoState) {
	if sm.OnStateChange != nil {
		sm.OnStateChange(state)
	}
}
