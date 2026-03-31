"""
API для приватных дуэлей между друзьями:
- POST /?action=create  — создать комнату, вернуть код
- POST /?action=join    — войти в комнату по коду
- GET  /?action=poll    — опросить статус комнаты
- POST /?action=submit  — отправить своё время
"""
import json
import os
import random
import string
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


def gen_code(length=6):
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=length))


def handler(event: dict, context) -> dict:
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

    # ── POST /create ──
    if action == "create":
        if not player_id:
            return resp(400, {"error": "player_id required"})

        conn = get_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # Закрываем старые висящие комнаты этого игрока
        cur.execute(
            f"UPDATE {SCHEMA}.rooms SET status='expired' WHERE host_id=%s AND status='waiting'",
            (player_id,)
        )

        code = gen_code()
        cur.execute(
            f"""INSERT INTO {SCHEMA}.rooms (id, host_id, status)
                VALUES (%s, %s, 'waiting') RETURNING *""",
            (code, player_id)
        )
        room = dict(cur.fetchone())
        conn.commit()
        cur.close()
        conn.close()
        return resp(200, {"room": room, "code": code})

    # ── POST /join ──
    if action == "join":
        if not player_id:
            return resp(400, {"error": "player_id required"})
        code = body.get("code", "").upper().strip()
        if not code:
            return resp(400, {"error": "code required"})

        conn = get_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            f"SELECT * FROM {SCHEMA}.rooms WHERE id=%s AND status='waiting'",
            (code,)
        )
        row = cur.fetchone()
        if not row:
            cur.close()
            conn.close()
            return resp(404, {"error": "Комната не найдена или устарела"})

        room = dict(row)
        if room["host_id"] == player_id:
            cur.close()
            conn.close()
            return resp(400, {"error": "Нельзя войти в свою же комнату"})

        cur.execute(
            f"UPDATE {SCHEMA}.rooms SET guest_id=%s, status='ready' WHERE id=%s RETURNING *",
            (player_id, code)
        )
        updated = dict(cur.fetchone())
        conn.commit()
        cur.close()
        conn.close()
        return resp(200, {"room": updated})

    # ── GET /poll ──
    if action == "poll":
        code = params.get("code", "").upper()
        if not code:
            return resp(400, {"error": "code required"})

        conn = get_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(f"SELECT * FROM {SCHEMA}.rooms WHERE id=%s", (code,))
        row = cur.fetchone()
        cur.close()
        conn.close()
        if not row:
            return resp(404, {"error": "not found"})
        return resp(200, {"room": dict(row)})

    # ── POST /submit ──
    if action == "submit":
        if not player_id:
            return resp(400, {"error": "player_id required"})
        code = body.get("code", "").upper()
        reaction_time = body.get("reaction_time")  # ms int или -1 (false_start)

        conn = get_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(f"SELECT * FROM {SCHEMA}.rooms WHERE id=%s", (code,))
        row = cur.fetchone()
        if not row:
            cur.close()
            conn.close()
            return resp(404, {"error": "not found"})

        room = dict(row)
        is_host = room["host_id"] == player_id
        is_guest = room["guest_id"] == player_id

        if not is_host and not is_guest:
            cur.close()
            conn.close()
            return resp(403, {"error": "not in room"})

        if is_host:
            cur.execute(
                f"UPDATE {SCHEMA}.rooms SET host_time=%s WHERE id=%s RETURNING *",
                (reaction_time, code)
            )
        else:
            cur.execute(
                f"UPDATE {SCHEMA}.rooms SET guest_time=%s WHERE id=%s RETURNING *",
                (reaction_time, code)
            )

        updated = dict(cur.fetchone())

        # Оба сдали результат — определяем победителя
        if updated["host_time"] is not None and updated["guest_time"] is not None:
            ht = updated["host_time"]
            gt = updated["guest_time"]

            if ht == -1 and gt == -1:
                winner = None
            elif ht == -1:
                winner = updated["guest_id"]
            elif gt == -1:
                winner = updated["host_id"]
            elif ht < gt:
                winner = updated["host_id"]
            elif gt < ht:
                winner = updated["guest_id"]
            else:
                winner = None  # draw

            cur.execute(
                f"UPDATE {SCHEMA}.rooms SET status='finished', winner_id=%s WHERE id=%s RETURNING *",
                (winner, code)
            )
            updated = dict(cur.fetchone())

        conn.commit()
        cur.close()
        conn.close()
        return resp(200, {"room": updated})

    return resp(404, {"error": "not found"})
