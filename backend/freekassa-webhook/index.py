"""
Freekassa:
- GET  /?action=pay  — сгенерировать ссылку на оплату
- POST /             — webhook от Freekassa после успешного платежа
"""
import hashlib
import json
import os

SCHEMA = "t_p67729910_mobile_game_reaction"

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Player-Id",
}

COIN_PACKAGES = {
    "coins_100":  {"coins": 100,  "price": "29.00"},
    "coins_300":  {"coins": 300,  "price": "49.00"},
    "coins_700":  {"coins": 700,  "price": "99.00"},
    "coins_1500": {"coins": 1500, "price": "149.00"},
}


def get_conn():
    import psycopg2
    return psycopg2.connect(os.environ["DATABASE_URL"])


def resp_json(status, body):
    return {
        "statusCode": status,
        "headers": {**CORS, "Content-Type": "application/json"},
        "body": json.dumps(body, ensure_ascii=False),
    }


def resp_text(status, body_str):
    return {
        "statusCode": status,
        "headers": {**CORS, "Content-Type": "text/plain"},
        "body": body_str,
    }


def make_pay_url(shop_id, amount, secret1, order_id, currency="RUB"):
    """Формируем ссылку на оплату Freekassa."""
    sign_raw = f"{shop_id}:{amount}:{secret1}:{currency}:{order_id}"
    sign = hashlib.md5(sign_raw.encode()).hexdigest()
    return (
        f"https://pay.freekassa.net/?"
        f"m={shop_id}&oa={amount}&currency={currency}"
        f"&o={order_id}&s={sign}&lang=ru"
    )


def verify_webhook_sign(merchant_id, amount, secret1, order_id, sign):
    """Проверяем подпись входящего webhook от Freekassa."""
    raw = f"{merchant_id}:{amount}:{secret1}:{order_id}"
    return hashlib.md5(raw.encode()).hexdigest() == sign


def handler(event: dict, context) -> dict:
    """Freekassa: генерация ссылки оплаты и приём webhook."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    method = event.get("httpMethod", "GET")
    params = event.get("queryStringParameters") or {}
    headers = event.get("headers") or {}
    action = params.get("action", "")

    # ── GET /?action=pay — генерация ссылки на оплату ──
    if method == "GET" and action == "pay":
        player_id = headers.get("X-Player-Id") or params.get("player_id")
        item_id = params.get("item_id")

        if not player_id:
            return resp_json(400, {"error": "player_id required"})
        if not item_id or item_id not in COIN_PACKAGES:
            return resp_json(400, {"error": "invalid item_id"})

        shop_id = os.environ.get("FREEKASSA_SHOP_ID", "")
        secret1 = os.environ.get("FREEKASSA_SECRET1", "")
        pkg = COIN_PACKAGES[item_id]

        # order_id = {player_id}_{item_id}  — по нему после оплаты начислим монеты
        order_id = f"{player_id}_{item_id}"
        pay_url = make_pay_url(shop_id, pkg["price"], secret1, order_id)

        return resp_json(200, {"url": pay_url, "coins": pkg["coins"], "price": pkg["price"]})

    # ── POST / — webhook от Freekassa после успешного платежа ──
    if method == "POST":
        body_raw = event.get("body") or ""

        form = {}
        if body_raw:
            from urllib.parse import unquote_plus
            for pair in body_raw.split("&"):
                if "=" in pair:
                    k, v = pair.split("=", 1)
                    form[unquote_plus(k)] = unquote_plus(v)

        data = {**params, **form}

        merchant_id = data.get("MERCHANT_ID", "")
        amount      = data.get("AMOUNT", "")
        sign        = data.get("SIGN", "")
        order_id    = data.get("MERCHANT_ORDER_ID", "")
        payment_id  = data.get("intid", "")

        secret1 = os.environ.get("FREEKASSA_SECRET1", "")

        if not verify_webhook_sign(merchant_id, amount, secret1, order_id, sign):
            return resp_text(400, "SIGN_ERROR")

        # order_id = {player_id}_{item_id}
        parts = order_id.split("_", 1)
        if len(parts) != 2:
            return resp_text(400, "BAD_ORDER_ID")

        player_id, item_id = parts[0], parts[1]
        pkg = COIN_PACKAGES.get(item_id)
        if not pkg:
            return resp_text(400, "UNKNOWN_ITEM")

        coins_to_add = pkg["coins"]

        from psycopg2.extras import RealDictCursor
        conn = get_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # Защита от дублей
        cur.execute(f"SELECT id FROM {SCHEMA}.payments WHERE payment_id=%s", (payment_id,))
        if cur.fetchone():
            cur.close(); conn.close()
            return resp_text(200, "YES")

        cur.execute(
            f"UPDATE {SCHEMA}.players SET coins = coins + %s WHERE id = %s",
            (coins_to_add, player_id)
        )
        cur.execute(
            f"""INSERT INTO {SCHEMA}.payments (player_id, item_id, coins_added, amount, payment_id, order_id)
                VALUES (%s, %s, %s, %s, %s, %s)""",
            (player_id, item_id, coins_to_add, amount, payment_id, order_id)
        )

        conn.commit()
        cur.close()
        conn.close()
        return resp_text(200, "YES")

    return resp_json(404, {"error": "not found"})
