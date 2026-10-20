package stats

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRecordStreaks(t *testing.T) {
	var s Stats
	s.Record(1, true, []string{"a", "b", "c"})
	s.Record(2, true, []string{"a"})
	if s.Streak != 2 || s.MaxStreak != 2 || s.Dist[2] != 1 || s.Dist[0] != 1 {
		t.Fatalf("after two wins: %+v", s)
	}
	s.Record(2, false, nil) // same day again: ignored
	if s.Played != 2 || s.Streak != 2 {
		t.Fatalf("recording a day twice changed stats: %+v", s)
	}
	s.Record(4, true, []string{"a", "b"}) // skipped day 3: streak restarts
	if s.Streak != 1 || s.MaxStreak != 2 {
		t.Fatalf("gap should reset the streak: %+v", s)
	}
	s.Record(5, false, []string{"a", "b", "c", "d", "e", "f"})
	if s.Streak != 0 || s.Played != 4 || s.Wins != 3 || !s.PlayedDay(5) {
		t.Fatalf("after a loss: %+v", s)
	}
}

func TestSaveLoad(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("XDG_STATE_HOME", dir)
	path, err := Path()
	if err != nil {
		t.Fatal(err)
	}
	if path != filepath.Join(dir, "comandle", "stats.json") {
		t.Fatalf("path = %s", path)
	}
	s, err := Load(path)
	if err != nil || s.Played != 0 {
		t.Fatalf("missing file should load empty: %+v %v", s, err)
	}
	s.Record(1, true, []string{"chmod"})
	if err := Save(path, s); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("stats file mode = %v, want 0600", info.Mode().Perm())
	}
	got, err := Load(path)
	if err != nil || got.Wins != 1 || got.LastGuesses[0] != "chmod" {
		t.Fatalf("round trip: %+v %v", got, err)
	}
}
