-- Удаление рекламы (разовая покупка)
ALTER TABLE t_p67729910_mobile_game_reaction.players
  ADD COLUMN IF NOT EXISTS no_ads BOOLEAN NOT NULL DEFAULT FALSE;

-- Реферальная система
ALTER TABLE t_p67729910_mobile_game_reaction.players
  ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS referrer_id UUID REFERENCES t_p67729910_mobile_game_reaction.players(id),
  ADD COLUMN IF NOT EXISTS referral_bonus_claimed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS referrals_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS referrals_rewarded INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_players_referral_code ON t_p67729910_mobile_game_reaction.players(referral_code);
CREATE INDEX IF NOT EXISTS idx_players_referrer_id ON t_p67729910_mobile_game_reaction.players(referrer_id);

-- Генерация реферальных кодов для существующих игроков
UPDATE t_p67729910_mobile_game_reaction.players
SET referral_code = UPPER(SUBSTRING(MD5(id::text || RANDOM()::text), 1, 6))
WHERE referral_code IS NULL;