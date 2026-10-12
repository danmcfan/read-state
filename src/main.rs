//! Discord's Read State workload against an LRU cache: batches of random
//! operations on a cache of 20 million entries, with a short sleep after each
//! batch, forever.
//!
//! Running it with no flags is the faithful workload. The flags change the
//! workload for measurement runs, and `--out` writes one JSON line per second
//! of metrics (see results/README.md for the schema).

mod cache;

use cache::{BTreeCompact, BTreeWide, Cache, HashCompact, HashWide};
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use std::fmt::Write as _;
use std::fs::OpenOptions;
use std::io::{self, BufWriter, Write};
use std::process::exit;
use std::thread::sleep;
use std::time::{Duration, Instant};

const USAGE: &str = "usage: read-state [--capacity=N] [--keys=N] [--batch=N] [--sleep=DUR]
                  [--read-ratio=F] [--duration=DUR] [--out=PATH|-] [--variant=NAME] [--seed=N]
                  [--map=hash|btree] [--compact]
  --capacity    total cache entries (default 20000000)
  --keys        keys are drawn from [0, keys); 0 means capacity*5/4 (default 0)
  --batch       operations per timed batch (default 20000)
  --sleep       sleep after each batch (default 100ms)
  --read-ratio  probability that an operation is a get; a miss then puts the key (default 0)
  --duration    stop after this long; 0 runs forever (default 0)
  --out         append JSONL metrics to this file ('-' for stdout); empty writes none
  --variant     variant name recorded in the config record
  --seed        random seed (default 1)
  --map         key index: hash (HashMap, preallocated) or btree (BTreeMap) (default hash)
  --compact     u32 links with a sentinel and u32 map values instead of Option<usize>
                (entry 48 -> 24 bytes); also --compact=true|false
Durations are a whole number with ms, s, m or h, or 0. Flags take --name=value or --name value.";

struct Config {
    capacity: usize,
    keys: i64,
    batch: usize,
    sleep: Duration,
    read_ratio: f64,
    duration: Duration,
    out: String,
    variant: String,
    seed: u64,
    btree: bool,
    compact: bool,
}

impl Default for Config {
    /// The faithful workload.
    fn default() -> Self {
        Config {
            capacity: 20_000_000,
            keys: 0,
            batch: 20_000,
            sleep: Duration::from_millis(100),
            read_ratio: 0.0,
            duration: Duration::ZERO,
            out: String::new(),
            variant: String::new(),
            seed: 1,
            btree: false,
            compact: false,
        }
    }
}

fn parse_duration(s: &str) -> Result<Duration, String> {
    if s == "0" {
        return Ok(Duration::ZERO);
    }
    let split = s.find(|c: char| !c.is_ascii_digit()).unwrap_or(s.len());
    let (num, unit) = s.split_at(split);
    let n: u64 = parse_int(num)?;
    match unit {
        "ms" => Ok(Duration::from_millis(n)),
        "s" => Ok(Duration::from_secs(n)),
        "m" => Ok(Duration::from_secs(n * 60)),
        "h" => Ok(Duration::from_secs(n * 3600)),
        _ => Err(format!(
            "bad duration {s:?} (want e.g. 100ms, 20s, 2m, 1h or 0)"
        )),
    }
}

fn parse_int<T: std::str::FromStr>(s: &str) -> Result<T, String> {
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return Err(format!("bad number {s:?}"));
    }
    s.parse().map_err(|_| format!("number out of range {s:?}"))
}

fn parse_args(args: &[String]) -> Result<Config, String> {
    let mut c = Config::default();
    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        i += 1;
        let Some(flag) = arg.strip_prefix("--") else {
            return Err(format!("unexpected argument {arg:?}"));
        };
        if flag == "help" || flag == "h" {
            println!("{USAGE}");
            exit(0);
        }
        // --compact is a boolean: bare, it never takes the next argument.
        if flag == "compact" {
            c.compact = true;
            continue;
        }
        let (name, value) = match flag.split_once('=') {
            Some((n, v)) => (n, v.to_string()),
            None => {
                let v = args.get(i).ok_or(format!("--{flag} needs a value"))?;
                i += 1;
                (flag, v.clone())
            }
        };
        let v = value.as_str();
        match name {
            "capacity" => c.capacity = parse_int(v)?,
            "keys" => c.keys = parse_int(v)?,
            "batch" => c.batch = parse_int(v)?,
            "sleep" => c.sleep = parse_duration(v)?,
            "read-ratio" => {
                c.read_ratio = v
                    .parse()
                    .ok()
                    .filter(|r: &f64| (0.0..=1.0).contains(r))
                    .ok_or(format!("--read-ratio must be between 0 and 1, got {v:?}"))?
            }
            "duration" => c.duration = parse_duration(v)?,
            "out" => c.out = value,
            "variant" => c.variant = value,
            "seed" => c.seed = parse_int(v)?,
            "map" => {
                c.btree = match v {
                    "hash" => false,
                    "btree" => true,
                    _ => return Err(format!("--map must be hash or btree, got {v:?}")),
                }
            }
            "compact" => {
                c.compact = match v {
                    "true" => true,
                    "false" => false,
                    _ => return Err(format!("--compact must be true or false, got {v:?}")),
                }
            }
            _ => return Err(format!("unknown flag --{name}")),
        }
    }
    if c.keys == 0 {
        c.keys = c.capacity as i64 * 5 / 4;
    }
    if c.capacity == 0 || c.keys == 0 || c.batch == 0 {
        return Err("--capacity, --keys and --batch must be positive".into());
    }
    if c.compact && c.capacity >= u32::MAX as usize {
        return Err("--compact needs --capacity below 4294967295".into());
    }
    Ok(c)
}

/// Operation counters for a window or a whole run.
#[derive(Default, Clone, Copy)]
struct Counts {
    ops: u64,
    hits: u64,
    misses: u64,
    evictions: u64,
}

impl Counts {
    fn add(&mut self, o: &Counts) {
        self.ops += o.ops;
        self.hits += o.hits;
        self.misses += o.misses;
        self.evictions += o.evictions;
    }
}

/// Runs one operation. With a read ratio of 0 every operation is a put, as in
/// the original program. A get that misses loads the key, which is a put. A
/// miss is any operation whose key wasn't cached.
fn op<C: Cache>(cache: &mut C, rng: &mut StdRng, cfg: &Config, c: &mut Counts) {
    c.ops += 1;
    let key = rng.gen_range(0..cfg.keys);
    if cfg.read_ratio > 0.0 && rng.gen_bool(cfg.read_ratio) {
        if cache.get(key).is_some() {
            c.hits += 1;
            return;
        }
        c.misses += 1;
        if cache.put(key, rng.gen::<i64>()).1 {
            c.evictions += 1;
        }
        return;
    }
    let (existed, evicted) = cache.put(key, rng.gen::<i64>());
    if existed {
        c.hits += 1;
    } else {
        c.misses += 1;
    }
    if evicted {
        c.evictions += 1;
    }
}

fn main() {
    let start = Instant::now();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cfg = parse_args(&args).unwrap_or_else(|e| {
        eprintln!("read-state: {e}\n{USAGE}");
        exit(2);
    });

    // Dispatch once; each variant is its own monomorphized loop.
    match (cfg.btree, cfg.compact) {
        (false, false) => run(HashWide::new(cfg.capacity), &cfg, start),
        (false, true) => run(HashCompact::new(cfg.capacity), &cfg, start),
        (true, false) => run(BTreeWide::new(cfg.capacity), &cfg, start),
        (true, true) => run(BTreeCompact::new(cfg.capacity), &cfg, start),
    }
}

/// The measurement loop: batches of operations, a sleep after each, and the
/// metrics records when --out is set.
fn run<C: Cache>(mut cache: C, cfg: &Config, start: Instant) -> ! {
    let mut rng = StdRng::seed_from_u64(cfg.seed);
    let mut rec = if cfg.out.is_empty() {
        None
    } else {
        Some(Recorder::new::<C>(cfg, start).unwrap_or_else(|e| {
            eprintln!("read-state: {}: {e}", cfg.out);
            exit(1);
        }))
    };

    // win counts the current window. The recorder adds it to the run totals
    // and resets it each time it writes a record.
    let mut win = Counts::default();
    loop {
        let t0 = Instant::now();
        for _ in 0..cfg.batch {
            op(&mut cache, &mut rng, cfg, &mut win);
        }
        let d = t0.elapsed();
        sleep(cfg.sleep);

        let now = Instant::now();
        let done = !cfg.duration.is_zero() && now - start >= cfg.duration;
        if let Some(rec) = rec.as_mut() {
            rec.batch_done(d);
            let mut res = rec.maybe_write_second(now, cache.len(), &mut win);
            if res.is_ok() && done {
                res = rec.write_end(now, cache.len(), &mut win);
            }
            if let Err(e) = res {
                eprintln!("read-state: {e}");
                exit(1);
            }
        }
        if done {
            exit(0);
        }
    }
}

/// Writes the JSONL metrics records. It's driven by the main loop and reuses
/// its buffers.
struct Recorder {
    w: BufWriter<Box<dyn Write>>,
    line: String,
    start: Instant,
    batch_us: Vec<u64>,
    sorted: Vec<u64>,
    total: Counts,
    batches: u64,
    last_sec: Instant,
    last_cpu: f64,
}

impl Recorder {
    fn new<C: Cache>(cfg: &Config, start: Instant) -> io::Result<Recorder> {
        let out: Box<dyn Write> = if cfg.out == "-" {
            Box::new(io::stdout())
        } else {
            Box::new(
                OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&cfg.out)?,
            )
        };
        let mut r = Recorder {
            w: BufWriter::new(out),
            line: String::with_capacity(4096),
            start,
            batch_us: Vec::with_capacity(64),
            sorted: Vec::with_capacity(64),
            total: Counts::default(),
            batches: 0,
            last_sec: start,
            last_cpu: 0.0,
        };
        let l = &mut r.line;
        l.clear();
        l.push_str("{\"type\":\"config\",\"lang\":\"rust\",\"variant\":");
        push_json_str(l, &cfg.variant);
        let _ = writeln!(
            l,
            ",\"capacity\":{cap},\"capacity_effective\":{cap},\"keys\":{},\"batch\":{},\
             \"sleep_ms\":{},\"read_ratio\":{},\"duration_s\":{},\"seed\":{},\"entry_bytes\":{},\
             \"map\":\"{}\",\"compact\":{}}}",
            cfg.keys,
            cfg.batch,
            cfg.sleep.as_secs_f64() * 1000.0,
            cfg.read_ratio,
            cfg.duration.as_secs_f64(),
            cfg.seed,
            C::ENTRY_BYTES,
            C::MAP,
            C::COMPACT,
            cap = cfg.capacity,
        );
        r.w.write_all(r.line.as_bytes())?;
        r.w.flush()?;
        Ok(r)
    }

    fn batch_done(&mut self, d: Duration) {
        self.batch_us.push(d.as_micros() as u64);
        self.batches += 1;
    }

    fn since(&self, t: Instant) -> f64 {
        (t - self.start).as_secs_f64()
    }

    /// Writes a sec record for the current window if at least a second has
    /// passed since the last one.
    fn maybe_write_second(
        &mut self,
        now: Instant,
        entries: usize,
        win: &mut Counts,
    ) -> io::Result<()> {
        let dt = (now - self.last_sec).as_secs_f64();
        if dt < 1.0 {
            return Ok(());
        }
        let cpu = cpu_seconds();
        self.sorted.clear();
        self.sorted.extend_from_slice(&self.batch_us);
        self.sorted.sort_unstable();
        let t = self.since(now);
        let l = &mut self.line;
        l.clear();
        let _ = write!(
            l,
            "{{\"type\":\"sec\",\"t\":{t:.3},\"ops\":{},\"hits\":{},\"misses\":{},\"evictions\":{},\
             \"entries\":{entries},\"batches\":{},\"batch_us\":[",
            win.ops,
            win.hits,
            win.misses,
            win.evictions,
            self.batch_us.len(),
        );
        for (i, us) in self.batch_us.iter().enumerate() {
            if i > 0 {
                l.push(',');
            }
            let _ = write!(l, "{us}");
        }
        let _ = writeln!(
            l,
            "],\"batch_p50_us\":{},\"batch_p99_us\":{},\"batch_max_us\":{},\"cpu_s\":{cpu:.3},\"cpu_pct\":{:.1}}}",
            percentile(&self.sorted, 0.50),
            percentile(&self.sorted, 0.99),
            percentile(&self.sorted, 1.0),
            100.0 * (cpu - self.last_cpu) / dt,
        );
        self.w.write_all(self.line.as_bytes())?;
        self.total.add(win);
        *win = Counts::default();
        self.batch_us.clear();
        self.last_sec = now;
        self.last_cpu = cpu;
        self.w.flush()
    }

    /// Writes the end record with the run totals, including the partial last
    /// window, and flushes the output.
    fn write_end(&mut self, now: Instant, entries: usize, win: &mut Counts) -> io::Result<()> {
        self.total.add(win);
        *win = Counts::default();
        let t = self.since(now);
        let tot = self.total;
        let l = &mut self.line;
        l.clear();
        let _ = writeln!(
            l,
            "{{\"type\":\"end\",\"t\":{t:.3},\"ops\":{},\"hits\":{},\"misses\":{},\"evictions\":{},\
             \"entries\":{entries},\"batches\":{},\"cpu_s\":{:.3}}}",
            tot.ops,
            tot.hits,
            tot.misses,
            tot.evictions,
            self.batches,
            cpu_seconds(),
        );
        self.w.write_all(self.line.as_bytes())?;
        self.w.flush()
    }
}

/// Nearest-rank percentile of a sorted slice, or 0 if it's empty.
fn percentile(sorted: &[u64], p: f64) -> u64 {
    if sorted.is_empty() {
        return 0;
    }
    let i = ((p * sorted.len() as f64).ceil() as usize).clamp(1, sorted.len()) - 1;
    sorted[i]
}

fn push_json_str(l: &mut String, s: &str) {
    l.push('"');
    for ch in s.chars() {
        match ch {
            '"' => l.push_str("\\\""),
            '\\' => l.push_str("\\\\"),
            c if (c as u32) < 0x20 => {
                let _ = write!(l, "\\u{:04x}", c as u32);
            }
            c => l.push(c),
        }
    }
    l.push('"');
}

/// The process's user plus system CPU time, in seconds.
fn cpu_seconds() -> f64 {
    // SAFETY: getrusage only writes to the struct we pass.
    let mut ru: libc::rusage = unsafe { std::mem::zeroed() };
    if unsafe { libc::getrusage(libc::RUSAGE_SELF, &mut ru) } != 0 {
        return 0.0;
    }
    let tv = |t: libc::timeval| t.tv_sec as f64 + t.tv_usec as f64 / 1e6;
    tv(ru.ru_utime) + tv(ru.ru_stime)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn defaults_are_faithful() {
        let c = parse_args(&[]).unwrap();
        assert_eq!(c.capacity, 20_000_000);
        assert_eq!(c.keys, 25_000_000);
        assert_eq!(c.batch, 20_000);
        assert_eq!(c.sleep, Duration::from_millis(100));
        assert_eq!(c.read_ratio, 0.0);
        assert!(c.duration.is_zero());
        assert!(c.out.is_empty());
        assert_eq!(c.seed, 1);
        assert!(!c.btree && !c.compact);
    }

    #[test]
    fn parses_both_flag_forms() {
        let c = parse_args(&args(&[
            "--capacity=2000000",
            "--read-ratio",
            "0.5",
            "--duration=180s",
            "--sleep",
            "0",
        ]))
        .unwrap();
        assert_eq!(c.capacity, 2_000_000);
        assert_eq!(c.keys, 2_500_000);
        assert_eq!(c.read_ratio, 0.5);
        assert_eq!(c.duration, Duration::from_secs(180));
        assert!(c.sleep.is_zero());
        for bad in [
            &["--capacity=0"][..],
            &["--read-ratio=2"],
            &["--sleep=5"],
            &["--nope=1"],
            &["x"],
            &["--keys=-1"],
            &["--seed"],
        ] {
            assert!(parse_args(&args(bad)).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn map_and_compact_flags() {
        let c = parse_args(&args(&["--compact", "--map", "btree"])).unwrap();
        assert!(c.btree && c.compact);
        // A bare --compact doesn't swallow the next flag.
        let c = parse_args(&args(&["--compact", "--capacity=10"])).unwrap();
        assert!(c.compact);
        assert_eq!(c.capacity, 10);
        let c = parse_args(&args(&["--map=hash", "--compact"])).unwrap();
        assert!(!c.btree && c.compact);
        let c = parse_args(&args(&["--compact=false"])).unwrap();
        assert!(!c.compact);
        for bad in [&["--map=foo"][..], &["--map"], &["--compact=yes"]] {
            assert!(parse_args(&args(bad)).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn durations() {
        assert_eq!(parse_duration("100ms").unwrap(), Duration::from_millis(100));
        assert_eq!(parse_duration("2m").unwrap(), Duration::from_secs(120));
        assert_eq!(parse_duration("1h").unwrap(), Duration::from_secs(3600));
        assert_eq!(parse_duration("0").unwrap(), Duration::ZERO);
        assert!(parse_duration("1.5s").is_err());
    }

    #[test]
    fn op_counts() {
        let cfg = Config {
            capacity: 10,
            keys: 20,
            read_ratio: 0.5,
            ..Config::default()
        };
        let mut cache = HashWide::new(cfg.capacity);
        let mut rng = StdRng::seed_from_u64(1);
        let mut c = Counts::default();
        for _ in 0..1000 {
            op(&mut cache, &mut rng, &cfg, &mut c);
        }
        assert_eq!(c.ops, 1000);
        assert_eq!(c.hits + c.misses, c.ops);
        assert_eq!(c.evictions, c.misses - 10);
    }

    #[test]
    fn percentiles() {
        let s: Vec<u64> = (1..=10).collect();
        assert_eq!(percentile(&s, 0.5), 5);
        assert_eq!(percentile(&s, 0.99), 10);
        assert_eq!(percentile(&s, 0.0), 1);
        assert_eq!(percentile(&[], 0.5), 0);
    }
}
