//! The browser workload: random operations over a pre-filled cache, matching
//! the Go `Workload` (same key range, operation mix and xorshift64 stream).

use crate::{Cache, HashWide};

/// Drives a pre-filled cache with random operations over a key range a
/// quarter larger than the capacity. Each operation picks a random key and,
/// with equal odds, either gets it (putting it on a miss) or puts it.
pub struct Workload {
    cache: HashWide,
    keys: i64,
    rng: u64,
}

impl Workload {
    /// A workload over a cache of `capacity`, filled with keys
    /// `0..capacity`. The key range is `capacity * 5 / 4`.
    ///
    /// # Panics
    ///
    /// If `capacity` does not fit in an `i64`.
    #[must_use]
    pub fn new(capacity: usize) -> Self {
        let mut cache = HashWide::new(capacity);
        let keys = i64::try_from(capacity).expect("capacity fits in i64");
        for k in 0..keys {
            cache.put(k, k);
        }
        Workload {
            cache,
            keys: keys * 5 / 4,
            rng: 0x9E37_79B9_7F4A_7C15,
        }
    }

    #[must_use]
    pub fn cache(&self) -> &HashWide {
        &self.cache
    }

    #[must_use]
    pub fn keys(&self) -> i64 {
        self.keys
    }

    /// Performs `n` operations.
    pub fn run(&mut self, n: u32) {
        for _ in 0..n {
            self.rng ^= self.rng << 13;
            self.rng ^= self.rng >> 7;
            self.rng ^= self.rng << 17;
            let k = (self.rng >> 1).cast_signed() % self.keys;
            if self.rng & 1 == 0 {
                if self.cache.get(k).is_none() {
                    self.cache.put(k, k);
                }
            } else {
                self.cache.put(k, k);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefills_to_capacity() {
        let w = Workload::new(1000);
        assert_eq!(w.cache().len(), 1000);
        assert_eq!(w.keys(), 1250);
    }

    #[test]
    fn run_keeps_cache_full() {
        let mut w = Workload::new(1000);
        w.run(50_000);
        assert_eq!(w.cache().len(), 1000);
    }
}
