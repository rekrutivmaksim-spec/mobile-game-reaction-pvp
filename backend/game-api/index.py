"""
Единый API для игры НЕ СЛОМАЙСЯ:
- POST /save-result — сохранить результат матча
- GET /leaderboard — топ игроков + позиция пользователя
- GET /profile — профиль игрока
- POST /init-player — создать/получить игрока
"""
import json
import os
import psycopg2
from psycopg2.extras import RealDictCursor

SCHEMA = "t_p67729910_mobile_game_reaction"

LEAGUES = [
    {"id": "bronze",  "name": "Бронза",  "min": 0,    "max": 999},
    {"id": "silver",  "name": "Серебро", "min": 1000, "max": 1399},
    {"id": "gold",    "name": "Золото",  "min": 1400, "max": 1799},
    {"id": "plat",    "name": "Платина", "min": 1800, "max": 2199},
    {"id": "legend",  "name": "Легенда", "min": 2200, "max": 999999},
]

def get_league(rating: int) -> dict:
    for lg in reversed(LEAGUES):
        if rating >= lg["min"]:
            return lg
    return LEAGUES[0]

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Player-Id",
}


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def resp(status, body, extra_headers=None):
    h = {**CORS, "Content-Type": "application/json"}
    if extra_headers:
        h.update(extra_headers)
    return {"statusCode": status, "headers": h, "body": json.dumps(body, ensure_ascii=False, default=str)}


def handler(event: dict, context) -> dict:
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    method = event.get("httpMethod", "GET")
    path = event.get("path", "/")
    params = event.get("queryStringParameters") or {}
    headers = event.get("headers") or {}
    player_id = headers.get("X-Player-Id") or params.get("player_id")

    body = {}
    if event.get("body"):
        try:
            body = json.loads(event["body"])
        except Exception:
            pass

    action = params.get("action", "")
    if not action:
        if "/init-player" in path:
            action = "init-player"
        elif "/save-result" in path:
            action = "save-result"
        elif "/leaderboard" in path:
            action = "leaderboard"
        elif "/profile" in path:
            action = "profile"

    # ── POST /init-player ──
    if method == "POST" and (action == "init-player" or "/init-player" in path):
        nickname = body.get("nickname", "Игрок")
        conn = get_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            f"INSERT INTO {SCHEMA}.players (nickname) VALUES (%s) RETURNING *",
            (nickname,)
        )
        player = dict(cur.fetchone())
        conn.commit()
        cur.close()
        conn.close()
        return resp(200, {"player": player})

    # ── POST /save-result ──
    if method == "POST" and (action == "save-result" or "/save-result" in path):
        if not player_id:
            return resp(400, {"error": "player_id required"})

        result_type = body.get("result")  # win / lose / false_start
        reaction_time = body.get("reaction_time")  # ms or None

        conn = get_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        cur.execute(f"SELECT * FROM {SCHEMA}.players WHERE id = %s", (player_id,))
        row = cur.fetchone()
        if not row:
            cur.close()
            conn.close()
            return resp(404, {"error": "player not found"})

        player = dict(row)
        is_win = result_type == "win"

        # Загружаем активные бусты
        cur.execute(
            f"SELECT effect_key, charges_left FROM {SCHEMA}.active_boosts WHERE player_id=%s",
            (player_id,)
        )
        boosts = {r["effect_key"]: r["charges_left"] for r in cur.fetchall()}

        rating_delta = 25 if is_win else -15

        # Щит лиги
        league_shield_fired = False
        if not is_win and boosts.get("league_shield", 0) > 0:
            league_min = {"bronze": 0, "silver": 1000, "gold": 1400, "plat": 1800, "legend": 2200}
            curr_lg = next((k for k, v in sorted(league_min.items(), key=lambda x: -x[1]) if player["rating"] >= v), "bronze")
            min_rating = league_min[curr_lg]
            new_rating_raw = player["rating"] + rating_delta
            if new_rating_raw < min_rating:
                rating_delta = min_rating - player["rating"]  # удержать на границе
                league_shield_fired = True
                cur.execute(
                    f"UPDATE {SCHEMA}.active_boosts SET charges_left=charges_left-1 WHERE player_id=%s AND effect_key='league_shield'",
                    (player_id,)
                )
                cur.execute(
                    f"DELETE FROM {SCHEMA}.active_boosts WHERE player_id=%s AND effect_key='league_shield' AND charges_left<=0",
                    (player_id,)
                )

        new_rating = max(0, player["rating"] + rating_delta)
        new_wins = player["wins"] + (1 if is_win else 0)
        new_losses = player["losses"] + (0 if is_win else 1)

        # Защита серии
        streak_shield_fired = False
        if not is_win and boosts.get("streak_shield", 0) > 0:
            streak_shield_fired = True
            new_streak = player["streak"]  # серия сохраняется
            cur.execute(
                f"UPDATE {SCHEMA}.active_boosts SET charges_left=charges_left-1 WHERE player_id=%s AND effect_key='streak_shield'",
                (player_id,)
            )
            cur.execute(
                f"DELETE FROM {SCHEMA}.active_boosts WHERE player_id=%s AND effect_key='streak_shield' AND charges_left<=0",
                (player_id,)
            )
        else:
            new_streak = player["streak"] + 1 if is_win else 0

        new_max_streak = max(player["max_streak"], new_streak)
        streak_bonus = 2 if new_streak >= 5 else 1

        # x2 буст
        x2_active = boosts.get("x2_reward", 0) > 0
        base_coins = (20 if is_win else 5) * streak_bonus
        coins_earned = base_coins * (2 if x2_active and is_win else 1)
        if x2_active and is_win:
            cur.execute(
                f"UPDATE {SCHEMA}.active_boosts SET charges_left=charges_left-1 WHERE player_id=%s AND effect_key='x2_reward'",
                (player_id,)
            )
            cur.execute(
                f"DELETE FROM {SCHEMA}.active_boosts WHERE player_id=%s AND effect_key='x2_reward' AND charges_left<=0",
                (player_id,)
            )

        new_coins = player["coins"] + coins_earned

        new_best = player["best_reaction"]
        new_total = player["total_reaction"]
        new_count = player["reaction_count"]

        if reaction_time and isinstance(reaction_time, (int, float)) and reaction_time > 0:
            rt = int(reaction_time)
            new_best = min(new_best, rt) if new_best else rt
            new_total = new_total + rt
            new_count = new_count + 1

        cur.execute(
            f"""UPDATE {SCHEMA}.players SET
                rating=%s, wins=%s, losses=%s, streak=%s, max_streak=%s,
                coins=%s, best_reaction=%s, total_reaction=%s, reaction_count=%s,
                last_played_at=NOW()
                WHERE id=%s RETURNING *""",
            (new_rating, new_wins, new_losses, new_streak, new_max_streak,
             new_coins, new_best, new_total, new_count, player_id)
        )
        updated = dict(cur.fetchone())
        conn.commit()

        # rank
        cur.execute(f"SELECT COUNT(*) as cnt FROM {SCHEMA}.players WHERE rating > %s", (new_rating,))
        rank = cur.fetchone()["cnt"] + 1

        cur.execute(f"SELECT COUNT(*) as cnt FROM {SCHEMA}.players")
        total = cur.fetchone()["cnt"]

        cur.close()
        conn.close()

        avg_reaction = int(updated["total_reaction"] / updated["reaction_count"]) if updated["reaction_count"] > 0 else None
        percent_better = round((1 - (rank - 1) / max(total, 1)) * 100) if total > 1 else 100

        prev_league = get_league(player["rating"])
        new_league = get_league(new_rating)

        return resp(200, {
            "player": updated,
            "rank": rank,
            "total_players": total,
            "percent_better": percent_better,
            "rating_delta": rating_delta,
            "coins_earned": coins_earned,
            "avg_reaction": avg_reaction,
            "prev_league": prev_league["id"],
            "new_league": new_league["id"],
            "league_shield_fired": league_shield_fired,
            "streak_shield_fired": streak_shield_fired,
            "x2_active": x2_active,
        })

    # ── GET /leaderboard ──
    if method == "GET" and (action == "leaderboard" or "/leaderboard" in path):
        conn = get_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        cur.execute(
            f"""SELECT id, nickname, rating, wins, losses, streak, max_streak, best_reaction,
                       RANK() OVER (ORDER BY rating DESC) as rank
                FROM {SCHEMA}.players
                ORDER BY rating DESC
                LIMIT 100"""
        )
        top = [dict(r) for r in cur.fetchall()]

        neighbors = []
        if player_id:
            cur.execute(f"SELECT rating FROM {SCHEMA}.players WHERE id = %s", (player_id,))
            me = cur.fetchone()
            if me:
                my_rating = me["rating"]
                cur.execute(
                    f"""WITH ranked AS (
                        SELECT id, nickname, rating, wins,
                               RANK() OVER (ORDER BY rating DESC) as rank
                        FROM {SCHEMA}.players
                    )
                    SELECT * FROM ranked
                    WHERE rank BETWEEN (SELECT rank FROM ranked WHERE id = %s) - 2
                                   AND (SELECT rank FROM ranked WHERE id = %s) + 2
                    ORDER BY rank""",
                    (player_id, player_id)
                )
                neighbors = [dict(r) for r in cur.fetchall()]

        cur.execute(f"SELECT COUNT(*) as cnt FROM {SCHEMA}.players")
        total = cur.fetchone()["cnt"]

        cur.close()
        conn.close()
        return resp(200, {"top": top, "neighbors": neighbors, "total_players": total})

    # ── GET /profile ──
    if method == "GET" and (action == "profile" or "/profile" in path):
        if not player_id:
            return resp(400, {"error": "player_id required"})

        conn = get_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(f"SELECT * FROM {SCHEMA}.players WHERE id = %s", (player_id,))
        row = cur.fetchone()
        if not row:
            cur.close()
            conn.close()
            return resp(404, {"error": "not found"})

        player = dict(row)

        cur.execute(f"SELECT COUNT(*) as cnt FROM {SCHEMA}.players WHERE rating > %s", (player["rating"],))
        rank = cur.fetchone()["cnt"] + 1

        cur.execute(f"SELECT COUNT(*) as cnt FROM {SCHEMA}.players")
        total = cur.fetchone()["cnt"]

        cur.close()
        conn.close()

        avg_reaction = int(player["total_reaction"] / player["reaction_count"]) if player["reaction_count"] > 0 else None
        total_matches = player["wins"] + player["losses"]
        winrate = round(player["wins"] / total_matches * 100) if total_matches > 0 else 0
        percent_better = round((1 - (rank - 1) / max(total, 1)) * 100) if total > 1 else 100

        league = get_league(player["rating"])

        return resp(200, {
            "player": player,
            "rank": rank,
            "total_players": total,
            "avg_reaction": avg_reaction,
            "winrate": winrate,
            "percent_better": percent_better,
            "league": league,
        })

    # ── POST /rename ──
    if method == "POST" and (action == "rename" or "/rename" in path):
        if not player_id:
            return resp(400, {"error": "player_id required"})
        nickname = (body.get("nickname") or "").strip()
        if not nickname or len(nickname) < 2 or len(nickname) > 20:
            return resp(400, {"error": "Ник: от 2 до 20 символов"})

        conn = get_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            f"UPDATE {SCHEMA}.players SET nickname=%s WHERE id=%s RETURNING *",
            (nickname, player_id)
        )
        row = cur.fetchone()
        conn.commit()
        cur.close()
        conn.close()
        if not row:
            return resp(404, {"error": "player not found"})
        return resp(200, {"player": dict(row)})

    return resp(404, {"error": "not found"})