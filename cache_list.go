// Package readstate is the Go side of the Read State demo: the LRU cache that
// Discord's Go service used, a map of pointers into a doubly linked list.
package readstate

import "container/list"

// Cache is an LRU cache of int64 keys and values.
type Cache interface {
	// Get returns the value for k. A hit moves k to the front.
	Get(k int64) (int64, bool)
	// Put stores v for k. An existing key is updated and moved to the front.
	// A new key is inserted at the front, evicting the least recently used key
	// when the cache is full.
	Put(k, v int64) (existed, evicted bool)
	// Len reports the number of cached entries.
	Len() int
}

type entry struct {
	key   int64
	value int64
}

// LRUCache is the original layout: a map of pointers into a container/list
// doubly linked list. Every entry is a separate heap object full of pointers,
// which the garbage collector has to trace on every cycle.
type LRUCache struct {
	capacity int
	cache    map[int64]*list.Element
	list     *list.List
}

// NewLRUCache returns an empty list-layout cache. The map is preallocated so
// filling it doesn't rehash.
func NewLRUCache(capacity int) *LRUCache {
	return &LRUCache{
		capacity: capacity,
		cache:    make(map[int64]*list.Element, capacity),
		list:     list.New(),
	}
}

// Get returns the value for k and marks it most recently used.
func (c *LRUCache) Get(k int64) (int64, bool) {
	if elem, ok := c.cache[k]; ok {
		c.list.MoveToFront(elem)
		return elem.Value.(*entry).value, true
	}
	return 0, false
}

// Put sets k to v and marks it most recently used, evicting the least
// recently used entry when the cache is full. It reports whether k was
// already present and whether an entry was evicted.
func (c *LRUCache) Put(k, v int64) (existed, evicted bool) {
	if elem, ok := c.cache[k]; ok {
		c.list.MoveToFront(elem)
		elem.Value.(*entry).value = v
		return true, false
	}

	if len(c.cache) >= c.capacity {
		oldest := c.list.Back()
		if oldest != nil {
			c.list.Remove(oldest)
			delete(c.cache, oldest.Value.(*entry).key)
			evicted = true
		}
	}

	elem := c.list.PushFront(&entry{k, v})
	c.cache[k] = elem
	return false, evicted
}

// Len returns the number of entries.
func (c *LRUCache) Len() int { return len(c.cache) }
