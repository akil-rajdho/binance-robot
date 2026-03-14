package database

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/bitcoin-robot/backend/internal/algorithm"
	_ "github.com/mattn/go-sqlite3"
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
}

// DB is the SQLite database layer implementing algorithm.DBStore.
type DB struct {
	db *sql.DB
}

// New opens the SQLite database at dbPath, creates tables and inserts default settings.
func New(dbPath string) (*DB, error) {
	sqlDB, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return nil, fmt.Errorf("database: open %s: %w", dbPath, err)
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

	return d, nil
}

// Close closes the underlying database connection.
func (d *DB) Close() error {
	return d.db.Close()
}

func (d *DB) createTables() error {
	_, err := d.db.Exec(`
		CREATE TABLE IF NOT EXISTS trades (
			id            INTEGER PRIMARY KEY AUTOINCREMENT,
			entry_time    DATETIME NOT NULL,
			entry_price   REAL NOT NULL,
			order_price   REAL NOT NULL,
			tp_price      REAL NOT NULL,
			sl_price      REAL NOT NULL,
			exit_time     DATETIME,
			exit_price    REAL,
			pnl           REAL,
			status        TEXT NOT NULL DEFAULT 'OPEN',
			reasoning     TEXT NOT NULL DEFAULT '{}'
		);

		CREATE TABLE IF NOT EXISTS settings (
			key   TEXT PRIMARY KEY,
			value TEXT NOT NULL
		);
	`)
	return err
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
	}

	for key, value := range defaults {
		_, err := d.db.Exec(
			`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`,
			key, value,
		)
		if err != nil {
			return fmt.Errorf("insert default setting %q: %w", key, err)
		}
	}
	return nil
}

// SaveReasoningSnapshot inserts a new trade record with status='OPEN'.
func (d *DB) SaveReasoningSnapshot(snapshot algorithm.ReasoningSnapshot) (tradeID int64, err error) {
	reasoningJSON, err := json.Marshal(snapshot)
	if err != nil {
		return 0, fmt.Errorf("database: marshal reasoning snapshot: %w", err)
	}

	result, err := d.db.Exec(
		`INSERT INTO trades (entry_time, entry_price, order_price, tp_price, sl_price, status, reasoning)
		 VALUES (?, ?, ?, ?, ?, 'OPEN', ?)`,
		snapshot.Timestamp,
		snapshot.CurrentPrice,
		snapshot.OrderPrice,
		snapshot.TPPrice,
		snapshot.SLPrice,
		string(reasoningJSON),
	)
	if err != nil {
		return 0, fmt.Errorf("database: insert trade: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("database: get last insert id: %w", err)
	}
	return id, nil
}

// UpdateTrade updates exit_time, exit_price, pnl, and status for the given trade.
func (d *DB) UpdateTrade(tradeID int64, exitPrice float64, pnl float64, status string) error {
	_, err := d.db.Exec(
		`UPDATE trades SET exit_time = ?, exit_price = ?, pnl = ?, status = ? WHERE id = ?`,
		time.Now(), exitPrice, pnl, status, tradeID,
	)
	if err != nil {
		return fmt.Errorf("database: update trade %d: %w", tradeID, err)
	}
	return nil
}

// GetSetting returns the value for the given settings key.
func (d *DB) GetSetting(key string) (string, error) {
	var value string
	err := d.db.QueryRow(`SELECT value FROM settings WHERE key = ?`, key).Scan(&value)
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
		`INSERT INTO settings (key, value) VALUES (?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
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
		        exit_time, exit_price, pnl, status, reasoning
		 FROM trades
		 ORDER BY id DESC
		 LIMIT ?`,
		limit,
	)
	if err != nil {
		return nil, fmt.Errorf("database: query trades: %w", err)
	}
	defer rows.Close()

	var trades []Trade
	for rows.Next() {
		var t Trade
		var exitTimeStr sql.NullString
		var exitPrice sql.NullFloat64
		var pnl sql.NullFloat64

		err := rows.Scan(
			&t.ID,
			&t.EntryTime,
			&t.EntryPrice,
			&t.OrderPrice,
			&t.TPPrice,
			&t.SLPrice,
			&exitTimeStr,
			&exitPrice,
			&pnl,
			&t.Status,
			&t.Reasoning,
		)
		if err != nil {
			return nil, fmt.Errorf("database: scan trade row: %w", err)
		}

		if exitTimeStr.Valid && exitTimeStr.String != "" {
			parsed, err := time.Parse(time.RFC3339Nano, exitTimeStr.String)
			if err != nil {
				// Try other common formats
				parsed, err = time.Parse("2006-01-02T15:04:05Z", exitTimeStr.String)
				if err != nil {
					parsed, _ = time.Parse("2006-01-02 15:04:05", exitTimeStr.String)
				}
			}
			t.ExitTime = &parsed
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
