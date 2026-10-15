package readstate

import "testing"

// layouts runs a test against every Go cache layout.
var layouts = map[string]func(capacity int) Cache{
	"list": func(n int) Cache { return NewLRUCache(n) },
	"slab": func(n int) Cache { return NewSlabCache(n) },
}

func TestCacheLRU(t *testing.T) {
	for name, newCache := range layouts {
		t.Run(name, func(t *testing.T) {
			c := newCache(2)
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
		})
	}
}

func TestCacheGetMovesToFront(t *testing.T) {
	for name, newCache := range layouts {
		t.Run(name, func(t *testing.T) {
			c := newCache(3)
			c.Put(1, 1)
			c.Put(2, 2)
			c.Put(3, 3)
			c.Get(1)    // order, newest first: 1 3 2
			c.Put(4, 4) // evicts 2
			c.Put(5, 5) // evicts 3
			for k, want := range map[int64]bool{1: true, 2: false, 3: false, 4: true, 5: true} {
				if _, ok := c.Get(k); ok != want {
					t.Fatalf("Get(%d) present = %v, want %v", k, ok, want)
				}
			}
			if c.Len() != 3 {
				t.Fatalf("Len = %d, want 3", c.Len())
			}
		})
	}
}

// The layouts must agree on every operation, so the chart compares only memory layout.
func TestLayoutsAgree(t *testing.T) {
	a, b := NewWorkload(100, ListLayout), NewWorkload(100, SlabLayout)
	a.Run(10_000)
	b.Run(10_000)
	for k := int64(0); k < a.Keys(); k++ {
		va, oka := a.Cache().Get(k)
		vb, okb := b.Cache().Get(k)
		if va != vb || oka != okb {
			t.Fatalf("key %d: list %d,%v vs slab %d,%v", k, va, oka, vb, okb)
		}
	}
}
