//! The browser build: `init` and `runBatch`, exported through wasm-bindgen.

use std::cell::RefCell;

use wasm_bindgen::prelude::*;

use crate::workload::Workload;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = performance)]
    fn now() -> f64;
}

thread_local! {
    static WORKLOAD: RefCell<Option<Workload>> = const { RefCell::new(None) };
}

/// Builds a fresh, pre-filled cache of `capacity`, replacing any existing one.
#[wasm_bindgen]
pub fn init(capacity: usize) {
    WORKLOAD.with(|w| {
        // Free the old cache before allocating the new one.
        *w.borrow_mut() = None;
        *w.borrow_mut() = Some(Workload::new(capacity));
    });
}

/// Runs `n` operations and returns the elapsed milliseconds.
#[wasm_bindgen(js_name = runBatch)]
pub fn run_batch(n: u32) -> f64 {
    WORKLOAD.with(|w| {
        let mut w = w.borrow_mut();
        let w = w.as_mut().expect("init must be called before runBatch");
        let start = now();
        w.run(n);
        now() - start
    })
}
