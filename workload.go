package readstate

// Workload drives a pre-filled cache with random operations over a key range
// a quarter larger than the capacity, so a steady share of operations miss.
// Each operation picks a random key and either Gets it (a read) or Puts it (a
// write), reading with the odds set by SetReadRatio: half by default.
type Workload struct {
	cache Cache
	keys  int64
	rng   uint64
	read  uint64 // percent of operations that are reads, 0..100
}

// NewWorkload returns a workload over a cache of the given capacity, filled
// with keys 0..capacity-1. The key range is capacity*5/4.
func NewWorkload(capacity int) *Workload {
	c := NewLRUCache(capacity)
	for k := int64(0); k < int64(capacity); k++ {
		c.Put(k, k)
	}
	return &Workload{cache: c, keys: int64(capacity) * 5 / 4, rng: 0x9E3779B97F4A7C15, read: 50}
}

// Cache returns the workload's cache.
func (w *Workload) Cache() Cache { return w.cache }

// Keys reports the size of the key range.
func (w *Workload) Keys() int64 { return w.keys }

// ReadRatio reports the percent of operations that are reads.
func (w *Workload) ReadRatio() int { return int(w.read) }

// SetReadRatio sets the percent of operations that are reads, clamped to
// 0..100. Reads never add a key, so at 100 the cache stops changing.
func (w *Workload) SetReadRatio(pct int) { w.read = uint64(min(max(pct, 0), 100)) }

// Run performs n operations.
func (w *Workload) Run(n int) {
	for range n {
		// xorshift64: cheap, deterministic and identical to the Rust workload.
		w.rng ^= w.rng << 13
		w.rng ^= w.rng >> 7
		w.rng ^= w.rng << 17
		k := int64(w.rng>>1) % w.keys
		if (w.rng>>32)%100 < w.read {
			w.cache.Get(k)
		} else {
			w.cache.Put(k, k)
		}
	}
}
