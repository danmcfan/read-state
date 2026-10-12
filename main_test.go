package main

import (
	"encoding/json"
	"io"
	"math/rand/v2"
	"testing"
	"time"
)

func TestParseFlagsDefaultsAreFaithful(t *testing.T) {
	c, err := parseFlags(nil, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	want := config{
		capacity: 20_000_000, keys: 25_000_000, batch: 20_000, sleep: 100 * time.Millisecond,
		readRatio: 0, duration: 0, out: "", seed: 1, layout: "list", gcpercent: 100,
		gcperiod: 2 * time.Minute,
	}
	if c != want {
		t.Fatalf("defaults = %+v, want %+v", c, want)
	}
}

func TestParseFlags(t *testing.T) {
	c, err := parseFlags([]string{"--capacity=2000000", "--keys", "2500000", "--read-ratio=0.5",
		"--duration=180s", "--gcperiod=20s", "-sleep=0"}, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	if c.capacity != 2_000_000 || c.keys != 2_500_000 || c.readRatio != 0.5 ||
		c.duration != 180*time.Second || c.gcperiod != 20*time.Second || c.sleep != 0 {
		t.Fatalf("parsed %+v", c)
	}
	for _, bad := range [][]string{
		{"--capacity=0"}, {"--keys=-1"}, {"--batch=0"}, {"--sleep=-1s"}, {"--read-ratio=1.5"},
		{"--read-ratio=NaN"}, {"--duration=-1s"}, {"--gcperiod=0"}, {"--layout=slab"},
		{"--nope"}, {"extra"},
	} {
		if _, err := parseFlags(bad, io.Discard); err == nil {
			t.Errorf("parseFlags(%q) succeeded", bad)
		}
	}
}

// The harness must not allocate per operation. Inserts into the list layout
// allocate by design, so pre-fill the cache and only touch cached keys.
func TestOpDoesNotAllocate(t *testing.T) {
	for _, ratio := range []float64{0, 0.5, 1} {
		const n = 1000
		c := NewLRUCache(n)
		for k := range int64(n) {
			c.Put(k, k)
		}
		w := &workload{cache: c, rng: rand.New(rand.NewPCG(1, 2)), keys: n, readRatio: ratio}
		var cnt counts
		if a := testing.AllocsPerRun(10_000, func() { w.op(&cnt) }); a != 0 {
			t.Errorf("read ratio %v: %v allocs per op", ratio, a)
		}
		if cnt.misses != 0 || cnt.evictions != 0 || cnt.hits != cnt.ops {
			t.Errorf("read ratio %v: counts %+v, want all hits", ratio, cnt)
		}
	}
}

func TestOpCounts(t *testing.T) {
	c := NewLRUCache(10)
	w := &workload{cache: c, rng: rand.New(rand.NewPCG(1, 2)), keys: 20, readRatio: 0.5}
	var cnt counts
	for range 1000 {
		w.op(&cnt)
	}
	if cnt.ops != 1000 || cnt.hits+cnt.misses != cnt.ops {
		t.Fatalf("counts %+v", cnt)
	}
	if cnt.evictions != cnt.misses-10 {
		t.Fatalf("evictions %d, want misses-capacity = %d", cnt.evictions, cnt.misses-10)
	}
	if c.Len() != 10 {
		t.Fatalf("Len = %d", c.Len())
	}
}

func TestListCacheLRU(t *testing.T) {
	c := NewLRUCache(2)
	c.Put(1, 10)
	c.Put(2, 20)
	if existed, _ := c.Put(1, 11); !existed { // 1 becomes most recent
		t.Fatal("Put(1) didn't find 1")
	}
	if _, evicted := c.Put(3, 30); !evicted { // evicts 2
		t.Fatal("Put(3) didn't evict")
	}
	if _, ok := c.Get(2); ok {
		t.Fatal("2 should have been evicted")
	}
	if v, ok := c.Get(1); !ok || v != 11 {
		t.Fatalf("Get(1) = %d, %v", v, ok)
	}
}

func TestClassifyGC(t *testing.T) {
	p := 20 * time.Second
	for _, tc := range []struct {
		iv        []time.Duration
		forced    uint64
		gcpercent int
		want      string
	}{
		{[]time.Duration{-1}, 0, 100, "heap"},
		{[]time.Duration{21 * time.Second}, 0, 100, "periodic"},
		{[]time.Duration{20 * time.Second}, 0, 100, "periodic"},
		{[]time.Duration{3 * time.Second}, 0, 100, "heap"},
		{[]time.Duration{21 * time.Second}, 0, -1, "heap"},
		{[]time.Duration{time.Second, 2 * time.Second}, 0, 100, "heap"},
		{[]time.Duration{time.Second, 25 * time.Second}, 0, 100, "mixed"},
		{[]time.Duration{time.Second}, 1, 100, "user"},
		{[]time.Duration{time.Second, time.Second}, 1, 100, "mixed"},
	} {
		if got := classifyGC(tc.iv, tc.forced, p, tc.gcpercent); got != tc.want {
			t.Errorf("classifyGC(%v, %d, %d) = %q, want %q", tc.iv, tc.forced, tc.gcpercent, got, tc.want)
		}
	}
}

func TestPercentile(t *testing.T) {
	s := []int64{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}
	for _, tc := range []struct {
		p    float64
		want int64
	}{{0.5, 5}, {0.99, 10}, {1, 10}, {0.1, 1}, {0, 1}} {
		if got := percentile(s, tc.p); got != tc.want {
			t.Errorf("percentile(%v) = %d, want %d", tc.p, got, tc.want)
		}
	}
	if percentile(nil, 0.5) != 0 {
		t.Error("empty percentile should be 0")
	}
}

func TestJSONWriter(t *testing.T) {
	var j jsonWriter
	j.begin()
	j.str("s", "a\"b\\c")
	j.int("i", -3)
	j.uint("u", 7)
	j.num("f", 1.23456, 3)
	j.num("nan", 0, -1)
	j.ints("a", []int64{1, 2})
	j.ints("e", nil)
	j.end()
	var m map[string]any
	if err := json.Unmarshal(j.b, &m); err != nil {
		t.Fatalf("%s: %v", j.b, err)
	}
	if m["s"] != "a\"b\\c" || m["f"] != 1.235 || len(m["e"].([]any)) != 0 {
		t.Fatalf("decoded %v", m)
	}
}

// Writing a second's records should allocate little: the rule is about 1 KB
// per second at most.
func TestRecorderAllocations(t *testing.T) {
	cfg, _ := parseFlags([]string{"--out=" + t.TempDir() + "/m.jsonl"}, io.Discard)
	start := time.Now()
	r, err := newRecorder(cfg, start, listEntryBytes)
	if err != nil {
		t.Fatal(err)
	}
	now := start
	win := counts{ops: 1}
	allocs := testing.AllocsPerRun(50, func() {
		for range 9 {
			r.batchDone(time.Millisecond)
		}
		now = now.Add(time.Second)
		if err := r.maybeWriteSecond(now, 1, &win); err != nil {
			t.Fatal(err)
		}
	})
	if allocs > 8 {
		t.Errorf("%v allocs per second", allocs)
	}
}
