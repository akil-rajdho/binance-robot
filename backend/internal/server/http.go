package server

import (
	"encoding/json"
	"log"
	"net/http"
	"os/exec"
	"strconv"
	"time"

	"github.com/bitcoin-robot/backend/internal/algorithm"
	"github.com/bitcoin-robot/backend/internal/auth"
	"github.com/bitcoin-robot/backend/internal/config"
	"github.com/bitcoin-robot/backend/internal/database"
)

// DBStore is the subset of the database layer the server needs.
type DBStore interface {
	GetTrades(limit int) ([]database.Trade, error)
	GetAllSettings() (map[string]string, error)
	SetSetting(key, value string) error
	GetSetting(key string) (string, error)
}

// BotController is the subset of the algorithm state machine the server needs.
type BotController interface {
	SetEnabled(enabled bool)
	SyncOnEnable()
	LoadConfig() error
	GetAlgoState() algorithm.AlgoState
	GetReasoningText() string
}

// Server is the HTTP/WebSocket API server for the dashboard.
type Server struct {
	hub        *Hub
	db         DBStore
	sm         BotController
	mux        *http.ServeMux
	hasAPIKeys bool
	cfg        *config.Config
}

// NewServer constructs a Server and registers all routes.
func NewServer(hub *Hub, db DBStore, sm BotController, hasAPIKeys bool, cfg *config.Config) *Server {
	s := &Server{
		hub:        hub,
		db:         db,
		sm:         sm,
		mux:        http.NewServeMux(),
		hasAPIKeys: hasAPIKeys,
		cfg:        cfg,
	}
	s.registerRoutes()
	return s
}

// Handler returns the configured HTTP handler (the mux with CORS and auth middleware).
func (s *Server) Handler() http.Handler {
	authMiddleware := auth.Middleware(s.cfg.AdminPassword)
	return corsMiddleware(authMiddleware(s.mux))
}

// registerRoutes wires up all API endpoints.
func (s *Server) registerRoutes() {
	// Public endpoints — auth middleware skips /api/auth/login; /api/deploy uses its own token check.
	s.mux.HandleFunc("/api/auth/login", s.handleLogin)
	s.mux.HandleFunc("/api/deploy", s.handleDeploy)

	// Protected endpoints (covered by the auth middleware applied in Handler).
	s.mux.HandleFunc("/ws", s.hub.HandleWS)
	s.mux.HandleFunc("/api/status", s.handleStatus)
	s.mux.HandleFunc("/api/trades", s.handleTrades)
	s.mux.HandleFunc("/api/config", s.handleConfig)
	s.mux.HandleFunc("/api/bot/start", s.handleBotStart)
	s.mux.HandleFunc("/api/bot/stop", s.handleBotStop)
	s.mux.HandleFunc("/api/reasoning", s.handleReasoning)
}

// corsMiddleware injects CORS headers and handles OPTIONS preflight requests.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// writeJSON serialises v as JSON and sets the Content-Type header.
func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("[Server] writeJSON encode error: %v", err)
	}
}

// writeError sends a JSON error response.
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// POST /api/auth/login — accepts {"password":"..."} and returns {"token":"..."} plus sets an HttpOnly cookie.
func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var body struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	tokenStr, err := auth.GenerateToken(body.Password, s.cfg.AdminPassword, s.cfg.AdminPassword)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid password")
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "token",
		Value:    tokenStr,
		Path:     "/",
		HttpOnly: true,
		MaxAge:   int((48 * time.Hour).Seconds()),
	})

	writeJSON(w, http.StatusOK, map[string]string{"token": tokenStr})
}

// GET /api/deploy — checks ?token= against cfg.DeployToken and runs the deploy script.
func (s *Server) handleDeploy(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	if s.cfg.DeployToken == "" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}

	token := r.URL.Query().Get("token")
	if token != s.cfg.DeployToken {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	cmd := exec.Command("sh", "-c", s.cfg.DeployScript)
	if err := cmd.Start(); err != nil {
		log.Printf("[Server] deploy script start error: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to start deploy")
		return
	}
	// Run detached — don't wait for completion.
	go func() {
		if err := cmd.Wait(); err != nil {
			log.Printf("[Server] deploy script exited with error: %v", err)
		}
	}()

	writeJSON(w, http.StatusOK, map[string]string{"status": "deploy started"})
}

// GET /api/status — returns the current AlgoState plus hasApiKeys flag.
func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	type statusResponse struct {
		algorithm.AlgoState
		HasAPIKeys bool `json:"hasApiKeys"`
	}
	writeJSON(w, http.StatusOK, statusResponse{
		AlgoState:  s.sm.GetAlgoState(),
		HasAPIKeys: s.hasAPIKeys,
	})
}

// GET /api/trades — returns trades. Accepts ?limit=N (default 50, 0 = all).
func (s *Server) handleTrades(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			limit = n
		}
	}
	if limit == 0 {
		limit = 10000 // effectively all
	}

	trades, err := s.db.GetTrades(limit)
	if err != nil {
		log.Printf("[Server] GetTrades error: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to retrieve trades")
		return
	}

	if trades == nil {
		trades = []database.Trade{}
	}
	writeJSON(w, http.StatusOK, trades)
}

// GET /api/config  — returns all settings.
// POST /api/config — updates settings from JSON body {"key":"value",...} and reloads config.
func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		settings, err := s.db.GetAllSettings()
		if err != nil {
			log.Printf("[Server] GetAllSettings error: %v", err)
			writeError(w, http.StatusInternalServerError, "failed to retrieve settings")
			return
		}
		writeJSON(w, http.StatusOK, settings)

	case http.MethodPost:
		var updates map[string]string
		if err := json.NewDecoder(r.Body).Decode(&updates); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}

		for key, value := range updates {
			if err := s.db.SetSetting(key, value); err != nil {
				log.Printf("[Server] SetSetting(%q) error: %v", key, err)
				writeError(w, http.StatusInternalServerError, "failed to update setting: "+key)
				return
			}
		}

		if err := s.sm.LoadConfig(); err != nil {
			log.Printf("[Server] LoadConfig after settings update error: %v", err)
			writeError(w, http.StatusInternalServerError, "settings saved but config reload failed: "+err.Error())
			return
		}

		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})

	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// POST /api/bot/start — enables the bot and syncs any open/manual orders.
func (s *Server) handleBotStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	s.sm.SetEnabled(true)
	go s.sm.SyncOnEnable() // check DB + WhiteBit for existing orders in background
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// POST /api/bot/stop — disables the bot.
func (s *Server) handleBotStop(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	s.sm.SetEnabled(false)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// GET /api/reasoning — returns a plain-English description of what the algorithm is doing.
func (s *Server) handleReasoning(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	state := s.sm.GetAlgoState()
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"text":      s.sm.GetReasoningText(),
		"state":     state.State,
		"timestamp": time.Now(),
	})
}
