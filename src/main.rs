use std::sync::Arc;
use std::time::Duration;
use tokio::signal::unix::{signal, SignalKind};
use tokio::time;

use readstate::{LRUCache, ReadState};

const CAPACITY: usize = 20_000_000;
const WRITE_CYCLE_COUNT: usize = 20_000;
const WRITE_INTERVAL: Duration = Duration::from_millis(100);

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cache = LRUCache::new(CAPACITY);
    let write_interval = time::interval(WRITE_INTERVAL);

    let write_task = tokio::spawn(write_loop(Arc::clone(&cache), write_interval));

    let mut sigint = signal(SignalKind::interrupt())?;
    let mut sigterm = signal(SignalKind::terminate())?;

    tokio::select! {
        _ = sigint.recv() => println!("Received SIGINT"),
        _ = sigterm.recv() => println!("Received SIGTERM"),
    }

    write_task.abort();

    Ok(())
}

async fn write_loop(cache: Arc<LRUCache>, mut interval: time::Interval) {
    loop {
        interval.tick().await;
        for _ in 0..WRITE_CYCLE_COUNT {
            let rs = ReadState::new();
            cache.put(rs.key(), rs);
        }
    }
}
