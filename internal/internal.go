package internal

import (
	"container/list"
	"sync"

	"github.com/google/uuid"
)

type ReadState struct {
	UserID    uuid.UUID
	ChannelID uuid.UUID
	Mentions  int
}

type CacheItem struct {
	Key   string
	Value ReadState
}

type LRUCache struct {
	mu           sync.Mutex
	capacity     int
	cache        map[string]*list.Element
	evictionList *list.List
}

func NewReadState() ReadState {
	return ReadState{
		UserID:    uuid.New(),
		ChannelID: uuid.New(),
		Mentions:  0,
	}
}

func (rs *ReadState) Key() string {
	return rs.UserID.String() + ":" + rs.ChannelID.String()
}

func NewLRUCache(capacity int) *LRUCache {
	return &LRUCache{
		capacity:     capacity,
		cache:        make(map[string]*list.Element),
		evictionList: list.New(),
	}
}

func (c *LRUCache) Get(key string) (ReadState, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if element, found := c.cache[key]; found {
		c.evictionList.MoveToFront(element)
		return element.Value.(*CacheItem).Value, true
	}
	return ReadState{}, false
}

func (c *LRUCache) Put(key string, value ReadState) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if element, found := c.cache[key]; found {
		c.evictionList.MoveToFront(element)
		element.Value.(*CacheItem).Value = value
		return
	}

	if c.evictionList.Len() == c.capacity {
		c.evict()
	}

	item := &CacheItem{Key: key, Value: value}
	element := c.evictionList.PushFront(item)
	c.cache[key] = element
}

func (c *LRUCache) evict() {
	element := c.evictionList.Back()
	if element != nil {
		c.evictionList.Remove(element)
		kv := element.Value.(*CacheItem)
		delete(c.cache, kv.Key)
	}
}
