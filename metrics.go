package main

import (
	"bufio"
	"math"
	"os"
	"runtime"
	"runtime/debug"
	"runtime/metrics"
	"slices"
	"strconv"
	"syscall"
	"time"
)

// Indexes into recorder.samples.
const (
	mCycles = iota
	mForced
	mGCTotal
	mMarkDedicated
	mMarkAssist
	mMarkIdle
	mPauseCPU
	mHeapLive
	mHeapGoal
	mHeapObjects
	mScanHeap
	mTotal
	numMetrics
)

var metricNames = [numMetrics]string{
	mCycles:        "/gc/cycles/total:gc-cycles",
	mForced:        "/gc/cycles/forced:gc-cycles",
	mGCTotal:       "/cpu/classes/gc/total:cpu-seconds",
	mMarkDedicated: "/cpu/classes/gc/mark/dedicated:cpu-seconds",
	mMarkAssist:    "/cpu/classes/gc/mark/assist:cpu-seconds",
	mMarkIdle:      "/cpu/classes/gc/mark/idle:cpu-seconds",
	mPauseCPU:      "/cpu/classes/gc/pause:cpu-seconds",
	mHeapLive:      "/gc/heap/live:bytes",
	mHeapGoal:      "/gc/heap/goal:bytes",
	mHeapObjects:   "/gc/heap/objects:objects",
	mScanHeap:      "/gc/scan/heap:bytes",
	mTotal:         "/memory/classes/total:bytes",
}

// gcSnapshot holds the cumulative GC values at the last gc record, so the next
// one can report deltas.
type gcSnapshot struct {
	cycles, forced                                     uint64
	cpu, markDedicated, markAssist, markIdle, pauseCPU float64
	pauseTotal                                         time.Duration
}

// recorder writes the JSONL metrics records. It's driven by the main loop
// (there's no sampler goroutine) and reuses its buffers, so writing records
// allocates almost nothing.
type recorder struct {
	f         *os.File
	w         *bufio.Writer
	j         jsonWriter
	start     time.Time
	gcpercent int

	batchUS []int64 // batch durations in the current window, in µs
	sorted  []int64 // scratch for percentiles
	total   counts  // run totals, excluding the current window
	batches int64   // run total, including the current window

	lastSec time.Time
	lastCPU float64

	samples   []metrics.Sample
	gcStats   debug.GCStats
	lastGC    gcSnapshot
	intervals []time.Duration
}

func newRecorder(cfg config, start time.Time, entryBytes int) (*recorder, error) {
	r := &recorder{
		start:     start,
		gcpercent: cfg.gcpercent,
		batchUS:   make([]int64, 0, 64),
		sorted:    make([]int64, 0, 64),
		lastSec:   start,
		samples:   make([]metrics.Sample, numMetrics),
		intervals: make([]time.Duration, 0, 256),
		gcStats: debug.GCStats{
			// ReadGCStats reuses these when they're big enough.
			Pause:    make([]time.Duration, 0, 2*256+3),
			PauseEnd: make([]time.Time, 0, 256),
		},
	}
	r.j.b = make([]byte, 0, 4096)
	for i, name := range metricNames {
		r.samples[i].Name = name
	}
	if cfg.out == "-" {
		r.w = bufio.NewWriter(os.Stdout)
	} else {
		f, err := os.OpenFile(cfg.out, os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0o644)
		if err != nil {
			return nil, err
		}
		r.f = f
		r.w = bufio.NewWriter(f)
	}
	r.writeConfig(cfg, entryBytes)
	return r, r.w.Flush()
}

func (r *recorder) writeConfig(cfg config, entryBytes int) {
	goexperiment := ""
	if bi, ok := debug.ReadBuildInfo(); ok {
		for _, s := range bi.Settings {
			if s.Key == "GOEXPERIMENT" {
				goexperiment = s.Value
			}
		}
	}
	j := &r.j
	j.begin()
	j.str("type", "config")
	j.str("lang", "go")
	j.str("variant", cfg.variant)
	j.int("capacity", int64(cfg.capacity))
	j.int("capacity_effective", int64(cfg.capacity))
	j.int("keys", cfg.keys)
	j.int("batch", int64(cfg.batch))
	j.num("sleep_ms", float64(cfg.sleep)/float64(time.Millisecond), -1)
	j.num("read_ratio", cfg.readRatio, -1)
	j.num("duration_s", cfg.duration.Seconds(), -1)
	j.uint("seed", cfg.seed)
	j.int("entry_bytes", int64(entryBytes))
	j.str("layout", cfg.layout)
	j.int("shards", 1)
	j.int("gcpercent", int64(cfg.gcpercent))
	j.num("gcperiod_s", gcPeriod().Seconds(), -1)
	j.str("gcperiod_mechanism", gcPeriodMechanism)
	j.int("gomaxprocs", int64(runtime.GOMAXPROCS(0)))
	j.str("goexperiment", goexperiment)
	j.int("gomemlimit_bytes", debug.SetMemoryLimit(-1))
	j.str("go_runtime", runtime.Version())
	j.end()
	r.w.Write(j.b)
}

// batchDone records one batch's duration.
func (r *recorder) batchDone(d time.Duration) {
	r.batchUS = append(r.batchUS, d.Microseconds())
	r.batches++
}

// maybeWriteSecond writes any new gc records and a sec record for the current
// window if at least a second has passed since the last one.
func (r *recorder) maybeWriteSecond(now time.Time, entries int, win *counts) error {
	dt := now.Sub(r.lastSec).Seconds()
	if dt < 1 {
		return nil
	}
	cpu := cpuSeconds()
	r.readGo()
	r.writeGC()

	j := &r.j
	j.begin()
	j.str("type", "sec")
	j.num("t", r.since(now), 3)
	j.int("ops", win.ops)
	j.int("hits", win.hits)
	j.int("misses", win.misses)
	j.int("evictions", win.evictions)
	j.int("entries", int64(entries))
	j.int("batches", int64(len(r.batchUS)))
	j.ints("batch_us", r.batchUS)
	r.sorted = append(r.sorted[:0], r.batchUS...)
	slices.Sort(r.sorted)
	j.int("batch_p50_us", percentile(r.sorted, 0.50))
	j.int("batch_p99_us", percentile(r.sorted, 0.99))
	j.int("batch_max_us", percentile(r.sorted, 1))
	j.num("cpu_s", cpu, 3)
	j.num("cpu_pct", 100*(cpu-r.lastCPU)/dt, 1)
	s := r.samples
	j.uint("gc_cycles", s[mCycles].Value.Uint64())
	j.uint("gc_cycles_forced", s[mForced].Value.Uint64())
	j.num("gc_cpu_s", s[mGCTotal].Value.Float64(), 6)
	j.num("gc_mark_dedicated_s", s[mMarkDedicated].Value.Float64(), 6)
	j.num("gc_mark_assist_s", s[mMarkAssist].Value.Float64(), 6)
	j.num("gc_mark_idle_s", s[mMarkIdle].Value.Float64(), 6)
	j.num("gc_pause_cpu_s", s[mPauseCPU].Value.Float64(), 6)
	j.num("gc_pause_total_s", r.gcStats.PauseTotal.Seconds(), 6)
	j.uint("heap_live_bytes", s[mHeapLive].Value.Uint64())
	j.uint("heap_goal_bytes", s[mHeapGoal].Value.Uint64())
	j.uint("heap_objects", s[mHeapObjects].Value.Uint64())
	j.uint("scan_heap_bytes", s[mScanHeap].Value.Uint64())
	j.uint("go_total_bytes", s[mTotal].Value.Uint64())
	j.end()
	r.w.Write(j.b)

	r.total.add(win)
	*win = counts{}
	r.batchUS = r.batchUS[:0]
	r.lastSec = now
	r.lastCPU = cpu
	return r.w.Flush()
}

// writeEnd writes any new gc records and the end record with the run totals,
// including the partial last window, then flushes and closes the output.
func (r *recorder) writeEnd(now time.Time, entries int, win *counts) error {
	r.readGo()
	r.writeGC()
	r.total.add(win)
	*win = counts{}
	j := &r.j
	j.begin()
	j.str("type", "end")
	j.num("t", r.since(now), 3)
	j.int("ops", r.total.ops)
	j.int("hits", r.total.hits)
	j.int("misses", r.total.misses)
	j.int("evictions", r.total.evictions)
	j.int("entries", int64(entries))
	j.int("batches", r.batches)
	j.num("cpu_s", cpuSeconds(), 3)
	j.end()
	r.w.Write(j.b)
	if err := r.w.Flush(); err != nil {
		return err
	}
	if r.f != nil {
		return r.f.Close()
	}
	return nil
}

// readGo reads runtime/metrics and then debug.ReadGCStats, which doesn't stop
// the world. Reading GC stats second means it has seen at least as many
// cycles as the metrics.
func (r *recorder) readGo() {
	metrics.Read(r.samples)
	debug.ReadGCStats(&r.gcStats)
}

// writeGC writes a gc record if GC cycles have finished since the last one.
// Its values are deltas over all the cycles since the previous gc record.
func (r *recorder) writeGC() {
	s := r.samples
	cycles := s[mCycles].Value.Uint64()
	if cycles <= r.lastGC.cycles {
		return
	}
	cur := gcSnapshot{
		cycles:        cycles,
		forced:        s[mForced].Value.Uint64(),
		cpu:           s[mGCTotal].Value.Float64(),
		markDedicated: s[mMarkDedicated].Value.Float64(),
		markAssist:    s[mMarkAssist].Value.Float64(),
		markIdle:      s[mMarkIdle].Value.Float64(),
		pauseCPU:      s[mPauseCPU].Value.Float64(),
		pauseTotal:    r.gcStats.PauseTotal,
	}
	prev := r.lastGC

	// PauseEnd holds cycle end times, newest first: PauseEnd[i] is the end of
	// cycle NumGC-i. Each new cycle's interval is from the previous cycle's
	// end to its own; -1 means unknown (the first cycle, or history lost).
	ends := r.gcStats.PauseEnd
	numGC := uint64(r.gcStats.NumGC)
	t := r.gcStats.LastGC
	if i := numGC - cycles; i < uint64(len(ends)) {
		t = ends[i]
	}
	r.intervals = r.intervals[:0]
	for n := prev.cycles + 1; n <= cycles; n++ {
		iv := time.Duration(-1)
		if i := numGC - n; i+1 < uint64(len(ends)) {
			iv = ends[i].Sub(ends[i+1])
		}
		r.intervals = append(r.intervals, iv)
	}
	kind := classifyGC(r.intervals, cur.forced-prev.forced, gcPeriod(), r.gcpercent)

	j := &r.j
	j.begin()
	j.str("type", "gc")
	j.num("t", r.since(t), 3)
	j.uint("cycles", cycles-prev.cycles)
	j.uint("n_end", cycles)
	j.str("kind", kind)
	j.num("gc_cpu_s", cur.cpu-prev.cpu, 6)
	j.num("mark_dedicated_s", cur.markDedicated-prev.markDedicated, 6)
	j.num("mark_assist_s", cur.markAssist-prev.markAssist, 6)
	j.num("mark_idle_s", cur.markIdle-prev.markIdle, 6)
	j.num("pause_cpu_s", cur.pauseCPU-prev.pauseCPU, 6)
	j.num("pause_s", (cur.pauseTotal - prev.pauseTotal).Seconds(), 6)
	j.uint("heap_live_bytes", s[mHeapLive].Value.Uint64())
	j.uint("scan_heap_bytes", s[mScanHeap].Value.Uint64())
	j.end()
	r.w.Write(j.b)
	r.lastGC = cur
}

// classifyGC names what started a group of GC cycles, given the end-to-end
// interval before each cycle (-1 if unknown) and how many of them were
// runtime.GC() calls.
//
// /gc/cycles/forced counts only runtime.GC() calls, so those are "user". The
// runtime starts a periodic cycle once the time since the last cycle ended
// passes the forced-GC period, so a cycle that ends at least that long after
// the previous one is "periodic" (unless GC is off, which disables the timer).
// Anything else was started by heap growth: "heap". A group with more than one
// kind is "mixed".
func classifyGC(intervals []time.Duration, forced uint64, period time.Duration, gcpercent int) string {
	n := uint64(len(intervals))
	switch {
	case forced >= n:
		return "user"
	case forced > 0:
		return "mixed"
	}
	kind := ""
	for _, iv := range intervals {
		k := "heap"
		if gcpercent >= 0 && iv >= period {
			k = "periodic"
		}
		if kind != "" && kind != k {
			return "mixed"
		}
		kind = k
	}
	return kind
}

// percentile returns the nearest-rank percentile of sorted, or 0 if empty.
func percentile(sorted []int64, p float64) int64 {
	if len(sorted) == 0 {
		return 0
	}
	i := int(math.Ceil(p*float64(len(sorted)))) - 1
	return sorted[max(0, min(i, len(sorted)-1))]
}

func (r *recorder) since(t time.Time) float64 { return t.Sub(r.start).Seconds() }

func (c *counts) add(o *counts) {
	c.ops += o.ops
	c.hits += o.hits
	c.misses += o.misses
	c.evictions += o.evictions
}

// cpuSeconds returns the process's user plus system CPU time.
func cpuSeconds() float64 {
	var ru syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &ru); err != nil {
		return 0
	}
	return float64(ru.Utime.Nano()+ru.Stime.Nano()) / 1e9
}

// jsonWriter builds one JSON object at a time in a reused buffer.
type jsonWriter struct {
	b     []byte
	first bool
}

func (j *jsonWriter) begin() { j.b = append(j.b[:0], '{'); j.first = true }
func (j *jsonWriter) end()   { j.b = append(j.b, '}', '\n') }

func (j *jsonWriter) key(k string) {
	if !j.first {
		j.b = append(j.b, ',')
	}
	j.first = false
	j.b = append(j.b, '"')
	j.b = append(j.b, k...)
	j.b = append(j.b, '"', ':')
}

func (j *jsonWriter) str(k, v string) { j.key(k); j.b = strconv.AppendQuoteToASCII(j.b, v) }
func (j *jsonWriter) int(k string, v int64) {
	j.key(k)
	j.b = strconv.AppendInt(j.b, v, 10)
}
func (j *jsonWriter) uint(k string, v uint64) {
	j.key(k)
	j.b = strconv.AppendUint(j.b, v, 10)
}

// num writes v with prec decimals (-1 for the shortest exact form).
func (j *jsonWriter) num(k string, v float64, prec int) {
	j.key(k)
	if math.IsNaN(v) || math.IsInf(v, 0) {
		j.b = append(j.b, "null"...)
		return
	}
	j.b = strconv.AppendFloat(j.b, v, 'f', prec, 64)
}

func (j *jsonWriter) ints(k string, v []int64) {
	j.key(k)
	j.b = append(j.b, '[')
	for i, x := range v {
		if i > 0 {
			j.b = append(j.b, ',')
		}
		j.b = strconv.AppendInt(j.b, x, 10)
	}
	j.b = append(j.b, ']')
}
