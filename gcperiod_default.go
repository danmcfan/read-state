//go:build !gcperiod

// Without the gcperiod build tag the forced-GC period is the runtime's own
// 2 minutes, and --gcperiod accepts only that value. See gcperiod_linkname.go.

package main

import (
	"fmt"
	"time"
)

const gcPeriodMechanism = "runtime-default"

const runtimeGCPeriod = 2 * time.Minute

// setGCPeriod fails unless d is the runtime's default period.
func setGCPeriod(d time.Duration) error {
	if d != runtimeGCPeriod {
		return fmt.Errorf("--gcperiod=%s needs a build with -tags gcperiod -ldflags=-checklinkname=0", d)
	}
	return nil
}

// gcPeriod reports the runtime's forced-GC period.
func gcPeriod() time.Duration { return runtimeGCPeriod }
