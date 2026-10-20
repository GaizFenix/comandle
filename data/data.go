// Package data embeds the game data: the answers in calendar order
// (commands.json) and every word a player may guess (allowed.txt).
package data

import _ "embed"

// Commands is commands.json: one entry per day, in order.
//
//go:embed commands.json
var Commands []byte

// Allowed is allowed.txt: one valid guess per line.
//
//go:embed allowed.txt
var Allowed []byte
