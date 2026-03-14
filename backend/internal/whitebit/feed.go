package whitebit

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/gorilla/websocket"
)

const wsURL = "wss://api.whitebit.com/ws"

// Candle represents a single OHLCV candlestick.
type Candle struct {
	Time   int64   // Unix timestamp
	Open   float64
	High   float64
	Low    float64
	Close  float64
	Volume float64
}

// PriceFeed subscribes to WhiteBit WebSocket price updates for a configurable
// market and candle interval.
type PriceFeed struct {
	market      string
	interval    string
	OnCandle    func(candle Candle)
	OnLastPrice func(price float64)
}

// NewPriceFeed creates a new PriceFeed for the given market and candle interval
// with the provided callbacks.
func NewPriceFeed(market, interval string, onCandle func(Candle), onLastPrice func(float64)) *PriceFeed {
	return &PriceFeed{
		market:      market,
		interval:    interval,
		OnCandle:    onCandle,
		OnLastPrice: onLastPrice,
	}
}

// wsMessage is the generic envelope for WhiteBit WebSocket frames.
type wsMessage struct {
	ID     int64           `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

// Start connects to the WhiteBit WebSocket, subscribes to candles and last
// price for the configured market, and dispatches updates to the registered
// callbacks. It reconnects automatically with exponential backoff
// (1s → 2s → 4s → 8s, capped at 30s) whenever the connection drops. It
// returns only when ctx is cancelled.
func (f *PriceFeed) Start(ctx context.Context) error {
	backoff := time.Second
	const maxBackoff = 30 * time.Second

	for {
		err := f.runConnection(ctx)
		if ctx.Err() != nil {
			// Context cancelled — clean shutdown.
			return ctx.Err()
		}
		if err != nil {
			fmt.Printf("whitebit feed: connection error: %v — reconnecting in %s\n", err, backoff)
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
		}

		backoff *= 2
		if backoff > maxBackoff {
			backoff = maxBackoff
		}
	}
}

// runConnection establishes one WebSocket session and reads messages until
// the connection closes or ctx is cancelled.
func (f *PriceFeed) runConnection(ctx context.Context) error {
	conn, _, err := websocket.DefaultDialer.DialContext(ctx, wsURL, nil)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()

	// Subscribe to candles for the configured market and interval.
	if err := conn.WriteJSON(map[string]interface{}{
		"id":     1,
		"method": "candles_subscribe",
		"params": []interface{}{f.market, f.interval},
	}); err != nil {
		return fmt.Errorf("subscribe candles: %w", err)
	}

	// Subscribe to last price for the configured market.
	if err := conn.WriteJSON(map[string]interface{}{
		"id":     2,
		"method": "lastprice_subscribe",
		"params": []interface{}{f.market},
	}); err != nil {
		return fmt.Errorf("subscribe lastprice: %w", err)
	}

	// Ping ticker to keep the connection alive.
	pingTicker := time.NewTicker(50 * time.Second)
	defer pingTicker.Stop()

	// Channel to propagate read errors back to the select loop.
	readErr := make(chan error, 1)
	msgs := make(chan wsMessage, 64)

	go func() {
		for {
			var msg wsMessage
			if err := conn.ReadJSON(&msg); err != nil {
				readErr <- err
				return
			}
			msgs <- msg
		}
	}()

	for {
		select {
		case <-ctx.Done():
			// Send a close frame then return.
			_ = conn.WriteMessage(
				websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""),
			)
			return nil

		case err := <-readErr:
			return fmt.Errorf("read: %w", err)

		case <-pingTicker.C:
			if err := conn.WriteJSON(map[string]interface{}{
				"id":     3,
				"method": "ping",
				"params": []interface{}{},
			}); err != nil {
				return fmt.Errorf("ping: %w", err)
			}

		case msg := <-msgs:
			f.handleMessage(msg)
		}
	}
}

// handleMessage routes an incoming WebSocket message to the appropriate handler.
func (f *PriceFeed) handleMessage(msg wsMessage) {
	switch msg.Method {
	case "candles_update":
		f.handleCandlesUpdate(msg.Params)
	case "lastprice_update":
		f.handleLastPriceUpdate(msg.Params)
	// Ignore: pong, subscription confirmations, and unknown methods.
	}
}

// handleCandlesUpdate parses a candles_update params payload.
//
// The payload is an array of candle arrays; each candle array has the form:
//
//	[time, open, close, high, low, volume, ...]
//
// index 0 → Time, 1 → Open, 2 → Close, 3 → High, 4 → Low, 5 → Volume
//
// Fields may arrive as JSON numbers or quoted strings — parseFloat handles both.
func (f *PriceFeed) handleCandlesUpdate(raw json.RawMessage) {
	if f.OnCandle == nil {
		return
	}

	// params is: [[time, open, close, high, low, volume, ...], ...]
	var candleArrays [][]json.RawMessage
	if err := json.Unmarshal(raw, &candleArrays); err != nil {
		return
	}

	for _, fields := range candleArrays {
		if len(fields) < 6 {
			continue
		}
		t, err0 := parseRawInt(fields[0])
		open, err1 := parseRawFloat(fields[1])
		close_, err2 := parseRawFloat(fields[2])
		high, err3 := parseRawFloat(fields[3])
		low, err4 := parseRawFloat(fields[4])
		vol, err5 := parseRawFloat(fields[5])
		if err0 != nil || err1 != nil || err2 != nil || err3 != nil || err4 != nil || err5 != nil {
			continue
		}
		f.OnCandle(Candle{
			Time:   t,
			Open:   open,
			Close:  close_,
			High:   high,
			Low:    low,
			Volume: vol,
		})
	}
}

// handleLastPriceUpdate parses a lastprice_update params payload.
//
// The payload is: ["MARKET", "price_string"]
func (f *PriceFeed) handleLastPriceUpdate(raw json.RawMessage) {
	if f.OnLastPrice == nil {
		return
	}

	var params []json.RawMessage
	if err := json.Unmarshal(raw, &params); err != nil || len(params) < 2 {
		return
	}

	price, err := parseRawFloat(params[1])
	if err != nil {
		return
	}
	f.OnLastPrice(price)
}

// parseRawFloat converts a json.RawMessage that is either a JSON number or a
// quoted string into a float64.
func parseRawFloat(raw json.RawMessage) (float64, error) {
	// Try number first.
	var f float64
	if err := json.Unmarshal(raw, &f); err == nil {
		return f, nil
	}
	// Try quoted string.
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return 0, fmt.Errorf("parseRawFloat: cannot decode %s", raw)
	}
	return strconv.ParseFloat(s, 64)
}

// parseRawInt converts a json.RawMessage (number or quoted string) into int64.
func parseRawInt(raw json.RawMessage) (int64, error) {
	var i int64
	if err := json.Unmarshal(raw, &i); err == nil {
		return i, nil
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return 0, fmt.Errorf("parseRawInt: cannot decode %s", raw)
	}
	return strconv.ParseInt(s, 10, 64)
}
