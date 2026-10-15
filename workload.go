package readstate

// DefaultReadRatio is the percent of operations that are reads until
// SetReadRatio changes it.
const DefaultReadRatio = 50

// Layout picks the Go cache's memory layout. The zero value is ListLayout.
type Layout int

const (
	// ListLayout is LRUCache: Discord's map of pointers into a linked list.
	ListLayout Layout = iota
	// SlabLayout is SlabCache: pointer-free, so the collector has nothing to scan.
	SlabLayout
)

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

// NewWorkload returns a workload over a cache of the given capacity and
// layout, filled with keys 0..capacity-1. The key range is capacity*5/4. It
// panics on an unknown layout.
func NewWorkload(capacity int, layout Layout) *Workload {
	var c Cache
	switch layout {
	case ListLayout:
		c = NewLRUCache(capacity)
	case SlabLayout:
		c = NewSlabCache(capacity)
	default:
		panic("readstate: unknown layout")
	}
	for k := int64(0); k < int64(capacity); k++ {
		c.Put(k, k)
	}
	return &Workload{cache: c, keys: int64(capacity) * 5 / 4, rng: 0x9E3779B97F4A7C15, read: DefaultReadRatio}
}

// Cache returns the workload's cache.
func (w *Workload) Cache() Cache { return w.cache }

// Keys reports the size of the key range.
func (w *Workload) Keys() int64 { return w.keys }

// ReadRatio reports the percent of operations that are reads, after
// SetReadRatio's clamping.
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
		// The high bits pick the operation. They overlap the bits that pick
		// the key, which only correlates the two, identically in Rust.
		if (w.rng>>32)%100 < w.read {
			w.cache.Get(k)
		} else {
			w.cache.Put(k, k)
		}
	}
}
