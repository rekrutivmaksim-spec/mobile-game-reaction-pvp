"""
Freekassa webhook — приём уведомлений об успешной оплате.
POST / — Freekassa отправляет сюда данные после успешного платежа.
"""
import hashlib
import json
import os

SCHEMA = "t_p67729910_mobile_game_reaction"

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

# Сколько монет выдаётся за каждый пакет (совпадает с item_id в shop_items)
COIN_PACKAGES = {
    "coins_100":  100,
    "coins_300":  300,
    "coins_700":  700,
    "coins_1500": 1500,
}


def get_conn():
    import psycopg2
    return psycopg2.connect(os.environ["DATABASE_URL"])


def resp(status, body_str):
    return {
        "statusCode": status,
        "headers": {**CORS, "Content-Type": "text/plain"},
        "body": body_str,
    }


def verify_sign(merchant_id, amount, secret1, order_id, sign):
    """Проверяем подпись от Freekassa: MD5(merchant_id:amount:secret1:order_id)"""
    raw = f"{merchant_id}:{amount}:{secret1}:{order_id}"
    return hashlib.md5(raw.encode()).hexdigest() == sign


def handler(event: dict, context) -> dict:
    """Webhook от Freekassa: начисляем монеты игроку после оплаты."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    # Freekassa шлёт POST с form-urlencoded или GET-параметрами
    params = event.get("queryStringParameters") or {}
    body_raw = event.get("body") or ""

    # Парсим form-urlencoded из body
    form = {}
    if body_raw:
        for pair in body_raw.split("&"):
            if "=" in pair:
                k, v = pair.split("=", 1)
                from urllib.parse import unquote_plus
                form[unquote_plus(k)] = unquote_plus(v)

    data = {**params, **form}

    merchant_id  = data.get("MERCHANT_ID", "")
    amount       = data.get("AMOUNT", "")
    sign         = data.get("SIGN", "")
    order_id     = data.get("MERCHANT_ORDER_ID", "")  # формат: {player_id}_{item_id}
    payment_id   = data.get("intid", "")

    secret1 = os.environ.get("FREEKASSA_SECRET1", "")

    # Проверка подписи
    if not verify_sign(merchant_id, amount, secret1, order_id, sign):
        return resp(400, "SIGN_ERROR")

    # order_id формат: {player_id}_{item_id}, например: uuid_coins_300
    parts = order_id.split("_", 1)
    if len(parts) != 2:
        return resp(400, "BAD_ORDER_ID")

    player_id, item_id = parts[0], parts[1]
    coins_to_add = COIN_PACKAGES.get(item_id, 0)

    if coins_to_add <= 0:
        return resp(400, "UNKNOWN_ITEM")

    from psycopg2.extras import RealDictCursor
    conn = get_conn()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # Защита от дублей — проверяем, не был ли этот платёж уже обработан
    cur.execute(
        f"SELECT id FROM {SCHEMA}.payments WHERE payment_id=%s",
        (payment_id,)
    )
    if cur.fetchone():
        cur.close(); conn.close()
        return resp(200, "YES")  # Freekassa ждёт "YES" — говорим что всё ок

    # Начисляем монеты
    cur.execute(
        f"UPDATE {SCHEMA}.players SET coins = coins + %s WHERE id = %s",
        (coins_to_add, player_id)
    )

    # Записываем платёж
    cur.execute(
        f"""INSERT INTO {SCHEMA}.payments (player_id, item_id, coins_added, amount, payment_id, order_id)
            VALUES (%s, %s, %s, %s, %s, %s)""",
        (player_id, item_id, coins_to_add, amount, payment_id, order_id)
    )

    conn.commit()
    cur.close()
    conn.close()

    return resp(200, "YES")