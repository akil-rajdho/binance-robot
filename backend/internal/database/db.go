package database

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"time"

	"github.com/bitcoin-robot/backend/internal/algorithm"
	_ "github.com/lib/pq"
)

// Trade represents a trade record for API responses.
type Trade struct {
	ID         int64      `json:"id"`
	EntryTime  time.Time  `json:"entryTime"`
	EntryPrice float64    `json:"entryPrice"`
	OrderPrice float64    `json:"orderPrice"`
	TPPrice    float64    `json:"tpPrice"`
	SLPrice    float64    `json:"slPrice"`
	ExitTime   *time.Time `json:"exitTime,omitempty"`
	ExitPrice  *float64   `json:"exitPrice,omitempty"`
	PnL        *float64   `json:"pnl,omitempty"`
	Status     string     `json:"status"`
	Reasoning  string     `json:"reasoning"` // raw JSON string
	OrderID    int64      `json:"orderId"`   // WhiteBit entry order ID
	TPOrderID  int64      `json:"tpOrderId"` // WhiteBit TP order ID
	SLOrderID   int64      `json:"slOrderId"`   // WhiteBit SL order ID
	CancelPrice float64    `json:"cancelPrice"` // BTC price when order was cancelled (0 if not cancelled)
}

// DB is the PostgreSQL database layer implementing algorithm.DBStore.
type DB struct {
	db *sql.DB
}

// New opens the PostgreSQL database at dsn, creates tables and inserts default settings.
func New(dsn string) (*DB, error) {
	sqlDB, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("database: open: %w", err)
	}

	if err := sqlDB.Ping(); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("database: ping: %w", err)
	}

	d := &DB{db: sqlDB}

	if err := d.createTables(); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("database: create tables: %w", err)
	}

	if err := d.insertDefaultSettings(); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("database: insert default settings: %w", err)
	}

	migrateDefaultSetting(sqlDB, "75", "tp_distance", "50")
	migrateDefaultSetting(sqlDB, "150", "sl_distance", "200")
	migrateMinGapPct(sqlDB)
	migrateDefaultSetting(sqlDB, "70", "tp_distance", "75")

	return d, nil
}

// Close closes the underlying database connection.
func (d *DB) Close() error {
	return d.db.Close()
}

func (d *DB) createTables() error {
	_, err := d.db.Exec(`
		CREATE TABLE IF NOT EXISTS trades (
			id            SERIAL PRIMARY KEY,
			entry_time    TIMESTAMPTZ NOT NULL,
			entry_price   DOUBLE PRECISION NOT NULL,
			order_price   DOUBLE PRECISION NOT NULL,
			tp_price      DOUBLE PRECISION NOT NULL,
			sl_price      DOUBLE PRECISION NOT NULL,
			exit_time     TIMESTAMPTZ,
			exit_price    DOUBLE PRECISION,
			pnl           DOUBLE PRECISION,
			status        TEXT NOT NULL DEFAULT 'OPEN',
			reasoning     TEXT NOT NULL DEFAULT '{}'
		);

		CREATE TABLE IF NOT EXISTS settings (
			key   TEXT PRIMARY KEY,
			value TEXT NOT NULL
		);
	`)
	if err != nil {
		return err
	}

	// Add order ID columns to existing tables (idempotent).
	migrations := []string{
		`ALTER TABLE trades ADD COLUMN IF NOT EXISTS order_id     BIGINT NOT NULL DEFAULT 0`,
		`ALTER TABLE trades ADD COLUMN IF NOT EXISTS tp_order_id  BIGINT NOT NULL DEFAULT 0`,
		`ALTER TABLE trades ADD COLUMN IF NOT EXISTS sl_order_id  BIGINT NOT NULL DEFAULT 0`,
		`ALTER TABLE trades ADD COLUMN IF NOT EXISTS cancel_price DOUBLE PRECISION NOT NULL DEFAULT 0`,
	}
	for _, m := range migrations {
		if _, merr := d.db.Exec(m); merr != nil {
			return fmt.Errorf("database: migration %q: %w", m, merr)
		}
	}
	return nil
}

func (d *DB) insertDefaultSettings() error {
	defaults := map[string]string{
		"position_size_usdt":   "700",
		"leverage":             "1",
		"daily_loss_limit_pct": "5",
		"bot_enabled":          "false",
		"starting_balance":     "700",
		"today_pnl":            "0",
		"today_date":           time.Now().Format("2006-01-02"),
		"entry_offset_initial": "150",
		"entry_offset_step":    "20",
		"entry_offset_min":     "50",
		"order_cancel_minutes": "10",
		"tp_distance":            "70",
		"sl_distance":            "150",
		"min_gap_pct":            "0.0010",
		"cancel_cooldown_minutes": "5",
		"entry_offset_pct":       "0.0020",
		"min_impulse_pct":        "0.0020",
		"max_atr_usdt":           "300",
		"high_confirm_seconds":   "120",
	}

	for key, value := range defaults {
		_, err := d.db.Exec(
			`INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
			key, value,
		)
		if err != nil {
			return fmt.Errorf("insert default setting %q: %w", key, err)
		}
	}
	return nil
}

// migrateDefaultSetting updates key from oldVal to newVal only if the current stored value
// is still the old default, leaving user-customized values untouched. Errors are logged but
// not returned — migration failure is non-fatal.
func migrateDefaultSetting(db *sql.DB, newVal, key, oldVal string) {
	_, err := db.Exec(
		`UPDATE settings SET value = $1 WHERE key = $2 AND value = $3`,
		newVal, key, oldVal,
	)
	if err != nil {
		log.Printf("database: migrateDefaultSetting %q (%s→%s): %v", key, oldVal, newVal, err)
	}
}

// migrateMinGapPct resets min_gap_pct to "0.0010" if the stored value is > 0.005 (0.5%).
// Values that large prevent orders from ever being placed in normal markets.
// Errors and no-ops are logged; migration failure is non-fatal.
func migrateMinGapPct(db *sql.DB) {
	var raw string
	err := db.QueryRow(`SELECT value FROM settings WHERE key = 'min_gap_pct'`).Scan(&raw)
	if err != nil {
		// Row missing or DB error — nothing to migrate.
		log.Printf("database: migrateMinGapPct: could not read min_gap_pct: %v", err)
		return
	}
	val, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		// Unparseable value — leave it alone; the bot will surface the error itself.
		return
	}
	if val > 0.005 {
		log.Printf("[DB Migration] min_gap_pct was %.4f (%.2f%%) which is too large and prevents order placement — reset to 0.0010 (0.10%%)", val, val*100)
		_, err = db.Exec(`UPDATE settings SET value = '0.0010' WHERE key = 'min_gap_pct'`)
		if err != nil {
			log.Printf("database: migrateMinGapPct: failed to reset min_gap_pct: %v", err)
		}
	}
}

// SaveReasoningSnapshot inserts a new trade record with status='OPEN' and returns its ID.
// orderID is the WhiteBit entry order ID returned immediately after placing the limit order.
func (d *DB) SaveReasoningSnapshot(snapshot algorithm.ReasoningSnapshot, orderID int64) (tradeID int64, err error) {
	reasoningJSON, err := json.Marshal(snapshot)
	if err != nil {
		return 0, fmt.Errorf("database: marshal reasoning snapshot: %w", err)
	}

	err = d.db.QueryRow(
		`INSERT INTO trades (entry_time, entry_price, order_price, tp_price, sl_price, status, reasoning, order_id)
		 VALUES ($1, $2, $3, $4, $5, 'OPEN', $6, $7)
		 RETURNING id`,
		snapshot.Timestamp,
		0,
		snapshot.OrderPrice,
		snapshot.TPPrice,
		snapshot.SLPrice,
		string(reasoningJSON),
		orderID,
	).Scan(&tradeID)
	if err != nil {
		return 0, fmt.Errorf("database: insert trade: %w", err)
	}

	return tradeID, nil
}

// UpdateTrade updates exit_time, exit_price, pnl, and status for the given trade.
func (d *DB) UpdateTrade(tradeID int64, exitPrice float64, pnl float64, status string) error {
	_, err := d.db.Exec(
		`UPDATE trades SET exit_time = $1, exit_price = $2, pnl = $3, status = $4 WHERE id = $5`,
		time.Now(), exitPrice, pnl, status, tradeID,
	)
	if err != nil {
		return fmt.Errorf("database: update trade %d: %w", tradeID, err)
	}
	return nil
}

// UpdateCancelPrice records the BTC spot price at the time the order was cancelled.
func (d *DB) UpdateCancelPrice(tradeID int64, price float64) error {
	_, err := d.db.Exec(
		`UPDATE trades SET cancel_price = $1 WHERE id = $2`,
		price, tradeID,
	)
	if err != nil {
		return fmt.Errorf("database: UpdateCancelPrice(%d): %w", tradeID, err)
	}
	return nil
}

// UpdateEntryPrice records the actual fill price once the entry order is confirmed filled.
func (d *DB) UpdateEntryPrice(tradeID int64, entryPrice float64) error {
	_, err := d.db.Exec(
		`UPDATE trades SET entry_price = $1 WHERE id = $2`,
		entryPrice, tradeID,
	)
	if err != nil {
		return fmt.Errorf("database: UpdateEntryPrice trade %d: %w", tradeID, err)
	}
	return nil
}

// UpdateOrderIDs saves the TP and SL order IDs for a trade once a position has opened.
func (d *DB) UpdateOrderIDs(tradeID int64, tpOrderID, slOrderID int64) error {
	_, err := d.db.Exec(
		`UPDATE trades SET tp_order_id = $1, sl_order_id = $2 WHERE id = $3`,
		tpOrderID, slOrderID, tradeID,
	)
	if err != nil {
		return fmt.Errorf("database: update order IDs for trade %d: %w", tradeID, err)
	}
	return nil
}

// GetOpenTrades returns all trades with status='OPEN', ordered by id ASC.
// The returned slice uses algorithm.OpenTrade so the state machine can consume it
// directly without importing the database package.
func (d *DB) GetOpenTrades() ([]algorithm.OpenTrade, error) {
	rows, err := d.db.Query(
		`SELECT id, order_price, entry_price, tp_price, sl_price,
		        order_id, tp_order_id, sl_order_id, status
		 FROM trades
		 WHERE status = 'OPEN'
		 ORDER BY id ASC`,
	)
	if err != nil {
		return nil, fmt.Errorf("database: query open trades: %w", err)
	}
	defer rows.Close()

	var trades []algorithm.OpenTrade
	for rows.Next() {
		var t algorithm.OpenTrade
		err := rows.Scan(
			&t.ID,
			&t.OrderPrice,
			&t.EntryPrice,
			&t.TPPrice,
			&t.SLPrice,
			&t.OrderID,
			&t.TPOrderID,
			&t.SLOrderID,
			&t.Status,
		)
		if err != nil {
			return nil, fmt.Errorf("database: scan open trade row: %w", err)
		}
		trades = append(trades, t)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("database: iterate open trades: %w", err)
	}
	return trades, nil
}

// GetSetting returns the value for the given settings key.
func (d *DB) GetSetting(key string) (string, error) {
	var value string
	err := d.db.QueryRow(`SELECT value FROM settings WHERE key = $1`, key).Scan(&value)
	if err == sql.ErrNoRows {
		return "", fmt.Errorf("database: setting %q not found", key)
	}
	if err != nil {
		return "", fmt.Errorf("database: get setting %q: %w", key, err)
	}
	return value, nil
}

// SetSetting upserts a key/value pair into the settings table.
func (d *DB) SetSetting(key, value string) error {
	_, err := d.db.Exec(
		`INSERT INTO settings (key, value) VALUES ($1, $2)
		 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
		key, value,
	)
	if err != nil {
		return fmt.Errorf("database: set setting %q: %w", key, err)
	}
	return nil
}

// UpdateTodayPnL adds pnl to today_pnl, resetting if today_date has changed.
// Returns the new cumulative today_pnl.
func (d *DB) UpdateTodayPnL(pnl float64) (todayPnL float64, err error) {
	today := time.Now().Format("2006-01-02")

	storedDate, err := d.GetSetting("today_date")
	if err != nil {
		return 0, fmt.Errorf("database: UpdateTodayPnL get today_date: %w", err)
	}

	var currentPnL float64
	if storedDate != today {
		// New day: reset
		currentPnL = 0
		if err := d.SetSetting("today_date", today); err != nil {
			return 0, fmt.Errorf("database: UpdateTodayPnL reset today_date: %w", err)
		}
	} else {
		pnlStr, err := d.GetSetting("today_pnl")
		if err != nil {
			return 0, fmt.Errorf("database: UpdateTodayPnL get today_pnl: %w", err)
		}
		currentPnL, err = strconv.ParseFloat(pnlStr, 64)
		if err != nil {
			return 0, fmt.Errorf("database: UpdateTodayPnL parse today_pnl %q: %w", pnlStr, err)
		}
	}

	newPnL := currentPnL + pnl
	if err := d.SetSetting("today_pnl", strconv.FormatFloat(newPnL, 'f', -1, 64)); err != nil {
		return 0, fmt.Errorf("database: UpdateTodayPnL set today_pnl: %w", err)
	}

	return newPnL, nil
}

// GetTodayPnL returns today_pnl, resetting to 0 if today_date has changed.
func (d *DB) GetTodayPnL() (float64, error) {
	today := time.Now().Format("2006-01-02")

	storedDate, err := d.GetSetting("today_date")
	if err != nil {
		return 0, fmt.Errorf("database: GetTodayPnL get today_date: %w", err)
	}

	if storedDate != today {
		// New day: reset
		if err := d.SetSetting("today_date", today); err != nil {
			return 0, fmt.Errorf("database: GetTodayPnL reset today_date: %w", err)
		}
		if err := d.SetSetting("today_pnl", "0"); err != nil {
			return 0, fmt.Errorf("database: GetTodayPnL reset today_pnl: %w", err)
		}
		return 0, nil
	}

	pnlStr, err := d.GetSetting("today_pnl")
	if err != nil {
		return 0, fmt.Errorf("database: GetTodayPnL get today_pnl: %w", err)
	}

	pnl, err := strconv.ParseFloat(pnlStr, 64)
	if err != nil {
		return 0, fmt.Errorf("database: GetTodayPnL parse today_pnl %q: %w", pnlStr, err)
	}
	return pnl, nil
}

// GetStartingBalance returns the starting_balance setting as float64.
func (d *DB) GetStartingBalance() (float64, error) {
	val, err := d.GetSetting("starting_balance")
	if err != nil {
		return 0, fmt.Errorf("database: GetStartingBalance: %w", err)
	}
	balance, err := strconv.ParseFloat(val, 64)
	if err != nil {
		return 0, fmt.Errorf("database: GetStartingBalance parse %q: %w", val, err)
	}
	return balance, nil
}

// GetTrades returns the most recent `limit` trades, newest first.
func (d *DB) GetTrades(limit int) ([]Trade, error) {
	rows, err := d.db.Query(
		`SELECT id, entry_time, entry_price, order_price, tp_price, sl_price,
		        exit_time, exit_price, pnl, status, reasoning,
		        order_id, tp_order_id, sl_order_id, cancel_price
		 FROM trades
		 ORDER BY id DESC
		 LIMIT $1`,
		limit,
	)
	if err != nil {
		return nil, fmt.Errorf("database: query trades: %w", err)
	}
	defer rows.Close()

	var trades []Trade
	for rows.Next() {
		var t Trade
		var exitTime sql.NullTime
		var exitPrice sql.NullFloat64
		var pnl sql.NullFloat64

		err := rows.Scan(
			&t.ID,
			&t.EntryTime,
			&t.EntryPrice,
			&t.OrderPrice,
			&t.TPPrice,
			&t.SLPrice,
			&exitTime,
			&exitPrice,
			&pnl,
			&t.Status,
			&t.Reasoning,
			&t.OrderID,
			&t.TPOrderID,
			&t.SLOrderID,
			&t.CancelPrice,
		)
		if err != nil {
			return nil, fmt.Errorf("database: scan trade row: %w", err)
		}

		if exitTime.Valid {
			t.ExitTime = &exitTime.Time
		}
		if exitPrice.Valid {
			t.ExitPrice = &exitPrice.Float64
		}
		if pnl.Valid {
			t.PnL = &pnl.Float64
		}

		trades = append(trades, t)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("database: iterate trades: %w", err)
	}
	return trades, nil
}

// GetAllSettings returns all settings as a map.
func (d *DB) GetAllSettings() (map[string]string, error) {
	rows, err := d.db.Query(`SELECT key, value FROM settings`)
	if err != nil {
		return nil, fmt.Errorf("database: query settings: %w", err)
	}
	defer rows.Close()

	settings := make(map[string]string)
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			return nil, fmt.Errorf("database: scan settings row: %w", err)
		}
		settings[key] = value
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("database: iterate settings: %w", err)
	}
	return settings, nil
}
