// Command read-state runs Discord's Read State workload against an LRU cache:
// batches of random operations on a cache of 20 million entries, with a short
// sleep after each batch, forever.
//
// Running it with no flags is the faithful workload. The flags change the
// workload for measurement runs, and --out writes one JSON line per second of
// metrics (see results/README.md for the schema).
package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"math/rand/v2"
	"os"
	"runtime/debug"
	"time"
)

// config holds the parsed flags.
type config struct {
	capacity  int
	keys      int64
	batch     int
	sleep     time.Duration
	readRatio float64
	duration  time.Duration
	out       string
	variant   string
	seed      uint64
	layout    string
	gcpercent int
	gcperiod  time.Duration
}

// parseFlags parses and validates the command line.
func parseFlags(args []string, stderr io.Writer) (config, error) {
	var c config
	fs := flag.NewFlagSet("read-state", flag.ContinueOnError)
	fs.SetOutput(stderr)
	fs.IntVar(&c.capacity, "capacity", 20_000_000, "total cache entries")
	fs.Int64Var(&c.keys, "keys", 0, "keys are drawn from [0, keys); 0 means capacity*5/4")
	fs.IntVar(&c.batch, "batch", 20_000, "operations per timed batch")
	fs.DurationVar(&c.sleep, "sleep", 100*time.Millisecond, "sleep after each batch")
	fs.Float64Var(&c.readRatio, "read-ratio", 0, "probability that an operation is a Get (a miss then Puts the key)")
	fs.DurationVar(&c.duration, "duration", 0, "stop after this long; 0 runs forever")
	fs.StringVar(&c.out, "out", "", "append JSONL metrics to this file ('-' for stdout); empty writes none")
	fs.StringVar(&c.variant, "variant", "", "variant name recorded in the config record")
	fs.Uint64Var(&c.seed, "seed", 1, "random seed")
	fs.StringVar(&c.layout, "layout", "list", "cache layout: list")
	fs.IntVar(&c.gcpercent, "gcpercent", 100, "GC percent, set with debug.SetGCPercent (overrides GOGC); -1 turns GC off")
	fs.DurationVar(&c.gcperiod, "gcperiod", 2*time.Minute, "forced-GC period (needs the gcperiod build tag unless 2m)")
	if err := fs.Parse(args); err != nil {
		return c, err
	}
	if fs.NArg() > 0 {
		return c, fmt.Errorf("unexpected argument %q", fs.Arg(0))
	}
	if c.keys == 0 {
		c.keys = int64(c.capacity) * 5 / 4
	}
	switch {
	case c.capacity <= 0:
		return c, errors.New("--capacity must be positive")
	case c.keys <= 0:
		return c, errors.New("--keys must be positive")
	case c.batch <= 0:
		return c, errors.New("--batch must be positive")
	case c.sleep < 0:
		return c, errors.New("--sleep must not be negative")
	case !(c.readRatio >= 0 && c.readRatio <= 1):
		return c, errors.New("--read-ratio must be between 0 and 1")
	case c.duration < 0:
		return c, errors.New("--duration must not be negative")
	case c.gcperiod <= 0:
		return c, errors.New("--gcperiod must be positive")
	case c.layout != "list":
		return c, fmt.Errorf("unknown --layout %q (want list)", c.layout)
	}
	return c, nil
}

// counts are operation counters for a window or a whole run.
type counts struct {
	ops, hits, misses, evictions int64
}

// workload draws random operations and applies them to a cache.
type workload struct {
	cache     Cache
	rng       *rand.Rand
	keys      int64
	readRatio float64
}

// op runs one operation. With a read ratio of 0 every operation is a Put, as
// in the original program. A Get that misses loads the key, which is a Put.
// A miss is any operation whose key wasn't cached.
func (w *workload) op(c *counts) {
	c.ops++
	k := w.rng.Int64N(w.keys)
	if w.readRatio > 0 && w.rng.Float64() < w.readRatio {
		if _, ok := w.cache.Get(k); ok {
			c.hits++
			return
		}
		c.misses++
		if _, evicted := w.cache.Put(k, w.rng.Int64()); evicted {
			c.evictions++
		}
		return
	}
	existed, evicted := w.cache.Put(k, w.rng.Int64())
	if existed {
		c.hits++
	} else {
		c.misses++
	}
	if evicted {
		c.evictions++
	}
}

func main() {
	start := time.Now()
	cfg, err := parseFlags(os.Args[1:], os.Stderr)
	if errors.Is(err, flag.ErrHelp) {
		os.Exit(0)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "read-state:", err)
		os.Exit(2)
	}
	if err := setGCPeriod(cfg.gcperiod); err != nil {
		fmt.Fprintln(os.Stderr, "read-state:", err)
		os.Exit(2)
	}
	debug.SetGCPercent(cfg.gcpercent)

	cache := NewLRUCache(cfg.capacity)
	w := &workload{
		cache:     cache,
		rng:       rand.New(rand.NewPCG(cfg.seed, cfg.seed^0x9E3779B97F4A7C15)),
		keys:      cfg.keys,
		readRatio: cfg.readRatio,
	}

	var rec *recorder
	if cfg.out != "" {
		rec, err = newRecorder(cfg, start, listEntryBytes)
		if err != nil {
			fmt.Fprintln(os.Stderr, "read-state:", err)
			os.Exit(1)
		}
	}

	// win counts the current window. The recorder adds it to the run totals
	// and resets it each time it writes a record.
	var win counts
	for {
		t0 := time.Now()
		for range cfg.batch {
			w.op(&win)
		}
		d := time.Since(t0)
		time.Sleep(cfg.sleep)

		now := time.Now()
		done := cfg.duration > 0 && now.Sub(start) >= cfg.duration
		if rec != nil {
			rec.batchDone(d)
			err := rec.maybeWriteSecond(now, cache.Len(), &win)
			if err == nil && done {
				err = rec.writeEnd(now, cache.Len(), &win)
			}
			if err != nil {
				fmt.Fprintln(os.Stderr, "read-state:", err)
				os.Exit(1)
			}
		}
		if done {
			os.Exit(0)
		}
	}
}
