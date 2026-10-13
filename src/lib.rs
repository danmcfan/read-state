//! The LRU cache: a key index (a map from key to slot) plus an index-based
//! doubly linked list of entries in a preallocated `Vec`.
//!
//! The cache is generic over the index map and the link type, so each of the
//! four variants (`HashMap` or `BTreeMap`, wide or compact links) is its own
//! monomorphized type with no dynamic dispatch in the hot loop:
//!
//! - wide links are `Option<usize>` (16 bytes; `usize` has no niche, so the
//!   `Option` adds a word), and the map stores `usize` slots;
//! - compact links are `u32` with `u32::MAX` meaning none (4 bytes), and the
//!   map stores `u32` slots.

use std::collections::{BTreeMap, HashMap};

/// A link between entries: a slot index or none.
pub trait Link: Copy + PartialEq {
    const NONE: Self;
    fn from_idx(i: usize) -> Self;
    fn idx(self) -> Option<usize>;
}

impl Link for Option<usize> {
    const NONE: Self = None;
    #[inline]
    fn from_idx(i: usize) -> Self {
        Some(i)
    }
    #[inline]
    fn idx(self) -> Option<usize> {
        self
    }
}

impl Link for u32 {
    const NONE: Self = u32::MAX;
    #[inline]
    fn from_idx(i: usize) -> Self {
        debug_assert!(i < u32::MAX as usize);
        i as u32
    }
    #[inline]
    fn idx(self) -> Option<usize> {
        if self == u32::MAX {
            None
        } else {
            Some(self as usize)
        }
    }
}

/// The largest capacity a link type can address.
pub fn max_capacity<L: Link>() -> usize {
    if std::mem::size_of::<L>() == 4 {
        u32::MAX as usize
    } else {
        usize::MAX
    }
}

/// A map from key to slot index.
pub trait KeyIndex {
    /// The key index's name (`hash` or `btree`).
    const NAME: &'static str;
    fn with_capacity(n: usize) -> Self;
    fn get(&self, k: i64) -> Option<usize>;
    fn insert(&mut self, k: i64, i: usize);
    fn remove(&mut self, k: i64);
    fn len(&self) -> usize;
}

macro_rules! key_index {
    ($map:ident, $v:ty, $name:literal, $new:expr) => {
        impl KeyIndex for $map<i64, $v> {
            const NAME: &'static str = $name;
            fn with_capacity(n: usize) -> Self {
                $new(n)
            }
            #[inline]
            fn get(&self, k: i64) -> Option<usize> {
                $map::get(self, &k).map(|&i| i as usize)
            }
            #[inline]
            fn insert(&mut self, k: i64, i: usize) {
                $map::insert(self, k, i as $v);
            }
            #[inline]
            fn remove(&mut self, k: i64) {
                $map::remove(self, &k);
            }
            fn len(&self) -> usize {
                $map::len(self)
            }
        }
    };
}

// HashMap preallocates for the full capacity; BTreeMap can't preallocate.
key_index!(HashMap, usize, "hash", HashMap::with_capacity);
key_index!(HashMap, u32, "hash", HashMap::with_capacity);
key_index!(BTreeMap, usize, "btree", |_| BTreeMap::new());
key_index!(BTreeMap, u32, "btree", |_| BTreeMap::new());

/// An LRU cache of `i64` keys and values.
pub trait Cache {
    /// The size of one entry in the list, without map overhead.
    const ENTRY_BYTES: usize;
    const MAP: &'static str;
    const COMPACT: bool;
    /// Returns the value for `key`. A hit moves the key to the front.
    fn get(&mut self, key: i64) -> Option<i64>;
    /// Stores `value` for `key` and returns (existed, evicted). An existing
    /// key is updated and moved to the front.
    fn put(&mut self, key: i64, value: i64) -> (bool, bool);
    fn len(&self) -> usize;
}

pub struct Entry<L> {
    key: i64,
    value: i64,
    prev: L,
    next: L,
}

pub struct LruCache<M, L> {
    capacity: usize,
    map: M,
    entries: Vec<Entry<L>>,
    head: L,
    tail: L,
}

/// The four variants: key index (`HashMap` or `BTreeMap`) × link width.
pub type HashWide = LruCache<HashMap<i64, usize>, Option<usize>>;
pub type HashCompact = LruCache<HashMap<i64, u32>, u32>;
pub type BTreeWide = LruCache<BTreeMap<i64, usize>, Option<usize>>;
pub type BTreeCompact = LruCache<BTreeMap<i64, u32>, u32>;

impl<M: KeyIndex, L: Link> LruCache<M, L> {
    pub fn new(capacity: usize) -> Self {
        assert!(capacity <= max_capacity::<L>(), "capacity too large for the link type");
        LruCache {
            capacity,
            map: M::with_capacity(capacity),
            entries: Vec::with_capacity(capacity),
            head: L::NONE,
            tail: L::NONE,
        }
    }

    #[inline]
    fn move_to_front(&mut self, index: usize) {
        if self.head.idx() != Some(index) {
            self.unlink(index);
            self.push_front(index);
        }
    }

    #[inline]
    fn push_front(&mut self, index: usize) {
        let link = L::from_idx(index);
        let head = self.head;
        let e = &mut self.entries[index];
        e.prev = L::NONE;
        e.next = head;
        match head.idx() {
            Some(h) => self.entries[h].prev = link,
            None => self.tail = link,
        }
        self.head = link;
    }

    #[inline]
    fn unlink(&mut self, index: usize) {
        let prev = self.entries[index].prev;
        let next = self.entries[index].next;
        match prev.idx() {
            Some(p) => self.entries[p].next = next,
            None => self.head = next,
        }
        match next.idx() {
            Some(n) => self.entries[n].prev = prev,
            None => self.tail = prev,
        }
    }

    fn remove_tail(&mut self) -> usize {
        let tail = self.tail.idx().expect("a full cache has a tail");
        self.unlink(tail);
        self.map.remove(self.entries[tail].key);
        tail
    }
}

impl<M: KeyIndex, L: Link> Cache for LruCache<M, L> {
    const ENTRY_BYTES: usize = std::mem::size_of::<Entry<L>>();
    const MAP: &'static str = M::NAME;
    const COMPACT: bool = std::mem::size_of::<L>() == 4;

    #[inline]
    fn get(&mut self, key: i64) -> Option<i64> {
        let index = self.map.get(key)?;
        self.move_to_front(index);
        Some(self.entries[index].value)
    }

    #[inline]
    fn put(&mut self, key: i64, value: i64) -> (bool, bool) {
        if let Some(index) = self.map.get(key) {
            self.entries[index].value = value;
            self.move_to_front(index);
            return (true, false);
        }
        let entry = Entry {
            key,
            value,
            prev: L::NONE,
            next: L::NONE,
        };
        let evicted = self.map.len() >= self.capacity;
        let index = if evicted {
            // Reuse the evicted slot so `entries` never grows past capacity.
            let index = self.remove_tail();
            self.entries[index] = entry;
            index
        } else {
            self.entries.push(entry);
            self.entries.len() - 1
        };
        self.push_front(index);
        self.map.insert(key, index);
        (false, evicted)
    }

    fn len(&self) -> usize {
        self.map.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    impl<M: KeyIndex, L: Link> LruCache<M, L> {
        /// Keys from most to least recently used, checking the links both ways.
        fn order(&self) -> Vec<i64> {
            let mut out = Vec::new();
            let mut prev = L::NONE;
            let mut cur = self.head;
            while let Some(i) = cur.idx() {
                assert!(self.entries[i].prev == prev, "broken prev link");
                out.push(self.entries[i].key);
                prev = cur;
                cur = self.entries[i].next;
            }
            assert!(self.tail == prev, "tail isn't the last entry");
            out
        }
    }

    fn check<M: KeyIndex, L: Link>() {
        let mut c = LruCache::<M, L>::new(3);
        assert_eq!(c.put(1, 10), (false, false));
        assert_eq!(c.put(2, 20), (false, false));
        assert_eq!(c.put(3, 30), (false, false));
        assert_eq!(c.order(), [3, 2, 1]);

        // An update moves the key to the front.
        assert_eq!(c.put(1, 11), (true, false));
        assert_eq!(c.order(), [1, 3, 2]);

        // A get hit moves the key to the front; a miss changes nothing.
        assert_eq!(c.get(2), Some(20));
        assert_eq!(c.order(), [2, 1, 3]);
        assert_eq!(c.get(9), None);
        assert_eq!(c.order(), [2, 1, 3]);

        // Eviction takes the least recently used key and reuses its slot.
        assert_eq!(c.put(4, 40), (false, true));
        assert_eq!(c.order(), [4, 2, 1]);
        assert_eq!(c.get(3), None);
        assert_eq!(c.get(1), Some(11));
        assert_eq!(c.order(), [1, 4, 2]);
        assert_eq!(c.entries.len(), 3);
    }

    #[test]
    fn lru_order_all_variants() {
        check::<HashMap<i64, usize>, Option<usize>>();
        check::<HashMap<i64, u32>, u32>();
        check::<BTreeMap<i64, usize>, Option<usize>>();
        check::<BTreeMap<i64, u32>, u32>();
    }

    fn small<M: KeyIndex, L: Link>() {
        // Capacity 1: the only entry is both head and tail.
        let mut c = LruCache::<M, L>::new(1);
        assert_eq!(c.put(1, 1), (false, false));
        assert_eq!(c.put(1, 2), (true, false));
        assert_eq!(c.put(2, 3), (false, true));
        assert_eq!(c.order(), [2]);
        assert_eq!(c.get(1), None);
        assert_eq!(c.get(2), Some(3));
        assert_eq!(c.entries.len(), 1);

        // Capacity 2: swapping head and tail repeatedly.
        let mut c = LruCache::<M, L>::new(2);
        c.put(1, 1);
        c.put(2, 2);
        for _ in 0..3 {
            c.get(1);
            assert_eq!(c.order(), [1, 2]);
            c.get(2);
            assert_eq!(c.order(), [2, 1]);
        }
        assert_eq!(c.put(3, 3), (false, true));
        assert_eq!(c.order(), [3, 2]);
    }

    #[test]
    fn capacity_one_and_two() {
        small::<HashMap<i64, usize>, Option<usize>>();
        small::<HashMap<i64, u32>, u32>();
        small::<BTreeMap<i64, usize>, Option<usize>>();
        small::<BTreeMap<i64, u32>, u32>();
    }

    fn churn<M: KeyIndex, L: Link>() {
        let cap = 100;
        let mut c = LruCache::<M, L>::new(cap);
        let mut x: u64 = 1;
        for i in 0..20_000 {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            let k = (x % 150) as i64;
            if i % 2 == 0 {
                c.get(k);
            } else {
                c.put(k, i);
            }
            assert!(c.entries.len() <= cap);
        }
        assert_eq!(c.entries.len(), c.map.len());
        let order = c.order();
        assert_eq!(order.len(), cap);
        for &k in &order {
            assert_eq!(c.entries[c.map.get(k).unwrap()].key, k);
        }
    }

    #[test]
    fn churn_keeps_map_and_list_consistent() {
        churn::<HashMap<i64, usize>, Option<usize>>();
        churn::<HashMap<i64, u32>, u32>();
        churn::<BTreeMap<i64, usize>, Option<usize>>();
        churn::<BTreeMap<i64, u32>, u32>();
    }

    #[test]
    fn entry_sizes() {
        assert_eq!(HashWide::ENTRY_BYTES, 48);
        assert_eq!(HashCompact::ENTRY_BYTES, 24);
        assert_eq!(BTreeWide::ENTRY_BYTES, 48);
        assert_eq!(BTreeCompact::ENTRY_BYTES, 24);
        assert_eq!((HashWide::MAP, HashWide::COMPACT), ("hash", false));
        assert_eq!((HashCompact::MAP, HashCompact::COMPACT), ("hash", true));
        assert_eq!((BTreeWide::MAP, BTreeWide::COMPACT), ("btree", false));
        assert_eq!((BTreeCompact::MAP, BTreeCompact::COMPACT), ("btree", true));
        // A u32 value doesn't shrink a HashMap slot: (i64, u32) pads to 16.
        assert_eq!(std::mem::size_of::<(i64, u32)>(), std::mem::size_of::<(i64, usize)>());
    }
}
