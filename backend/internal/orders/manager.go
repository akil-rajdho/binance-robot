package orders

import (
	"context"
	"fmt"

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
	priceStr := fmt.Sprintf("%.2f", price)
	result, err := m.client.PlaceCollateralLimitOrder(m.market, "sell", amount, priceStr)
	if err != nil {
		return 0, fmt.Errorf("orders: PlaceShortLimitOrder: %w", err)
	}
	return result.OrderID, nil
}

// CancelOrder cancels the order with the given ID on the market.
func (m *Manager) CancelOrder(_ context.Context, orderID int64) error {
	if err := m.client.CancelOrder(m.market, orderID); err != nil {
		return fmt.Errorf("orders: CancelOrder %d: %w", orderID, err)
	}
	return nil
}

// PlaceTakeProfit places a limit BUY order to close a short position at the given price.
// amount "0" signals WhiteBit to close the entire position.
func (m *Manager) PlaceTakeProfit(_ context.Context, _ int64, price float64) (orderID int64, err error) {
	priceStr := fmt.Sprintf("%.2f", price)
	result, err := m.client.PlaceCollateralLimitOrder(m.market, "buy", "0", priceStr)
	if err != nil {
		return 0, fmt.Errorf("orders: PlaceTakeProfit: %w", err)
	}
	return result.OrderID, nil
}

// PlaceStopLoss places a stop-limit BUY order to close a short position when price rises to SL price.
// Uses activation_price = SL price, limit price = SL price + 10 (slippage buffer).
func (m *Manager) PlaceStopLoss(_ context.Context, _ int64, price float64) (orderID int64, err error) {
	priceStr := fmt.Sprintf("%.2f", price)
	limitStr := fmt.Sprintf("%.2f", price+10)
	result, err := m.client.PlaceStopLimitOrder(m.market, "buy", "0", priceStr, limitStr)
	if err != nil {
		return 0, fmt.Errorf("orders: PlaceStopLoss: %w", err)
	}
	return result.OrderID, nil
}

// IsOrderFilled uses a two-step check to distinguish filled from cancelled orders:
// 1. If the order is still in active orders → not filled yet.
// 2. If the order appears in executed orders → filled, returns fill price.
// 3. If absent from both → order was cancelled, returns filled=false.
func (m *Manager) IsOrderFilled(_ context.Context, orderID int64) (filled bool, fillPrice float64, err error) {
	activeOrders, err := m.client.GetActiveOrders(m.market)
	if err != nil {
		return false, 0, fmt.Errorf("orders: IsOrderFilled GetActiveOrders: %w", err)
	}

	for _, o := range activeOrders {
		if o.OrderID == orderID {
			// Still active — not filled
			return false, 0, nil
		}
	}

	// Not in active orders — check execution history
	found, fp, execErr := m.client.GetExecutedOrder(m.market, orderID)
	if execErr != nil {
		return false, 0, fmt.Errorf("orders: IsOrderFilled GetExecutedOrder: %w", execErr)
	}
	if found {
		return true, fp, nil
	}

	// Not in active, not in executed — order was cancelled
	return false, 0, nil
}

// IsOrderFilled2 is the simplified variant used for TP/SL checks.
// Uses the same two-step check: active → executed → cancelled.
func (m *Manager) IsOrderFilled2(_ context.Context, orderID int64) (filled bool, err error) {
	activeOrders, err := m.client.GetActiveOrders(m.market)
	if err != nil {
		return false, fmt.Errorf("orders: IsOrderFilled2 GetActiveOrders: %w", err)
	}

	for _, o := range activeOrders {
		if o.OrderID == orderID {
			// Still active — not filled
			return false, nil
		}
	}

	// Not in active orders — check execution history
	found, _, execErr := m.client.GetExecutedOrder(m.market, orderID)
	if execErr != nil {
		return false, fmt.Errorf("orders: IsOrderFilled2 GetExecutedOrder: %w", execErr)
	}
	if found {
		return true, nil
	}

	// Not in active, not in executed — order was cancelled
	return false, nil
}
