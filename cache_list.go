package main

import (
	"container/list"
	"unsafe"
)

// Cache is an LRU cache of int64 keys and values. Every layout implements it.
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

// listEntryBytes is the size of one cached entry's structs (the entry and its
// list.Element), not counting the map slot or allocator size-class rounding.
const listEntryBytes = int(unsafe.Sizeof(entry{}) + unsafe.Sizeof(list.Element{}))

// NewLRUCache returns an empty list-layout cache. The map is preallocated, as
// every other layout is, so filling it doesn't rehash.
func NewLRUCache(capacity int) *LRUCache {
	return &LRUCache{
		capacity: capacity,
		cache:    make(map[int64]*list.Element, capacity),
		list:     list.New(),
	}
}

func (c *LRUCache) Get(k int64) (int64, bool) {
	if elem, ok := c.cache[k]; ok {
		c.list.MoveToFront(elem)
		return elem.Value.(*entry).value, true
	}
	return 0, false
}

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

func (c *LRUCache) Len() int { return len(c.cache) }
