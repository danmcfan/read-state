//! The browser build: `init`, `setReadRatio` and `runBatch`, exported through wasm-bindgen.

use std::cell::{Cell, RefCell};

use wasm_bindgen::prelude::*;

use crate::workload::Workload;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = performance)]
    fn now() -> f64;
}

thread_local! {
    static WORKLOAD: RefCell<Option<Workload>> = const { RefCell::new(None) };
    /// Kept across `init`, so a new cache keeps the reader's setting.
    static READ_RATIO: Cell<u32> = const { Cell::new(50) };
}

/// Builds a fresh, pre-filled cache of `capacity`, replacing any existing one.
#[wasm_bindgen]
pub fn init(capacity: usize) {
    WORKLOAD.with(|w| {
        // Free the old cache before allocating the new one.
        *w.borrow_mut() = None;
        let mut workload = Workload::new(capacity);
        workload.set_read_ratio(READ_RATIO.get());
        *w.borrow_mut() = Some(workload);
    });
}

/// Sets the percent of operations that are reads, now and for later `init`s.
#[wasm_bindgen(js_name = setReadRatio)]
pub fn set_read_ratio(pct: u32) {
    READ_RATIO.set(pct);
    WORKLOAD.with(|w| {
        if let Some(w) = w.borrow_mut().as_mut() {
            w.set_read_ratio(pct);
        }
    });
}

/// Runs `n` operations and returns the elapsed milliseconds, or NaN before
/// `init`.
#[wasm_bindgen(js_name = runBatch)]
pub fn run_batch(n: u32) -> f64 {
    WORKLOAD.with(|w| {
        let mut w = w.borrow_mut();
        let Some(w) = w.as_mut() else {
            return f64::NAN;
        };
        let start = now();
        w.run(n);
        now() - start
    })
}
