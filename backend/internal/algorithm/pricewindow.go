package algorithm

import (
	"sync"
	"time"
)

type PricePoint struct {
	Price     float64
	Timestamp time.Time
}

type PriceWindow struct {
	mu     sync.RWMutex
	prices []PricePoint
	window time.Duration // typically 10 * time.Minute
}

func NewPriceWindow(window time.Duration) *PriceWindow {
	return &PriceWindow{
		prices: make([]PricePoint, 0),
		window: window,
	}
}

// Add adds a new price point and evicts points older than window.
func (pw *PriceWindow) Add(price float64) {
	pw.mu.Lock()
	defer pw.mu.Unlock()

	now := time.Now()

	// Evict stale points
	valid := pw.prices[:0]
	for _, p := range pw.prices {
		if time.Since(p.Timestamp) <= pw.window {
			valid = append(valid, p)
		}
	}
	pw.prices = valid

	// Append new point
	pw.prices = append(pw.prices, PricePoint{
		Price:     price,
		Timestamp: now,
	})
}

// High returns the maximum price in the current window.
// Returns 0 if no data points exist.
func (pw *PriceWindow) High() float64 {
	pw.mu.RLock()
	defer pw.mu.RUnlock()

	if len(pw.prices) == 0 {
		return 0
	}

	max := pw.prices[0].Price
	for _, p := range pw.prices[1:] {
		if p.Price > max {
			max = p.Price
		}
	}
	return max
}

// Len returns the number of data points in the window.
func (pw *PriceWindow) Len() int {
	pw.mu.RLock()
	defer pw.mu.RUnlock()
	return len(pw.prices)
}

// AddAt adds a price point at an explicit timestamp.
// Used for seeding the window with historical candle data.
func (pw *PriceWindow) AddAt(price float64, ts time.Time) {
	pw.mu.Lock()
	defer pw.mu.Unlock()

	// Evict stale points
	valid := pw.prices[:0]
	for _, p := range pw.prices {
		if time.Since(p.Timestamp) <= pw.window {
			valid = append(valid, p)
		}
	}
	pw.prices = valid

	pw.prices = append(pw.prices, PricePoint{
		Price:     price,
		Timestamp: ts,
	})
}

// Open returns the oldest price in the current window.
// Returns 0 if no data points exist.
func (pw *PriceWindow) Open() float64 {
	pw.mu.RLock()
	defer pw.mu.RUnlock()

	if len(pw.prices) == 0 {
		return 0
	}
	return pw.prices[0].Price
}
