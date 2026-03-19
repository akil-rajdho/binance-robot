package orders

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/bitcoin-robot/backend/internal/algorithm"
	"github.com/bitcoin-robot/backend/internal/whitebit"
)

// Manager implements algorithm.OrderManager using the WhiteBit client.
type Manager struct {
	client *whitebit.Client
	market string // e.g. "BTC_PERP"
}

// NewManager creates a new order Manager for the given market.
func NewManager(client *whitebit.Client, market string) *Manager {
	return &Manager{
		client: client,
		market: market,
	}
}

// PlaceShortLimitOrder places a collateral limit sell order on the market.
func (m *Manager) PlaceShortLimitOrder(_ context.Context, price float64, amount string) (orderID int64, err error) {
	priceStr := fmt.Sprintf("%.1f", price)
	result, err := m.client.PlaceCollateralLimitOrder(m.market, "sell", amount, priceStr, "")
	if err != nil {
		return 0, fmt.Errorf("orders: PlaceShortLimitOrder: %w", err)
	}
	return result.OrderID, nil
}

// CancelOrder cancels an order by ID. It tries the regular collateral limit cancel first,
// then falls back to the conditional cancel. This handles both entry/TP orders (regular limit)
// and SL orders (conditional stop-limit) with a single call.
func (m *Manager) CancelOrder(_ context.Context, orderID int64) error {
	// Try regular collateral limit cancel first (entry order, TP order)
	if err := m.client.CancelCollateralLimitOrder(m.market, orderID); err == nil {
		return nil
	}
	// Fall back to conditional cancel (stop-loss order)
	if err := m.client.CancelConditionalOrder(m.market, orderID); err == nil {
		return nil
	}
	return fmt.Errorf("orders: CancelOrder %d: failed both regular and conditional cancel", orderID)
}

// PlaceTakeProfit places a limit BUY order to close a short position at the given price.
// amount "0" signals WhiteBit to close the entire position.
func (m *Manager) PlaceTakeProfit(_ context.Context, _ int64, price float64, amount string) (orderID int64, err error) {
	priceStr := fmt.Sprintf("%.1f", price)
	if amount == "" {
		amount = "0"
	}
	result, err := m.client.PlaceCollateralLimitOrder(m.market, "buy", amount, priceStr, "")
	if err != nil {
		return 0, fmt.Errorf("orders: PlaceTakeProfit: %w", err)
	}
	return result.OrderID, nil
}

// PlaceStopLoss places a stop-limit BUY order to close a short position when price rises to SL price.
// Uses activation_price = SL price, limit price = SL price + 10 (slippage buffer).
func (m *Manager) PlaceStopLoss(_ context.Context, _ int64, price float64, amount string) (orderID int64, err error) {
	priceStr := fmt.Sprintf("%.1f", price)
	limitStr := fmt.Sprintf("%.1f", price+10)
	if amount == "" {
		amount = "0"
	}
	result, err := m.client.PlaceStopLimitOrder(m.market, "buy", amount, priceStr, limitStr)
	if err != nil {
		return 0, fmt.Errorf("orders: PlaceStopLoss: %w", err)
	}
	return result.OrderID, nil
}

// IsOrderFilled checks if the entry order (regular collateral limit) has been filled.
// Returns (filled, cancelled, fillPrice, error).
// 1. If still in active collateral orders → filled=false, cancelled=false.
// 2. If in execution history → filled=true, cancelled=false.
// 3. Absent from both → filled=false, cancelled=true.
func (m *Manager) IsOrderFilled(_ context.Context, orderID int64) (filled bool, cancelled bool, fillPrice float64, err error) {
	activeOrders, err := m.client.GetActiveCollateralLimitOrders(m.market)
	if err != nil {
		return false, false, 0, fmt.Errorf("orders: IsOrderFilled GetActiveCollateralLimitOrders: %w", err)
	}
	for _, o := range activeOrders {
		if o.OrderID == orderID {
			return false, false, 0, nil // still active
		}
	}

	// Not in active — check execution history
	found, fp, execErr := m.client.GetExecutedOrder(m.market, orderID)
	if execErr != nil {
		return false, false, 0, fmt.Errorf("orders: IsOrderFilled GetExecutedOrder: %w", execErr)
	}
	if found {
		return true, false, fp, nil
	}

	// Not in active, not in executed — was cancelled externally
	return false, true, 0, nil
}

// PlaceMarketClose places a market buy order to close the entire short position.
// amount "0" signals WhiteBit to close the full position.
func (m *Manager) PlaceMarketClose(_ context.Context) (orderID int64, err error) {
	result, err := m.client.PlaceCollateralMarketOrder(m.market, "buy", "0")
	if err != nil {
		return 0, fmt.Errorf("orders: PlaceMarketClose: %w", err)
	}
	return result.OrderID, nil
}

// IsOrderFilled2 checks if a TP or SL order has been filled.
// It checks both regular and conditional active orders, then execution history.
func (m *Manager) IsOrderFilled2(_ context.Context, orderID int64) (filled bool, err error) {
	// Check regular active orders (covers TP which is a collateral limit buy)
	regularOrders, err := m.client.GetActiveCollateralLimitOrders(m.market)
	if err != nil {
		return false, fmt.Errorf("orders: IsOrderFilled2 GetActiveCollateralLimitOrders: %w", err)
	}
	for _, o := range regularOrders {
		if o.OrderID == orderID {
			return false, nil // still active
		}
	}

	// Check conditional active orders (covers SL which is a stop-limit)
	conditionalOrders, err := m.client.GetActiveConditionalOrders(m.market)
	if err != nil {
		// Non-fatal: API key may lack permission. Log and continue to execution history check.
		fmt.Printf("[Orders] IsOrderFilled2: GetActiveConditionalOrders error (non-fatal): %v\n", err)
	} else {
		for _, o := range conditionalOrders {
			if o.OrderID == orderID {
				return false, nil // still active
			}
		}
	}

	// Not in any active list — check execution history
	found, _, execErr := m.client.GetExecutedOrder(m.market, orderID)
	if execErr != nil {
		return false, fmt.Errorf("orders: IsOrderFilled2 GetExecutedOrder: %w", execErr)
	}
	return found, nil
}

// GetOpenPositions returns all open positions for the market.
func (m *Manager) GetOpenPositions(_ context.Context) ([]algorithm.OpenPosition, error) {
	positions, err := m.client.GetPositions()
	if err != nil {
		return nil, fmt.Errorf("orders: GetOpenPositions: %w", err)
	}
	var result []algorithm.OpenPosition
	for _, p := range positions {
		// WhiteBit returns "BTC-PERP" but we use "BTC_PERP" — normalize both
		normalizedPos := strings.ReplaceAll(strings.ToUpper(p.Market), "-", "_")
		normalizedWant := strings.ReplaceAll(strings.ToUpper(m.market), "-", "_")
		if normalizedPos != normalizedWant {
			fmt.Printf("[Orders] GetOpenPositions: skipping position market=%s (want %s)\n", p.Market, m.market)
			continue
		}
		amount, _ := strconv.ParseFloat(p.Amount, 64)
		basePrice, _ := strconv.ParseFloat(p.BasePrice, 64)
		if amount == 0 {
			continue
		}
		// WhiteBit doesn't return a "side" field — determine from amount sign
		// Negative amount = short, positive = long
		side := "long"
		if amount < 0 {
			side = "short"
			amount = -amount
		}
		fmt.Printf("[Orders] GetOpenPositions: found position market=%s side=%s amount=%.4f basePrice=%.2f\n", p.Market, side, amount, basePrice)
		result = append(result, algorithm.OpenPosition{
			Market:    p.Market,
			Side:      side,
			Amount:    amount,
			BasePrice: basePrice,
		})
	}
	return result, nil
}

// GetActiveShortOrders returns all active sell orders for the market.
// Used by the state machine to detect manually placed orders and prevent duplicate order placement.
func (m *Manager) GetActiveShortOrders(_ context.Context) ([]algorithm.ActiveOrder, error) {
	orders, err := m.client.GetActiveCollateralLimitOrders(m.market)
	if err != nil {
		return nil, fmt.Errorf("orders: GetActiveShortOrders: %w", err)
	}
	var active []algorithm.ActiveOrder
	for _, o := range orders {
		side := strings.ToLower(o.Side)
		if side == "sell" {
			price, parseErr := strconv.ParseFloat(o.Price, 64)
			if parseErr != nil {
				continue
			}
			active = append(active, algorithm.ActiveOrder{
				OrderID: o.OrderID,
				Price:   price,
				Side:    side,
			})
		}
	}
	return active, nil
}
