-- Daily Login Bonus
ALTER TABLE t_p67729910_mobile_game_reaction.players
  ADD COLUMN IF NOT EXISTS daily_streak INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_daily_claim DATE NULL,
  ADD COLUMN IF NOT EXISTS last_daily_check DATE NULL;

-- Best of day/week
ALTER TABLE t_p67729910_mobile_game_reaction.players
  ADD COLUMN IF NOT EXISTS today_best_reaction INTEGER NULL,
  ADD COLUMN IF NOT EXISTS today_matches INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS today_wins INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS today_date DATE NULL;

-- Achievements unlocked
CREATE TABLE IF NOT EXISTS t_p67729910_mobile_game_reaction.achievements (
  player_id UUID NOT NULL,
  achievement_id TEXT NOT NULL,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (player_id, achievement_id)
);

CREATE INDEX IF NOT EXISTS idx_achievements_player
  ON t_p67729910_mobile_game_reaction.achievements(player_id);
