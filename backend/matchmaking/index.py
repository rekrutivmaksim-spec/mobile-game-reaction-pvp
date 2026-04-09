"""
Matchmaking API — рандомный подбор реальных игроков (FIFO).

Endpoints:
- POST /?action=join   — встать в очередь. Если есть соперник — создаёт матч.
- GET  /?action=poll   — опросить статус: в очереди или матч создан?
- POST /?action=submit — отправить время реакции; сервер определяет победителя.
- POST /?action=leave  — выйти из очереди.
"""
import json
import os
import random
import psycopg2
from psycopg2.extras import RealDictCursor

SCHEMA = "t_p67729910_mobile_game_reaction"

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Player-Id",
}


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def resp(status, body):
    return {
        "statusCode": status,
        "headers": {**CORS, "Content-Type": "application/json"},
        "body": json.dumps(body, ensure_ascii=False, default=str),
    }


def handler(event: dict, context) -> dict:
    """Matchmaking API: join, poll, submit, leave — подбор реальных игроков."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    method = event.get("httpMethod", "GET")
    params = event.get("queryStringParameters") or {}
    headers = event.get("headers") or {}
    player_id = headers.get("X-Player-Id") or params.get("player_id")
    action = params.get("action", "")

    body = {}
    if event.get("body"):
        try:
            body = json.loads(event["body"])
        except Exception:
            pass

    if not player_id:
        return resp(400, {"error": "player_id required"})

    # ── POST /join — встать в очередь ──
    if action == "join" and method == "POST":
        conn = get_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # Получаем данные игрока
        cur.execute(f"SELECT nickname, rating FROM {SCHEMA}.players WHERE id=%s", (player_id,))
        pl = cur.fetchone()
        if not pl:
            cur.close(); conn.close()
            return resp(404, {"error": "player not found"})

        # Проверка активного матча (созданного не более 60 сек назад)
        cur.execute(
            f"""SELECT * FROM {SCHEMA}.pvp_matches
                WHERE status='playing'
                  AND created_at > NOW() - INTERVAL '60 seconds'
                  AND (player1_id=%s OR player2_id=%s)
                ORDER BY created_at DESC LIMIT 1""",
            (player_id, player_id)
        )
        existing = cur.fetchone()
        if existing:
            cur.close(); conn.close()
            return resp(200, {"status": "matched", "match": dict(existing)})

        # Атомарно удаляем игрока из очереди (если был) — защита от дубля
        cur.execute(
            f"DELETE FROM {SCHEMA}.matchmaking_queue WHERE player_id=%s",
            (player_id,)
        )

        # Атомарно захватываем соперника через DELETE..RETURNING
        # (не позволит двум игрокам захватить одного и того же)
        cur.execute(
            f"""DELETE FROM {SCHEMA}.matchmaking_queue
                WHERE player_id = (
                    SELECT player_id FROM {SCHEMA}.matchmaking_queue
                    WHERE player_id != %s
                      AND match_id IS NULL
                      AND joined_at > NOW() - INTERVAL '30 seconds'
                    ORDER BY joined_at ASC
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED
                )
                RETURNING *""",
            (player_id,)
        )
        opponent = cur.fetchone()

        if opponent:
            # Доп. защита: сверяем что соперник — не мы сами
            if opponent["player_id"] == player_id:
                # Этого не должно происходить, но на всякий
                cur.execute(
                    f"""INSERT INTO {SCHEMA}.matchmaking_queue (player_id, nickname, rating, joined_at)
                        VALUES (%s, %s, %s, NOW())
                        ON CONFLICT (player_id) DO UPDATE
                        SET joined_at=NOW(), match_id=NULL, nickname=EXCLUDED.nickname, rating=EXCLUDED.rating""",
                    (player_id, pl["nickname"], pl["rating"])
                )
                conn.commit()
                cur.close(); conn.close()
                return resp(200, {"status": "waiting"})

            # Создаём матч между двумя реальными игроками
            signal_delay = random.randint(1800, 4000)
            cur.execute(
                f"""INSERT INTO {SCHEMA}.pvp_matches
                    (player1_id, player2_id, player1_nickname, player2_nickname, signal_delay_ms, status)
                    VALUES (%s, %s, %s, %s, %s, 'playing')
                    RETURNING *""",
                (opponent["player_id"], player_id, opponent["nickname"], pl["nickname"], signal_delay)
            )
            match = dict(cur.fetchone())

            conn.commit()
            cur.close(); conn.close()
            return resp(200, {"status": "matched", "match": match})

        # Свободных нет — встаём в очередь (UPSERT для защиты от дубля)
        cur.execute(
            f"""INSERT INTO {SCHEMA}.matchmaking_queue (player_id, nickname, rating, joined_at)
                VALUES (%s, %s, %s, NOW())
                ON CONFLICT (player_id) DO UPDATE
                SET joined_at=NOW(), match_id=NULL, nickname=EXCLUDED.nickname, rating=EXCLUDED.rating""",
            (player_id, pl["nickname"], pl["rating"])
        )
        conn.commit()
        cur.close(); conn.close()
        return resp(200, {"status": "waiting"})

    # ── GET /poll — опросить статус ──
    if action == "poll" and method == "GET":
        conn = get_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # Проверяем активный матч (только свежие, не старше 60 сек)
        cur.execute(
            f"""SELECT * FROM {SCHEMA}.pvp_matches
                WHERE status='playing'
                  AND created_at > NOW() - INTERVAL '60 seconds'
                  AND (player1_id=%s OR player2_id=%s)
                ORDER BY created_at DESC LIMIT 1""",
            (player_id, player_id)
        )
        match = cur.fetchone()
        if match:
            cur.close(); conn.close()
            return resp(200, {"status": "matched", "match": dict(match)})

        # Проверяем финальный матч (только свежие, не старше 30 сек)
        cur.execute(
            f"""SELECT * FROM {SCHEMA}.pvp_matches
                WHERE status='finished'
                  AND finished_at > NOW() - INTERVAL '30 seconds'
                  AND (player1_id=%s OR player2_id=%s)
                ORDER BY finished_at DESC LIMIT 1""",
            (player_id, player_id)
        )
        finished = cur.fetchone()

        # Если в очереди — значит ждём
        cur.execute(f"SELECT 1 FROM {SCHEMA}.matchmaking_queue WHERE player_id=%s AND match_id IS NULL", (player_id,))
        in_queue = cur.fetchone() is not None

        cur.close(); conn.close()
        if in_queue:
            return resp(200, {"status": "waiting"})
        if finished:
            return resp(200, {"status": "finished", "match": dict(finished)})
        return resp(200, {"status": "idle"})

    # ── POST /submit — отправить время реакции ──
    if action == "submit" and method == "POST":
        match_id = body.get("match_id")
        reaction_time = body.get("reaction_time")  # int (мс) или -1 (false_start)

        if not match_id:
            return resp(400, {"error": "match_id required"})
        if reaction_time is None:
            return resp(400, {"error": "reaction_time required"})
        if not isinstance(reaction_time, (int, float)):
            return resp(400, {"error": "reaction_time must be number"})
        if reaction_time != -1 and (reaction_time < 80 or reaction_time > 5000):
            return resp(400, {"error": "reaction_time out of range"})
        reaction_time = int(reaction_time)

        conn = get_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(f"SELECT * FROM {SCHEMA}.pvp_matches WHERE id=%s FOR UPDATE", (match_id,))
        match = cur.fetchone()
        if not match:
            cur.close(); conn.close()
            return resp(404, {"error": "match not found"})

        match = dict(match)
        is_p1 = match["player1_id"] == player_id
        is_p2 = match["player2_id"] == player_id
        if not is_p1 and not is_p2:
            cur.close(); conn.close()
            return resp(403, {"error": "not your match"})

        # Матч уже завершён — возвращаем финальный результат
        if match["status"] == "finished":
            cur.close(); conn.close()
            return resp(200, {"match": match})

        # Антидубль
        if is_p1 and match["player1_time"] is not None:
            cur.close(); conn.close()
            return resp(200, {"match": match})
        if is_p2 and match["player2_time"] is not None:
            cur.close(); conn.close()
            return resp(200, {"match": match})

        field = "player1_time" if is_p1 else "player2_time"
        cur.execute(
            f"UPDATE {SCHEMA}.pvp_matches SET {field}=%s WHERE id=%s RETURNING *",
            (reaction_time, match_id)
        )
        updated = dict(cur.fetchone())

        # Если оба сдали — определяем победителя
        if updated["player1_time"] is not None and updated["player2_time"] is not None:
            t1 = updated["player1_time"]
            t2 = updated["player2_time"]
            if t1 == -1 and t2 == -1:
                winner = None
            elif t1 == -1:
                winner = updated["player2_id"]
            elif t2 == -1:
                winner = updated["player1_id"]
            elif t1 < t2:
                winner = updated["player1_id"]
            elif t2 < t1:
                winner = updated["player2_id"]
            else:
                winner = None

            cur.execute(
                f"""UPDATE {SCHEMA}.pvp_matches
                    SET winner_id=%s, status='finished', finished_at=NOW()
                    WHERE id=%s RETURNING *""",
                (winner, match_id)
            )
            updated = dict(cur.fetchone())

            # Чистим очередь обоих
            cur.execute(
                f"DELETE FROM {SCHEMA}.matchmaking_queue WHERE player_id IN (%s, %s)",
                (updated["player1_id"], updated["player2_id"])
            )

        conn.commit()
        cur.close(); conn.close()
        return resp(200, {"match": updated})

    # ── POST /leave — выйти из очереди ──
    if action == "leave" and method == "POST":
        conn = get_conn()
        cur = conn.cursor()
        cur.execute(f"DELETE FROM {SCHEMA}.matchmaking_queue WHERE player_id=%s", (player_id,))
        conn.commit()
        cur.close(); conn.close()
        return resp(200, {"ok": True})

    return resp(404, {"error": "not found"})