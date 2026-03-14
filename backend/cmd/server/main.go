package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/bitcoin-robot/backend/internal/algorithm"
	"github.com/bitcoin-robot/backend/internal/config"
	"github.com/bitcoin-robot/backend/internal/database"
	"github.com/bitcoin-robot/backend/internal/orders"
	"github.com/bitcoin-robot/backend/internal/server"
	"github.com/bitcoin-robot/backend/internal/whitebit"
)

func main() {
	// 1. Load config
	cfg, err := config.Load()
	if err != nil {
		log.Fatal("config:", err)
	}

	// 2. Open database
	db, err := database.New(cfg.DBPath)
	if err != nil {
		log.Fatal("database:", err)
	}

	// 3. Create WhiteBit client
	wbClient := whitebit.NewClient(cfg.WhitebitAPIKey, cfg.WhitebitAPISecret)

	// 4. Create order manager
	orderMgr := orders.NewManager(wbClient, "BTC_PERP")

	// 5. Create price window (10 minutes)
	priceWindow := algorithm.NewPriceWindow(10 * time.Minute)

	// 6. Create WebSocket hub
	hub := server.NewHub()

	// 7. Create state machine
	sm := algorithm.NewStateMachine(priceWindow, orderMgr, db)
	sm.OnStateChange = func(state algorithm.AlgoState) {
		hub.BroadcastJSON("algo_state", state)
	}

	// 8. Load config into state machine
	if err := sm.LoadConfig(); err != nil {
		log.Printf("warn: failed to load config into state machine: %v", err)
	}

	// 9. Create price feed
	priceFeed := whitebit.NewPriceFeed("BTC_PERP", "1", func(candle whitebit.Candle) {
		hub.BroadcastJSON("candle", candle)
	}, func(price float64) {
		hub.BroadcastJSON("price_tick", map[string]float64{"price": price})
		sm.OnPrice(price)
	})

	// 10. Create HTTP server
	httpServer := server.NewServer(hub, db, sm)

	// 11. Start everything
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start state machine poll loop
	go sm.Start(ctx)

	// Start price feed (reconnects automatically)
	go func() {
		if err := priceFeed.Start(ctx); err != nil {
			log.Printf("price feed stopped: %v", err)
		}
	}()

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
