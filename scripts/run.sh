#!/usr/bin/env bash
# Measurement runs for the read-state variants, one at a time.
#
#   scripts/run.sh list               print variant names in matrix order
#   scripts/run.sh <variant> [...]    build, run each variant in isolation, summarize
#   scripts/run.sh all                every variant in matrix order, then summarize
#   scripts/run.sh summarize          only regenerate the summary files
#
# Environment:
#   OUT_DIR=results   where <variant>.jsonl, logs/ and summary.json go
#   DURATION=180s     length of each run (e.g. DURATION=15s OUT_DIR=/tmp/x for a smoke test)
#   PROFILE=quick     the only supported profile (see results/README.md)
#
# Don't run anything else heavy (builds, tests, other measurements) while this
# runs: each variant's CPU numbers assume it has the machine to itself.
#
# Needs Go 1.23+ (for -ldflags=-checklinkname=0), cargo, and macOS or Linux.
# Works with the bash 3.2 that ships with macOS.

set -eu

cd "$(dirname "$0")/.."

OUT_DIR=${OUT_DIR:-results}
DURATION=${DURATION:-180s}
PROFILE=${PROFILE:-quick}
COOLDOWN=10

if [ "$PROFILE" != quick ]; then
	echo "run.sh: unknown PROFILE=$PROFILE (only 'quick' is supported)" >&2
	exit 2
fi

# The quick profile: a 2M-entry cache (10x smaller than the faithful 20M), a
# 50% read ratio, and Go's forced GC every 20 s instead of every 2 minutes, so
# a 3-minute run sees several periodic collections after the cache fills.
COMMON_ARGS="--capacity=2000000 --read-ratio=0.5 --seed=1 --duration=$DURATION"
GO_ARGS="--gcperiod=20s"

GO_BIN=bin/read-state-go
RUST_BIN=target/release/read-state

# variant NAME sets the variant's settings, or fails for an unknown name:
#   lang   go or rust
#   args   extra flags for the binary, after the quick-profile flags
#   envv   extra environment, as NAME=value words (e.g. GOMEMLIMIT=...)
#   bin    a different binary (default: the language's)
#   label, issue, group, go192   metadata copied into the env record for the
#                                summary and the site (go192: true, false or null)
#
# This table is the one source of truth for the matrix: `list` and `all` read
# the variant names, in order, from the rows between the MATRIX markers.
variant() {
	lang= args= envv= bin= label= issue= group= go192=null
	case "$1" in
	# BEGIN MATRIX
	go-baseline)
		lang=go args="--layout=list" label="Go, map + container/list"
		issue=2 group=go-baseline go192=true ;;
	# Discord's step 1: GC percent (100 is go-baseline).
	go-gcpercent-50)
		lang=go args="--gcpercent=50" label="Go, GC percent 50"
		issue=3 group=go-gcpercent go192=true ;;
	go-gcpercent-400)
		lang=go args="--gcpercent=400" label="Go, GC percent 400"
		issue=3 group=go-gcpercent go192=true ;;
	go-gcpercent-1000)
		lang=go args="--gcpercent=1000" label="Go, GC percent 1000"
		issue=3 group=go-gcpercent go192=true ;;
	# Step 2: a smaller cache. Below 2M the key space stays at 2.5M, so misses
	# rise as the cache shrinks; above 2M it grows with the cache (keys
	# default to capacity*5/4), so the hit rate stays at the baseline's.
	go-cap-500K)
		lang=go args="--capacity=500000 --keys=2500000" label="Go, 500K entries"
		issue=3 group=go-capacity go192=true ;;
	go-cap-1M)
		lang=go args="--capacity=1000000 --keys=2500000" label="Go, 1M entries"
		issue=3 group=go-capacity go192=true ;;
	go-cap-4M)
		lang=go args="--capacity=4000000" label="Go, 4M entries"
		issue=3 group=go-capacity go192=true ;;
	go-cap-8M)
		lang=go args="--capacity=8000000" label="Go, 8M entries"
		issue=3 group=go-capacity go192=true ;;
	# Step 3: many partitioned caches, same total capacity.
	go-shards-16)
		lang=go args="--shards=16" label="Go, 16 shards"
		issue=3 group=go-shards go192=true ;;
	rust-baseline)
		lang=rust label="Rust, HashMap + index list"
		issue=2 group=rust ;;
	# END MATRIX
	*) return 1 ;;
	esac
	case $lang in
	go) bin=${bin:-$GO_BIN} args="$COMMON_ARGS $GO_ARGS $args" ;;
	rust) bin=${bin:-$RUST_BIN} args="$COMMON_ARGS $args" ;;
	esac
}

variants() {
	sed -n '/^[[:space:]]*# BEGIN MATRIX$/,/^[[:space:]]*# END MATRIX$/s/^[[:space:]]*\([a-z0-9][A-Za-z0-9-]*\))$/\1/p' "$0"
}

json_str() {
	printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"
}

# json_env NAME prints the variable's value in the run's environment as a
# JSON string, or null if it isn't set.
json_env() {
	# shellcheck disable=SC2086 # envv is a list of NAME=value words
	if env $envv sh -c "[ -n \"\${$1+x}\" ]"; then
		json_str "$(env $envv sh -c "printf '%s' \"\$$1\"")"
	else
		printf null
	fi
}

host_json() {
	os=$(uname -s) os_version=
	case $os in
	Darwin)
		os=macOS
		os_version=$(sw_vers -productVersion)
		cpu=$(sysctl -n machdep.cpu.brand_string)
		ncpu=$(sysctl -n hw.ncpu)
		mem=$(sysctl -n hw.memsize) ;;
	*)
		os_version=$(uname -r)
		cpu=$(sed -n 's/^model name[[:space:]]*: //p' /proc/cpuinfo | head -n 1)
		ncpu=$(getconf _NPROCESSORS_ONLN)
		mem=$(($(sed -n 's/^MemTotal: *\([0-9]*\) kB/\1/p' /proc/meminfo) * 1024)) ;;
	esac
	printf '{"os":%s,"os_version":%s,"kernel":%s,"arch":%s,"cpu_model":%s,"ncpu":%s,"mem_bytes":%s}' \
		"$(json_str "$os")" "$(json_str "$os_version")" "$(json_str "$(uname -r)")" \
		"$(json_str "$(uname -m)")" "$(json_str "$cpu")" "$ncpu" "$mem"
}

build() {
	echo "== build" >&2
	mkdir -p bin
	go build -tags gcperiod -ldflags=-checklinkname=0 -o "$GO_BIN" .
	cargo build --release --quiet
}

# matrix_json ORDER prints the current variant's matrix metadata as a JSON
# object (call variant NAME first).
matrix_json() {
	printf '{"order":%d,"label":%s,"issue":%d,"group":%s,"go192":%s}' \
		"$1" "$(json_str "$label")" "$issue" "$(json_str "$group")" "$go192"
}

# summarize passes the current matrix to cmd/summarize, so the summary's order
# and metadata follow this script even for results recorded before rows were
# added or changed.
summarize() {
	echo "== summarize $OUT_DIR" >&2
	matrix=$(mktemp "${TMPDIR:-/tmp}/read-state-matrix.XXXXXX")
	i=0
	for v in $(variants); do
		i=$((i + 1))
		variant "$v"
		printf '{"variant":%s,%s\n' "$(json_str "$v")" "$(matrix_json "$i" | cut -c2-)"
	done >"$matrix"
	rc=0
	go run ./cmd/summarize --in="$OUT_DIR" --matrix="$matrix" || rc=$?
	rm -f "$matrix"
	return "$rc"
}

# run_variant NAME ORDER runs one variant and writes $OUT_DIR/NAME.jsonl.
run_variant() {
	v=$1 order=$2
	variant "$v"
	out=$OUT_DIR/$v.jsonl
	log=$OUT_DIR/logs/$v.stderr.log
	mkdir -p "$OUT_DIR/logs"

	godebug=
	[ "$lang" = go ] && godebug=GODEBUG=gctrace=1
	cmd=$(echo "$godebug $envv $bin $args --variant=$v --out=$out" | sed 's/^ *//; s/  */ /g')

	# The results files themselves don't make the checkout dirty.
	dirty=false
	if git status --porcelain | grep -v -e "^.. ${OUT_DIR#./}/" -e '^.. site/data/' | grep -q .; then
		dirty=true
	fi

	{
		printf '{"type":"env","variant":%s,"profile":"quick","started_at":"%s",' \
			"$(json_str "$v")" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
		printf '"git_commit":"%s","git_dirty":%s,"command":%s,' \
			"$(git rev-parse HEAD)" "$dirty" "$(json_str "$cmd")"
		printf '"env_vars":{"GOGC":%s,"GOMEMLIMIT":%s,"GOEXPERIMENT":%s,"GOMAXPROCS":%s},' \
			"$(json_env GOGC)" "$(json_env GOMEMLIMIT)" "$(json_env GOEXPERIMENT)" "$(json_env GOMAXPROCS)"
		printf '"host":%s,' "$(host_json)"
		printf '"go_version":%s,"rust_version":%s,"cargo_version":%s,' \
			"$(json_str "$(go env GOVERSION)")" "$(json_str "$(rustc --version)")" \
			"$(json_str "$(cargo --version)")"
		printf '"matrix":%s}\n' "$(matrix_json "$order")"
	} >"$out"

	echo "== $v: $cmd" >&2
	SECONDS=0
	# shellcheck disable=SC2086 # envv and args are lists of words
	env $godebug $envv "$bin" $args --variant="$v" --out="$out" 2>"$log" &
	pid=$!

	# Sample RSS once a second until the process exits. ps reports KiB; a
	# zombie (exited, not yet waited for) reports 0 or nothing.
	: >"$tmp"
	while kill -0 "$pid" 2>/dev/null; do
		rss=$(ps -o rss= -p "$pid" 2>/dev/null | tr -d ' ') || break
		[ -n "$rss" ] && [ "$rss" -gt 0 ] || break
		printf '{"type":"proc","t":%d,"rss_bytes":%d}\n' "$SECONDS" "$((rss * 1024))" >>"$tmp"
		sleep 1
	done
	status=0
	wait "$pid" || status=$?
	pid=
	cat "$tmp" >>"$out"

	if [ "$status" -ne 0 ]; then
		echo "run.sh: $v exited with status $status (see $log)" >&2
		failed="$failed $v"
	fi
}

run() {
	for v in "$@"; do
		variant "$v" || { echo "run.sh: unknown variant $v (see scripts/run.sh list)" >&2; exit 2; }
	done
	build
	tmp=$(mktemp "${TMPDIR:-/tmp}/read-state-proc.XXXXXX")
	pid=
	trap 'rm -f "$tmp"' EXIT
	trap '[ -n "$pid" ] && kill "$pid" 2>/dev/null; exit 130' INT TERM
	failed=
	n=0
	for v in "$@"; do
		n=$((n + 1))
		order=$(variants | grep -n -x -- "$v" | cut -d: -f1)
		run_variant "$v" "$order"
		if [ "$n" -lt "$#" ]; then
			echo "== cooldown ${COOLDOWN}s" >&2
			sleep "$COOLDOWN"
		fi
	done
	summarize
	if [ -n "$failed" ]; then
		echo "run.sh: failed:$failed" >&2
		exit 1
	fi
}

case "${1:-}" in
"" | -h | --help)
	sed -n '2,13s/^# \{0,1\}//p' "$0"
	[ $# -gt 0 ] || exit 2 ;;
list) variants ;;
summarize) summarize ;;
all)
	# shellcheck disable=SC2046 # variant names are single words
	run $(variants) ;;
*) run "$@" ;;
esac
