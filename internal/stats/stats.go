// Package stats keeps the player's history in one small file on their own
// machine. Nothing leaves it: comandle makes no network calls.
package stats

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
)

// Stats is the player's record across days.
type Stats struct {
	Played      int      `json:"played"`
	Wins        int      `json:"wins"`
	Streak      int      `json:"streak"`
	MaxStreak   int      `json:"max_streak"`
	Dist        [6]int   `json:"distribution"` // wins by number of tries
	LastDay     int      `json:"last_day"`
	LastWon     bool     `json:"last_won"`
	LastGuesses []string `json:"last_guesses"`
}

// Path is where the stats live: $XDG_STATE_HOME/comandle when set, otherwise
// the OS config directory (~/.config on Linux, ~/Library/Application Support
// on macOS).
func Path() (string, error) {
	if dir := os.Getenv("XDG_STATE_HOME"); dir != "" {
		return filepath.Join(dir, "comandle", "stats.json"), nil
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "comandle", "stats.json"), nil
}

// Load reads the stats file. A missing file is a new player, not an error.
func Load(path string) (Stats, error) {
	var s Stats
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return s, err
	}
	return s, json.Unmarshal(data, &s)
}

// Save writes the stats readable only by the player, replacing the file
// atomically so an interrupted write never leaves it half done.
func Save(path string, s Stats) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".stats-*.json")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(append(data, '\n')); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}

// Played reports whether the player already finished that day.
func (s *Stats) PlayedDay(day int) bool { return s.LastDay == day && day > 0 }

// Record adds a finished daily round. Recording the same day twice does
// nothing. A streak counts consecutive days won.
func (s *Stats) Record(day int, won bool, guesses []string) {
	if s.PlayedDay(day) {
		return
	}
	consecutive := s.LastDay == day-1 && s.LastWon
	s.Played++
	if won {
		s.Wins++
		if consecutive {
			s.Streak++
		} else {
			s.Streak = 1
		}
		if s.Streak > s.MaxStreak {
			s.MaxStreak = s.Streak
		}
		if n := len(guesses); n >= 1 && n <= len(s.Dist) {
			s.Dist[n-1]++
		}
	} else {
		s.Streak = 0
	}
	s.LastDay = day
	s.LastWon = won
	s.LastGuesses = append([]string(nil), guesses...)
}
