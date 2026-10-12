//go:build gcperiod

// This file lets --gcperiod change the runtime's forced-GC period, so the quick
// measurement profile can see several periodic collections in a 3-minute run.
//
// It links to the runtime's unexported forcegcperiod variable, which sysmon
// checks to start a periodic (gcTriggerTime) collection. Unlike a goroutine
// calling runtime.GC(), this runs the same code path as Go's normal 2-minute
// forced GC. Go 1.23 and later refuse this link unless the binary is built with
// -ldflags=-checklinkname=0, so the file is behind the gcperiod build tag:
//
//	go build -tags gcperiod -ldflags=-checklinkname=0 -o bin/read-state-go .

package main

import (
	"time"
	_ "unsafe" // for go:linkname
)

//go:linkname forcegcperiod runtime.forcegcperiod
var forcegcperiod int64

const gcPeriodMechanism = "linkname"

// setGCPeriod sets the runtime's forced-GC period.
func setGCPeriod(d time.Duration) error { forcegcperiod = int64(d); return nil }

// gcPeriod reports the runtime's forced-GC period.
func gcPeriod() time.Duration { return time.Duration(forcegcperiod) }
