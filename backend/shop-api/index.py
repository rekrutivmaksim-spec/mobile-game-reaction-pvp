"""
Магазин:
- GET  /?action=catalog         — каталог товаров + инвентарь игрока
- POST /?action=buy             — купить товар (body: {item_id})
- POST /?action=equip           — надеть предмет (body: {item_id})
- POST /?action=use             — использовать расходник (body: {effect_key})
- GET  /?action=boosts          — активные бусты игрока
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

BUNDLE_COLD_GRANTS = [
    ("retry",         3),
    ("streak_shield", 2),
    ("league_shield", 1),
]


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def resp(status, body):
    return {
        "statusCode": status,
        "headers": {**CORS, "Content-Type": "application/json"},
        "body": json.dumps(body, ensure_ascii=False, default=str),
    }


def add_to_inventory(cur, player_id, item_id, qty=1):
    cur.execute(
        f"""INSERT INTO {SCHEMA}.inventory (player_id, item_id, quantity)
            VALUES (%s, %s, %s)
            ON CONFLICT (player_id, item_id)
            DO UPDATE SET quantity = {SCHEMA}.inventory.quantity + EXCLUDED.quantity""",
        (player_id, item_id, qty)
    )


def add_boost(cur, player_id, effect_key, charges):
    cur.execute(
        f"""INSERT INTO {SCHEMA}.active_boosts (player_id, effect_key, charges_left)
            VALUES (%s, %s, %s)
            ON CONFLICT (player_id, effect_key)
            DO UPDATE SET charges_left = {SCHEMA}.active_boosts.charges_left + EXCLUDED.charges_left""",
        (player_id, effect_key, charges)
    )


def handler(event: dict, context) -> dict:
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    method = event.get("httpMethod", "GET")
    params = event.get("queryStringParameters") or {}
    headers = event.get("headers") or {}
    player_id = headers.get("X-Player-Id") or params.get("player_id")
    action = params.get("action", "catalog")

    body = {}
    if event.get("body"):
        try:
            body = json.loads(event["body"])
        except Exception:
            pass

    if not player_id:
        return resp(400, {"error": "player_id required"})

    # ── GET /catalog ──
    if action == "catalog" or (method == "GET" and action != "boosts"):
        conn = get_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        cur.execute(f"SELECT * FROM {SCHEMA}.shop_items ORDER BY tab, sort_order")
        items = [dict(r) for r in cur.fetchall()]

        cur.execute(
            f"SELECT item_id, quantity, equipped FROM {SCHEMA}.inventory WHERE player_id=%s",
            (player_id,)
        )
        inv = {r["item_id"]: {"quantity": r["quantity"], "equipped": r["equipped"]} for r in cur.fetchall()}

        cur.execute(
            f"SELECT effect_key, charges_left FROM {SCHEMA}.active_boosts WHERE player_id=%s",
            (player_id,)
        )
        boosts = {r["effect_key"]: r["charges_left"] for r in cur.fetchall()}

        cur.execute(f"SELECT coins FROM {SCHEMA}.players WHERE id=%s", (player_id,))
        prow = cur.fetchone()
        coins = prow["coins"] if prow else 0

        cur.close()
        conn.close()
        return resp(200, {"items": items, "inventory": inv, "boosts": boosts, "coins": coins})

    # ── GET /boosts ──
    if action == "boosts":
        conn = get_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            f"SELECT effect_key, charges_left FROM {SCHEMA}.active_boosts WHERE player_id=%s",
            (player_id,)
        )
        boosts = {r["effect_key"]: r["charges_left"] for r in cur.fetchall()}
        cur.close()
        conn.close()
        return resp(200, {"boosts": boosts})

    # ── POST /buy ──
    if action == "buy":
        item_id = body.get("item_id")
        if not item_id:
            return resp(400, {"error": "item_id required"})

        conn = get_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        cur.execute(f"SELECT * FROM {SCHEMA}.shop_items WHERE id=%s", (item_id,))
        item = cur.fetchone()
        if not item:
            cur.close(); conn.close()
            return resp(404, {"error": "item not found"})

        item = dict(item)
        if item["price_coins"] is None:
            cur.close(); conn.close()
            return resp(400, {"error": "Этот товар покупается за реальные деньги"})

        cur.execute(f"SELECT coins FROM {SCHEMA}.players WHERE id=%s FOR UPDATE", (player_id,))
        prow = cur.fetchone()
        if not prow:
            cur.close(); conn.close()
            return resp(404, {"error": "player not found"})

        if prow["coins"] < item["price_coins"]:
            cur.close(); conn.close()
            return resp(400, {"error": "Недостаточно монет"})

        new_coins = prow["coins"] - item["price_coins"]
        cur.execute(f"UPDATE {SCHEMA}.players SET coins=%s WHERE id=%s", (new_coins, player_id))

        itype = item["item_type"]
        effect_key = item["effect_key"]
        charges = item["effect_value"]

        if item_id == "bundle_cold":
            for ek, qty in BUNDLE_COLD_GRANTS:
                add_to_inventory(cur, player_id, f"{ek}_item", qty)
                add_to_inventory(cur, player_id, item_id, 0)
        elif itype == "consumable":
            add_to_inventory(cur, player_id, item_id, charges)
        elif itype == "activator":
            add_to_inventory(cur, player_id, item_id, 1)
            add_boost(cur, player_id, effect_key, charges)
        elif itype == "permanent":
            add_to_inventory(cur, player_id, item_id, 1)

        conn.commit()
        cur.close()
        conn.close()
        return resp(200, {"ok": True, "coins_left": new_coins})

    # ── POST /equip ──
    if action == "equip":
        item_id = body.get("item_id")
        if not item_id:
            return resp(400, {"error": "item_id required"})

        conn = get_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        cur.execute(f"SELECT * FROM {SCHEMA}.shop_items WHERE id=%s", (item_id,))
        item = cur.fetchone()
        if not item:
            cur.close(); conn.close()
            return resp(404, {"error": "not found"})

        item = dict(item)
        effect_key = item["effect_key"]

        # Снять экипировку с остальных предметов того же эффекта
        cur.execute(
            f"""UPDATE {SCHEMA}.inventory SET equipped=FALSE
                WHERE player_id=%s AND item_id IN (
                    SELECT id FROM {SCHEMA}.shop_items WHERE effect_key=%s
                )""",
            (player_id, effect_key)
        )
        cur.execute(
            f"UPDATE {SCHEMA}.inventory SET equipped=TRUE WHERE player_id=%s AND item_id=%s",
            (player_id, item_id)
        )
        conn.commit()
        cur.close()
        conn.close()
        return resp(200, {"ok": True})

    # ── POST /use ──
    if action == "use":
        effect_key = body.get("effect_key")  # retry / streak_shield / league_shield
        if not effect_key:
            return resp(400, {"error": "effect_key required"})

        conn = get_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # Найти расходник с нужным эффектом
        consumable_ids = [f"{effect_key}_1", f"{effect_key}_3", f"{effect_key}_item", effect_key]
        found_item_id = None
        found_qty = 0

        for cid in consumable_ids:
            cur.execute(
                f"SELECT item_id, quantity FROM {SCHEMA}.inventory WHERE player_id=%s AND item_id=%s AND quantity>0",
                (player_id, cid)
            )
            row = cur.fetchone()
            if row:
                found_item_id = row["item_id"]
                found_qty = row["quantity"]
                break

        # Проверяем также shop_items с таким effect_key
        if not found_item_id:
            cur.execute(
                f"""SELECT i.item_id, i.quantity FROM {SCHEMA}.inventory i
                    JOIN {SCHEMA}.shop_items s ON s.id = i.item_id
                    WHERE i.player_id=%s AND s.effect_key=%s AND s.item_type='consumable' AND i.quantity>0
                    LIMIT 1""",
                (player_id, effect_key)
            )
            row = cur.fetchone()
            if row:
                found_item_id = row["item_id"]
                found_qty = row["quantity"]

        if not found_item_id:
            cur.close(); conn.close()
            return resp(400, {"error": "Нет предмета"})

        new_qty = found_qty - 1
        if new_qty <= 0:
            cur.execute(
                f"DELETE FROM {SCHEMA}.inventory WHERE player_id=%s AND item_id=%s",
                (player_id, found_item_id)
            )
        else:
            cur.execute(
                f"UPDATE {SCHEMA}.inventory SET quantity=%s WHERE player_id=%s AND item_id=%s",
                (new_qty, player_id, found_item_id)
            )

        # Для streak_shield и league_shield — регистрируем в active_boosts
        if effect_key in ("streak_shield", "league_shield"):
            add_boost(cur, player_id, effect_key, 1)

        conn.commit()
        cur.close()
        conn.close()
        return resp(200, {"ok": True, "remaining": new_qty})

    return resp(404, {"error": "not found"})
