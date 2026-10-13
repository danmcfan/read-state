package readstate

import "testing"

func TestWorkloadPrefillsToCapacity(t *testing.T) {
	w := NewWorkload(1000)
	if got := w.Cache().Len(); got != 1000 {
		t.Fatalf("Len after NewWorkload = %d, want 1000", got)
	}
	if w.Keys() != 1250 {
		t.Fatalf("Keys = %d, want capacity*5/4 = 1250", w.Keys())
	}
}

func TestWorkloadRunKeepsCacheFull(t *testing.T) {
	w := NewWorkload(1000)
	w.Run(50_000)
	if got := w.Cache().Len(); got != 1000 {
		t.Fatalf("Len after Run = %d, want 1000", got)
	}
}

func TestWorkloadIsDeterministic(t *testing.T) {
	a, b := NewWorkload(100), NewWorkload(100)
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
