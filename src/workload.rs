//! The browser workload: random operations over a pre-filled cache, matching
//! the Go `Workload` (same key range, operation mix and xorshift64 stream).

use crate::{Cache, HashWide};

/// The percent of operations that are reads until `set_read_ratio` changes it.
pub const DEFAULT_READ_RATIO: u32 = 50;

/// Drives a pre-filled cache with random operations over a key range a
/// quarter larger than the capacity. Each operation picks a random key and
/// either gets it (a read) or puts it (a write), reading with the odds set by
/// `set_read_ratio`: half by default.
pub struct Workload {
    cache: HashWide,
    keys: i64,
    rng: u64,
    /// Percent of operations that are reads, 0..=100.
    read: u32,
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
            read: DEFAULT_READ_RATIO,
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

    /// The percent of operations that are reads, after `set_read_ratio`'s
    /// clamping.
    #[must_use]
    pub fn read_ratio(&self) -> u32 {
        self.read
    }

    /// Sets the percent of operations that are reads, clamped to 0..=100.
    /// Reads never add a key, so at 100 the cache stops changing.
    pub fn set_read_ratio(&mut self, pct: u32) {
        self.read = pct.min(100);
    }

    /// Performs `n` operations.
    pub fn run(&mut self, n: u32) {
        for _ in 0..n {
            self.rng ^= self.rng << 13;
            self.rng ^= self.rng >> 7;
            self.rng ^= self.rng << 17;
            let k = (self.rng >> 1).cast_signed() % self.keys;
            // The high bits pick the operation. They overlap the bits that
            // pick the key, which only correlates the two, identically in Go.
            if (self.rng >> 32) % 100 < u64::from(self.read) {
                self.cache.get(k);
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

    fn new_keys(w: &mut Workload, capacity: i64) -> usize {
        (capacity..w.keys())
            .filter(|&k| w.cache.get(k).is_some())
            .count()
    }

    #[test]
    fn all_reads_never_put() {
        let mut w = Workload::new(1000);
        w.set_read_ratio(100);
        w.run(50_000);
        assert_eq!(new_keys(&mut w, 1000), 0);
    }

    #[test]
    fn all_writes_put() {
        let mut w = Workload::new(1000);
        w.set_read_ratio(0);
        w.run(50_000);
        assert!(new_keys(&mut w, 1000) > 0);
    }

    #[test]
    fn clamps_read_ratio() {
        let mut w = Workload::new(10);
        w.set_read_ratio(250);
        assert_eq!(w.read_ratio(), 100);
    }
}
