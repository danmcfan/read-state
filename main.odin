package main

import "core:math/rand"
import "core:time"

CAPACITY :: 20_000_000
WRITE_CYCLE_COUNT :: 20_000
WRITE_INTERVAL :: 100 * time.Millisecond
// Keys come from a range a little larger than the cache, so most writes update a
// cached entry (like Discord's read states) and only some evict.
KEY_SPACE :: CAPACITY * 5 / 4

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

	entry := Entry {
		key   = key,
		value = value,
		prev  = NO_INDEX,
		next  = NO_INDEX,
	}
	index: int
	if len(c.lookup) >= c.capacity {
		// Reuse the evicted slot so entries never grows past capacity.
		index = remove_tail(c)
		c.entries[index] = entry
	} else {
		index = len(c.entries)
		append(&c.entries, entry)
	}
	push_front(c, index)
	c.lookup[key] = index
}

move_to_front :: proc(c: ^LRU_Cache, index: int) {
	if c.head == index do return

	unlink(c, index)
	push_front(c, index)
}

push_front :: proc(c: ^LRU_Cache, index: int) {
	c.entries[index].prev = NO_INDEX
	c.entries[index].next = c.head
	if c.head != NO_INDEX {
		c.entries[c.head].prev = index
	}
	c.head = index
	if c.tail == NO_INDEX {
		c.tail = index
	}
}

unlink :: proc(c: ^LRU_Cache, index: int) {
	prev, next := c.entries[index].prev, c.entries[index].next

	if prev != NO_INDEX {
		c.entries[prev].next = next
	} else {
		c.head = next
	}
	if next != NO_INDEX {
		c.entries[next].prev = prev
	} else {
		c.tail = prev
	}
}

remove_tail :: proc(c: ^LRU_Cache) -> int {
	tail := c.tail
	unlink(c, tail)
	delete_key(&c.lookup, c.entries[tail].key)
	return tail
}

main :: proc() {
	cache := new_lru_cache(CAPACITY)

	for {
		for _ in 0 ..< WRITE_CYCLE_COUNT {
			key := rand.int63_max(KEY_SPACE)
			value := rand.int63()
			lru_put(&cache, key, value)
		}
		time.sleep(WRITE_INTERVAL)
	}
}
