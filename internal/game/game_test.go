package game

import (
	"errors"
	"slices"
	"strings"
	"testing"
	"time"
)

const fixtureCommands = `[
 {"id":"chmod","category":"permisos","level":"básico",
  "clues":["Decide quién puede leer un archivo.","Acepta modos en octal.","Viene de change mode."],
  "summary":"Cambia permisos.","explanation":"Explicación.",
  "examples":[{"cmd":"a","desc":"a"},{"cmd":"b","desc":"b"},{"cmd":"c","desc":"c"}],
  "security":"Nota."},
 {"id":"grep","category":"texto","level":"básico",
  "clues":["Busca texto.","Usa expresiones regulares.","Global regular expression print."],
  "summary":"Busca patrones.","explanation":"Explicación.",
  "examples":[{"cmd":"a","desc":"a"},{"cmd":"b","desc":"b"},{"cmd":"c","desc":"c"}],
  "security":"Nota.","lab":"https://example.com/lab/"}
]`

const fixtureAllowed = "# comment\nchown\nmount\ncrond\nchmod\n"

func book(t *testing.T) *Book {
	t.Helper()
	b, err := Load([]byte(fixtureCommands), []byte(fixtureAllowed))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestScore(t *testing.T) {
	c, p, a := Correct, Present, Absent
	cases := []struct {
		guess, answer string
		want          []Mark
	}{
		{"chmod", "chmod", []Mark{c, c, c, c, c}},
		{"chown", "chmod", []Mark{c, c, p, a, a}},
		{"mount", "chmod", []Mark{p, p, a, a, a}},
		// Only one 'a' left to match after the exact one: the second is Absent.
		{"mama", "mamo", []Mark{c, c, c, a}},
		// Repeated letter in the guess, single in the answer.
		{"eerie", "there", []Mark{p, a, p, a, c}},
		{"speed", "abide", []Mark{a, a, p, a, p}},
	}
	for _, tc := range cases {
		if got := Score(tc.guess, tc.answer); !slices.Equal(got, tc.want) {
			t.Errorf("Score(%q, %q) = %v, want %v", tc.guess, tc.answer, got, tc.want)
		}
	}
}

func TestDayNumber(t *testing.T) {
	cases := []struct {
		at   time.Time
		want int
	}{
		{time.Date(2026, 10, 19, 23, 59, 0, 0, Argentina), 1}, // before launch: day 1
		{time.Date(2026, 10, 20, 0, 0, 0, 0, Argentina), 1},
		{time.Date(2026, 10, 20, 23, 59, 59, 0, Argentina), 1},
		{time.Date(2026, 10, 21, 2, 59, 0, 0, time.UTC), 1}, // still the 20th in Argentina
		{time.Date(2026, 10, 21, 3, 0, 0, 0, time.UTC), 2},
		{time.Date(2027, 1, 1, 12, 0, 0, 0, Argentina), 74},
	}
	for _, tc := range cases {
		if got := DayNumber(tc.at); got != tc.want {
			t.Errorf("DayNumber(%v) = %d, want %d", tc.at, got, tc.want)
		}
	}
	next := NextDay(time.Date(2026, 10, 20, 18, 0, 0, 0, Argentina))
	if !next.Equal(time.Date(2026, 10, 21, 0, 0, 0, 0, Argentina)) {
		t.Errorf("NextDay = %v", next)
	}
}

func TestDailyIsStableAndCycles(t *testing.T) {
	b := book(t)
	if b.Daily(1).ID != "chmod" || b.Daily(2).ID != "grep" {
		t.Fatalf("calendar order not respected: %s %s", b.Daily(1).ID, b.Daily(2).ID)
	}
	if b.Daily(0).ID != "chmod" {
		t.Error("days before 1 should clamp to day 1")
	}
	// After the list runs out the days cycle, and the same day always gets
	// the same answer.
	first := map[int]string{}
	for n := 3; n < 50; n++ {
		first[n] = b.Daily(n).ID
	}
	for n := 3; n < 50; n++ {
		if got := b.Daily(n).ID; got != first[n] {
			t.Fatalf("day %d changed from %s to %s", n, first[n], got)
		}
	}
}

func TestRound(t *testing.T) {
	b := book(t)
	ans, _ := b.Get("chmod")
	r := NewRound(b, ans)

	if _, err := r.Try("grep"); !errors.Is(err, ErrLength) {
		t.Errorf("short guess: got %v, want ErrLength", err)
	}
	if _, err := r.Try("zzzzz"); !errors.Is(err, ErrUnknown) {
		t.Errorf("unknown word: got %v, want ErrUnknown", err)
	}
	if _, err := r.Try("chown"); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Try("CHOWN"); !errors.Is(err, ErrRepeated) {
		t.Errorf("repeat: got %v, want ErrRepeated", err)
	}
	if r.CluesVisible() != 0 {
		t.Errorf("one miss shows %d clues, want 0", r.CluesVisible())
	}
	r.Try("mount")
	if r.CluesVisible() != 1 {
		t.Errorf("two misses show %d clues, want 1", r.CluesVisible())
	}
	if st := r.LetterState(); st['c'] != Correct || st['m'] != Present || st['w'] != Absent {
		t.Errorf("letter state wrong: %v", st)
	}
	if _, err := r.Try("chmod"); err != nil || !r.Won() || !r.Over() {
		t.Fatalf("winning guess: err=%v won=%v", err, r.Won())
	}
	if _, err := r.Try("crond"); !errors.Is(err, ErrOver) {
		t.Errorf("after the end: got %v, want ErrOver", err)
	}
	share := r.Share(7, false)
	if !strings.HasPrefix(share, "comandle #7 3/6\n🟩🟩🟨⬛⬛\n🟨🟨⬛⬛⬛\n🟩🟩🟩🟩🟩\n") {
		t.Errorf("share text:\n%s", share)
	}
	if strings.Contains(share, "chmod") {
		t.Error("share text must not spoil the answer")
	}
}

func TestCandidates(t *testing.T) {
	allowed := "chown\nmount\ncrond\nchmod\nchgrp\nchsh\n"
	b, err := Load([]byte(fixtureCommands), []byte(allowed))
	if err != nil {
		t.Fatal(err)
	}
	ans, _ := b.Get("chmod")
	r := NewRound(b, ans)
	all := r.Candidates()
	if !slices.Equal(all, []string{"chgrp", "chmod", "chown", "crond", "mount"}) {
		t.Fatalf("before any guess every 5-letter word fits, got %v", all)
	}
	r.Try("chown") // c h correct, o present, w n absent
	got := r.Candidates()
	if !slices.Equal(got, []string{"chmod"}) {
		t.Errorf("after chown: %v, want [chmod]", got)
	}
}

func TestLostRoundShowsAllClues(t *testing.T) {
	b, err := Load([]byte(fixtureCommands), []byte("aaaaa\nbbbbb\nccccc\nddddd\neeeee\nfffff\n"))
	if err != nil {
		t.Fatal(err)
	}
	ans, _ := b.Get("chmod")
	r := NewRound(b, ans)
	for _, g := range []string{"aaaaa", "bbbbb", "ccccc", "ddddd", "eeeee", "fffff"} {
		if _, err := r.Try(g); err != nil {
			t.Fatal(err)
		}
	}
	if !r.Over() || r.Won() || r.CluesVisible() != 3 {
		t.Errorf("lost round: over=%v won=%v clues=%d", r.Over(), r.Won(), r.CluesVisible())
	}
	if !strings.HasPrefix(r.Share(1, false), "comandle #1 X/6") {
		t.Error("a lost round shares X/6")
	}
}

func TestLoadRejectsBadData(t *testing.T) {
	bad := `[{"id":"ls","category":"nope","level":"básico","clues":["ls is here"],
	  "summary":"","explanation":"","examples":[],"security":""}]`
	_, err := Load([]byte(bad), nil)
	if err == nil {
		t.Fatal("expected an error")
	}
	for _, want := range []string{"4 to 8", "unknown category", "3 clues", "gives the answer away", "3 examples", "required"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error should mention %q:\n%v", want, err)
		}
	}
}
