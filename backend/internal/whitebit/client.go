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
	"net/http"
	"strconv"
	"time"
)

const defaultBaseURL = "https://api.whitebit.com"

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
	Timestamp int64  `json:"timestamp"`
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

	// Decode into a raw map first so we can inspect the "message" field.
	// WhiteBit returns HTTP 200 even for API-level errors; the error is
	// signalled by a non-empty "message" field that is not "Ok".
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

	if dst != nil {
		if err := json.Unmarshal(respBody, dst); err != nil {
			return fmt.Errorf("whitebit: decode response from %s: %w", endpoint, err)
		}
	}
	return nil
}

// PlaceCollateralLimitOrder places a collateral limit order on the given market.
// side should be "buy" or "sell".
func (c *Client) PlaceCollateralLimitOrder(market, side, amount, price string) (*OrderResult, error) {
	const endpoint = "/api/v4/order/collateral/limit"
	body := map[string]interface{}{
		"market": market,
		"side":   side,
		"amount": amount,
		"price":  price,
	}
	var result OrderResult
	if err := c.doRequest(context.Background(), endpoint, body, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// CancelOrder cancels an order by its ID on the given market.
func (c *Client) CancelOrder(market string, orderID int64) error {
	const endpoint = "/api/v4/order/cancel"
	body := map[string]interface{}{
		"market":  market,
		"orderId": orderID,
	}
	return c.doRequest(context.Background(), endpoint, body, nil)
}

// GetActiveOrders returns all active orders for the given market.
func (c *Client) GetActiveOrders(market string) ([]OrderResult, error) {
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

// GetPositions returns all open collateral positions.
func (c *Client) GetPositions() ([]Position, error) {
	const endpoint = "/api/v4/collateral/positions"
	body := map[string]interface{}{}
	var result []Position
	if err := c.doRequest(context.Background(), endpoint, body, &result); err != nil {
		return nil, err
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
