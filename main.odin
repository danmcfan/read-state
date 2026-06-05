package main

import "core:math/rand"
import "core:time"

CAPACITY :: 20_000_000
WRITE_CYCLE_COUNT :: 20_000
WRITE_INTERVAL :: 100 * time.Millisecond

NO_INDEX :: -1

Entry :: struct {
	key:   i64,
	value: i64,
	prev:  int,
	next:  int,
}

LRU_Cache :: struct {
	capacity: int,
	lookup:   map[i64]int,
	entries:  [dynamic]Entry,
	head:     int,
	tail:     int,
}

new_lru_cache :: proc(capacity: int) -> LRU_Cache {
	c: LRU_Cache
	c.capacity = capacity
	c.lookup = make(map[i64]int)
	reserve(&c.lookup, capacity)
	reserve(&c.entries, capacity)
	c.head = NO_INDEX
	c.tail = NO_INDEX
	return c
}

lru_get :: proc(c: ^LRU_Cache, key: i64) -> (value: i64, ok: bool) {
	if index, found := c.lookup[key]; found {
		move_to_front(c, index)
		return c.entries[index].value, true
	}
	return 0, false
}

lru_put :: proc(c: ^LRU_Cache, key, value: i64) {
	if index, found := c.lookup[key]; found {
		c.entries[index].value = value
		move_to_front(c, index)
		return
	}

	if len(c.lookup) >= c.capacity {
		remove_tail(c)
	}

	index := len(c.entries)
	entry := Entry {
		key   = key,
		value = value,
		prev  = NO_INDEX,
		next  = c.head,
	}
	if c.head != NO_INDEX {
		c.entries[c.head].prev = index
	}
	append(&c.entries, entry)
	c.head = index
	if c.tail == NO_INDEX {
		c.tail = index
	}
	c.lookup[key] = index
}

move_to_front :: proc(c: ^LRU_Cache, index: int) {
	if c.head == index do return

	entry := &c.entries[index]
	prev, next := entry.prev, entry.next

	if prev != NO_INDEX {
		c.entries[prev].next = next
	}
	if next != NO_INDEX {
		c.entries[next].prev = prev
	}
	if c.tail == index {
		c.tail = prev
	}

	entry.prev = NO_INDEX
	entry.next = c.head
	if c.head != NO_INDEX {
		c.entries[c.head].prev = index
	}
	c.head = index
}

remove_tail :: proc(c: ^LRU_Cache) {
	if c.tail == NO_INDEX do return

	tail := c.tail
	entry := c.entries[tail]
	prev := entry.prev

	c.tail = prev
	if prev != NO_INDEX {
		c.entries[prev].next = NO_INDEX
	} else {
		c.head = NO_INDEX
	}

	delete_key(&c.lookup, entry.key)
}

main :: proc() {
	cache := new_lru_cache(CAPACITY)

	for {
		for _ in 0 ..< WRITE_CYCLE_COUNT {
			key := rand.int63()
			value := rand.int63()
			lru_put(&cache, key, value)
		}
		time.sleep(WRITE_INTERVAL)
	}
}
