package readstate

import "testing"

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
