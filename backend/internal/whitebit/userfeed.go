package whitebit

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"time"

	"github.com/gorilla/websocket"
)

// ExecutedOrderEvent represents a filled order from the WebSocket stream.
type ExecutedOrderEvent struct {
	OrderID   int64
	Market    string
	Side      string // "sell" or "buy"
	Price     float64
	Amount    float64
	Timestamp float64
}

// PendingOrderEvent represents an order lifecycle event from the WebSocket stream.
// EventType: 1=new, 2=modified, 3=removed (cancelled or filled)
type PendingOrderEvent struct {
	EventType int
	OrderID   int64
	Market    string
	Side      string // "sell" or "buy"
	Price     float64
	Amount    float64
}

// UserFeed subscribes to WhiteBit WebSocket authenticated streams for order updates.
type UserFeed struct {
	client          *Client
	market          string
	OnOrderExecuted func(event ExecutedOrderEvent)
	OnOrderPending  func(event PendingOrderEvent)
}

// NewUserFeed creates a new UserFeed for the given market.
func NewUserFeed(client *Client, market string) *UserFeed {
	return &UserFeed{
		client: client,
		market: market,
	}
}

// Start connects to the WebSocket, authenticates, subscribes, and processes events.
// It reconnects automatically on failure. Blocks until ctx is cancelled.
func (f *UserFeed) Start(ctx context.Context) {
	backoff := time.Second
	maxBackoff := 30 * time.Second

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		err := f.run(ctx)
		if err != nil {
			log.Printf("[UserFeed] connection error: %v — reconnecting in %s", err, backoff)
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}

		backoff *= 2
		if backoff > maxBackoff {
			backoff = maxBackoff
		}
	}
}

func (f *UserFeed) run(ctx context.Context) error {
	// Get fresh auth token
	token, err := f.client.GetWebSocketToken()
	if err != nil {
		return fmt.Errorf("get ws token: %w", err)
	}
	log.Printf("[UserFeed] got WebSocket token, connecting...")

	conn, _, err := websocket.DefaultDialer.DialContext(ctx, wsURL, nil)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()

	// Authorize
	authMsg := map[string]interface{}{
		"id":     1,
		"method": "authorize",
		"params": []interface{}{token, "public"},
	}
	if err := conn.WriteJSON(authMsg); err != nil {
		return fmt.Errorf("send auth: %w", err)
	}

	// Read auth response
	_, rawResp, err := conn.ReadMessage()
	if err != nil {
		return fmt.Errorf("read auth response: %w", err)
	}
	log.Printf("[UserFeed] auth response: %s", string(rawResp))

	// Check auth success
	var authResp struct {
		Result struct {
			Status string `json:"status"`
		} `json:"result"`
		Error interface{} `json:"error"`
	}
	if err := json.Unmarshal(rawResp, &authResp); err != nil {
		return fmt.Errorf("parse auth response: %w", err)
	}
	if authResp.Result.Status != "success" {
		return fmt.Errorf("auth failed: %s", string(rawResp))
	}
	log.Println("[UserFeed] authenticated successfully")

	// Subscribe to ordersPending (order lifecycle: new, modified, cancelled)
	pendingSub := map[string]interface{}{
		"id":     2,
		"method": "ordersPending_subscribe",
		"params": []interface{}{f.market},
	}
	if err := conn.WriteJSON(pendingSub); err != nil {
		return fmt.Errorf("subscribe ordersPending: %w", err)
	}

	// Subscribe to ordersExecuted (fills)
	executedSub := map[string]interface{}{
		"id":     3,
		"method": "ordersExecuted_subscribe",
		"params": []interface{}{[]interface{}{f.market}, 0},
	}
	if err := conn.WriteJSON(executedSub); err != nil {
		return fmt.Errorf("subscribe ordersExecuted: %w", err)
	}

	log.Printf("[UserFeed] subscribed to order streams for %s", f.market)

	// Ping ticker to keep the connection alive
	pingTicker := time.NewTicker(30 * time.Second)
	defer pingTicker.Stop()

	// Read messages in a goroutine
	msgCh := make(chan []byte, 64)
	errCh := make(chan error, 1)
	go func() {
		for {
			_, raw, err := conn.ReadMessage()
			if err != nil {
				errCh <- err
				return
			}
			msgCh <- raw
		}
	}()

	for {
		select {
		case <-ctx.Done():
			return nil
		case err := <-errCh:
			return fmt.Errorf("read: %w", err)
		case raw := <-msgCh:
			var msg wsMessage
			if err := json.Unmarshal(raw, &msg); err != nil {
				continue
			}
			switch msg.Method {
			case "ordersPending_update":
				f.handlePendingUpdate(msg.Params)
			case "ordersExecuted_update":
				f.handleExecutedUpdate(msg.Params)
			}
		case <-pingTicker.C:
			if err := conn.WriteJSON(map[string]interface{}{
				"id":     0,
				"method": "ping",
				"params": []interface{}{},
			}); err != nil {
				return fmt.Errorf("ping: %w", err)
			}
		}
	}
}

func (f *UserFeed) handlePendingUpdate(params json.RawMessage) {
	if f.OnOrderPending == nil {
		return
	}

	// WhiteBit sends: [eventType, {order object}]
	var raw []json.RawMessage
	if err := json.Unmarshal(params, &raw); err != nil || len(raw) < 2 {
		return
	}

	var eventType int
	if err := json.Unmarshal(raw[0], &eventType); err != nil {
		return
	}

	var order struct {
		ID     int64  `json:"id"`
		Market string `json:"market"`
		Side   int    `json:"side"` // 1=sell, 2=buy
		Price  string `json:"price"`
		Amount string `json:"amount"`
	}
	if err := json.Unmarshal(raw[1], &order); err != nil {
		return
	}

	side := "sell"
	if order.Side == 2 {
		side = "buy"
	}
	price, _ := strconv.ParseFloat(order.Price, 64)
	amount, _ := strconv.ParseFloat(order.Amount, 64)

	log.Printf("[UserFeed] ordersPending event=%d id=%d market=%s side=%s price=%.2f", eventType, order.ID, order.Market, side, price)

	f.OnOrderPending(PendingOrderEvent{
		EventType: eventType,
		OrderID:   order.ID,
		Market:    order.Market,
		Side:      side,
		Price:     price,
		Amount:    amount,
	})
}

func (f *UserFeed) handleExecutedUpdate(params json.RawMessage) {
	if f.OnOrderExecuted == nil {
		return
	}

	// WhiteBit sends: [{executed order object}]
	var orders []json.RawMessage
	if err := json.Unmarshal(params, &orders); err != nil || len(orders) == 0 {
		return
	}

	for _, raw := range orders {
		var order struct {
			ID     int64   `json:"id"`
			Market string  `json:"market"`
			Side   int     `json:"side"` // 1=sell, 2=buy
			Price  string  `json:"price"`
			Amount string  `json:"amount"`
			Time   float64 `json:"time"`
		}
		if err := json.Unmarshal(raw, &order); err != nil {
			continue
		}

		side := "sell"
		if order.Side == 2 {
			side = "buy"
		}
		price, _ := strconv.ParseFloat(order.Price, 64)
		amount, _ := strconv.ParseFloat(order.Amount, 64)

		log.Printf("[UserFeed] ordersExecuted id=%d market=%s side=%s price=%.2f amount=%.4f", order.ID, order.Market, side, price, amount)

		f.OnOrderExecuted(ExecutedOrderEvent{
			OrderID:   order.ID,
			Market:    order.Market,
			Side:      side,
			Price:     price,
			Amount:    amount,
			Timestamp: order.Time,
		})
	}
}
