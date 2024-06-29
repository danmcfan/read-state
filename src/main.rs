use rand::Rng;
use std::collections::HashMap;
use std::hash::Hash;
use std::thread::sleep;
use std::time::Duration;

const CAPACITY: usize = 20_000_000;
const WRITE_CYCLE_COUNT: usize = 20_000;
const WRITE_INTERVAL: Duration = Duration::from_millis(100);

struct Entry<K, V> {
    key: K,
    value: V,
    prev: Option<usize>,
    next: Option<usize>,
}

pub struct LRUCache<K, V> {
    capacity: usize,
    map: HashMap<K, usize>,
    entries: Vec<Option<Entry<K, V>>>,
    head: Option<usize>,
    tail: Option<usize>,
}

fn main() {
    let mut cache = LRUCache::new(CAPACITY);

    loop {
        for _ in 0..WRITE_CYCLE_COUNT {
            let mut rng = rand::thread_rng();
            let key = rng.gen::<i64>();
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
            Some(&self.entries[index].as_ref().unwrap().value)
        } else {
            None
        }
    }

    pub fn put(&mut self, key: K, value: V) {
        if let Some(&index) = self.map.get(&key) {
            self.entries[index].as_mut().unwrap().value = value;
            self.move_to_front(index);
        } else {
            if self.map.len() >= self.capacity {
                self.remove_tail();
            }
            let index = self.entries.len();
            self.entries.push(Some(Entry {
                key: key.clone(),
                value,
                prev: None,
                next: self.head,
            }));
            if let Some(head) = self.head {
                self.entries[head].as_mut().unwrap().prev = Some(index);
            }
            self.head = Some(index);
            if self.tail.is_none() {
                self.tail = Some(index);
            }
            self.map.insert(key, index);
        }
    }

    fn move_to_front(&mut self, index: usize) {
        if Some(index) != self.head {
            let prev = self.entries[index].as_ref().unwrap().prev;
            let next = self.entries[index].as_ref().unwrap().next;

            if let Some(prev) = prev {
                self.entries[prev].as_mut().unwrap().next = next;
            }
            if let Some(next) = next {
                self.entries[next].as_mut().unwrap().prev = prev;
            }
            if Some(index) == self.tail {
                self.tail = prev;
            }

            self.entries[index].as_mut().unwrap().prev = None;
            self.entries[index].as_mut().unwrap().next = self.head;
            if let Some(head) = self.head {
                self.entries[head].as_mut().unwrap().prev = Some(index);
            }
            self.head = Some(index);
        }
    }

    fn remove_tail(&mut self) {
        if let Some(tail) = self.tail {
            let prev = self.entries[tail].as_ref().unwrap().prev;
            self.tail = prev;
            if let Some(prev) = prev {
                self.entries[prev].as_mut().unwrap().next = None;
            } else {
                self.head = None;
            }
            let entry = self.entries[tail].take().unwrap();
            self.map.remove(&entry.key);
        }
    }
}
