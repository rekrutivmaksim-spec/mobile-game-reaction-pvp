
-- Комнаты для приватных дуэлей
CREATE TABLE t_p67729910_mobile_game_reaction.rooms (
    id          TEXT PRIMARY KEY,
    host_id     TEXT NOT NULL,
    guest_id    TEXT,
    status      TEXT NOT NULL DEFAULT 'waiting',
    host_time   INTEGER,
    guest_time  INTEGER,
    winner_id   TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '10 minutes'
);

-- Шаблоны дневных челленджей
CREATE TABLE t_p67729910_mobile_game_reaction.challenges (
    id          SERIAL PRIMARY KEY,
    type        TEXT NOT NULL,
    title       TEXT NOT NULL,
    description TEXT NOT NULL,
    target      INTEGER NOT NULL,
    reward_coins INTEGER NOT NULL DEFAULT 30
);

-- Прогресс игрока по челленджам (сбрасывается каждый день)
CREATE TABLE t_p67729910_mobile_game_reaction.player_challenges (
    id           SERIAL PRIMARY KEY,
    player_id    TEXT NOT NULL,
    challenge_id INTEGER NOT NULL,
    progress     INTEGER NOT NULL DEFAULT 0,
    completed    BOOLEAN NOT NULL DEFAULT FALSE,
    day          DATE NOT NULL DEFAULT CURRENT_DATE,
    UNIQUE (player_id, challenge_id, day)
);

-- Сидируем 3 шаблона челленджей
INSERT INTO t_p67729910_mobile_game_reaction.challenges (type, title, description, target, reward_coins) VALUES
  ('play_matches',  'Боец дня',      'Сыграй 5 матчей',           5,  25),
  ('win_matches',   'Победная серия','Выиграй 3 матча',            3,  40),
  ('no_false_start','Стальные нервы','Сыграй 3 матча без фальстарта', 3, 50);
