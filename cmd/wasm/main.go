//go:build js && wasm

// Command wasm is the browser build of the Go workload. It registers its
// functions on the readStateGo JS global, then blocks so they stay callable.
package main

import (
	"math"
	"runtime"
	"syscall/js"
	"time"

	"readstate"
)

var w *readstate.Workload

func main() {
	js.Global().Set("readStateGo", js.ValueOf(map[string]any{
		// init(capacity): build a fresh, pre-filled cache, replacing any old one.
		"init": js.FuncOf(func(_ js.Value, args []js.Value) any {
			w = nil // let the old cache be collected before allocating the new one
			w = readstate.NewWorkload(args[0].Int())
			return nil
		}),
		// runBatch(n) -> elapsed milliseconds, or NaN before init. A panic
		// here would kill the Go runtime for good.
		"runBatch": js.FuncOf(func(_ js.Value, args []js.Value) any {
			if w == nil {
				return math.NaN()
			}
			start := time.Now()
			w.Run(args[0].Int())
			return float64(time.Since(start).Nanoseconds()) / 1e6
		}),
		"forceGC": js.FuncOf(func(js.Value, []js.Value) any {
			runtime.GC()
			return nil
		}),
		// heapStats() -> { heapAlloc, numGC, lastPauseMs }.
		"heapStats": js.FuncOf(func(js.Value, []js.Value) any {
			var m runtime.MemStats
			runtime.ReadMemStats(&m)
			return map[string]any{
				"heapAlloc":   float64(m.HeapAlloc),
				"numGC":       int(m.NumGC),
				"lastPauseMs": float64(m.PauseNs[(m.NumGC+255)%256]) / 1e6,
			}
		}),
	}))
	select {}
}
