package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPercentile(t *testing.T) {
	s := []int64{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}
	if got := percentile(s, 0.5); got != 5 {
		t.Errorf("p50 = %d", got)
	}
	if got := percentile(s, 0.99); got != 10 {
		t.Errorf("p99 = %d", got)
	}
	if got := percentile([]float64{}, 0.5); got != 0 {
		t.Errorf("empty = %v", got)
	}
	if got := median([]int64{9, 1, 5}); got != 5 {
		t.Errorf("median = %d", got)
	}
}

func TestSteadyIndex(t *testing.T) {
	secs := []record{{Entries: 10}, {Entries: 99}, {Entries: 100}, {Entries: 100}}
	if got := steadyIndex(secs, 100); got != 2 {
		t.Errorf("steadyIndex = %d, want 2", got)
	}
	if got := steadyIndex(secs[:2], 100); got != -1 {
		t.Errorf("steadyIndex = %d, want -1", got)
	}
}

const goRun = `{"type":"env","variant":"go-x","profile":"quick","git_commit":"abc","host":{"os":"macOS","os_version":"26.0","cpu_model":"M","ncpu":10,"mem_bytes":1},"go_version":"go1.26.4","rust_version":"rustc","matrix":{"order":1,"label":"Go X","issue":2,"group":"go-baseline","go192":true}}
{"type":"config","lang":"go","variant":"go-x","capacity":100,"capacity_effective":100,"keys":125,"batch":10,"sleep_ms":100,"read_ratio":0.5,"duration_s":4,"seed":1,"entry_bytes":56,"layout":"list","shards":1,"gcpercent":100,"gcperiod_s":2,"gcperiod_mechanism":"linkname","gomaxprocs":10,"goexperiment":"","gomemlimit_bytes":9223372036854775807,"go_runtime":"go1.26.4"}
{"type":"gc","t":0.5,"cycles":1,"n_end":1,"kind":"heap","gc_cpu_s":0.01,"mark_assist_s":0,"pause_s":0.0001}
{"type":"sec","t":1.0,"ops":100,"hits":0,"misses":100,"evictions":0,"entries":90,"batch_us":[1,2],"batch_p99_us":2,"batch_max_us":2,"cpu_pct":10,"heap_live_bytes":1048576,"scan_heap_bytes":5}
{"type":"sec","t":2.0,"ops":100,"hits":80,"misses":20,"evictions":10,"entries":100,"batch_us":[3,4],"batch_p99_us":4,"batch_max_us":4,"cpu_pct":20,"heap_live_bytes":2097152,"scan_heap_bytes":6}
{"type":"gc","t":2.6,"cycles":1,"n_end":2,"kind":"periodic","gc_cpu_s":0.5,"mark_assist_s":0.1,"pause_s":0.0002}
{"type":"gc","t":2.8,"cycles":3,"n_end":5,"kind":"heap","gc_cpu_s":0.03,"mark_assist_s":0,"pause_s":0.0009,"pause_max_s":0.0005}
{"type":"sec","t":3.0,"ops":100,"hits":80,"misses":20,"evictions":20,"entries":100,"batch_us":[5,100],"batch_p99_us":100,"batch_max_us":100,"cpu_pct":40,"heap_live_bytes":2097152,"scan_heap_bytes":7}
{"type":"end","t":4.0,"ops":300,"hits":160,"misses":140,"evictions":30,"entries":100,"batches":6,"cpu_s":1}
{"type":"proc","t":1,"rss_bytes":1048576}
{"type":"proc","t":2,"rss_bytes":2097152}
{"type":"proc","t":3,"rss_bytes":4194304}
`

const rustShort = `{"type":"config","lang":"rust","variant":"rust-y","capacity":100,"capacity_effective":100,"keys":125,"batch":10,"sleep_ms":100,"read_ratio":0.5,"duration_s":2,"seed":1,"entry_bytes":48,"map":"hash","compact":false}
{"type":"sec","t":1.0,"ops":100,"hits":0,"misses":100,"evictions":0,"entries":50,"batch_us":[1],"batch_p99_us":1,"batch_max_us":1,"cpu_pct":5}
{"type":"end","t":1.5,"ops":100,"hits":0,"misses":100,"evictions":0,"entries":50,"batches":1,"cpu_s":0.1}
`

func readFixture(t *testing.T, name, body string) *run {
	t.Helper()
	p := filepath.Join(t.TempDir(), name+".jsonl")
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	r, err := readRun(p)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestSummarize(t *testing.T) {
	runs := []*run{readFixture(t, "rust-y", rustShort), readFixture(t, "go-x", goRun)}
	var warn strings.Builder
	s := build(runs, time.Unix(0, 0), &warn)
	if len(s.Variants) != 2 || s.Variants[0].ID != "go-x" || s.Variants[1].ID != "rust-y" {
		t.Fatalf("variant order: %+v", s.Variants)
	}
	g := s.Variants[0]
	if g.Label != "Go X" || g.Group != "go-baseline" || g.Go192 == nil || !*g.Go192 || g.Config.GOMEMLIMIT != nil {
		t.Errorf("metadata: %+v", g)
	}
	h := g.Headline
	if h == nil {
		t.Fatal("go headline is nil")
	}
	if h.SteadyFromS != 2 || h.OpsPerS != 100 || h.HitRate != 0.8 || h.CPUPctMean != 30 || h.CPUPctMax != 40 {
		t.Errorf("headline: %+v", h)
	}
	if h.BatchP50US != 4 || h.BatchMaxUS != 100 || h.RSSBytesMedian != 2097152 || h.RSSBytesMax != 4194304 {
		t.Errorf("headline batches/rss: %+v", h)
	}
	if h.GC == nil || h.GC.Cycles != 4 || h.GC.PeriodicCycles != 1 || h.GC.CPUSPerPeriodicMedian != 0.5 ||
		h.GC.PauseMaxMS != 0.5 || h.GC.HeapLiveBytes != 2097152 {
		t.Errorf("gc headline: %+v", h.GC)
	}
	if len(g.Series.T) != 3 || g.Series.RSSMB[0] == nil || *g.Series.RSSMB[0] != 1 || *g.Series.HeapLiveMB[1] != 2 {
		t.Errorf("series: %+v", g.Series)
	}
	if len(g.GCEvents) != 3 {
		t.Errorf("gc events: %+v", g.GCEvents)
	}

	r := s.Variants[1]
	if r.Headline != nil || r.Series.HeapLiveMB != nil {
		t.Errorf("short rust run: headline %+v, heap %v", r.Headline, r.Series.HeapLiveMB)
	}
	if !strings.Contains(warn.String(), "rust-y") {
		t.Errorf("no warning for the short run: %q", warn.String())
	}
	if s.Profile.Capacity != 100 || s.Profile.GCPeriodS == nil || *s.Profile.GCPeriodS != 2 || s.Env.GitCommit != "abc" {
		t.Errorf("profile/env: %+v %+v", s.Profile, s.Env)
	}
}
