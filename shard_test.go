package main

import (
	"math/rand/v2"
	"testing"
)

func TestNewCacheOneShardIsUnwrapped(t *testing.T) {
	c, capEff, err := newCache("list", 100, 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := c.(*LRUCache); !ok {
		t.Fatalf("newCache with 1 shard returned %T, want *LRUCache", c)
	}
	if capEff != 100 {
		t.Fatalf("capacity_effective = %d, want 100", capEff)
	}
}

func TestNewCacheErrors(t *testing.T) {
	if _, _, err := newCache("list", 100, 0); err == nil {
		t.Error("0 shards accepted")
	}
	if _, _, err := newCache("nope", 100, 4); err == nil {
		t.Error("unknown layout accepted")
	}
}

func TestShardCapacityRoundsUp(t *testing.T) {
	for _, tc := range []struct{ capacity, shards, want int }{
		{2_000_000, 16, 2_000_000}, {100, 16, 112}, {10, 3, 12}, {5, 5, 5},
	} {
		c, capEff, err := newCache("list", tc.capacity, tc.shards)
		if err != nil {
			t.Fatal(err)
		}
		if capEff != tc.want {
			t.Errorf("newCache(%d, %d): capacity_effective = %d, want %d", tc.capacity, tc.shards, capEff, tc.want)
		}
		if n := len(c.(*shardedCache).shards); n != tc.shards {
			t.Errorf("%d shards, want %d", n, tc.shards)
		}
	}
}

func TestShardRoutingIsDeterministicAndSpread(t *testing.T) {
	c, _, _ := newCache("list", 1600, 16)
	s := c.(*shardedCache)
	seen := map[Cache]int{}
	for k := range int64(1600) {
		a, b := s.shard(k), s.shard(k)
		if a != b {
			t.Fatalf("key %d routed to two shards", k)
		}
		seen[a]++
	}
	if len(seen) != 16 {
		t.Fatalf("keys reached %d of 16 shards", len(seen))
	}
	for _, n := range seen {
		if n < 50 || n > 150 { // 100 expected per shard
			t.Fatalf("uneven routing: %v", seen)
		}
	}
}

func TestShardedPutGetAndLen(t *testing.T) {
	const capacity, shards = 1000, 8
	c, capEff, _ := newCache("list", capacity, shards)
	for k := range int64(500) {
		if existed, evicted := c.Put(k, k*10); existed || evicted {
			t.Fatalf("Put(%d) = %v, %v", k, existed, evicted)
		}
	}
	for k := range int64(500) {
		if v, ok := c.Get(k); !ok || v != k*10 {
			t.Fatalf("Get(%d) = %d, %v", k, v, ok)
		}
	}
	if existed, _ := c.Put(7, 1); !existed {
		t.Fatal("Put of a cached key didn't report existed")
	}
	if c.Len() != 500 {
		t.Fatalf("Len = %d, want 500", c.Len())
	}

	rng := rand.New(rand.NewPCG(1, 2))
	for range 10 * capacity {
		c.Put(rng.Int64N(10*capacity), 0)
		if c.Len() > capEff {
			t.Fatalf("Len %d exceeds capacity_effective %d", c.Len(), capEff)
		}
	}
	if c.Len() != capEff {
		t.Fatalf("Len = %d after filling, want %d", c.Len(), capEff)
	}
}

// Each shard evicts its own least recently used key, not the global one.
func TestShardEvictsItsOwnLRU(t *testing.T) {
	c, _, _ := newCache("list", 4, 2) // two shards of 2
	s := c.(*shardedCache)
	// Find three keys in shard 0 and one in shard 1.
	var a []int64
	var other int64 = -1
	for k := int64(0); len(a) < 3 || other < 0; k++ {
		if s.shard(k) == s.shards[0] {
			if len(a) < 3 {
				a = append(a, k)
			}
		} else if other < 0 {
			other = k
		}
	}
	c.Put(a[0], 0)  // oldest overall, shard 0
	c.Put(other, 0) // shard 1
	c.Put(a[1], 0)  // shard 0 is now full
	c.Get(a[0])     // a[0] becomes shard 0's most recent
	_, evicted := c.Put(a[2], 0)
	if !evicted {
		t.Fatal("Put into a full shard didn't evict")
	}
	if _, ok := c.Get(a[1]); ok {
		t.Fatal("shard 0 should have evicted its LRU key a[1]")
	}
	for _, k := range []int64{a[0], a[2], other} {
		if _, ok := c.Get(k); !ok {
			t.Fatalf("key %d was evicted", k)
		}
	}
}

// Routing through the shards must not allocate per operation.
func TestShardedOpDoesNotAllocate(t *testing.T) {
	const n = 1000
	c, _, _ := newCache("list", n, 16)
	for k := range int64(n / 2) {
		c.Put(k, k)
	}
	k := int64(0)
	allocs := testing.AllocsPerRun(10_000, func() {
		c.Get(k)
		c.Put(k, k+1)
		k = (k + 1) % (n / 2)
	})
	if allocs != 0 {
		t.Fatalf("%v allocs per Get+Put hit", allocs)
	}
	w := &workload{cache: c, rng: rand.New(rand.NewPCG(1, 2)), keys: n / 2, readRatio: 0.5}
	var cnt counts
	if a := testing.AllocsPerRun(10_000, func() { w.op(&cnt) }); a != 0 {
		t.Fatalf("%v allocs per workload op", a)
	}
}

func TestSplitmix64(t *testing.T) {
	// Reference outputs of the SplitMix64 finalizer applied to 0 and 1.
	if got := splitmix64(0); got != 0xE220A8397B1DCDAF {
		t.Errorf("splitmix64(0) = %#x", got)
	}
	if got := splitmix64(1); got != 0x910A2DEC89025CC1 {
		t.Errorf("splitmix64(1) = %#x", got)
	}
}
