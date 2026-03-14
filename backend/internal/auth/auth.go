package auth

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// GenerateToken validates the provided password against adminPassword and, if valid,
// returns a signed HS256 JWT with a 48-hour expiry and an "iat" claim.
// The secret used for signing is the adminPassword itself.
func GenerateToken(password, adminPassword, secret string) (string, error) {
	if password != adminPassword {
		return "", errors.New("invalid password")
	}

	now := time.Now()
	claims := jwt.MapClaims{
		"iat": now.Unix(),
		"exp": now.Add(48 * time.Hour).Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// ValidateToken parses and validates a JWT string using the provided secret.
// It returns an error if the token is missing, malformed, expired, or has an invalid signature.
func ValidateToken(tokenStr, secret string) error {
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return []byte(secret), nil
	})
	if err != nil {
		return err
	}
	if !token.Valid {
		return errors.New("invalid token")
	}
	return nil
}

// Middleware returns an HTTP middleware that enforces JWT authentication.
// It checks the Authorization: Bearer <token> header first, then falls back to
// the "token" cookie. The /api/auth/login path is always skipped.
// On failure it responds with HTTP 401 and JSON {"error": "unauthorized"}.
func Middleware(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Skip authentication for public endpoints.
			if r.URL.Path == "/api/auth/login" || r.URL.Path == "/api/deploy" || r.URL.Path == "/api/deploy/logs" {
				next.ServeHTTP(w, r)
				return
			}

			tokenStr := ""

			// Check Authorization header first.
			if authHeader := r.Header.Get("Authorization"); authHeader != "" {
				parts := strings.SplitN(authHeader, " ", 2)
				if len(parts) == 2 && strings.EqualFold(parts[0], "bearer") {
					tokenStr = parts[1]
				}
			}

			// Fall back to cookie (used by WebSocket connections and browsers).
			if tokenStr == "" {
				if cookie, err := r.Cookie("token"); err == nil {
					tokenStr = cookie.Value
				}
			}

			if tokenStr == "" {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				json.NewEncoder(w).Encode(map[string]string{"error": "unauthorized"})
				return
			}

			if err := ValidateToken(tokenStr, secret); err != nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				json.NewEncoder(w).Encode(map[string]string{"error": "unauthorized"})
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
