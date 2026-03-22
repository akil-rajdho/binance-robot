package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/bitcoin-robot/backend/internal/algorithm"
	"github.com/bitcoin-robot/backend/internal/config"
	"github.com/bitcoin-robot/backend/internal/database"
	"github.com/bitcoin-robot/backend/internal/orders"
	"github.com/bitcoin-robot/backend/internal/server"
	"github.com/bitcoin-robot/backend/internal/whitebit"
	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
)

func main() {
	// 1. Load config
	cfg, err := config.Load()
	if err != nil {
		log.Fatal("config:", err)
	}

	// 2. Open database
	db, err := database.New(cfg.PostgresDSN)
	if err != nil {
		log.Fatal("database:", err)
	}

	// 3. Create WhiteBit client
	wbClient := whitebit.NewClient(cfg.WhitebitAPIKey, cfg.WhitebitAPISecret)

	// 4. Create order manager
	orderMgr := orders.NewManager(wbClient, "BTC_USDT")

	// 5. Create price window (10 minutes)
	priceWindow := algorithm.NewPriceWindow(10 * time.Minute)

	// 6. Create WebSocket hub
	hub := server.NewHub()

	// 7. Create state machine
	sm := algorithm.NewStateMachine(priceWindow, orderMgr, db)
	sm.OnStateChange = func(state algorithm.AlgoState) {
		hub.BroadcastJSON("algo_state", state)
		hub.BroadcastJSON("order_update", nil) // triggers trade list refresh in the dashboard
	}

	// Push current algo state to each new WebSocket client immediately on connect.
	hub.OnConnect = func(conn *websocket.Conn) {
		state := sm.GetAlgoState()
		_ = conn.WriteJSON(server.Message{Type: "algo_state", Data: state})
	}

	// 8. Load config into state machine
	if err := sm.LoadConfig(); err != nil {
		log.Printf("warn: failed to load config into state machine: %v", err)
	}

	// Auto-start bot if BOT_AUTOSTART=true
	if os.Getenv("BOT_AUTOSTART") == "true" {
		log.Println("[Startup] BOT_AUTOSTART=true — enabling bot")
		sm.SetEnabled(true)
		sm.SyncOnEnable()
	}

	// 8b. Recover any open trades from a previous server run.
	log.Println("[Startup] Checking for open trades to recover...")
	if err := sm.RecoverOpenTrades(context.Background()); err != nil {
		log.Printf("[Startup] Warning: trade recovery failed: %v", err)
	}

	// 8a. Seed price window and cache historical candles for the chart.
	historicalCandles, err := wbClient.GetKlines("BTC_USDT", 60, 200)
	if err != nil {
		log.Printf("warn: failed to fetch historical klines: %v", err)
	} else {
		log.Printf("[Startup] Loaded %d historical candles", len(historicalCandles))
		cutoff := time.Now().Add(-10 * time.Minute)
		for _, c := range historicalCandles {
			if time.Unix(c.Time, 0).After(cutoff) {
				priceWindow.Add(c.Close)
				sm.OnCandle(c.High, c.Low, c.Close, time.Unix(c.Time, 0))
			}
		}
		// Store candles for new connections (broadcast on connect in OnConnect below)
		cachedCandles := historicalCandles
		originalOnConnect := hub.OnConnect
		hub.OnConnect = func(conn *websocket.Conn) {
			for _, c := range cachedCandles {
				_ = conn.WriteJSON(server.Message{Type: "candle", Data: c})
			}
			if originalOnConnect != nil {
				originalOnConnect(conn)
			}
		}
	}

	// 9. Connect to Redis
	redisOpts, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		log.Printf("warn: failed to parse Redis URL %q: %v — price caching disabled", cfg.RedisURL, err)
		redisOpts = nil
	}
	var rdb *redis.Client
	if redisOpts != nil {
		rdb = redis.NewClient(redisOpts)
		rCtx, rCancel := context.WithTimeout(context.Background(), 3*time.Second)
		if pingErr := rdb.Ping(rCtx).Err(); pingErr != nil {
			log.Printf("warn: Redis ping failed: %v — price caching disabled", pingErr)
			rdb = nil
		}
		rCancel()
	}

	// Wire Redis price cache into OnConnect so new clients get the latest price instantly.
	if rdb != nil {
		prevOnConnect := hub.OnConnect
		hub.OnConnect = func(conn *websocket.Conn) {
			if prevOnConnect != nil {
				prevOnConnect(conn)
			}
			if val, err := rdb.Get(context.Background(), "btc:price").Result(); err == nil {
				if price, err := strconv.ParseFloat(val, 64); err == nil {
					_ = conn.WriteJSON(server.Message{Type: "price_tick", Data: map[string]float64{"price": price}})
				}
			}
		}
	}

	// 10. Create price feed
	// Authenticated WebSocket for instant order/position updates
	userFeed := whitebit.NewUserFeed(wbClient, "BTC_USDT")
	userFeed.OnOrderExecuted = func(event whitebit.ExecutedOrderEvent) {
		sm.OnOrderExecuted(event.OrderID, event.Price, event.Side)
	}
	userFeed.OnOrderPending = func(event whitebit.PendingOrderEvent) {
		sm.OnOrderPending(event.EventType, event.OrderID)
	}

	priceFeed := whitebit.NewPriceFeed("BTC_USDT", "1", func(candle whitebit.Candle) {
		hub.BroadcastJSON("candle", candle)
		sm.OnCandle(candle.High, candle.Low, candle.Close, time.Unix(candle.Time, 0))
	}, func(price float64) {
		hub.BroadcastJSON("price_tick", map[string]float64{"price": price})
		sm.OnPrice(price)
		// Cache latest price in Redis
		if rdb != nil {
			rdb.Set(context.Background(), "btc:price", strconv.FormatFloat(price, 'f', -1, 64), 10*time.Minute)
		}
	})

	// 11. Create HTTP server
	httpServer := server.NewServer(hub, db, sm, cfg.WhitebitAPIKey != "" && cfg.WhitebitAPISecret != "", cfg)

	// 12. Start everything
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start state machine poll loop
	go sm.Start(ctx)

	// Periodic algo-state heartbeat: broadcast current state every 5 s so the
	// dashboard always shows fresh high10min, filterStatus, ATR, etc. even when
	// no orders are being placed and the state machine has no transitions to fire.
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				hub.BroadcastJSON("algo_state", sm.GetAlgoState())
			}
		}
	}()

	// Start price feed (reconnects automatically)
	go func() {
		if err := priceFeed.Start(ctx); err != nil {
			log.Printf("price feed stopped: %v", err)
		}
	}()

	// Start authenticated user feed for instant fill detection
	go userFeed.Start(ctx)

	// Start HTTP server
	addr := ":" + cfg.Port
	srv := &http.Server{
		Addr:    addr,
		Handler: httpServer.Handler(),
	}

	go func() {
		log.Printf("Bitcoin Robot backend listening on %s", addr)
		if err := srv.ListenAndServe(); err != http.ErrServerClosed {
			log.Fatal("http server:", err)
		}
	}()

	// Wait for shutdown signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down...")
	cancel() // stop goroutines
	srv.Shutdown(context.Background())
	log.Println("Done")
}
