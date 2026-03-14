package server

import (
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

// Message is what gets broadcast to all frontend clients.
// Message types: "price_tick", "candle", "algo_state", "order_update", "pnl_update"
type Message struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

// Hub fans out messages from the backend to all connected frontend dashboard clients.
type Hub struct {
	mu       sync.RWMutex
	clients  map[*websocket.Conn]bool
	upgrader websocket.Upgrader
}

// NewHub creates an initialised Hub ready to accept connections.
func NewHub() *Hub {
	return &Hub{
		clients: make(map[*websocket.Conn]bool),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}
}

// HandleWS upgrades the HTTP connection to WebSocket and registers the client.
func (h *Hub) HandleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[Hub] WebSocket upgrade error: %v", err)
		return
	}

	h.mu.Lock()
	h.clients[conn] = true
	h.mu.Unlock()

	log.Printf("[Hub] Client connected: %s (total: %d)", conn.RemoteAddr(), h.clientCount())

	// Read pump: discard incoming messages and detect disconnects.
	go func() {
		defer func() {
			h.mu.Lock()
			delete(h.clients, conn)
			h.mu.Unlock()
			conn.Close()
			log.Printf("[Hub] Client disconnected: %s (total: %d)", conn.RemoteAddr(), h.clientCount())
		}()

		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				break
			}
		}
	}()
}

// Broadcast sends a Message to all connected clients.
// Non-blocking: clients that fail to receive are disconnected.
func (h *Hub) Broadcast(msg Message) {
	h.mu.RLock()
	// Snapshot client list under read lock.
	clients := make([]*websocket.Conn, 0, len(h.clients))
	for conn := range h.clients {
		clients = append(clients, conn)
	}
	h.mu.RUnlock()

	var failed []*websocket.Conn
	for _, conn := range clients {
		if err := conn.WriteJSON(msg); err != nil {
			log.Printf("[Hub] WriteJSON to %s failed: %v — dropping client", conn.RemoteAddr(), err)
			failed = append(failed, conn)
		}
	}

	if len(failed) > 0 {
		h.mu.Lock()
		for _, conn := range failed {
			delete(h.clients, conn)
			conn.Close()
		}
		h.mu.Unlock()
	}
}

// BroadcastJSON wraps data in a Message and broadcasts it to all clients.
func (h *Hub) BroadcastJSON(msgType string, data interface{}) {
	h.Broadcast(Message{Type: msgType, Data: data})
}

// clientCount returns the current number of connected clients.
// Safe to call without holding any lock (it acquires a read lock internally).
func (h *Hub) clientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}
