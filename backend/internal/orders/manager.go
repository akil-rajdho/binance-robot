package orders

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"strings"

	"github.com/bitcoin-robot/backend/internal/algorithm"
	"github.com/bitcoin-robot/backend/internal/whitebit"
)

// Manager implements algorithm.OrderManager using the WhiteBit client.
type Manager struct {
	client *whitebit.Client
	market string // e.g. "BTC_USDT"
}

// NewManager creates a new order Manager for the given market.
func NewManager(client *whitebit.Client, market string) *Manager {
	return &Manager{
		client: client,
		market: market,
	}
}

// PlaceShortLimitOrder places a margin limit sell order on the market.
func (m *Manager) PlaceShortLimitOrder(_ context.Context, price float64, amount string) (orderID int64, err error) {
	priceStr := fmt.Sprintf("%.1f", price)
	result, err := m.client.PlaceMarginLimitOrder(m.market, "sell", amount, priceStr)
	if err != nil {
		return 0, fmt.Errorf("orders: PlaceShortLimitOrder: %w", err)
	}
	return result.OrderID, nil
}

// CancelOrder cancels an order by ID. It tries the regular limit cancel first,
// then falls back to the conditional cancel for stop-limit orders.
func (m *Manager) CancelOrder(_ context.Context, orderID int64) error {
	if err := m.client.CancelCollateralLimitOrder(m.market, orderID); err == nil {
		return nil
	}
	if err := m.client.CancelConditionalOrder(m.market, orderID); err == nil {
		return nil
	}
	return fmt.Errorf("orders: CancelOrder %d: failed both regular and conditional cancel", orderID)
}

// PlaceTakeProfit places a limit BUY order to close a short position at the given price.
// For margin trading, amount must be specified — no "0" close-entire shortcut.
func (m *Manager) PlaceTakeProfit(_ context.Context, _ int64, price float64, amount string) (orderID int64, err error) {
	priceStr := fmt.Sprintf("%.1f", price)
	result, err := m.client.PlaceMarginLimitOrder(m.market, "buy", amount, priceStr)
	if err != nil {
		return 0, fmt.Errorf("orders: PlaceTakeProfit: %w", err)
	}
	return result.OrderID, nil
}

// PlaceStopLoss places a stop-limit BUY order to close a short position when price rises to SL price.
// Uses activation_price = SL price, limit price = SL price + 10 (slippage buffer).
// For margin trading, amount must be specified — no "0" close-entire shortcut.
func (m *Manager) PlaceStopLoss(_ context.Context, _ int64, price float64, amount string) (orderID int64, err error) {
	priceStr := fmt.Sprintf("%.1f", price)
	limitStr := fmt.Sprintf("%.1f", price+10)
	result, err := m.client.PlaceMarginStopLimitOrder(m.market, "buy", amount, priceStr, limitStr)
	if err != nil {
		return 0, fmt.Errorf("orders: PlaceStopLoss: %w", err)
	}
	return result.OrderID, nil
}

// IsOrderFilled checks if the entry order (margin limit) has been filled.
// Returns (filled, cancelled, fillPrice, error).
// 1. If still in active orders → filled=false, cancelled=false.
// 2. If in execution history → filled=true, cancelled=false.
// 3. Absent from both → filled=false, cancelled=true.
func (m *Manager) IsOrderFilled(_ context.Context, orderID int64) (filled bool, cancelled bool, fillPrice float64, err error) {
	activeOrders, err := m.client.GetActiveCollateralLimitOrders(m.market)
	if err != nil {
		return false, false, 0, fmt.Errorf("orders: IsOrderFilled GetActiveOrders: %w", err)
	}
	for _, o := range activeOrders {
		if o.OrderID == orderID {
			return false, false, 0, nil // still active
		}
	}

	found, fp, execErr := m.client.GetExecutedOrder(m.market, orderID)
	if execErr != nil {
		return false, false, 0, fmt.Errorf("orders: IsOrderFilled GetExecutedOrder: %w", execErr)
	}
	if found {
		return true, false, fp, nil
	}

	return false, true, 0, nil
}

// PlaceMarketClose places a market buy order to close the entire short position.
// For margin, queries the open position size first (no "amount=0" shortcut).
func (m *Manager) PlaceMarketClose(_ context.Context) (orderID int64, err error) {
	positions, err := m.client.GetMarginPositions()
	if err != nil {
		return 0, fmt.Errorf("orders: PlaceMarketClose: get positions: %w", err)
	}

	amount := ""
	for _, p := range positions {
		normalizedPos := strings.ReplaceAll(strings.ToUpper(p.Market), "-", "_")
		normalizedWant := strings.ReplaceAll(strings.ToUpper(m.market), "-", "_")
		if normalizedPos == normalizedWant && strings.ToLower(p.Side) == "sell" {
			amount = p.Amount
			break
		}
	}

	if amount == "" || amount == "0" {
		return 0, fmt.Errorf("orders: PlaceMarketClose: no open short position found for %s", m.market)
	}

	result, err := m.client.PlaceMarginMarketOrder(m.market, "buy", amount)
	if err != nil {
		return 0, fmt.Errorf("orders: PlaceMarketClose: %w", err)
	}
	return result.OrderID, nil
}

// IsOrderFilled2 checks if a TP or SL order has been filled.
// Checks active orders, then execution history.
func (m *Manager) IsOrderFilled2(_ context.Context, orderID int64) (filled bool, err error) {
	regularOrders, err := m.client.GetActiveCollateralLimitOrders(m.market)
	if err != nil {
		return false, fmt.Errorf("orders: IsOrderFilled2 GetActiveOrders: %w", err)
	}
	for _, o := range regularOrders {
		if o.OrderID == orderID {
			return false, nil // still active
		}
	}

	found, _, execErr := m.client.GetExecutedOrder(m.market, orderID)
	if execErr != nil {
		return false, fmt.Errorf("orders: IsOrderFilled2 GetExecutedOrder: %w", execErr)
	}
	if found {
		return true, nil
	}

	// Not in active orders AND not in execution history — treat as filled.
	log.Printf("[Orders] IsOrderFilled2: order %d not found anywhere — treating as filled\n", orderID)
	return true, nil
}

// GetOpenPositions returns all open margin positions for the market.
func (m *Manager) GetOpenPositions(_ context.Context) ([]algorithm.OpenPosition, error) {
	positions, err := m.client.GetMarginPositions()
	if err != nil {
		return nil, fmt.Errorf("orders: GetOpenPositions: %w", err)
	}
	var result []algorithm.OpenPosition
	for _, p := range positions {
		normalizedPos := strings.ReplaceAll(strings.ToUpper(p.Market), "-", "_")
		normalizedWant := strings.ReplaceAll(strings.ToUpper(m.market), "-", "_")
		if normalizedPos != normalizedWant {
			continue
		}
		amount, _ := strconv.ParseFloat(p.Amount, 64)
		basePrice, _ := strconv.ParseFloat(p.BasePrice, 64)
		if amount == 0 {
			continue
		}
		// Margin API returns explicit side: "sell" = short, "buy" = long
		rawSide := strings.ToLower(p.Side)
		side := "long"
		if rawSide == "sell" {
			side = "short"
		}
		log.Printf("[Orders] GetOpenPositions: found position market=%s side=%s amount=%.4f basePrice=%.2f", p.Market, side, amount, basePrice)
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
