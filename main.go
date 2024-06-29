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
)

type entry struct {
	key   any
	value any
}

type LRUCache struct {
	capacity int
	cache    map[any]*list.Element
	list     *list.List
}

func main() {
	cache := NewLRUCache(Capacity)

	for {
		for range WriteCycleCount {
			k := rand.Int63()
			v := rand.Int63()
			cache.Put(k, v)
		}
		time.Sleep(WriteInterval)
	}
}

func NewLRUCache(capacity int) *LRUCache {
	return &LRUCache{
		capacity: capacity,
		cache:    make(map[any]*list.Element),
		list:     list.New(),
	}
}

func (c *LRUCache) Get(k any) (any, bool) {
	if elem, ok := c.cache[k]; ok {
		c.list.MoveToFront(elem)
		return elem.Value.(*entry).value, true
	}
	return nil, false
}

func (c *LRUCache) Put(k, v any) {
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
