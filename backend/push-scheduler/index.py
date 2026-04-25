"""
Push Scheduler для игры НЕ СЛОМАЙСЯ.
Отправляет Web Push через FCM HTTP v1 API (Service Account).
Триггеры:
- near_miss: разница < 50мс → через 20-30 мин
- streak_lost >= 3 → через 1-2 часа
- close_to_league_up: до след. лиги < 50 рейтинга → через 1-3 часа
- inactive: не заходил > 24ч → 1 раз в день
Лимит: 2 пуша в день на игрока.
"""
import json
import os
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone

import psycopg2
from psycopg2.extras import RealDictCursor

SCHEMA = os.environ.get("MAIN_DB_SCHEMA", "t_p67729910_mobile_game_reaction")

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Player-Id",
}

LEAGUES = [
    {"id": "bronze",  "name": "Бронза",  "min": 0},
    {"id": "silver",  "name": "Серебро", "min": 1000},
    {"id": "gold",    "name": "Золото",  "min": 1400},
    {"id": "plat",    "name": "Платина", "min": 1800},
    {"id": "legend",  "name": "Легенда", "min": 2200},
]

def get_next_league(rating: int):
    for lg in LEAGUES:
        if lg["min"] > rating:
            return lg
    return None

def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])

def resp(status, body):
    return {
        "statusCode": status,
        "headers": {**CORS, "Content-Type": "application/json"},
        "body": json.dumps(body, ensure_ascii=False, default=str),
    }


# ── FCM HTTP v1 через Service Account ──

_fcm_token_cache = {"token": None, "expires": 0}

def get_fcm_access_token() -> str:
    """Получает OAuth2 access token через Service Account JWT."""
    import time
    import base64

    now = int(time.time())
    if _fcm_token_cache["token"] and _fcm_token_cache["expires"] > now + 60:
        return _fcm_token_cache["token"]

    sa_json = os.environ.get("FCM_SERVICE_ACCOUNT", "")
    if not sa_json:
        return ""

    try:
        sa = json.loads(sa_json)
    except Exception:
        return ""

    client_email = sa.get("client_email", "")
    private_key = sa.get("private_key", "")
    if not client_email or not private_key:
        return ""

    header = base64.urlsafe_b64encode(
        json.dumps({"alg": "RS256", "typ": "JWT"}).encode()
    ).rstrip(b"=")

    payload = base64.urlsafe_b64encode(json.dumps({
        "iss": client_email,
        "scope": "https://www.googleapis.com/auth/firebase.messaging",
        "aud": "https://oauth2.googleapis.com/token",
        "iat": now,
        "exp": now + 3600,
    }).encode()).rstrip(b"=")

    signing_input = header + b"." + payload

    try:
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding

        key = serialization.load_pem_private_key(private_key.encode(), password=None)
        signature = key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
        sig_b64 = base64.urlsafe_b64encode(signature).rstrip(b"=")
        jwt_token = (signing_input + b"." + sig_b64).decode()
    except Exception:
        return ""

    token_data = urllib.parse.urlencode({
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "assertion": jwt_token,
    }).encode()

    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=token_data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            result = json.loads(r.read())
            access_token = result.get("access_token", "")
            _fcm_token_cache["token"] = access_token
            _fcm_token_cache["expires"] = now + result.get("expires_in", 3600)
            return access_token
    except Exception:
        return ""


def send_fcm_push(fcm_token: str, title: str, body_text: str, data: dict = None) -> bool:
    """Отправляет push через FCM HTTP v1 API."""
    sa_json = os.environ.get("FCM_SERVICE_ACCOUNT", "")
    if not sa_json:
        return False

    try:
        sa = json.loads(sa_json)
        project_id = sa.get("project_id", "")
    except Exception:
        return False

    access_token = get_fcm_access_token()
    if not access_token:
        return False

    url = f"https://fcm.googleapis.com/v1/projects/{project_id}/messages:send"

    message = {
        "message": {
            "token": fcm_token,
            "notification": {
                "title": title,
                "body": body_text,
            },
            "webpush": {
                "notification": {
                    "icon": "/icon-192.png",
                    "badge": "/icon-96.png",
                },
                "fcm_options": {
                    "link": "/?autostart=1",
                },
            },
            "data": {k: str(v) for k, v in (data or {}).items()},
        }
    }

    req_data = json.dumps(message).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=req_data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {access_token}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status == 200
    except urllib.error.HTTPError:
        return False
    except Exception:
        return False


def build_push_for_player(player: dict):
    """Определяет триггер. Возвращает (title, body, data) или None."""
    now = datetime.now(timezone.utc)

    reset_date = player.get("push_reset_date")
    count_today = player.get("push_count_today") or 0
    if reset_date and reset_date == now.date() and count_today >= 2:
        return None

    last_played = player.get("last_played_at")
    if not last_played or not isinstance(last_played, datetime):
        return None

    elapsed = (now - last_played).total_seconds() / 60
    last_result = player.get("last_result", "")
    near_miss_diff = player.get("near_miss_diff")
    rating = player.get("rating", 1000)

    # 1. Near miss
    if (last_result == "lose" and near_miss_diff is not None
            and near_miss_diff < 50 and 20 <= elapsed <= 120):
        ms = int(near_miss_diff)
        return (
            f"{ms} мс… ты был очень близко",
            "Один матч — и всё могло быть иначе.",
            {"action": "start_game", "trigger": "near_miss"}
        )

    # 2. Потеря серии
    if (last_result == "lose"
            and (player.get("streak") or 0) == 0
            and (player.get("max_streak") or 0) >= 3
            and 60 <= elapsed <= 300):
        ms = player.get("max_streak", 3)
        return (
            "Серия прервана",
            f"Ты был в шаге от {ms + 1} побед подряд. Вернись.",
            {"action": "start_game", "trigger": "streak_lost"}
        )

    # 3. Близко к апу лиги
    next_lg = get_next_league(rating)
    if next_lg and 60 <= elapsed <= 360:
        points_left = next_lg["min"] - rating
        if 0 < points_left <= 50:
            return (
                f"Ещё {points_left} рейтинга до {next_lg['name']}",
                "Одна победа — и ты поднимаешься.",
                {"action": "start_game", "trigger": "league_up"}
            )

    # 4. Ежедневный бонус готов (не заходил > 20ч, бонус не забран сегодня)
    hours_away = (now - last_played).total_seconds() / 3600
    last_daily = player.get("last_daily_claim")
    daily_ready = not last_daily or last_daily < now.date()
    if daily_ready and 20 <= hours_away <= 30:
        daily_streak = player.get("daily_streak") or 0
        day_num = (daily_streak % 7) + 1
        rewards = [30, 50, 80, 120, 180, 250, 500]
        reward = rewards[min(day_num - 1, 6)]
        return (
            "Ежедневный бонус готов 🎁",
            f"День {day_num}: заходи и забирай +{reward} монет.",
            {"action": "open_daily", "trigger": "daily_bonus"}
        )

    # 5. Не заходил 24-48ч
    if 24 <= hours_away <= 48:
        return (
            "Сможешь выдержать сегодня?",
            "Твои соперники уже тренируются.",
            {"action": "start_game", "trigger": "inactive"}
        )

    return None


def handler(event: dict, context) -> dict:
    """Push Scheduler: GET ?action=run — массовая рассылка, POST ?action=send_one — одиночная."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    method = event.get("httpMethod", "GET")
    params = event.get("queryStringParameters") or {}
    action = params.get("action", "run")

    body = {}
    if event.get("body"):
        try:
            body = json.loads(event["body"])
        except Exception:
            pass

    # ── POST /send_one ──
    if method == "POST" and action == "send_one":
        player_id = body.get("player_id")
        if not player_id:
            return resp(400, {"error": "player_id required"})

        conn = get_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(f"SELECT * FROM {SCHEMA}.players WHERE id = %s", (player_id,))
        row = cur.fetchone()
        if not row:
            cur.close(); conn.close()
            return resp(404, {"error": "player not found"})

        player = dict(row)
        if not player.get("push_token"):
            cur.close(); conn.close()
            return resp(200, {"ok": False, "reason": "no_token"})

        push = build_push_for_player(player)
        if not push:
            cur.close(); conn.close()
            return resp(200, {"ok": False, "reason": "no_trigger"})

        title, body_text, data = push
        sent = send_fcm_push(player["push_token"], title, body_text, data)

        if sent:
            today = datetime.now(timezone.utc).date()
            new_count = (player.get("push_count_today") or 0) + 1
            cur.execute(
                f"UPDATE {SCHEMA}.players SET push_sent_at=NOW(), push_count_today=%s, push_reset_date=%s WHERE id=%s",
                (new_count, today, player_id)
            )
            conn.commit()

        cur.close(); conn.close()
        return resp(200, {"ok": sent, "trigger": data.get("trigger")})

    # ── GET /run — массовая рассылка ──
    if action == "run":
        conn = get_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            f"""SELECT * FROM {SCHEMA}.players
                WHERE push_token IS NOT NULL
                  AND last_played_at > NOW() - INTERVAL '48 hours'"""
        )
        players = [dict(r) for r in cur.fetchall()]

        sent_count = 0
        skipped = 0
        today = datetime.now(timezone.utc).date()

        for player in players:
            push = build_push_for_player(player)
            if not push:
                skipped += 1
                continue

            title, body_text, data = push
            ok = send_fcm_push(player["push_token"], title, body_text, data)

            if ok:
                new_count = (player.get("push_count_today") or 0) + 1
                cur.execute(
                    f"UPDATE {SCHEMA}.players SET push_sent_at=NOW(), push_count_today=%s, push_reset_date=%s WHERE id=%s",
                    (new_count, today, player["id"])
                )
                sent_count += 1

        conn.commit()
        cur.close()
        conn.close()

        return resp(200, {"ok": True, "sent": sent_count, "skipped": skipped, "total": len(players)})

    return resp(404, {"error": "unknown action"})