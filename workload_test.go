package readstate

import "testing"

func TestWorkloadPrefillsToCapacity(t *testing.T) {
	for _, layout := range []Layout{ListLayout, SlabLayout} {
		w := NewWorkload(1000, layout)
		if got := w.Cache().Len(); got != 1000 {
			t.Fatalf("Len after NewWorkload = %d, want 1000", got)
		}
		if w.Keys() != 1250 {
			t.Fatalf("Keys = %d, want capacity*5/4 = 1250", w.Keys())
		}
	}
}

func TestWorkloadRunKeepsCacheFull(t *testing.T) {
	for _, layout := range []Layout{ListLayout, SlabLayout} {
		w := NewWorkload(1000, layout)
		w.Run(50_000)
		if got := w.Cache().Len(); got != 1000 {
			t.Fatalf("Len after Run = %d, want 1000", got)
		}
	}
}

func TestWorkloadIsDeterministic(t *testing.T) {
	for _, layout := range []Layout{ListLayout, SlabLayout} {
		a, b := NewWorkload(100, layout), NewWorkload(100, layout)
		a.Run(1000)
		b.Run(1000)
		for k := int64(0); k < a.Keys(); k++ {
			va, oka := a.Cache().Get(k)
			vb, okb := b.Cache().Get(k)
			if va != vb || oka != okb {
				t.Fatalf("key %d: %d,%v vs %d,%v", k, va, oka, vb, okb)
			}
		}
	}
}

// newKeys counts keys outside the prefill, which only a Put can add.
func newKeys(w *Workload, capacity int64) int {
	n := 0
	for k := capacity; k < w.Keys(); k++ {
		if _, ok := w.Cache().Get(k); ok {
			n++
		}
	}
	return n
}

func TestWorkloadAllReadsNeverPut(t *testing.T) {
	for _, layout := range []Layout{ListLayout, SlabLayout} {
		w := NewWorkload(1000, layout)
		w.SetReadRatio(100)
		w.Run(50_000)
		if got := newKeys(w, 1000); got != 0 {
			t.Fatalf("read ratio 100 added %d keys, want 0", got)
		}
	}
}

func TestWorkloadAllWritesPut(t *testing.T) {
	for _, layout := range []Layout{ListLayout, SlabLayout} {
		w := NewWorkload(1000, layout)
		w.SetReadRatio(0)
		w.Run(50_000)
		if got := newKeys(w, 1000); got == 0 {
			t.Fatal("read ratio 0 added no keys")
		}
	}
}

func TestWorkloadClampsReadRatio(t *testing.T) {
	for _, layout := range []Layout{ListLayout, SlabLayout} {
		w := NewWorkload(10, layout)
		w.SetReadRatio(250)
		if w.ReadRatio() != 100 {
			t.Fatalf("ReadRatio = %d, want 100", w.ReadRatio())
		}
		w.SetReadRatio(-5)
		if w.ReadRatio() != 0 {
			t.Fatalf("ReadRatio = %d, want 0", w.ReadRatio())
		}
	}
}
