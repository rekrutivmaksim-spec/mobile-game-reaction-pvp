CREATE TABLE IF NOT EXISTS t_p67729910_mobile_game_reaction.payments (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id   uuid NOT NULL,
    item_id     text NOT NULL,
    coins_added integer NOT NULL,
    amount      text,
    payment_id  text UNIQUE NOT NULL,
    order_id    text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payments_player_id_idx ON t_p67729910_mobile_game_reaction.payments(player_id);
