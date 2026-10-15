package readstate

const none int32 = -1

// slot is one slab entry. It holds no pointers, so neither does the slab.
type slot struct {
	key, value int64
	prev, next int32 // indices into SlabCache.slots; none at either end
}

// SlabCache is the pointer-free layout, mirroring the Rust cache: a map of
// int32 indices into one preallocated slice, linked by index. Neither the map
// nor the slice contains a pointer, so the garbage collector marks them noscan
// and skips their contents however large the cache grows.
type SlabCache struct {
	index      map[int64]int32
	slots      []slot
	head, tail int32 // most and least recently used; none when empty
}

// NewSlabCache returns an empty slab-layout cache. The map and slice are
// sized up front, and evicted slots are reused, so neither grows after that.
// It panics if capacity doesn't fit an int32 index.
func NewSlabCache(capacity int) *SlabCache {
	if capacity < 1 || capacity > int(^uint32(0)>>1) {
		panic("readstate: slab capacity must be in 1..MaxInt32")
	}
	return &SlabCache{
		index: make(map[int64]int32, capacity),
		slots: make([]slot, 0, capacity),
		head:  none,
		tail:  none,
	}
}

// Get returns the value for k and marks it most recently used.
func (c *SlabCache) Get(k int64) (int64, bool) {
	i, ok := c.index[k]
	if !ok {
		return 0, false
	}
	c.moveToFront(i)
	return c.slots[i].value, true
}

// Put sets k to v and marks it most recently used, evicting the least
// recently used entry into the new key's slot when the cache is full. It
// reports whether k was already present and whether an entry was evicted.
func (c *SlabCache) Put(k, v int64) (existed, evicted bool) {
	if i, ok := c.index[k]; ok {
		c.slots[i].value = v
		c.moveToFront(i)
		return true, false
	}

	var i int32
	if len(c.slots) < cap(c.slots) {
		i = int32(len(c.slots)) // len < cap <= MaxInt32, checked in NewSlabCache
		c.slots = append(c.slots, slot{})
	} else {
		i = c.tail
		c.unlink(i)
		delete(c.index, c.slots[i].key)
		evicted = true
	}
	c.slots[i] = slot{key: k, value: v, prev: none, next: none}
	c.pushFront(i)
	c.index[k] = i
	return false, evicted
}

// Len returns the number of entries.
func (c *SlabCache) Len() int { return len(c.index) }

func (c *SlabCache) moveToFront(i int32) {
	if c.head == i {
		return
	}
	c.unlink(i)
	c.pushFront(i)
}

func (c *SlabCache) unlink(i int32) {
	s := &c.slots[i]
	if s.prev == none {
		c.head = s.next
	} else {
		c.slots[s.prev].next = s.next
	}
	if s.next == none {
		c.tail = s.prev
	} else {
		c.slots[s.next].prev = s.prev
	}
}

func (c *SlabCache) pushFront(i int32) {
	s := &c.slots[i]
	s.prev, s.next = none, c.head
	if c.head == none {
		c.tail = i
	} else {
		c.slots[c.head].prev = i
	}
	c.head = i
}
