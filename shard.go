package main

import "fmt"

// splitmix64 is the SplitMix64 finalizer. It spreads consecutive keys evenly
// over the shards.
func splitmix64(x uint64) uint64 {
	x += 0x9E3779B97F4A7C15
	x = (x ^ (x >> 30)) * 0xBF58476D1CE4E5B9
	x = (x ^ (x >> 27)) * 0x94D049BB133111EB
	return x ^ (x >> 31)
}

// shardedCache is Discord's "many partitioned LRU caches": N independent
// caches, with each key routed to one of them by a hash. Each shard evicts its
// own least recently used entry, so the whole is only approximately LRU.
type shardedCache struct {
	shards []Cache
}

func (s *shardedCache) shard(k int64) Cache {
	return s.shards[splitmix64(uint64(k))%uint64(len(s.shards))]
}

func (s *shardedCache) Get(k int64) (int64, bool) { return s.shard(k).Get(k) }

func (s *shardedCache) Put(k, v int64) (existed, evicted bool) { return s.shard(k).Put(k, v) }

func (s *shardedCache) Len() int {
	n := 0
	for _, c := range s.shards {
		n += c.Len()
	}
	return n
}

// newLayout returns an empty cache of the given layout.
func newLayout(layout string, capacity int) (Cache, error) {
	switch layout {
	case "list":
		return NewLRUCache(capacity), nil
	}
	return nil, fmt.Errorf("unknown layout %q", layout)
}

// newCache returns a cache of the given layout split into shards. Each shard
// holds ceil(capacity/shards) entries, so the total it can hold
// (capacityEffective) is capacity rounded up to a multiple of shards. With one
// shard it returns the bare layout cache, with no routing in front of it.
func newCache(layout string, capacity, shards int) (c Cache, capacityEffective int, err error) {
	if shards < 1 {
		return nil, 0, fmt.Errorf("shards must be at least 1, got %d", shards)
	}
	if shards == 1 {
		c, err := newLayout(layout, capacity)
		return c, capacity, err
	}
	per := (capacity + shards - 1) / shards
	s := &shardedCache{shards: make([]Cache, shards)}
	for i := range s.shards {
		if s.shards[i], err = newLayout(layout, per); err != nil {
			return nil, 0, err
		}
	}
	return s, per * shards, nil
}
