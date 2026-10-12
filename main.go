package main

import (
	"container/list"
	"math/rand"
	"time"
)

const (
	Capacity        = 20_000_000
	WriteCycleCount = 20_000
	WriteInterval   = 100 * time.Millisecond
	// Keys come from a range a little larger than the cache, so most writes update a
	// cached entry (like Discord's read states) and only some evict.
	KeySpace = Capacity * 5 / 4
)

type entry struct {
	key   int64
	value int64
}

type LRUCache struct {
	capacity int
	cache    map[int64]*list.Element
	list     *list.List
}

func main() {
	cache := NewLRUCache(Capacity)

	for {
		for range WriteCycleCount {
			k := rand.Int63n(KeySpace)
			v := rand.Int63()
			cache.Put(k, v)
		}
		time.Sleep(WriteInterval)
	}
}

func NewLRUCache(capacity int) *LRUCache {
	return &LRUCache{
		capacity: capacity,
		cache:    make(map[int64]*list.Element),
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

func (c *LRUCache) Put(k, v int64) {
	if elem, ok := c.cache[k]; ok {
		c.list.MoveToFront(elem)
		elem.Value.(*entry).value = v
		return
	}

	if len(c.cache) >= c.capacity {
		oldest := c.list.Back()
		if oldest != nil {
			c.list.Remove(oldest)
			delete(c.cache, oldest.Value.(*entry).key)
		}
	}

	elem := c.list.PushFront(&entry{k, v})
	c.cache[k] = elem
}
