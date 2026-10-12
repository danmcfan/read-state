use rand::Rng;
use std::collections::HashMap;
use std::hash::Hash;
use std::thread::sleep;
use std::time::Duration;

const CAPACITY: usize = 20_000_000;
const WRITE_CYCLE_COUNT: usize = 20_000;
const WRITE_INTERVAL: Duration = Duration::from_millis(100);
// Keys come from a range a little larger than the cache, so most writes update a
// cached entry (like Discord's read states) and only some evict.
const KEY_SPACE: i64 = CAPACITY as i64 * 5 / 4;

struct Entry<K, V> {
    key: K,
    value: V,
    prev: Option<usize>,
    next: Option<usize>,
}

pub struct LRUCache<K, V> {
    capacity: usize,
    map: HashMap<K, usize>,
    entries: Vec<Entry<K, V>>,
    head: Option<usize>,
    tail: Option<usize>,
}

fn main() {
    let mut cache = LRUCache::new(CAPACITY);

    let mut rng = rand::thread_rng();

    loop {
        for _ in 0..WRITE_CYCLE_COUNT {
            let key = rng.gen_range(0..KEY_SPACE);
            let value = rng.gen::<i64>();
            cache.put(key, value);
        }
        sleep(WRITE_INTERVAL)
    }
}

impl<K: Eq + Hash + Clone, V> LRUCache<K, V> {
    pub fn new(capacity: usize) -> Self {
        LRUCache {
            capacity,
            map: HashMap::with_capacity(capacity),
            entries: Vec::with_capacity(capacity),
            head: None,
            tail: None,
        }
    }

    pub fn get(&mut self, key: &K) -> Option<&V> {
        if let Some(&index) = self.map.get(key) {
            self.move_to_front(index);
            Some(&self.entries[index].value)
        } else {
            None
        }
    }

    pub fn put(&mut self, key: K, value: V) {
        if let Some(&index) = self.map.get(&key) {
            self.entries[index].value = value;
            self.move_to_front(index);
            return;
        }

        let entry = Entry {
            key: key.clone(),
            value,
            prev: None,
            next: None,
        };
        let index = if self.map.len() >= self.capacity {
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
    }

    fn move_to_front(&mut self, index: usize) {
        if Some(index) != self.head {
            self.unlink(index);
            self.push_front(index);
        }
    }

    fn push_front(&mut self, index: usize) {
        self.entries[index].prev = None;
        self.entries[index].next = self.head;
        if let Some(head) = self.head {
            self.entries[head].prev = Some(index);
        }
        self.head = Some(index);
        if self.tail.is_none() {
            self.tail = Some(index);
        }
    }

    fn unlink(&mut self, index: usize) {
        let prev = self.entries[index].prev;
        let next = self.entries[index].next;
        match prev {
            Some(prev) => self.entries[prev].next = next,
            None => self.head = next,
        }
        match next {
            Some(next) => self.entries[next].prev = prev,
            None => self.tail = prev,
        }
    }

    fn remove_tail(&mut self) -> usize {
        let tail = self.tail.expect("a full cache has a tail");
        self.unlink(tail);
        self.map.remove(&self.entries[tail].key);
        tail
    }
}
