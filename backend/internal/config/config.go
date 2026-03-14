package config

import (
	"errors"
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	WhitebitAPIKey    string
	WhitebitAPISecret string
	PostgresDSN       string
	RedisURL          string
	Port              string
	AdminPassword     string
	DeployToken       string
	DeployScript      string
}

func Load() (*Config, error) {
	// Load .env file if present; silently ignore if absent.
	_ = godotenv.Load()

	cfg := &Config{
		WhitebitAPIKey:    os.Getenv("WHITEBIT_API_KEY"),
		WhitebitAPISecret: os.Getenv("WHITEBIT_API_SECRET"),
		PostgresDSN:       os.Getenv("POSTGRES_DSN"),
		RedisURL:          os.Getenv("REDIS_URL"),
		Port:              os.Getenv("PORT"),
		AdminPassword:     os.Getenv("ADMIN_PASSWORD"),
		DeployToken:       os.Getenv("DEPLOY_TOKEN"),
		DeployScript:      os.Getenv("DEPLOY_SCRIPT"),
	}

	if cfg.WhitebitAPIKey == "" {
		return nil, errors.New("WHITEBIT_API_KEY is required")
	}
	if cfg.WhitebitAPISecret == "" {
		return nil, errors.New("WHITEBIT_API_SECRET is required")
	}
	if cfg.AdminPassword == "" {
		return nil, errors.New("ADMIN_PASSWORD is required")
	}

	if cfg.PostgresDSN == "" {
		cfg.PostgresDSN = "postgres://bitcoin:bitcoin@localhost:5432/bitcoinrobot?sslmode=disable"
	}
	if cfg.RedisURL == "" {
		cfg.RedisURL = "redis://localhost:6379"
	}
	if cfg.Port == "" {
		cfg.Port = "8080"
	}
	if cfg.DeployScript == "" {
		cfg.DeployScript = "/home/bitcoin/app/deploy.sh"
	}

	return cfg, nil
}
