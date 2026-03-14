# Stage 1: Build
FROM golang:1.23-bookworm AS builder

WORKDIR /app

# Install CGO dependencies for sqlite3
RUN apt-get update && apt-get install -y gcc libc6-dev && rm -rf /var/lib/apt/lists/*

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=1 GOOS=linux go build -o /bitcoin-robot ./cmd/server

# Stage 2: Runtime
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates libsqlite3-0 && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /data

COPY --from=builder /bitcoin-robot /bitcoin-robot

EXPOSE 8080

CMD ["/bitcoin-robot"]
