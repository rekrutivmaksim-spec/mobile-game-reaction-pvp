
-- Каталог товаров магазина
CREATE TABLE t_p67729910_mobile_game_reaction.shop_items (
    id           TEXT PRIMARY KEY,
    tab          TEXT NOT NULL,          -- coins / help / look / status
    title        TEXT NOT NULL,
    description  TEXT NOT NULL,
    icon         TEXT NOT NULL,
    price_coins  INTEGER,                -- цена в монетах (NULL = за реальные)
    price_rub    INTEGER,                -- цена в рублях (NULL = за монеты)
    item_type    TEXT NOT NULL,          -- consumable / permanent / activator
    effect_key   TEXT,                   -- ключ эффекта для логики
    effect_value INTEGER DEFAULT 1,     -- количество зарядов/матчей
    badge        TEXT,                   -- "popular" / "best" / NULL
    sort_order   INTEGER DEFAULT 0
);

-- Инвентарь игрока
CREATE TABLE t_p67729910_mobile_game_reaction.inventory (
    id           SERIAL PRIMARY KEY,
    player_id    TEXT NOT NULL,
    item_id      TEXT NOT NULL,
    quantity     INTEGER NOT NULL DEFAULT 1,   -- для расходников
    equipped     BOOLEAN NOT NULL DEFAULT FALSE,
    acquired_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (player_id, item_id)
);

-- Активные временные бусты игрока
CREATE TABLE t_p67729910_mobile_game_reaction.active_boosts (
    id           SERIAL PRIMARY KEY,
    player_id    TEXT NOT NULL,
    effect_key   TEXT NOT NULL,
    charges_left INTEGER NOT NULL DEFAULT 1,
    activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (player_id, effect_key)
);

-- Заполняем каталог
INSERT INTO t_p67729910_mobile_game_reaction.shop_items
    (id, tab, title, description, icon, price_coins, price_rub, item_type, effect_key, effect_value, badge, sort_order)
VALUES
-- === ПОМОЩЬ ===
('retry_1',       'help', 'Вторая попытка',   'Аннулирует поражение — матч перезапустится', '🔄', 10,  NULL, 'consumable', 'retry',          1, NULL,       10),
('retry_3',       'help', '3 попытки',         'Запас на чёрный день',                       '🔄', 25,  NULL, 'consumable', 'retry',          3, 'popular',  11),
('streak_shield', 'help', 'Защита серии',      'Следующее поражение не обнулит серию',       '🛡️', 30,  NULL, 'consumable', 'streak_shield',  1, NULL,       20),
('league_shield', 'help', 'Щит лиги',          'Защищает от вылета из текущей лиги',         '💎', 50,  NULL, 'consumable', 'league_shield',  1, 'popular',  30),
('focus_1',       'help', 'Концентрация ×1',   'Убирает фейк-сигналы на 1 матч',             '🧘', 20,  NULL, 'activator',  'focus',          1, NULL,       40),
('focus_3',       'help', 'Концентрация ×3',   'Убирает фейк-сигналы на 3 матча',            '🧘', 50,  NULL, 'activator',  'focus',          3, 'best',     41),
('x2_5',          'help', 'x2 награда ×5',     'Удваивает монеты за победу — 5 матчей',      '⚡', 40,  NULL, 'activator',  'x2_reward',      5, NULL,       50),
('x2_10',         'help', 'x2 награда ×10',    'Удваивает монеты за победу — 10 матчей',     '⚡', 70,  NULL, 'activator',  'x2_reward',     10, 'best',     51),
('bundle_cold',   'help', 'Набор хладнокровия','3 попытки + 2 защиты + 1 щит',               '🎁', 90,  NULL, 'consumable', 'bundle_cold',    1, 'popular',  60),

-- === ОБЛИК ===
('theme_neon',    'look', 'Тема: Неон',        'Неоновые цвета вместо стандартных',          '💜', 80,  NULL, 'permanent',  'theme',          1, NULL,       10),
('theme_ice',     'look', 'Тема: Лёд',         'Ледяная холодная цветовая схема',            '❄️', 80,  NULL, 'permanent',  'theme',          1, NULL,       11),
('theme_fire',    'look', 'Тема: Огонь',       'Огненный интенсивный стиль',                 '🔥', 80,  NULL, 'permanent',  'theme',          1, 'popular',  12),
('signal_spark',  'look', 'Сигнал: Молния',    'Вспышка молнии вместо зелёного',             '⚡', 60,  NULL, 'permanent',  'signal_fx',      1, NULL,       20),
('signal_pulse',  'look', 'Сигнал: Импульс',   'Пульсирующий круговой эффект',               '🌀', 60,  NULL, 'permanent',  'signal_fx',      1, NULL,       21),
('win_gold',      'look', 'Победа: Золото',    'Золотой взрыв на экране победы',             '✨', 60,  NULL, 'permanent',  'win_fx',         1, NULL,       30),
('win_electric',  'look', 'Победа: Электро',   'Электрический разряд при победе',            '⚡', 60,  NULL, 'permanent',  'win_fx',         1, NULL,       31),

-- === СТАТУС ===
('frame_neon',    'status', 'Рамка: Неон',     'Неоновый контур вокруг карточки',            '🟣', 100, NULL, 'permanent',  'frame',          1, NULL,       10),
('frame_plat',    'status', 'Рамка: Платина',  'Платиновый блеск статуса',                   '💎', 150, NULL, 'permanent',  'frame',          1, 'popular',  11),
('title_iron',    'status', 'Титул: Не дрогнул','Подпись под именем в профиле',              '🏆', 80,  NULL, 'permanent',  'title',          1, NULL,       20),
('title_light',   'status', 'Титул: Быстрее света','Для тех кто держит рекорды',            '⚡', 80,  NULL, 'permanent',  'title',          1, NULL,       21);
