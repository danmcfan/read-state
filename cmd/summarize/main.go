// Command summarize reads every results/<variant>.jsonl file written by
// scripts/run.sh and writes summary.json, the only data source for the site.
//
//	go run ./cmd/summarize --in=results
//
// When --in is the repo's results directory it also writes an identical copy to
// site/data/summary.json. See results/README.md for both formats.
package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"time"
)

// record is any JSONL record. Fields are pointers where a record type may
// leave them out.
type record struct {
	Type    string `json:"type"`
	Variant string `json:"variant"`

	// env
	Profile   string             `json:"profile"`
	GitCommit string             `json:"git_commit"`
	Host      *host              `json:"host"`
	GoVersion string             `json:"go_version"`
	RustVer   string             `json:"rust_version"`
	EnvVars   map[string]*string `json:"env_vars"`
	Matrix    *matrix            `json:"matrix"`

	// config
	Lang              string   `json:"lang"`
	Capacity          int64    `json:"capacity"`
	CapacityEffective int64    `json:"capacity_effective"`
	Keys              int64    `json:"keys"`
	Batch             int64    `json:"batch"`
	SleepMS           float64  `json:"sleep_ms"`
	ReadRatio         float64  `json:"read_ratio"`
	DurationS         float64  `json:"duration_s"`
	EntryBytes        int64    `json:"entry_bytes"`
	Layout            *string  `json:"layout"`
	Shards            *int64   `json:"shards"`
	GCPercent         *int64   `json:"gcpercent"`
	GCPeriodS         *float64 `json:"gcperiod_s"`
	GOMAXPROCS        *int64   `json:"gomaxprocs"`
	GOEXPERIMENT      *string  `json:"goexperiment"`
	GOMEMLIMIT        *int64   `json:"gomemlimit_bytes"`
	Map               *string  `json:"map"`
	Compact           *bool    `json:"compact"`

	// sec, gc, end, proc
	T          float64  `json:"t"`
	Ops        int64    `json:"ops"`
	Hits       int64    `json:"hits"`
	Misses     int64    `json:"misses"`
	Entries    int64    `json:"entries"`
	BatchUS    []int64  `json:"batch_us"`
	BatchP99US int64    `json:"batch_p99_us"`
	BatchMaxUS int64    `json:"batch_max_us"`
	CPUPct     float64  `json:"cpu_pct"`
	HeapLive   *int64   `json:"heap_live_bytes"`
	ScanHeap   *int64   `json:"scan_heap_bytes"`
	Cycles     int64    `json:"cycles"`
	Kind       string   `json:"kind"`
	GCCPUS     float64  `json:"gc_cpu_s"`
	AssistS    float64  `json:"mark_assist_s"`
	PauseS     float64  `json:"pause_s"`
	PauseMaxS  *float64 `json:"pause_max_s"`
	RSSBytes   int64    `json:"rss_bytes"`
}

type host struct {
	OS        string `json:"os"`
	OSVersion string `json:"os_version"`
	CPUModel  string `json:"cpu_model"`
	NCPU      int64  `json:"ncpu"`
	MemBytes  int64  `json:"mem_bytes"`
}

type matrix struct {
	Order int    `json:"order"`
	Label string `json:"label"`
	Issue int    `json:"issue"`
	Group string `json:"group"`
	Go192 *bool  `json:"go192"`
}

// run is one variant's parsed file.
type run struct {
	id     string
	env    *record
	config *record
	secs   []record
	gcs    []record
	procs  []record
}

func readRun(path string) (*run, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	r := &run{id: strings.TrimSuffix(filepath.Base(path), ".jsonl")}
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 1<<16), 1<<24)
	for line := 1; sc.Scan(); line++ {
		if len(bytes.TrimSpace(sc.Bytes())) == 0 {
			continue
		}
		var rec record
		if err := json.Unmarshal(sc.Bytes(), &rec); err != nil {
			return nil, fmt.Errorf("%s:%d: %v", path, line, err)
		}
		switch rec.Type {
		case "env":
			r.env = &rec
		case "config":
			r.config = &rec
		case "sec":
			r.secs = append(r.secs, rec)
		case "gc":
			r.gcs = append(r.gcs, rec)
		case "proc":
			r.procs = append(r.procs, rec)
		}
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	if r.config == nil {
		return nil, fmt.Errorf("%s: no config record", path)
	}
	if r.config.Variant != "" {
		r.id = r.config.Variant
	}
	return r, nil
}

// Output types, in summary.json field order.

type summary struct {
	SchemaVersion int       `json:"schema_version"`
	GeneratedAt   string    `json:"generated_at"`
	Profile       *profile  `json:"profile"`
	Env           *envOut   `json:"env"`
	Variants      []variant `json:"variants"`
}

type profile struct {
	Name      string   `json:"name"`
	Capacity  int64    `json:"capacity"`
	Keys      int64    `json:"keys"`
	ReadRatio float64  `json:"read_ratio"`
	Batch     int64    `json:"batch"`
	SleepMS   float64  `json:"sleep_ms"`
	GCPeriodS *float64 `json:"gcperiod_s"`
	DurationS float64  `json:"duration_s"`
	Faithful  faithful `json:"faithful"`
}

type faithful struct {
	Capacity  int64 `json:"capacity"`
	GCPeriodS int64 `json:"gcperiod_s"`
}

type envOut struct {
	OS          string `json:"os"`
	CPUModel    string `json:"cpu_model"`
	NCPU        int64  `json:"ncpu"`
	MemBytes    int64  `json:"mem_bytes"`
	GoVersion   string `json:"go_version"`
	RustVersion string `json:"rust_version"`
	GOMAXPROCS  *int64 `json:"gomaxprocs"`
	GitCommit   string `json:"git_commit"`
}

type variant struct {
	ID       string    `json:"id"`
	Lang     string    `json:"lang"`
	Label    string    `json:"label"`
	Issue    *int      `json:"issue"`
	Group    string    `json:"group"`
	Go192    *bool     `json:"go192"`
	Config   configOut `json:"config"`
	Headline *headline `json:"headline"`
	Series   series    `json:"series"`
	GCEvents []gcEvent `json:"gc_events"`
}

type configOut struct {
	Layout       *string `json:"layout"`
	Shards       *int64  `json:"shards"`
	GCPercent    *int64  `json:"gcpercent"`
	GOMEMLIMIT   *int64  `json:"gomemlimit"`
	GOEXPERIMENT *string `json:"goexperiment"`
	Map          *string `json:"map"`
	Compact      *bool   `json:"compact"`
	Capacity     int64   `json:"capacity"`
	Keys         int64   `json:"keys"`
	EntryBytes   int64   `json:"entry_bytes"`
}

type headline struct {
	SteadyFromS    float64     `json:"steady_from_s"`
	OpsPerS        int64       `json:"ops_per_s"`
	HitRate        float64     `json:"hit_rate"`
	MissRate       float64     `json:"miss_rate"`
	CPUPctMean     float64     `json:"cpu_pct_mean"`
	CPUPctP99      float64     `json:"cpu_pct_p99"`
	CPUPctMax      float64     `json:"cpu_pct_max"`
	RSSBytesMedian int64       `json:"rss_bytes_median"`
	RSSBytesMax    int64       `json:"rss_bytes_max"`
	BytesPerEntry  int64       `json:"bytes_per_entry"`
	BatchP50US     int64       `json:"batch_p50_us"`
	BatchP99US     int64       `json:"batch_p99_us"`
	BatchMaxUS     int64       `json:"batch_max_us"`
	GC             *gcHeadline `json:"gc"`
}

type gcHeadline struct {
	Cycles                   int64   `json:"cycles"`
	PeriodicCycles           int64   `json:"periodic_cycles"`
	CPUSPerPeriodicMedian    float64 `json:"cpu_s_per_periodic_median"`
	CPUSPerPeriodicMax       float64 `json:"cpu_s_per_periodic_max"`
	AssistSPerPeriodicMedian float64 `json:"assist_s_per_periodic_median"`
	PauseMaxMS               float64 `json:"pause_max_ms"`
	ScanHeapBytes            int64   `json:"scan_heap_bytes"`
	HeapLiveBytes            int64   `json:"heap_live_bytes"`
}

type series struct {
	T          []int64    `json:"t"`
	CPUPct     []float64  `json:"cpu_pct"`
	RSSMB      []*float64 `json:"rss_mb"`
	BatchP99US []int64    `json:"batch_p99_us"`
	BatchMaxUS []int64    `json:"batch_max_us"`
	HeapLiveMB []*float64 `json:"heap_live_mb"`
}

type gcEvent struct {
	T       float64 `json:"t"`
	Kind    string  `json:"kind"`
	Cycles  int64   `json:"cycles"`
	CPUS    float64 `json:"cpu_s"`
	AssistS float64 `json:"assist_s"`
	PauseMS float64 `json:"pause_ms"`
}

const mib = 1 << 20

func round(v float64, decimals int) float64 {
	p := math.Pow10(decimals)
	return math.Round(v*p) / p
}

// percentile returns the nearest-rank percentile of sorted, or 0 if empty.
func percentile[T int64 | float64](sorted []T, p float64) T {
	if len(sorted) == 0 {
		return 0
	}
	i := int(math.Ceil(p*float64(len(sorted)))) - 1
	return sorted[max(0, min(i, len(sorted)-1))]
}

func median[T int64 | float64](v []T) T {
	s := slices.Clone(v)
	slices.Sort(s)
	return percentile(s, 0.5)
}

// steadyIndex returns the index of the first sec record whose cache is full,
// or -1 if the cache never filled.
func steadyIndex(secs []record, capacity int64) int {
	for i, s := range secs {
		if s.Entries >= capacity {
			return i
		}
	}
	return -1
}

// nearestProc returns the RSS of the proc record nearest to t, if one is
// within 1.5 s.
func nearestProc(procs []record, t float64) (int64, bool) {
	best, bestD := int64(0), math.Inf(1)
	for _, p := range procs {
		if d := math.Abs(p.T - t); d < bestD {
			best, bestD = p.RSSBytes, d
		}
	}
	return best, bestD <= 1.5
}

func summarizeRun(r *run, stderr io.Writer) variant {
	c := r.config
	v := variant{ID: r.id, Lang: c.Lang, GCEvents: []gcEvent{}}
	if r.env != nil && r.env.Matrix != nil {
		m := r.env.Matrix
		v.Label, v.Group, v.Go192 = m.Label, m.Group, m.Go192
		v.Issue = &m.Issue
	}
	capEff := c.CapacityEffective
	if capEff == 0 {
		capEff = c.Capacity
	}
	v.Config = configOut{
		Layout: c.Layout, Shards: c.Shards, GCPercent: c.GCPercent, GOEXPERIMENT: c.GOEXPERIMENT,
		Map: c.Map, Compact: c.Compact, Capacity: c.Capacity, Keys: c.Keys, EntryBytes: c.EntryBytes,
	}
	if c.GOMEMLIMIT != nil && *c.GOMEMLIMIT != math.MaxInt64 {
		v.Config.GOMEMLIMIT = c.GOMEMLIMIT
	}
	isGo := c.Lang == "go"

	// Series: one point per sec record over the whole run.
	s := series{T: []int64{}, CPUPct: []float64{}, RSSMB: []*float64{}, BatchP99US: []int64{},
		BatchMaxUS: []int64{}}
	if isGo {
		s.HeapLiveMB = []*float64{}
	}
	for _, sec := range r.secs {
		s.T = append(s.T, int64(math.Round(sec.T)))
		s.CPUPct = append(s.CPUPct, round(sec.CPUPct, 1))
		if rss, ok := nearestProc(r.procs, sec.T); ok {
			mb := round(float64(rss)/mib, 1)
			s.RSSMB = append(s.RSSMB, &mb)
		} else {
			s.RSSMB = append(s.RSSMB, nil)
		}
		s.BatchP99US = append(s.BatchP99US, sec.BatchP99US)
		s.BatchMaxUS = append(s.BatchMaxUS, sec.BatchMaxUS)
		if isGo {
			if sec.HeapLive != nil {
				mb := round(float64(*sec.HeapLive)/mib, 1)
				s.HeapLiveMB = append(s.HeapLiveMB, &mb)
			} else {
				s.HeapLiveMB = append(s.HeapLiveMB, nil)
			}
		}
	}
	if !isGo {
		s.HeapLiveMB = nil
	}
	v.Series = s

	for _, g := range r.gcs {
		v.GCEvents = append(v.GCEvents, gcEvent{
			T: round(g.T, 3), Kind: g.Kind, Cycles: g.Cycles, CPUS: round(g.GCCPUS, 4),
			AssistS: round(g.AssistS, 4), PauseMS: round(g.PauseS*1000, 3),
		})
	}

	si := steadyIndex(r.secs, capEff)
	if si < 0 {
		fmt.Fprintf(stderr, "summarize: %s: the cache never filled; headline is null\n", r.id)
		return v
	}
	v.Headline = computeHeadline(r, si, capEff, isGo)
	return v
}

func computeHeadline(r *run, si int, capacity int64, isGo bool) *headline {
	steady := r.secs[si:]
	from := steady[0].T
	prevT := 0.0
	if si > 0 {
		prevT = r.secs[si-1].T
	}
	var ops, hits int64
	var cpu []float64
	var batches []int64
	var heapLive, scanHeap []int64
	for _, s := range steady {
		ops += s.Ops
		hits += s.Hits
		cpu = append(cpu, s.CPUPct)
		batches = append(batches, s.BatchUS...)
		if s.HeapLive != nil {
			heapLive = append(heapLive, *s.HeapLive)
		}
		if s.ScanHeap != nil {
			scanHeap = append(scanHeap, *s.ScanHeap)
		}
	}
	h := &headline{SteadyFromS: round(from, 3)}
	if span := steady[len(steady)-1].T - prevT; span > 0 {
		h.OpsPerS = int64(math.Round(float64(ops) / span))
	}
	if ops > 0 {
		h.HitRate = round(float64(hits)/float64(ops), 4)
		h.MissRate = round(1-float64(hits)/float64(ops), 4)
	}
	var sum float64
	for _, c := range cpu {
		sum += c
	}
	slices.Sort(cpu)
	h.CPUPctMean = round(sum/float64(len(cpu)), 1)
	h.CPUPctP99 = round(percentile(cpu, 0.99), 1)
	h.CPUPctMax = round(percentile(cpu, 1), 1)

	// proc t is whole seconds from bash, so allow for up to a second of skew.
	var rss []int64
	for _, p := range r.procs {
		if p.T >= math.Floor(from) {
			rss = append(rss, p.RSSBytes)
		}
	}
	slices.Sort(rss)
	h.RSSBytesMedian = percentile(rss, 0.5)
	h.RSSBytesMax = percentile(rss, 1)
	h.BytesPerEntry = int64(math.Round(float64(h.RSSBytesMedian) / float64(capacity)))

	slices.Sort(batches)
	h.BatchP50US = percentile(batches, 0.5)
	h.BatchP99US = percentile(batches, 0.99)
	h.BatchMaxUS = percentile(batches, 1)

	if !isGo {
		return h
	}
	g := &gcHeadline{}
	var periodicCPU, periodicAssist []float64
	for _, e := range r.gcs {
		if e.T < from {
			continue
		}
		g.Cycles += e.Cycles
		if e.Kind == "periodic" {
			g.PeriodicCycles += e.Cycles
			if e.Cycles == 1 {
				periodicCPU = append(periodicCPU, e.GCCPUS)
				periodicAssist = append(periodicAssist, e.AssistS)
			}
		}
		switch {
		case e.PauseMaxS != nil:
			g.PauseMaxMS = max(g.PauseMaxMS, round(*e.PauseMaxS*1000, 3))
		case e.Cycles == 1:
			// Older records without pause_max_s: a single cycle's total is its max.
			g.PauseMaxMS = max(g.PauseMaxMS, round(e.PauseS*1000, 3))
		}
	}
	slices.Sort(periodicCPU)
	g.CPUSPerPeriodicMedian = round(percentile(periodicCPU, 0.5), 3)
	g.CPUSPerPeriodicMax = round(percentile(periodicCPU, 1), 3)
	g.AssistSPerPeriodicMedian = round(median(periodicAssist), 3)
	if len(scanHeap) > 0 {
		g.ScanHeapBytes = median(scanHeap)
	}
	if len(heapLive) > 0 {
		g.HeapLiveBytes = median(heapLive)
	}
	h.GC = g
	return h
}

func order(r *run) int {
	if r.env != nil && r.env.Matrix != nil && r.env.Matrix.Order > 0 {
		return r.env.Matrix.Order
	}
	return math.MaxInt
}

func build(runs []*run, now time.Time, stderr io.Writer) summary {
	sort.SliceStable(runs, func(i, j int) bool {
		if oi, oj := order(runs[i]), order(runs[j]); oi != oj {
			return oi < oj
		}
		return runs[i].id < runs[j].id
	})
	out := summary{SchemaVersion: 1, GeneratedAt: now.UTC().Format(time.RFC3339), Variants: []variant{}}
	for _, r := range runs {
		out.Variants = append(out.Variants, summarizeRun(r, stderr))
	}
	if len(runs) == 0 {
		return out
	}

	first := runs[0]
	p := &profile{Name: "quick", Capacity: first.config.Capacity, Keys: first.config.Keys,
		ReadRatio: first.config.ReadRatio, Batch: first.config.Batch, SleepMS: first.config.SleepMS,
		DurationS: first.config.DurationS, Faithful: faithful{Capacity: 20_000_000, GCPeriodS: 120}}
	e := &envOut{}
	commits := map[string]bool{}
	for _, r := range runs {
		if r.env != nil {
			if r.env.Profile != "" {
				p.Name = r.env.Profile
			}
			if e.GitCommit == "" {
				e.GitCommit = r.env.GitCommit
				e.GoVersion, e.RustVersion = r.env.GoVersion, r.env.RustVer
				if hh := r.env.Host; hh != nil {
					e.OS = strings.TrimSpace(hh.OS + " " + hh.OSVersion)
					e.CPUModel, e.NCPU, e.MemBytes = hh.CPUModel, hh.NCPU, hh.MemBytes
				}
			}
			commits[r.env.GitCommit] = true
		}
		if r.config.Lang == "go" && p.GCPeriodS == nil {
			p.GCPeriodS, e.GOMAXPROCS = r.config.GCPeriodS, r.config.GOMAXPROCS
		}
	}
	if len(commits) > 1 {
		fmt.Fprintf(stderr, "summarize: runs come from %d different commits; env.git_commit is the first\n", len(commits))
	}
	out.Profile, out.Env = p, e
	return out
}

func main() {
	in := flag.String("in", "results", "directory of <variant>.jsonl files")
	flag.Parse()

	paths, err := filepath.Glob(filepath.Join(*in, "*.jsonl"))
	if err != nil {
		fmt.Fprintln(os.Stderr, "summarize:", err)
		os.Exit(1)
	}
	var runs []*run
	for _, p := range paths {
		r, err := readRun(p)
		if err != nil {
			fmt.Fprintln(os.Stderr, "summarize:", err)
			os.Exit(1)
		}
		runs = append(runs, r)
	}
	b, err := json.MarshalIndent(build(runs, time.Now(), os.Stderr), "", " ")
	if err != nil {
		fmt.Fprintln(os.Stderr, "summarize:", err)
		os.Exit(1)
	}
	b = append(b, '\n')

	targets := []string{filepath.Join(*in, "summary.json")}
	// The repo's own results also feed the site.
	if abs, err := filepath.Abs(*in); err == nil {
		if wd, err := os.Getwd(); err == nil && abs == filepath.Join(wd, "results") {
			targets = append(targets, filepath.Join("site", "data", "summary.json"))
		}
	}
	for _, t := range targets {
		if err := os.MkdirAll(filepath.Dir(t), 0o755); err == nil {
			err = os.WriteFile(t, b, 0o644)
		}
		if err != nil {
			fmt.Fprintln(os.Stderr, "summarize:", err)
			os.Exit(1)
		}
		fmt.Fprintf(os.Stderr, "summarize: wrote %s (%d variants)\n", t, len(runs))
	}
}
