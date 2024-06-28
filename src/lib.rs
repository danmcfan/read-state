use std::collections::{HashMap, LinkedList};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

#[derive(Clone)]
pub struct ReadState {
    user_id: Uuid,
    channel_id: Uuid,
}

#[derive(Clone)]
struct CacheItem {
    value: ReadState,
}

pub struct LRUCache {
    capacity: usize,
    cache: Mutex<HashMap<String, LinkedList<CacheItem>>>,
    eviction_list: Mutex<LinkedList<String>>,
}

impl ReadState {
    pub fn new() -> Self {
        ReadState {
            user_id: Uuid::new_v4(),
            channel_id: Uuid::new_v4(),
        }
    }

    pub fn key(&self) -> String {
        format!("{}:{}", self.user_id, self.channel_id)
    }
}

impl LRUCache {
    pub fn new(capacity: usize) -> Arc<Self> {
        Arc::new(LRUCache {
            capacity,
            cache: Mutex::new(HashMap::new()),
            eviction_list: Mutex::new(LinkedList::new()),
        })
    }

    pub fn get(&self, key: &str) -> Option<ReadState> {
        let mut cache = self.cache.lock().unwrap();
        let mut eviction_list = self.eviction_list.lock().unwrap();

        if let Some(list) = cache.get_mut(key) {
            let item = list.pop_front().unwrap();
            list.push_front(item.clone());
            eviction_list.push_front(key.to_string());
            Some(item.value)
        } else {
            None
        }
    }

    pub fn put(&self, key: String, value: ReadState) {
        let mut cache = self.cache.lock().unwrap();
        let mut eviction_list = self.eviction_list.lock().unwrap();

        if let Some(list) = cache.get_mut(&key) {
            list.push_front(CacheItem { value });
            eviction_list.push_front(key);
        } else {
            if cache.len() == self.capacity {
                if let Some(old_key) = eviction_list.pop_back() {
                    cache.remove(&old_key);
                }
            }
            let mut list = LinkedList::new();
            list.push_front(CacheItem { value });
            cache.insert(key.clone(), list);
            eviction_list.push_front(key);
        }
    }
}
