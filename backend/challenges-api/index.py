"""
API дневных челленджей:
- GET  /?action=get        — получить челленджи игрока на сегодня (с прогрессом)
- POST /?action=report     — обновить прогресс по итогам матча
"""
import json
import os
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


def ensure_player_challenges(cur, player_id):
    """Создаёт записи прогресса на сегодня если их ещё нет."""
    cur.execute(f"SELECT id FROM {SCHEMA}.challenges")
    all_ids = [r["id"] for r in cur.fetchall()]
    for cid in all_ids:
        cur.execute(
            f"""INSERT INTO {SCHEMA}.player_challenges (player_id, challenge_id, progress, completed, day)
                VALUES (%s, %s, 0, FALSE, CURRENT_DATE)
                ON CONFLICT (player_id, challenge_id, day) DO NOTHING""",
            (player_id, cid)
        )


def handler(event: dict, context) -> dict:
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    method = event.get("httpMethod", "GET")
    params = event.get("queryStringParameters") or {}
    headers = event.get("headers") or {}
    player_id = headers.get("X-Player-Id") or params.get("player_id")
    action = params.get("action", "get")

    body = {}
    if event.get("body"):
        try:
            body = json.loads(event["body"])
        except Exception:
            pass

    if not player_id:
        return resp(400, {"error": "player_id required"})

    # ── GET /get ──
    if action == "get" or method == "GET":
        conn = get_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        ensure_player_challenges(cur, player_id)
        conn.commit()

        cur.execute(
            f"""SELECT c.id, c.type, c.title, c.description, c.target, c.reward_coins,
                       pc.progress, pc.completed
                FROM {SCHEMA}.challenges c
                JOIN {SCHEMA}.player_challenges pc
                  ON pc.challenge_id = c.id
                 AND pc.player_id = %s
                 AND pc.day = CURRENT_DATE
                ORDER BY c.id""",
            (player_id,)
        )
        challenges = [dict(r) for r in cur.fetchall()]
        cur.close()
        conn.close()
        return resp(200, {"challenges": challenges})

    # ── POST /report ──
    if action == "report":
        result_type = body.get("result")   # win / lose / false_start
        no_false_start = body.get("no_false_start", False)
        coins_earned_total = 0
        completed_titles = []

        conn = get_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        ensure_player_challenges(cur, player_id)

        cur.execute(
            f"""SELECT c.id, c.type, c.target, c.reward_coins,
                       pc.progress, pc.completed
                FROM {SCHEMA}.challenges c
                JOIN {SCHEMA}.player_challenges pc
                  ON pc.challenge_id = c.id
                 AND pc.player_id = %s
                 AND pc.day = CURRENT_DATE""",
            (player_id,)
        )
        rows = [dict(r) for r in cur.fetchall()]

        for row in rows:
            if row["completed"]:
                continue

            ctype = row["type"]
            new_progress = row["progress"]

            if ctype == "play_matches":
                new_progress += 1
            elif ctype == "win_matches" and result_type == "win":
                new_progress += 1
            elif ctype == "no_false_start" and result_type != "false_start":
                new_progress += 1
            elif ctype == "no_false_start" and result_type == "false_start":
                # Сбрасываем — нет фальстарта означает ВСЕ матчи без него
                new_progress = 0

            newly_completed = new_progress >= row["target"]
            if newly_completed:
                new_progress = row["target"]
                coins_earned_total += row["reward_coins"]
                completed_titles.append(row["reward_coins"])

            cur.execute(
                f"""UPDATE {SCHEMA}.player_challenges
                    SET progress=%s, completed=%s
                    WHERE player_id=%s AND challenge_id=%s AND day=CURRENT_DATE""",
                (new_progress, newly_completed, player_id, row["id"])
            )

        # Начисляем монеты игроку если что-то выполнено
        if coins_earned_total > 0:
            cur.execute(
                f"UPDATE {SCHEMA}.players SET coins = coins + %s WHERE id = %s",
                (coins_earned_total, player_id)
            )

        conn.commit()

        # Возвращаем актуальный список
        cur.execute(
            f"""SELECT c.id, c.type, c.title, c.description, c.target, c.reward_coins,
                       pc.progress, pc.completed
                FROM {SCHEMA}.challenges c
                JOIN {SCHEMA}.player_challenges pc
                  ON pc.challenge_id = c.id
                 AND pc.player_id = %s
                 AND pc.day = CURRENT_DATE
                ORDER BY c.id""",
            (player_id,)
        )
        challenges = [dict(r) for r in cur.fetchall()]
        cur.close()
        conn.close()

        return resp(200, {
            "challenges": challenges,
            "coins_earned": coins_earned_total,
            "completed_count": len(completed_titles),
        })

    return resp(404, {"error": "not found"})
