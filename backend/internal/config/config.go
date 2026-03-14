package config

import (
	"errors"
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	WhitebitAPIKey    string
	WhitebitAPISecret string
	DBPath            string
	Port              string
}

func Load() (*Config, error) {
	// Load .env file if present; silently ignore if absent.
	_ = godotenv.Load()

	cfg := &Config{
		WhitebitAPIKey:    os.Getenv("WHITEBIT_API_KEY"),
		WhitebitAPISecret: os.Getenv("WHITEBIT_API_SECRET"),
		DBPath:            os.Getenv("DB_PATH"),
		Port:              os.Getenv("PORT"),
	}

	if cfg.WhitebitAPIKey == "" {
		return nil, errors.New("WHITEBIT_API_KEY is required")
	}
	if cfg.WhitebitAPISecret == "" {
		return nil, errors.New("WHITEBIT_API_SECRET is required")
	}

	if cfg.DBPath == "" {
		cfg.DBPath = "/data/bitcoin-robot.db"
	}
	if cfg.Port == "" {
		cfg.Port = "8080"
	}

	return cfg, nil
}
