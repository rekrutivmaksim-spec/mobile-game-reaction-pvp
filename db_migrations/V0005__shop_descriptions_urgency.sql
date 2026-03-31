
UPDATE t_p67729910_mobile_game_reaction.shop_items SET
  description = 'Фальстарт не считается — матч начнётся снова'
WHERE id = 'retry_1';

UPDATE t_p67729910_mobile_game_reaction.shop_items SET
  description = 'Три шанса исправить обидную ошибку'
WHERE id = 'retry_3';

UPDATE t_p67729910_mobile_game_reaction.shop_items SET
  title = 'Защита серии',
  description = 'Сломался — серия не сгорит. Один раз.'
WHERE id = 'streak_shield';

UPDATE t_p67729910_mobile_game_reaction.shop_items SET
  description = 'Проиграл — остаёшься в лиге. Один раз.'
WHERE id = 'league_shield';

UPDATE t_p67729910_mobile_game_reaction.shop_items SET
  title = 'Игра без фейков ×1',
  description = 'Никаких ложных сигналов. Один матч — чистая игра'
WHERE id = 'focus_1';

UPDATE t_p67729910_mobile_game_reaction.shop_items SET
  title = 'Игра без фейков ×3',
  description = 'Три матча без фейков — докажи что быстрее'
WHERE id = 'focus_3';

UPDATE t_p67729910_mobile_game_reaction.shop_items SET
  description = 'Каждая победа приносит вдвое больше монет — 5 матчей'
WHERE id = 'x2_5';

UPDATE t_p67729910_mobile_game_reaction.shop_items SET
  description = 'Каждая победа приносит вдвое больше монет — 10 матчей'
WHERE id = 'x2_10';

UPDATE t_p67729910_mobile_game_reaction.shop_items SET
  description = '3 повтора + 2 защиты серии + 1 щит лиги. Всё сразу.'
WHERE id = 'bundle_cold';
