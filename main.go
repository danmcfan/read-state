package main

import (
	"os"
	"os/signal"
	"syscall"
	"time"

	"readstate/internal"
)

const (
	Capacity        = 20_000_000
	WriteCycleCount = 20_000
	WriteInterval   = 100 * time.Millisecond
)

func main() {
	cache := internal.NewLRUCache(Capacity)

	writeTicker := time.NewTicker(WriteInterval)

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	go writeLoop(cache, writeTicker)

	<-stop
	writeTicker.Stop()
}

func writeLoop(c *internal.LRUCache, t *time.Ticker) {
	for range t.C {
		for range WriteCycleCount {
			rs := internal.NewReadState()
			c.Put(rs.Key(), rs)
		}
	}
}
