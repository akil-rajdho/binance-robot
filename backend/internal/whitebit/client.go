package whitebit

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha512"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

const defaultBaseURL = "https://whitebit.com"

// Client is a WhiteBit REST API client with HMAC-SHA512 authentication.
type Client struct {
	apiKey     string
	apiSecret  string
	baseURL    string
	httpClient *http.Client
}

// NewClient creates a new WhiteBit API client.
func NewClient(apiKey, apiSecret string) *Client {
	return &Client{
		apiKey:    apiKey,
		apiSecret: apiSecret,
		baseURL:   defaultBaseURL,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// OrderResult represents the result of an order operation.
type OrderResult struct {
	OrderID   int64  `json:"orderId"`
	Market    string `json:"market"`
	Side      string `json:"side"`
	Price     string `json:"price"`
	Amount    string `json:"amount"`
	Status    string `json:"status"` // "active", "filled", "cancelled"
	Timestamp float64 `json:"timestamp"`
}

// Position represents an open collateral position.
type Position struct {
	Market        string `json:"market"`
	Side          string `json:"side"` // "long" or "short"
	Amount        string `json:"amount"`
	BasePrice     string `json:"basePrice"`
	LiquidPrice   string `json:"liquidationPrice"`
	UnrealizedPnL string `json:"unrealizedFunding"`
}

// signRequest builds the authentication headers for a private API call.
// It mutates body by adding "request" and "nonce" fields before signing,
// then marshals the body exactly once and returns both the headers and the
// marshalled bytes so that the caller can use the same bytes as the HTTP
// request body — avoiding a double-marshal whose key order may differ.
func (c *Client) signRequest(endpoint string, body map[string]interface{}) (headers map[string]string, bodyBytes []byte, err error) {
	body["request"] = endpoint
	body["nonce"] = strconv.FormatInt(time.Now().UnixMilli(), 10)

	raw, err := json.Marshal(body)
	if err != nil {
		return nil, nil, fmt.Errorf("whitebit: marshal request body: %w", err)
	}

	payload := base64.StdEncoding.EncodeToString(raw)

	mac := hmac.New(sha512.New, []byte(c.apiSecret))
	mac.Write([]byte(payload))
	sig := hex.EncodeToString(mac.Sum(nil))

	return map[string]string{
		"Content-Type":    "application/json",
		"X-TXC-APIKEY":    c.apiKey,
		"X-TXC-PAYLOAD":   payload,
		"X-TXC-SIGNATURE": sig,
	}, raw, nil
}

// doRequest signs and executes a POST request to a private endpoint, then
// decodes the JSON response body into dst.
func (c *Client) doRequest(ctx context.Context, endpoint string, body map[string]interface{}, dst interface{}) error {
	headers, bodyBytes, err := c.signRequest(endpoint, body)
	if err != nil {
		return err
	}

	url := c.baseURL + endpoint
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyBytes))
	if err != nil {
		return fmt.Errorf("whitebit: create request: %w", err)
	}

	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("whitebit: execute request to %s: %w", endpoint, err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("whitebit: read response body: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("whitebit: %s returned HTTP %d: %s", endpoint, resp.StatusCode, respBody)
	}

	// Some endpoints (e.g. /api/v4/orders) return a bare JSON array.
	// Only attempt the map-based error-check when the response is a JSON object.
	if len(respBody) > 0 && respBody[0] == '{' {
		var raw map[string]json.RawMessage
		if err := json.Unmarshal(respBody, &raw); err != nil {
			return fmt.Errorf("whitebit: decode response from %s: %w", endpoint, err)
		}
		if msgRaw, ok := raw["message"]; ok {
			var msg string
			if jsonErr := json.Unmarshal(msgRaw, &msg); jsonErr == nil && msg != "" && msg != "Ok" {
				return fmt.Errorf("whitebit API error: %s", msg)
			}
		}
	}

	if dst != nil {
		if err := json.Unmarshal(respBody, dst); err != nil {
			return fmt.Errorf("whitebit: decode response from %s: %w", endpoint, err)
		}
	}
	return nil
}

// PlaceCollateralLimitOrder places a collateral limit order on the given market.
// side should be "buy" or "sell". positionSide should be "SHORT", "LONG", or "" for one-way mode.
func (c *Client) PlaceCollateralLimitOrder(market, side, amount, price, positionSide string) (*OrderResult, error) {
	const endpoint = "/api/v4/order/collateral/limit"
	body := map[string]interface{}{
		"market": market,
		"side":   side,
		"amount": amount,
		"price":  price,
	}
	if positionSide != "" {
		body["positionSide"] = positionSide
	}
	var result OrderResult
	if err := c.doRequest(context.Background(), endpoint, body, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// CancelCollateralLimitOrder cancels a regular (non-conditional) collateral limit order.
// Used for entry and take-profit orders placed via /api/v4/order/collateral/limit.
func (c *Client) CancelCollateralLimitOrder(market string, orderID int64) error {
	const endpoint = "/api/v4/order/cancel"
	body := map[string]interface{}{
		"market":  market,
		"orderId": orderID,
	}
	return c.doRequest(context.Background(), endpoint, body, nil)
}

// CancelConditionalOrder cancels a conditional order (stop-limit).
// Used for stop-loss orders placed via /api/v4/order/collateral/stop-limit.
func (c *Client) CancelConditionalOrder(market string, orderID int64) error {
	const endpoint = "/api/v4/order/conditional-cancel"
	body := map[string]interface{}{
		"market": market,
		"id":     orderID,
	}
	return c.doRequest(context.Background(), endpoint, body, nil)
}

// GetActiveCollateralLimitOrders returns active non-conditional collateral limit orders for the given market.
// Used to check entry and take-profit orders.
func (c *Client) GetActiveCollateralLimitOrders(market string) ([]OrderResult, error) {
	const endpoint = "/api/v4/orders"
	body := map[string]interface{}{
		"market": market,
	}
	var result []OrderResult
	if err := c.doRequest(context.Background(), endpoint, body, &result); err != nil {
		return nil, err
	}
	return result, nil
}

// GetActiveConditionalOrders returns active conditional orders (stop-limit) for the given market.
// Used to check stop-loss orders.
func (c *Client) GetActiveConditionalOrders(market string) ([]OrderResult, error) {
	const endpoint = "/api/v4/orders/conditional"
	body := map[string]interface{}{
		"market": market,
	}
	var result []OrderResult
	if err := c.doRequest(context.Background(), endpoint, body, &result); err != nil {
		return nil, err
	}
	return result, nil
}

// GetPositions returns all open collateral positions.
func (c *Client) GetPositions() ([]Position, error) {
	const endpoint = "/api/v4/collateral-account/positions"
	body := map[string]interface{}{}
	var result []Position
	if err := c.doRequest(context.Background(), endpoint, body, &result); err != nil {
		return nil, err
	}
	log.Printf("[WhiteBit] GetPositions: found %d positions", len(result))
	for i, p := range result {
		log.Printf("[WhiteBit]   position[%d]: market=%s side=%s amount=%s basePrice=%s", i, p.Market, p.Side, p.Amount, p.BasePrice)
	}
	return result, nil
}

// GetExecutedOrder checks if a specific order was executed (filled).
// Returns the fill price if found in execution history.
// If the order appears in results, it was filled; if not found in executed AND not in active, it was cancelled.
func (c *Client) GetExecutedOrder(market string, orderID int64) (found bool, fillPrice float64, err error) {
	const endpoint = "/api/v4/trade-account/order"
	body := map[string]interface{}{
		"market":  market,
		"orderId": orderID,
	}

	var result struct {
		Records []struct {
			ID    int64  `json:"id"`
			Price string `json:"price"`
		} `json:"records"`
	}
	if err := c.doRequest(context.Background(), endpoint, body, &result); err != nil {
		return false, 0, fmt.Errorf("whitebit: GetExecutedOrder: %w", err)
	}

	for _, r := range result.Records {
		if r.ID == orderID {
			price, parseErr := strconv.ParseFloat(r.Price, 64)
			if parseErr != nil {
				return true, 0, nil
			}
			return true, price, nil
		}
	}
	return false, 0, nil
}

// PlaceCollateralMarketOrder places a collateral market order.
// amount "0" means close the entire position.
func (c *Client) PlaceCollateralMarketOrder(market, side, amount string) (*OrderResult, error) {
	const endpoint = "/api/v4/order/collateral/market"
	params := map[string]interface{}{
		"market": market,
		"side":   side,
		"amount": amount,
	}
	var result OrderResult
	if err := c.doRequest(context.Background(), endpoint, params, &result); err != nil {
		return nil, fmt.Errorf("whitebit: PlaceCollateralMarketOrder: %w", err)
	}
	return &result, nil
}

// PlaceStopLimitOrder places a stop-limit order via the collateral stop-limit endpoint.
func (c *Client) PlaceStopLimitOrder(market, side, amount, activationPrice, price string) (*OrderResult, error) {
	const endpoint = "/api/v4/order/collateral/stop-limit"
	body := map[string]interface{}{
		"market":           market,
		"side":             side,
		"amount":           amount,
		"activation_price": activationPrice,
		"price":            price,
	}
	var result OrderResult
	if err := c.doRequest(context.Background(), endpoint, body, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// GetBalance returns the available USDT balance in the trade account.
func (c *Client) GetBalance() (float64, error) {
	const endpoint = "/api/v4/trade-account/balance"
	body := map[string]interface{}{
		"ticker": "USDT",
	}

	// The balance endpoint returns a map of ticker → balance object.
	var raw map[string]struct {
		Available string `json:"available"`
	}
	if err := c.doRequest(context.Background(), endpoint, body, &raw); err != nil {
		return 0, err
	}

	entry, ok := raw["USDT"]
	if !ok {
		return 0, fmt.Errorf("whitebit: USDT balance not found in response")
	}

	balance, err := strconv.ParseFloat(entry.Available, 64)
	if err != nil {
		return 0, fmt.Errorf("whitebit: parse USDT balance %q: %w", entry.Available, err)
	}
	return balance, nil
}

// GetKlines fetches historical 1-minute OHLCV candles from the public kline endpoint.
// interval is in seconds (60 = 1 minute). limit is the number of candles to return (max 1440).
func (c *Client) GetKlines(market string, interval, limit int) ([]Candle, error) {
	// V1 API works for BTC_PERP. V4 /api/v4/public/kline returns 404.
	// Interval must be a string: "1m", "5m", "15m", "1h", etc.
	intervalStr := "1m"
	switch interval {
	case 300:
		intervalStr = "5m"
	case 900:
		intervalStr = "15m"
	case 3600:
		intervalStr = "1h"
	}

	params := url.Values{}
	params.Set("market", market)
	params.Set("interval", intervalStr)
	params.Set("limit", strconv.Itoa(limit))

	resp, err := c.httpClient.Get(c.baseURL + "/api/v1/public/kline?" + params.Encode())
	if err != nil {
		return nil, fmt.Errorf("whitebit: GetKlines: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("whitebit: GetKlines read body: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("whitebit: GetKlines HTTP %d: %s", resp.StatusCode, body)
	}

	// V1 response: {"success":true,"message":null,"result":[[time,open,close,high,low,vol,deal],...]}
	var envelope struct {
		Result [][]json.RawMessage `json:"result"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return nil, fmt.Errorf("whitebit: GetKlines parse: %w", err)
	}
	raw := envelope.Result

	candles := make([]Candle, 0, len(raw))
	for _, fields := range raw {
		if len(fields) < 6 {
			continue
		}
		t, e0 := parseKlineInt(fields[0])
		open, e1 := parseKlineFloat(fields[1])
		close_, e2 := parseKlineFloat(fields[2])
		high, e3 := parseKlineFloat(fields[3])
		low, e4 := parseKlineFloat(fields[4])
		vol, e5 := parseKlineFloat(fields[5])
		if e0 != nil || e1 != nil || e2 != nil || e3 != nil || e4 != nil || e5 != nil {
			continue
		}
		candles = append(candles, Candle{
			Time:   t,
			Open:   open,
			Close:  close_,
			High:   high,
			Low:    low,
			Volume: vol,
		})
	}
	return candles, nil
}

func parseKlineFloat(r json.RawMessage) (float64, error) {
	var f float64
	if err := json.Unmarshal(r, &f); err == nil {
		return f, nil
	}
	var s string
	if err := json.Unmarshal(r, &s); err != nil {
		return 0, fmt.Errorf("parseKlineFloat: %s", r)
	}
	return strconv.ParseFloat(s, 64)
}

func parseKlineInt(r json.RawMessage) (int64, error) {
	var i int64
	if err := json.Unmarshal(r, &i); err == nil {
		return i, nil
	}
	var s string
	if err := json.Unmarshal(r, &s); err != nil {
		return 0, fmt.Errorf("parseKlineInt: %s", r)
	}
	return strconv.ParseInt(s, 10, 64)
}
