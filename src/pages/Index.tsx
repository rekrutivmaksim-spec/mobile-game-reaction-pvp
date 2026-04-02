import { useState, useEffect, useRef, useCallback } from "react";
import Icon from "@/components/ui/icon";
import { getLeague, getProgressToNext, getPressureMessage } from "@/lib/leagues";

const API       = "https://functions.poehali.dev/7000f2b2-907e-4557-90a3-c4e459c83279";
const DUEL_API  = "https://functions.poehali.dev/fd904cf2-ca8c-4cda-9ec3-e5fb219c5102";
const CHALL_API = "https://functions.poehali.dev/741e5a6a-988f-460f-a7a9-c35ed918cb69";
const SHOP_API  = "https://functions.poehali.dev/ec65f2ad-bca4-448e-aadc-868e4837731e";

// ─────────────── TYPES ───────────────
type Screen = "home" | "searching" | "game" | "result" | "leaderboard" | "profile" | "duel-lobby" | "duel-wait" | "challenges" | "shop";
type GamePhase = "wait" | "tension" | "action" | "done";
type ResultType = "win" | "lose" | "false_start";

interface DuelRoom {
  id: string;
  host_id: string;
  guest_id: string | null;
  status: "waiting" | "ready" | "finished" | "expired";
  host_time: number | null;
  guest_time: number | null;
  winner_id: string | null;
}

interface Challenge {
  id: number;
  type: string;
  title: string;
  description: string;
  target: number;
  reward_coins: number;
  progress: number;
  completed: boolean;
}

interface ShopItem {
  id: string;
  tab: "coins" | "help" | "look" | "status";
  title: string;
  description: string;
  icon: string;
  price_coins: number | null;
  price_rub: number | null;
  item_type: "consumable" | "permanent" | "activator";
  effect_key: string;
  effect_value: number;
  badge: string | null;
  sort_order: number;
}

interface Player {
  id: string;
  nickname: string;
  rating: number;
  wins: number;
  losses: number;
  streak: number;
  max_streak: number;
  best_reaction: number | null;
  coins: number;
}

interface MatchResult {
  type: ResultType;
  playerTime: number;
  opponentTime: number;
  ratingChange: number;
  coinsEarned: number;
  newStreak: number;
  streakLost?: number;
  percentBetter?: number;
  rank?: number;
  prevLeagueId?: string;
  newLeagueId?: string;
  pressureMsg?: string;
  nearMiss?: "edge" | "close";
}

interface LeaderboardEntry {
  id: string;
  nickname: string;
  rating: number;
  wins: number;
  rank: number;
  best_reaction: number | null;
}

// ─────────────── BOT LOGIC ───────────────
// isNewbie: true для первых 3 матчей — бот заметно медленнее, шанс выиграть выше
function getBotReactionTime(isNewbie = false): number {
  if (isNewbie) {
    // Бот 280–420 мс, никогда не делает фальстарт
    return 280 + Math.random() * 140;
  }
  const base = 200 + Math.random() * 150;
  return Math.random() < 0.05 ? -1 : base;
}

function getSignalDelay(): number {
  const roll = Math.random();
  if (roll < 0.4) return 1500 + Math.random() * 1000;
  if (roll < 0.8) return 2500 + Math.random() * 1000;
  return 3500 + Math.random() * 1500;
}

const NICKNAMES = ["Зверь", "Железный", "Молния", "Призрак", "Ракета", "Тень", "Коршун", "Тигр", "Волк", "Дракон"];
function randomNick() { return NICKNAMES[Math.floor(Math.random() * NICKNAMES.length)] + Math.floor(Math.random() * 99); }

// ─────────────── ANALYTICS ───────────────
function trackEvent(goal: string, params?: Record<string, string | number | boolean>) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ym = (window as any).ym;
    if (ym) ym(101026698, "reachGoal", goal, params);
  } catch { /* noop */ }
}

// ─────────────── MAIN COMPONENT ───────────────
export default function Index() {
  const [screen, setScreen] = useState<Screen>("home");
  const [phase, setPhase] = useState<GamePhase>("wait");
  const [result, setResult] = useState<MatchResult | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [playerId, setPlayerId] = useState<string>("");

  // League-up overlay
  const [leagueUpVisible, setLeagueUpVisible] = useState(false);
  const [leagueUpName, setLeagueUpName] = useState("");
  const [leagueUpColor, setLeagueUpColor] = useState("#f39c12");
  const [leagueUpIcon, setLeagueUpIcon] = useState("🥇");

  // Tension
  const [fakeFlash, setFakeFlash] = useState(false);
  const [almostGreen, setAlmostGreen] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [screenFlash, setScreenFlash] = useState<"none" | "red" | "green">("none");

  // Leaderboard / profile
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [neighbors, setNeighbors] = useState<LeaderboardEntry[]>([]);
  const [profileData, setProfileData] = useState<{ avg_reaction: number | null; winrate: number; percent_better: number; rank: number; total_players: number } | null>(null);
  const [loadingLB, setLoadingLB] = useState(false);

  // Duel
  const [duelRoom, setDuelRoom] = useState<DuelRoom | null>(null);
  const [duelJoinCode, setDuelJoinCode] = useState("");
  const [duelJoinError, setDuelJoinError] = useState("");
  const [duelCopied, setDuelCopied] = useState(false);
  const duelPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Challenges
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [challengeCoins, setChallengeCoins] = useState(0);

  // Nickname edit
  const [nickEditing, setNickEditing] = useState(false);
  const [nickValue, setNickValue] = useState("");
  const [nickError, setNickError] = useState("");
  const [nickSaving, setNickSaving] = useState(false);

  // Save progress prompt (мягкая регистрация — пока только ник)
  const [savePrompt, setSavePrompt] = useState(false);

  // Challenges timer
  const [challengeTimer, setChallengeTimer] = useState("");

  // Shop
  const [shopItems, setShopItems] = useState<ShopItem[]>([]);
  const [shopInventory, setShopInventory] = useState<Record<string, { quantity: number; equipped: boolean }>>({});
  const [shopBoosts, setShopBoosts] = useState<Record<string, number>>({});
  const [shopTab, setShopTab] = useState<"coins" | "help" | "look" | "status">("help");
  const [shopLoading, setShopLoading] = useState(false);
  const [shopToast, setShopToast] = useState("");
  const [contextOffer, setContextOffer] = useState<{ itemId: string; message: string } | null>(null);

  // Onboarding (первый запуск)
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardStep, setOnboardStep] = useState(0);

  // Streak milestone celebration
  const [streakMilestone, setStreakMilestone] = useState<number | null>(null);

  // Challenge claim animation
  const [claimingChallengeId, setClaimingChallengeId] = useState<number | null>(null);
  const [claimedIds, setClaimedIds] = useState<Set<number>>(new Set());

  const greenTimeRef = useRef<number>(0);
  const gameActiveRef = useRef(false);
  const tensionTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const mainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseRef = useRef<GamePhase>("wait");
  const playerRef = useRef<Player | null>(null);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { playerRef.current = player; }, [player]);

  // ── INIT PLAYER ──
  useEffect(() => {
    const stored = localStorage.getItem("ne_slomaisa_player_id");
    if (stored) {
      setPlayerId(stored);
      fetch(`${API}/?action=profile&player_id=${stored}`)
        .then(r => r.json())
        .then(d => {
          if (d.player) setPlayer(d.player);
          if (d.percent_better !== undefined) {
            setProfileData({
              avg_reaction: d.avg_reaction,
              winrate: d.winrate ?? 0,
              percent_better: d.percent_better,
              rank: d.rank,
              total_players: d.total_players,
            });
          }
        })
        .catch(() => {});
      // Подгрузить задания для бейджа
      fetch(`${CHALL_API}/?action=get&player_id=${stored}`)
        .then(r => r.json())
        .then(d => { if (d.challenges) setChallenges(d.challenges); })
        .catch(() => {});
    } else {
      const nick = randomNick();
      fetch(`${API}/?action=init-player`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: nick }),
      })
        .then(r => r.json())
        .then(d => {
          if (d.player) {
            localStorage.setItem("ne_slomaisa_player_id", d.player.id);
            setPlayerId(d.player.id);
            setPlayer(d.player);
            setShowOnboarding(true);
            setOnboardStep(0);
          }
        })
        .catch(() => {});
    }
  }, []);

  const clearAllTimers = useCallback(() => {
    tensionTimersRef.current.forEach(clearTimeout);
    tensionTimersRef.current = [];
    if (mainTimerRef.current) clearTimeout(mainTimerRef.current);
  }, []);

  // ── TENSION ──
  const runTensionEffects = useCallback((totalDelay: number) => {
    const effects: ReturnType<typeof setTimeout>[] = [];
    if (Math.random() < 0.30) {
      const t = Math.random() * totalDelay * 0.6 + 300;
      effects.push(setTimeout(() => { setFakeFlash(true); setTimeout(() => setFakeFlash(false), 60 + Math.random() * 40); }, t));
    }
    if (Math.random() < 0.20) {
      const t = Math.random() * totalDelay * 0.5 + 500;
      effects.push(setTimeout(() => { setAlmostGreen(true); setTimeout(() => setAlmostGreen(false), 80 + Math.random() * 40); }, t));
    }
    if (Math.random() < 0.20) {
      const t = Math.random() * totalDelay * 0.7 + 400;
      effects.push(setTimeout(() => {
        setShaking(true);
        if (navigator.vibrate) navigator.vibrate([30]);
        setTimeout(() => setShaking(false), 400);
      }, t));
    }
    tensionTimersRef.current = effects;
  }, []);

  // ── CHALLENGES: репортнуть матч ──
  const reportChallenge = useCallback((type: ResultType) => {
    const pid = localStorage.getItem("ne_slomaisa_player_id");
    if (!pid) return;
    fetch(`${CHALL_API}/?action=report`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Player-Id": pid },
      body: JSON.stringify({ result: type }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.challenges) setChallenges(d.challenges);
        if (d.coins_earned > 0) {
          setChallengeCoins(d.coins_earned);
          setTimeout(() => setChallengeCoins(0), 3000);
          if (d.player) setPlayer(d.player);
        }
      });
  }, []);

  // ── SAVE RESULT TO SERVER ──
  const saveResult = useCallback((type: ResultType, reactionTime: number | null, newPlayer: Player) => {
    const pid = localStorage.getItem("ne_slomaisa_player_id");
    if (!pid) return;
    fetch(`${API}/?action=save-result`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Player-Id": pid },
      body: JSON.stringify({ result: type, reaction_time: reactionTime }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.player) setPlayer(d.player);
        setResult(prev => prev ? {
          ...prev,
          percentBetter: d.percent_better,
          rank: d.rank,
        } : prev);
        // Контекстные офферы
        if (d.streak_shield_fired) {
          setShopToast("🛡️ Защита серии сработала!");
          setTimeout(() => setShopToast(""), 3000);
        }
        if (d.league_shield_fired) {
          setShopToast("💎 Щит лиги сохранил твою лигу!");
          setTimeout(() => setShopToast(""), 3000);
        }
      })
      .catch(() => {});
  }, []);

  // ── FINISH MATCH ──
  const finishMatch = useCallback((
    type: ResultType,
    playerMs: number,
    opponentMs: number,
    curPlayer: Player | null,
  ) => {
    clearAllTimers();
    gameActiveRef.current = false;
    setPhase("done");

    const isWin = type === "win";
    const ratingDelta = isWin ? 25 : -15;
    const currentStreak = curPlayer?.streak ?? 0;
    const streakLost = !isWin && currentStreak >= 2 ? currentStreak : undefined;
    const newStreak = isWin ? currentStreak + 1 : 0;
    const streakBonus = newStreak >= 5 ? 2 : 1;
    const coins_earned = (isWin ? 20 : -10) * streakBonus;

    const prevRating = curPlayer?.rating ?? 1000;
    const newRatingVal = Math.max(0, prevRating + ratingDelta);
    const prevLeague = getLeague(prevRating);
    const newLeague = getLeague(newRatingVal);
    const didLeagueUp = newLeague.id !== prevLeague.id && newRatingVal > prevRating;
    const pressureMsg = getPressureMessage(newRatingVal, ratingDelta, isWin);

    // Near Miss
    let nearMiss: "edge" | "close" | undefined;
    if (type !== "false_start" && playerMs > 0 && playerMs < 5000 && opponentMs > 0) {
      const diff = Math.abs(playerMs - opponentMs);
      if (diff < 20) nearMiss = "close";
      else if (diff < 50) nearMiss = "edge";
    }

    const newPlayer: Player = curPlayer ? {
      ...curPlayer,
      rating: newRatingVal,
      wins: curPlayer.wins + (isWin ? 1 : 0),
      losses: curPlayer.losses + (isWin ? 0 : 1),
      streak: newStreak,
      max_streak: Math.max(curPlayer.max_streak, newStreak),
      coins: Math.max(0, curPlayer.coins + coins_earned),
      best_reaction: (playerMs > 0 && playerMs < 5000)
        ? (curPlayer.best_reaction ? Math.min(curPlayer.best_reaction, playerMs) : playerMs)
        : curPlayer.best_reaction,
    } : null;

    if (newPlayer) setPlayer(newPlayer);

    setResult({
      type,
      playerTime: playerMs,
      opponentTime: opponentMs,
      ratingChange: ratingDelta,
      coinsEarned: coins_earned,
      newStreak,
      streakLost,
      prevLeagueId: prevLeague.id,
      newLeagueId: newLeague.id,
      pressureMsg: pressureMsg ?? undefined,
      nearMiss,
    });

    saveResult(type, playerMs > 0 && playerMs < 5000 ? playerMs : null, newPlayer!);
    reportChallenge(type);
    trackEvent("match_result", { result: type, streak: newStreak, rating: newRatingVal, ...(nearMiss ? { near_miss: nearMiss } : {}) });

    // Контекстный оффер — усиленный
    if (type === "false_start") {
      setTimeout(() => setContextOffer({ itemId: "retry_1", message: "Палец дёрнулся раньше. Вернуть попытку?" }), 400);
    } else if (!isWin && streakLost && streakLost >= 3) {
      setTimeout(() => setContextOffer({ itemId: "retry_1", message: `Серия ${streakLost} сгорела. Одна попытка — и она вернётся` }), 400);
    } else if (!isWin && nearMiss === "close") {
      setTimeout(() => setContextOffer({ itemId: "retry_1", message: `${Math.abs(playerMs - opponentMs)}мс — ты был быстрее. Переиграть?` }), 400);
    } else if (!isWin && nearMiss === "edge") {
      setTimeout(() => setContextOffer({ itemId: "retry_1", message: "Ты почти вытянул. Ещё одна попытка?" }), 400);
    }

    const delay = nearMiss ? 500 : 350;
    setTimeout(() => {
      setScreenFlash("none");
      setScreen("result");
      if (didLeagueUp) {
        trackEvent("league_up", { league: newLeague.id, rating: newRatingVal });
        setTimeout(() => {
          setLeagueUpName(newLeague.name);
          setLeagueUpColor(newLeague.color);
          setLeagueUpIcon(newLeague.icon);
          setLeagueUpVisible(true);
          if (navigator.vibrate) navigator.vibrate([100, 80, 200]);
          setTimeout(() => setLeagueUpVisible(false), 3200);
          // Мягкий промпт: ап лиги — хороший момент предложить задать ник
          const nick = playerRef.current?.nickname ?? "";
          const isGenerated = /^(Зверь|Железный|Молния|Призрак|Ракета|Тень|Коршун|Тигр|Волк|Дракон)\d+$/.test(nick);
          if (isGenerated) setTimeout(() => setSavePrompt(true), 3500);
        }, 600);
      }
      // Серия 3+ — тоже предлагаем задать ник
      if (newStreak >= 3) {
        const nick = playerRef.current?.nickname ?? "";
        const isGenerated = /^(Зверь|Железный|Молния|Призрак|Ракета|Тень|Коршун|Тигр|Волк|Дракон)\d+$/.test(nick);
        if (isGenerated) setTimeout(() => setSavePrompt(true), 800);
      }
      // Streak milestones — 3, 5, 10, 15, 20
      if ([3, 5, 10, 15, 20].includes(newStreak)) {
        setTimeout(() => {
          setStreakMilestone(newStreak);
          if (navigator.vibrate) navigator.vibrate([50, 30, 100]);
          setTimeout(() => setStreakMilestone(null), 3500);
        }, 500);
      }
    }, delay);
  }, [clearAllTimers, saveResult, reportChallenge]);

  // ── START MATCH ──
  const startMatch = useCallback(() => {
    trackEvent("match_start");
    setScreen("searching");
    setResult(null);

    setTimeout(() => {
      setScreen("game");
      setPhase("wait");
      phaseRef.current = "wait";
      setFakeFlash(false);
      setAlmostGreen(false);
      setShaking(false);
      setScreenFlash("none");
      gameActiveRef.current = true;

      const totalPlayed = (playerRef.current?.wins ?? 0) + (playerRef.current?.losses ?? 0);
      const isNewbie = totalPlayed < 3;

      const delay = getSignalDelay();
      runTensionEffects(isNewbie ? 0 : delay); // новичкам без фейков в первом матче

      mainTimerRef.current = setTimeout(() => {
        if (!gameActiveRef.current) return;
        greenTimeRef.current = Date.now();
        setPhase("action");
        phaseRef.current = "action";
        setScreenFlash("green");

        const botTime = getBotReactionTime(isNewbie);
        if (botTime === -1) {
          setTimeout(() => {
            if (gameActiveRef.current) finishMatch("win", 999, -1, playerRef.current);
          }, 200);
        } else {
          setTimeout(() => {
            if (gameActiveRef.current) finishMatch("lose", 9999, botTime, playerRef.current);
          }, botTime);
        }
        setTimeout(() => {
          if (gameActiveRef.current) finishMatch("lose", 5000, getBotReactionTime(isNewbie), playerRef.current);
        }, 3000);
      }, delay);
    }, 1200 + Math.random() * 800);
  }, [runTensionEffects, finishMatch]);

  // ── PLAYER TAP ──
  const handleGameTap = useCallback(() => {
    if (!gameActiveRef.current) return;
    const currentPhase = phaseRef.current;

    if (currentPhase === "wait" || currentPhase === "tension") {
      gameActiveRef.current = false;
      clearAllTimers();
      setScreenFlash("red");
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
      setShaking(true);
      setTimeout(() => setShaking(false), 400);
      finishMatch("false_start", -1, 0, playerRef.current);
      return;
    }
    if (currentPhase === "action") {
      const reactionTime = Date.now() - greenTimeRef.current;
      if (reactionTime < 100) return;
      gameActiveRef.current = false;
      clearAllTimers();
      const botTime = 200 + Math.random() * 150;
      finishMatch(reactionTime < botTime ? "win" : "lose", reactionTime, botTime, playerRef.current);
    }
  }, [finishMatch, clearAllTimers]);

  // ── LOAD LEADERBOARD ──
  const loadLeaderboard = useCallback(() => {
    setLoadingLB(true);
    const pid = localStorage.getItem("ne_slomaisa_player_id") || "";
    fetch(`${API}/?action=leaderboard&player_id=${pid}`)
      .then(r => r.json())
      .then(d => {
        setLeaderboard(d.top || []);
        setNeighbors(d.neighbors || []);
      })
      .finally(() => setLoadingLB(false));
  }, []);

  // ── LOAD PROFILE ──
  const loadProfile = useCallback(() => {
    const pid = localStorage.getItem("ne_slomaisa_player_id");
    if (!pid) return;
    fetch(`${API}/?action=profile&player_id=${pid}`)
      .then(r => r.json())
      .then(d => {
        if (d.player) setPlayer(d.player);
        setProfileData({
          avg_reaction: d.avg_reaction,
          winrate: d.winrate,
          percent_better: d.percent_better,
          rank: d.rank,
          total_players: d.total_players,
        });
      });
  }, []);

  useEffect(() => { return () => clearAllTimers(); }, [clearAllTimers]);

  // ── RENAME NICKNAME ──
  const saveNickname = useCallback(() => {
    const pid = localStorage.getItem("ne_slomaisa_player_id");
    if (!pid) return;
    const nick = nickValue.trim();
    if (nick.length < 2 || nick.length > 20) {
      setNickError("От 2 до 20 символов");
      return;
    }
    setNickSaving(true);
    setNickError("");
    fetch(`${API}/?action=rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Player-Id": pid },
      body: JSON.stringify({ nickname: nick }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) { setNickError(d.error); return; }
        if (d.player) { setPlayer(d.player); setNickEditing(false); setSavePrompt(false); }
      })
      .finally(() => setNickSaving(false));
  }, [nickValue]);

  // ── DUEL: создать комнату (хост) ──
  const createDuelRoom = useCallback(() => {
    const pid = localStorage.getItem("ne_slomaisa_player_id");
    if (!pid) return;
    fetch(`${DUEL_API}/?action=create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Player-Id": pid },
    })
      .then(r => r.json())
      .then(d => {
        if (d.room) {
          trackEvent("duel_create");
          setDuelRoom(d.room);
          setScreen("duel-lobby");
          // Поллинг — ждём гостя
          duelPollRef.current = setInterval(() => {
            fetch(`${DUEL_API}/?action=poll&code=${d.room.id}`)
              .then(r => r.json())
              .then(pd => {
                if (pd.room) setDuelRoom(pd.room);
                if (pd.room?.status === "ready" || pd.room?.status === "finished") {
                  if (duelPollRef.current) clearInterval(duelPollRef.current);
                }
              });
          }, 2000);
        }
      });
  }, []);

  // ── DUEL: войти в комнату (гость) ──
  const joinDuelRoom = useCallback((code: string) => {
    const pid = localStorage.getItem("ne_slomaisa_player_id");
    if (!pid) return;
    setDuelJoinError("");
    fetch(`${DUEL_API}/?action=join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Player-Id": pid },
      body: JSON.stringify({ code: code.toUpperCase().trim() }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) { setDuelJoinError(d.error); return; }
        if (d.room) {
          setDuelRoom(d.room);
          setScreen("duel-lobby");
        }
      });
  }, []);



  // ── DUEL: стоп поллинг ──
  const stopDuelPoll = useCallback(() => {
    if (duelPollRef.current) { clearInterval(duelPollRef.current); duelPollRef.current = null; }
  }, []);

  // ── DUEL: шаринг ──
  const shareDuel = useCallback(() => {
    if (!duelRoom || !player) return;
    const url = `${window.location.origin}?duel=${duelRoom.id}`;
    const text = `Я вызываю тебя! Сможешь не сломаться?\n${url}`;
    if (navigator.share) {
      navigator.share({ title: "НЕ СЛОМАЙСЯ", text, url });
    } else {
      navigator.clipboard.writeText(text);
      setDuelCopied(true);
      setTimeout(() => setDuelCopied(false), 2000);
    }
  }, [duelRoom, player]);

  // ── SHOP: загрузить каталог ──
  const loadShop = useCallback(() => {
    const pid = localStorage.getItem("ne_slomaisa_player_id");
    if (!pid) return;
    setShopLoading(true);
    fetch(`${SHOP_API}/?action=catalog&player_id=${pid}`)
      .then(r => r.json())
      .then(d => {
        if (d.items) setShopItems(d.items);
        if (d.inventory) setShopInventory(d.inventory);
        if (d.boosts) setShopBoosts(d.boosts);
        if (d.coins !== undefined && player) setPlayer(p => p ? { ...p, coins: d.coins } : p);
      })
      .finally(() => setShopLoading(false));
  }, [player]);

  // ── SHOP: купить товар ──
  const buyItem = useCallback((itemId: string) => {
    const pid = localStorage.getItem("ne_slomaisa_player_id");
    if (!pid) return;
    fetch(`${SHOP_API}/?action=buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Player-Id": pid },
      body: JSON.stringify({ item_id: itemId }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) { setShopToast(d.error); setTimeout(() => setShopToast(""), 2500); return; }
        if (d.ok) {
          trackEvent("shop_buy", { item_id: itemId });
          setShopToast("Куплено!");
          setTimeout(() => setShopToast(""), 2000);
          setContextOffer(null);
          if (player) setPlayer(p => p ? { ...p, coins: d.coins_left } : p);
          loadShop();
        }
      });
  }, [player, loadShop]);

  // ── SHOP: надеть предмет ──
  const equipItem = useCallback((itemId: string) => {
    const pid = localStorage.getItem("ne_slomaisa_player_id");
    if (!pid) return;
    fetch(`${SHOP_API}/?action=equip`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Player-Id": pid },
      body: JSON.stringify({ item_id: itemId }),
    })
      .then(r => r.json())
      .then(d => { if (d.ok) loadShop(); });
  }, [loadShop]);

  // ── SHOP: использовать расходник (контекстный оффер) ──
  const consumeItem = useCallback((effectKey: string) => {
    const pid = localStorage.getItem("ne_slomaisa_player_id");
    if (!pid) return;
    fetch(`${SHOP_API}/?action=use`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Player-Id": pid },
      body: JSON.stringify({ effect_key: effectKey }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setContextOffer(null);
          loadShop();
        }
      });
  }, [loadShop]);

  // ── CHALLENGES: загрузить ──
  const loadChallenges = useCallback(() => {
    const pid = localStorage.getItem("ne_slomaisa_player_id");
    if (!pid) return;
    fetch(`${CHALL_API}/?action=get&player_id=${pid}`)
      .then(r => r.json())
      .then(d => { if (d.challenges) setChallenges(d.challenges); });
  }, []);



  // Проверяем deep-link при загрузке
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const duelCode = params.get("duel");
    if (duelCode) {
      setDuelJoinCode(duelCode);
      setScreen("duel-wait");
    }
  }, []);

  // Таймер до обновления заданий (до полуночи по МСК = UTC+3)
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const msk = new Date(now.getTime() + (3 * 60 - now.getTimezoneOffset()) * 60000);
      const midnight = new Date(msk);
      midnight.setHours(24, 0, 0, 0);
      const diff = midnight.getTime() - msk.getTime();
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setChallengeTimer(`${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const getBgColor = () => {
    if (screenFlash === "red") return "#c0392b";
    if (screenFlash === "green") return "#00e676";
    if (phase === "action") return "#00e676";
    if (fakeFlash) return "#131313";
    if (almostGreen) return "#0d1a0d";
    return "#0f0f0f";
  };

  const rating = player?.rating ?? 1000;
  const streak = player?.streak ?? 0;
  const coins = player?.coins ?? 150;
  const currentLeague = getLeague(rating);
  const leagueProgress = getProgressToNext(rating);

  // ═══════════════════ SCREENS ═══════════════════

  // ── HOME ──
  if (screen === "home") {
    const totalGames = (player?.wins ?? 0) + (player?.losses ?? 0);
    const hasPlayed = totalGames > 0;
    const btnLabel = hasPlayed ? "ЕЩЁ РАЗ" : "ПРОВЕРЬ СЕБЯ";

    return (
      <div className="relative flex flex-col items-center justify-between h-dvh w-full px-6 py-10 overflow-hidden" style={{ backgroundColor: "#0f0f0f" }}>
        {/* Угловые декоры */}
        {["top-4 left-4 border-l-2 border-t-2", "top-4 right-4 border-r-2 border-t-2", "bottom-4 left-4 border-l-2 border-b-2", "bottom-4 right-4 border-r-2 border-b-2"].map((cls, i) => (
          <div key={i} className={`absolute w-6 h-6 ${cls}`} style={{ borderColor: "rgba(192,57,43,0.35)" }} />
        ))}

        {/* Stats */}
        <div className="w-full flex items-center justify-between animate-fade-in">
          <div className="flex flex-col gap-0.5">
            <span className="font-rubik text-[10px] tracking-widest uppercase" style={{ color: "rgba(255,255,255,0.25)" }}>Рейтинг</span>
            <div className="flex items-center gap-1.5">
              <span className="font-oswald text-2xl font-bold text-white">{rating}</span>
              <span className="text-sm leading-none">{currentLeague.icon}</span>
            </div>
          </div>
          <div className="flex flex-col items-center gap-0.5">
            <span className="font-rubik text-[10px] tracking-widest uppercase" style={{ color: "rgba(255,255,255,0.25)" }}>Серия</span>
            {streak >= 5 ? (
              <span className={`font-oswald text-2xl font-bold animate-streak-fire`} style={{ color: "#ff6b35" }}>🔥 {streak}</span>
            ) : streak > 0 ? (
              <span className="font-oswald text-2xl font-bold" style={{ color: "#f39c12" }}>🔥 {streak}</span>
            ) : (
              <span className="font-rubik text-[10px] text-center leading-tight" style={{ color: "rgba(255,255,255,0.2)", maxWidth: "60px" }}>начни серию</span>
            )}
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <span className="font-rubik text-[10px] tracking-widest uppercase" style={{ color: "rgba(255,255,255,0.25)" }}>Монеты</span>
            <span className="font-oswald text-2xl font-bold" style={{ color: "#f39c12" }}>🪙{coins}</span>
          </div>
        </div>

        {/* Hero */}
        <div className="flex flex-col items-center gap-5 w-full">

          {/* Заголовок */}
          <div className="relative flex flex-col items-center">
            <div className="absolute w-64 h-64 rounded-full blur-3xl pointer-events-none" style={{ backgroundColor: "#c0392b", opacity: 0.08 }} />
            <div className="relative z-10 border px-5 py-1 mb-4" style={{ borderColor: "rgba(192,57,43,0.45)" }}>
              <span className="font-rubik text-[10px] tracking-[0.4em] uppercase" style={{ color: "#c0392b" }}>Не нажми раньше сигнала</span>
            </div>
            <h1 className="relative z-10 font-oswald leading-[0.88] font-bold uppercase" style={{ fontSize: "clamp(3.5rem, 18vw, 5.5rem)", color: "#f5f5f5", letterSpacing: "-0.02em" }}>НЕ</h1>
            <h1 className="relative z-10 font-oswald leading-[0.88] font-bold uppercase" style={{ fontSize: "clamp(3.5rem, 18vw, 5.5rem)", color: "#c0392b", letterSpacing: "-0.02em" }}>СЛОМАЙСЯ</h1>
          </div>

          {/* Вызов + триггер */}
          <div className="flex flex-col items-center gap-1.5">
            <span
              className="font-oswald text-base uppercase tracking-wider text-center"
              style={{ color: "rgba(255,255,255,0.55)", animation: "pulse 3s ease-in-out infinite" }}
            >
              {streak >= 5 ? `${streak} побед подряд. Не сломайся` : "90% игроков ошибаются"}
            </span>
            {/* Персональный триггер — приоритет: %, иначе лига, иначе приветствие */}
            {profileData ? (
              <span className="font-rubik text-xs text-center" style={{ color: "#f39c12" }}>
                ты быстрее {profileData.percent_better}% игроков
              </span>
            ) : leagueProgress.next ? (
              <span className="font-rubik text-xs text-center" style={{ color: "rgba(255,255,255,0.3)" }}>
                до {leagueProgress.next.name}: {leagueProgress.pointsLeft} очков
              </span>
            ) : (
              <span className="font-rubik text-xs text-center" style={{ color: "rgba(255,255,255,0.2)" }}>
                {player?.nickname ?? "Игрок"} · готов к бою?
              </span>
            )}
          </div>

          {/* Серия под угрозой / мотиватор */}
          {streak >= 5 && (
            <div className="w-full max-w-xs border px-4 py-2.5 flex items-center gap-2.5 animate-streak-danger" style={{ borderColor: "rgba(243,156,18,0.4)", backgroundColor: "rgba(243,156,18,0.05)" }}>
              <span className="text-base">⚠️</span>
              <span className="font-rubik text-xs" style={{ color: "#f39c12" }}>
                Серия {streak} на кону. Одна ошибка — и всё сгорит
              </span>
            </div>
          )}
          {streak >= 3 && streak < 5 && (
            <div className="w-full max-w-xs border px-4 py-2.5 flex items-center gap-2.5" style={{ borderColor: "rgba(243,156,18,0.25)", backgroundColor: "rgba(243,156,18,0.03)" }}>
              <span className="text-base">🔥</span>
              <span className="font-rubik text-xs" style={{ color: "rgba(243,156,18,0.7)" }}>
                Серия {streak} — ещё {5 - streak} до x2 наград
              </span>
            </div>
          )}

          {/* Кнопка + давление */}
          <div className="flex flex-col items-center gap-2 w-full max-w-xs">
            <span
              className="font-rubik text-[11px] uppercase tracking-widest"
              style={{ color: "rgba(255,255,255,0.2)", animation: "pulse 2.5s ease-in-out infinite" }}
            >
              {streak >= 3 ? "рискнёшь продолжить?" : "ошибка = поражение"}
            </span>
            <button
              onClick={startMatch}
              className="w-full h-16 font-oswald text-xl font-bold tracking-[0.2em] uppercase transition-all active:scale-95"
              style={{
                backgroundColor: "#c0392b",
                color: "#f5f5f5",
                boxShadow: "0 0 30px rgba(192,57,43,0.4)",
                animation: "pulse 2.5s ease-in-out infinite",
              }}
            >
              {btnLabel}
            </button>
          </div>
        </div>

        {/* Nav */}
        <div className="flex gap-6 items-center">
          {[
            { icon: "Trophy", label: "Топ", action: () => { setScreen("leaderboard"); loadLeaderboard(); } },
            { icon: "Swords", label: "Дуэль", action: () => { setDuelJoinCode(""); setDuelJoinError(""); setScreen("duel-wait"); } },
            { icon: "ShoppingBag", label: "Магазин", action: () => { setScreen("shop"); loadShop(); } },
            { icon: "CalendarCheck", label: "Задания", action: () => { setScreen("challenges"); loadChallenges(); } },
            { icon: "User", label: "Профиль", action: () => { setScreen("profile"); loadProfile(); } },
          ].map(({ icon, label, action }, idx) => {
            const hasBadge = idx === 3 && challenges.some(c => c.completed && !claimedIds.has(c.id));
            return (
              <button key={label} onClick={action} className="relative flex flex-col items-center gap-1.5 transition-opacity active:opacity-60" style={{ opacity: 0.35 }}>
                <Icon name={icon} size={18} style={{ color: "#f5f5f5" }} />
                <span className="font-rubik text-[9px] text-white uppercase tracking-wider">{label}</span>
                {hasBadge && (
                  <div className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#f39c12", boxShadow: "0 0 6px rgba(243,156,18,0.6)" }} />
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── SEARCHING ──
  if (screen === "searching") {
    return (
      <div className="flex flex-col items-center justify-center h-dvh w-full gap-10" style={{ backgroundColor: "#0f0f0f" }}>
        <div className="relative flex items-center justify-center w-24 h-24">
          {[1, 0.65, 0.4].map((scale, i) => (
            <div key={i} className="absolute rounded-full border" style={{ width: `${96 * scale}px`, height: `${96 * scale}px`, borderColor: "rgba(192,57,43,0.4)", animation: `pulse ${1.2 + i * 0.3}s ease-in-out ${i * 0.15}s infinite` }} />
          ))}
          <Icon name="Crosshair" size={30} style={{ color: "#c0392b" }} />
        </div>
        <div className="flex flex-col items-center gap-3">
          <span className="font-oswald text-xl tracking-[0.25em] uppercase" style={{ color: "rgba(255,255,255,0.6)" }}>
            {streak >= 3 ? "Ищем достойного" : "Ищем соперника"}
          </span>
          <div className="flex gap-1.5">
            {[0, 1, 2].map(i => (
              <div key={i} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#c0392b", animation: `pulse 1.2s ease-in-out ${i * 0.25}s infinite` }} />
            ))}
          </div>
          {streak >= 5 && (
            <span className="font-rubik text-xs mt-3" style={{ color: "rgba(243,156,18,0.5)" }}>
              🔥 Серия {streak} на кону
            </span>
          )}
        </div>
      </div>
    );
  }

  // ── GAME ──
  if (screen === "game") {
    const isAction = phase === "action";
    const bgColor = getBgColor();

    return (
      <div
        className={`relative flex flex-col items-center justify-center h-dvh w-full select-none ${shaking ? "animate-shake" : ""}`}
        style={{ backgroundColor: bgColor, transition: isAction ? "background-color 0.07s" : "background-color 0.2s" }}
        onPointerDown={handleGameTap}
      >
        {(fakeFlash || almostGreen) && (
          <div className="absolute inset-0 pointer-events-none" style={{ backgroundColor: "#00e676", opacity: fakeFlash ? 0.07 : 0.12, zIndex: 10 }} />
        )}
        <div className="absolute top-12 inset-x-0 flex justify-center" style={{ color: isAction ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.12)" }}>
          <span className="font-rubik text-[11px] uppercase tracking-widest">{isAction ? "нажимай" : "не трогай экран"}</span>
        </div>
        <div className="flex flex-col items-center">
          {!isAction ? (
            <div className="flex flex-col items-center gap-4">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#c0392b", boxShadow: "0 0 16px rgba(192,57,43,0.9)", animation: "pulse 1s ease-in-out infinite" }} />
              <span className="font-oswald font-bold uppercase leading-none tracking-tight" style={{ fontSize: "clamp(5rem, 25vw, 8rem)", color: "#f5f5f5" }}>ЖДИ</span>
              <span className="font-rubik text-sm" style={{ color: "rgba(255,255,255,0.18)" }}>Не нажми раньше…</span>
            </div>
          ) : (
            <div className="flex flex-col items-center animate-number-pop">
              <span className="font-oswald font-bold uppercase leading-none tracking-tight" style={{ fontSize: "clamp(5rem, 25vw, 8rem)", color: "#0f0f0f" }}>ЖМИ!</span>
            </div>
          )}
        </div>
        {isAction && (
          <div className="absolute bottom-16 inset-x-0 flex justify-center animate-fade-in" style={{ color: "rgba(0,0,0,0.3)" }}>
            <span className="font-rubik text-[11px] uppercase tracking-widest">весь экран — кнопка</span>
          </div>
        )}
        {["top-0 left-0 border-l-2 border-t-2", "top-0 right-0 border-r-2 border-t-2", "bottom-0 left-0 border-l-2 border-b-2", "bottom-0 right-0 border-r-2 border-b-2"].map((cls, i) => (
          <div key={i} className={`absolute w-8 h-8 ${cls}`} style={{ borderColor: isAction ? "rgba(0,0,0,0.15)" : "rgba(192,57,43,0.25)" }} />
        ))}
      </div>
    );
  }

  // ── RESULT ──
  if (screen === "result" && result) {
    const isWin = result.type === "win";
    const isFalseStart = result.type === "false_start";
    const accentColor = isWin ? "#00e676" : "#c0392b";
    const nearMissText = result.nearMiss === "close"
      ? `${Math.abs(result.playerTime - result.opponentTime)} мс… ты был очень близко`
      : result.nearMiss === "edge"
      ? "Почти… разница минимальная"
      : null;
    const titleText = isFalseStart ? "ТЫ СЛОМАЛСЯ"
      : result.nearMiss === "close" ? (isWin ? "НА ВОЛОСКЕ!" : "ПОЧТИ…")
      : isWin ? "ТЫ ВЫДЕРЖАЛ" : "ТЫ СЛОМАЛСЯ";
    const subtitleText = isFalseStart ? "Слишком рано"
      : isWin ? `быстрее соперника на ${Math.round(result.opponentTime - result.playerTime)}мс`
      : result.nearMiss ? `${Math.abs(Math.round(result.playerTime - result.opponentTime))} мс... ты был очень близко` : "Он был быстрее��";

    return (
      <div className="relative flex flex-col items-center justify-between h-dvh w-full px-6 py-12 overflow-hidden" style={{ backgroundColor: "#0f0f0f" }}>
        <div className="absolute top-[-60px] left-1/2 -translate-x-1/2 w-72 h-72 rounded-full blur-3xl pointer-events-none" style={{ backgroundColor: accentColor, opacity: 0.08 }} />
        <div />
        <div className="flex flex-col items-center gap-5 animate-result-in w-full">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: accentColor, boxShadow: `0 0 20px ${accentColor}` }} />
          <div className="flex flex-col items-center gap-2">
            <span className={`font-oswald font-bold uppercase text-center leading-none ${isWin ? "animate-win-glow" : "animate-lose-glow"}`} style={{ fontSize: "clamp(2.5rem, 12vw, 4rem)", color: accentColor }}>
              {titleText}
            </span>
            <span className="font-rubik text-sm text-center" style={{ color: "rgba(255,255,255,0.3)" }}>{subtitleText}</span>
          </div>

          {/* Near Miss */}
          {nearMissText && (
            <div className="w-full border px-4 py-2.5 flex items-center gap-2.5 animate-result-in" style={{ borderColor: "rgba(255,255,255,0.2)", backgroundColor: "rgba(255,255,255,0.04)" }}>
              <span className="text-base">🪙</span>
              <span className="font-oswald text-sm tracking-wider uppercase" style={{ color: "#f5f5f5" }}>{nearMissText}</span>
            </div>
          )}

          {/* Percent better */}
          {result.percentBetter !== undefined && (
            <div className="border px-5 py-2" style={{ borderColor: "rgba(255,255,255,0.1)", backgroundColor: "rgba(255,255,255,0.03)" }}>
              <span className="font-oswald text-lg font-bold" style={{ color: "#f39c12" }}>
                БЫСТРЕЕ {result.percentBetter}% ИГРОКОВ
              </span>
            </div>
          )}

          {/* Time comparison */}
          {!isFalseStart && (
            <div className="w-full flex border" style={{ borderColor: "rgba(255,255,255,0.07)", backgroundColor: "rgba(255,255,255,0.02)" }}>
              <div className="flex-1 flex flex-col items-center gap-1 py-4">
                <span className="font-rubik text-[10px] uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.25)" }}>Ты</span>
                <span className="font-oswald text-3xl font-bold" style={{ color: isWin ? "#00e676" : "#c0392b" }}>
                  {result.playerTime === 9999 ? "—" : result.playerTime}
                </span>
                <span className="font-rubik text-[10px]" style={{ color: "rgba(255,255,255,0.2)" }}>мс</span>
              </div>
              <div className="w-px" style={{ backgroundColor: "rgba(255,255,255,0.07)" }} />
              <div className="flex-1 flex flex-col items-center gap-1 py-4">
                <span className="font-rubik text-[10px] uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.25)" }}>Соперник</span>
                <span className="font-oswald text-3xl font-bold" style={{ color: isWin ? "#c0392b" : "#00e676" }}>
                  {result.opponentTime === -1 ? "ФС" : Math.round(result.opponentTime)}
                </span>
                <span className="font-rubik text-[10px]" style={{ color: "rgba(255,255,255,0.2)" }}>мс</span>
              </div>
            </div>
          )}

          {/* Stats */}
          <div className="flex gap-6 items-center">
            <div className="flex flex-col items-center gap-1">
              <span className="font-oswald text-xl font-bold" style={{ color: result.ratingChange > 0 ? "#00e676" : "#c0392b" }}>
                {result.ratingChange > 0 ? "+" : ""}{result.ratingChange}
              </span>
              <span className="font-rubik text-[10px] tracking-widest uppercase" style={{ color: "rgba(255,255,255,0.2)" }}>рейтинга</span>
            </div>
            <div className="w-px h-8" style={{ backgroundColor: "rgba(255,255,255,0.07)" }} />
            <div className="flex flex-col items-center gap-1">
              <span className="font-oswald text-xl font-bold" style={{ color: result.coinsEarned >= 0 ? "#f39c12" : "#e74c3c" }}>{result.coinsEarned > 0 ? "+" : ""}{result.coinsEarned}🪙</span>
              <span className="font-rubik text-[10px] tracking-widest uppercase" style={{ color: "rgba(255,255,255,0.2)" }}>монет</span>
            </div>
            {result.newStreak > 0 && (
              <>
                <div className="w-px h-8" style={{ backgroundColor: "rgba(255,255,255,0.07)" }} />
                <div className="flex flex-col items-center gap-1">
                  <span className="font-oswald text-xl font-bold" style={{ color: "#f39c12" }}>🔥{result.newStreak}</span>
                  <span className="font-rubik text-[10px] tracking-widest uppercase" style={{ color: "rgba(255,255,255,0.2)" }}>серия</span>
                </div>
              </>
            )}
          </div>
          {result.newStreak >= 5 && (
            <div className="px-4 py-1.5 border font-oswald text-xs tracking-widest uppercase" style={{ borderColor: "#f39c12", color: "#f39c12" }}>
              x2 НАГРАДА · СЕРИЯ {result.newStreak}
            </div>
          )}

          {/* Боль потери серии — усиленная */}
          {result.streakLost && result.streakLost >= 5 && (
            <div className="w-full border px-4 py-4 flex flex-col gap-2 animate-result-in" style={{ borderColor: "rgba(192,57,43,0.6)", backgroundColor: "rgba(192,57,43,0.1)" }}>
              <div className="flex items-center gap-2.5">
                <span className="text-2xl">💀</span>
                <span className="font-oswald text-lg font-bold uppercase" style={{ color: "#c0392b" }}>
                  Серия прервана
                </span>
              </div>
              <span className="font-rubik text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
                x2 награды сгорели. Ты был в шаге от серии {result.streakLost + 1}
              </span>
            </div>
          )}
          {result.streakLost && result.streakLost >= 2 && result.streakLost < 5 && (
            <div className="w-full border px-4 py-3 flex items-center gap-2.5 animate-result-in" style={{ borderColor: "rgba(192,57,43,0.4)", backgroundColor: "rgba(192,57,43,0.06)" }}>
              <span className="text-base">💔</span>
              <div className="flex flex-col gap-0.5">
                <span className="font-oswald text-sm font-bold uppercase" style={{ color: "#c0392b" }}>
                  Серия {result.streakLost} прервана
                </span>
                <span className="font-rubik text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                  До x2 наград оставалось {5 - result.streakLost} {5 - result.streakLost === 1 ? "победа" : "победы"}
                </span>
              </div>
            </div>
          )}

          {/* Прогресс до следующей лиги */}
          {leagueProgress.next && !result.pressureMsg && (
            <div className="w-full border px-4 py-2.5 flex items-center gap-2.5" style={{ borderColor: "rgba(255,255,255,0.1)", backgroundColor: "rgba(255,255,255,0.03)" }}>
              <span className="text-sm">{leagueProgress.next.icon}</span>
              <span className="font-rubik text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>
                До {leagueProgress.next.name}: {leagueProgress.pointsLeft}
              </span>
            </div>
          )}

          {/* League changed */}
          {result.newLeagueId && result.prevLeagueId && result.newLeagueId !== result.prevLeagueId && (() => {
            const nl = getLeague(player?.rating ?? 1000);
            return (
              <div className="w-full border p-3 flex items-center gap-3" style={{ borderColor: nl.color, backgroundColor: `${nl.glowColor.replace("0.4", "0.08")}` }}>
                <span className="text-2xl">{nl.icon}</span>
                <div className="flex flex-col gap-0.5">
                  <span className="font-oswald text-sm font-bold uppercase" style={{ color: nl.color }}>Ты поднялся в {nl.name}!</span>
                  <span className="font-rubik text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>Новая лига разблокирована</span>
                </div>
              </div>
            );
          })()}

          {/* Pressure message */}
          {result.pressureMsg && (
            <div className="w-full border px-4 py-2.5 flex items-center gap-2.5" style={{
              borderColor: result.pressureMsg.includes("вылететь") ? "rgba(192,57,43,0.5)" : "rgba(243,156,18,0.5)",
              backgroundColor: result.pressureMsg.includes("вылететь") ? "rgba(192,57,43,0.06)" : "rgba(243,156,18,0.06)",
              animation: result.pressureMsg.includes("вылететь") ? "streak-danger 1.5s ease-in-out infinite" : "none",
            }}>
              <span className="text-base">{result.pressureMsg.includes("вылететь") ? "⚠️" : "🎯"}</span>
              <span className="font-rubik text-sm font-medium" style={{ color: result.pressureMsg.includes("вылететь") ? "#c0392b" : "#f39c12" }}>
                {result.pressureMsg}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 w-full">
          <button onClick={startMatch} className="w-full h-14 font-oswald text-lg font-bold tracking-[0.2em] uppercase transition-all active:scale-95" style={{ backgroundColor: accentColor, color: isWin ? "#0f0f0f" : "#f5f5f5" }}>
            ЕЩЁ РАЗ
          </button>
          {isWin && (
            <button
              className="w-full h-12 font-oswald text-sm font-bold tracking-[0.15em] uppercase transition-all active:scale-95 flex items-center justify-center gap-2"
              style={{ backgroundColor: "#f39c12", color: "#0f0f0f" }}
              onClick={() => {
                trackEvent("double_reward_click");
                // TODO: реклама → удвоение
              }}
            >
              УДВОИТЬ НАГРАДУ
            </button>
          )}
          {!isWin && (
            <button
              className="w-full h-12 font-oswald text-sm tracking-[0.15em] uppercase transition-all active:scale-95 flex items-center justify-center gap-2"
              style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "#f5f5f5", border: "1px solid rgba(255,255,255,0.15)" }}
              onClick={() => {
                trackEvent("fix_mistake_click");
                const hasRetry = shopInventory["retry_1"]?.quantity > 0 || shopInventory["retry_3"]?.quantity > 0;
                if (hasRetry) {
                  consumeItem("retry");
                  startMatch();
                } else if (coins >= 10) {
                  buyItem("retry_1");
                  startMatch();
                } else {
                  setShopToast("Не хватает монет");
                  setTimeout(() => setShopToast(""), 2500);
                }
              }}
            >
              ИСПРАВИТЬ ОШИБКУ — 10 монет
            </button>
          )}
          <button
            onClick={createDuelRoom}
            className="w-full h-12 font-oswald text-sm tracking-[0.15em] uppercase transition-all active:scale-95 flex items-center justify-center gap-2"
            style={{ backgroundColor: "transparent", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.15)" }}
          >
            <Icon name="Swords" size={14} />
            ВЫЗВАТЬ ДРУГА
          </button>
          <button onClick={() => setScreen("home")} className="w-full h-10 font-oswald text-xs tracking-[0.15em] uppercase transition-all active:scale-95" style={{ backgroundColor: "transparent", color: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.05)" }}>
            ГЛАВНЫЙ ЭКРАН
          </button>
        </div>
      </div>
    );
  }

  // ── LEADERBOARD ──
  if (screen === "leaderboard") {
    // Цель: найти ближайшего выше в топе
    const myLbEntry = leaderboard.find(e => e.id === playerId);
    const myRank = myLbEntry?.rank ?? null;
    const aboveEntry = myRank && myRank > 1 ? leaderboard.find(e => e.rank === myRank - 1) : null;
    const winsToOvertake = aboveEntry ? Math.ceil((aboveEntry.rating - rating + 1) / 25) : null;

    return (
      <div className="flex flex-col h-dvh w-full overflow-hidden" style={{ backgroundColor: "#0f0f0f" }}>
        {/* Header */}
        <div className="flex items-center gap-4 px-6 pt-10 pb-4">
          <button onClick={() => setScreen("home")} className="active:opacity-60 transition-opacity">
            <Icon name="ArrowLeft" size={20} style={{ color: "rgba(255,255,255,0.5)" }} />
          </button>
          <h2 className="font-oswald text-2xl font-bold uppercase tracking-wider text-white flex-1">Лучшие игроки</h2>
          {myRank && <span className="font-oswald text-sm font-bold" style={{ color: "rgba(255,255,255,0.3)" }}>Ты на месте #{myRank}</span>}
        </div>

        {/* Цель — обогнать следующего */}
        {aboveEntry && winsToOvertake !== null && (
          <div className="mx-6 mb-3 border px-4 py-2.5 flex items-center gap-2.5" style={{ borderColor: "rgba(243,156,18,0.3)", backgroundColor: "rgba(243,156,18,0.05)" }}>
            <span className="text-sm">🎯</span>
            <span className="font-rubik text-sm flex-1" style={{ color: "#f39c12" }}>
              До #{myRank! - 1} — {winsToOvertake === 1 ? "1 победа" : `${winsToOvertake} победы`}
            </span>
            <span className="font-oswald text-sm font-bold" style={{ color: "rgba(255,255,255,0.3)" }}>#{myRank - 1}</span>
          </div>
        )}

        {/* My position block */}
        {player && neighbors.length > 0 && (
          <div className="mx-6 mb-3 border p-4" style={{ borderColor: "rgba(192,57,43,0.3)", backgroundColor: "rgba(192,57,43,0.05)" }}>
            <span className="font-rubik text-[10px] uppercase tracking-widest mb-2 block" style={{ color: "rgba(255,255,255,0.3)" }}>Рядом с тобой</span>
            {neighbors.map((n) => (
              <div key={n.id} className="flex items-center gap-3 py-1.5">
                <span className="font-oswald text-sm w-8 text-right" style={{ color: n.id === playerId ? "#c0392b" : "rgba(255,255,255,0.3)" }}>#{n.rank}</span>
                <span className="font-rubik text-sm flex-1" style={{ color: n.id === playerId ? "#f5f5f5" : "rgba(255,255,255,0.45)", fontWeight: n.id === playerId ? 500 : 400 }}>
                  {n.nickname}{n.id === playerId ? " ← ты" : ""}
                </span>
                <span className="font-oswald text-sm font-bold" style={{ color: n.id === playerId ? "#c0392b" : "rgba(255,255,255,0.4)" }}>{n.rating}</span>
              </div>
            ))}
          </div>
        )}

        {/* Top list */}
        <div className="flex-1 overflow-y-auto px-6 pb-8">
          {loadingLB ? (
            <div className="flex justify-center pt-8">
              <span className="font-rubik text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>Загрузка…</span>
            </div>
          ) : leaderboard.length === 0 ? (
            <div className="flex flex-col items-center pt-12 gap-3">
              <Icon name="Trophy" size={32} style={{ color: "rgba(255,255,255,0.1)" }} />
              <span className="font-rubik text-sm text-center" style={{ color: "rgba(255,255,255,0.25)" }}>
                Сыграй первый матч —<br />и попади в таблицу
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-0">
              {leaderboard.map((entry, idx) => {
                const isMe = entry.id === playerId;
                const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : null;
                const entryLeague = getLeague(entry.rating);
                return (
                  <div
                    key={entry.id}
                    className="flex items-center gap-3 py-3"
                    style={{
                      borderBottom: "1px solid rgba(255,255,255,0.04)",
                      backgroundColor: isMe ? "rgba(192,57,43,0.08)" : "transparent",
                      boxShadow: isMe ? "inset 0 0 0 1px rgba(192,57,43,0.2)" : "none",
                    }}
                  >
                    <span className="font-oswald text-sm w-8 text-right" style={{ color: isMe ? "#c0392b" : "rgba(255,255,255,0.25)" }}>
                      {medal || `#${entry.rank}`}
                    </span>
                    <span className="font-rubik text-sm flex-1" style={{ color: isMe ? "#f5f5f5" : "rgba(255,255,255,0.55)", fontWeight: isMe ? 600 : 400 }}>
                      {entry.nickname}{isMe ? " 👈" : ""}
                    </span>
                    <span className="text-sm">{entryLeague.icon}</span>
                    <span className="font-oswald text-base font-bold" style={{ color: isMe ? "#c0392b" : entryLeague.color }}>{entry.rating}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── PROFILE ──
  if (screen === "profile") {
    const totalGames = (player?.wins ?? 0) + (player?.losses ?? 0);
    const profLeague = getLeague(rating);
    const profProgress = getProgressToNext(rating);
    const winrate = totalGames > 0 ? Math.round(((player?.wins ?? 0) / totalGames) * 100) : 0;
    const pctBetter = profileData?.percent_better ?? null;
    return (
      <div className="flex flex-col h-dvh w-full overflow-hidden" style={{ backgroundColor: "#0f0f0f" }}>
        <div className="flex items-center gap-4 px-6 pt-10 pb-4">
          <button onClick={() => setScreen("home")} className="active:opacity-60 transition-opacity">
            <Icon name="ArrowLeft" size={20} style={{ color: "rgba(255,255,255,0.5)" }} />
          </button>
          <h2 className="font-oswald text-2xl font-bold uppercase tracking-wider text-white flex-1">Профиль</h2>
        </div>

        <div className="flex-1 px-6 flex flex-col gap-3 overflow-y-auto pb-8">

          {/* Hero-карточка: Лига + ELO + ник */}
          <div className="border p-5 flex flex-col gap-3" style={{ borderColor: profLeague.color + "50", backgroundColor: "rgba(255,255,255,0.02)" }}>
            {/* Лига — главный акцент */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-3xl leading-none">{profLeague.icon}</span>
                <span
                  className="font-oswald text-3xl font-bold uppercase"
                  style={{ color: profLeague.color, textShadow: `0 0 20px ${profLeague.glowColor}` }}
                >
                  {profLeague.name.toUpperCase()}
                </span>
              </div>
              <div className="flex flex-col items-end">
                <span className="font-oswald text-2xl font-bold" style={{ color: "#f5f5f5" }}>{rating}</span>
                <span className="font-rubik text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>ELO</span>
              </div>
            </div>

            {/* Прогресс до следующей лиги */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between">
                <span className="font-rubik text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>{profLeague.name} {profLeague.minRating}</span>
                {profProgress.next && (
                  <span className="font-rubik text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>
                    до {profProgress.next.name} · {profProgress.pointsLeft}
                  </span>
                )}
              </div>
              <div className="relative w-full h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "rgba(255,255,255,0.07)" }}>
                <div className="absolute left-0 top-0 h-full rounded-full" style={{ width: `${profProgress.pct}%`, backgroundColor: profLeague.color, boxShadow: `0 0 8px ${profLeague.glowColor}` }} />
              </div>
            </div>

            {/* % игроков */}
            {pctBetter !== null && (
              <div className="border px-4 py-2.5 flex items-center justify-center" style={{ borderColor: "rgba(243,156,18,0.3)", backgroundColor: "rgba(243,156,18,0.06)" }}>
                <span className="font-oswald text-lg font-bold uppercase tracking-wider" style={{ color: "#f39c12" }}>
                  🔥 быстрее {pctBetter}% игроков
                </span>
              </div>
            )}

            {/* Ник + редактирование */}
            <div className="flex items-center justify-between pt-1" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              {nickEditing ? (
                <div className="flex flex-col gap-2 flex-1">
                  <input
                    autoFocus value={nickValue} onChange={e => setNickValue(e.target.value)} maxLength={20}
                    className="w-full h-10 px-3 font-oswald text-xl outline-none"
                    style={{ backgroundColor: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.2)", color: "#f5f5f5" }}
                    onKeyDown={e => { if (e.key === "Enter") saveNickname(); if (e.key === "Escape") setNickEditing(false); }}
                  />
                  {nickError && <span className="font-rubik text-xs" style={{ color: "#c0392b" }}>{nickError}</span>}
                  <div className="flex gap-2">
                    <button onClick={saveNickname} disabled={nickSaving} className="flex-1 h-8 font-oswald text-xs font-bold uppercase tracking-wider" style={{ backgroundColor: "#c0392b", color: "#f5f5f5" }}>
                      {nickSaving ? "…" : "Сохранить"}
                    </button>
                    <button onClick={() => { setNickEditing(false); setNickError(""); }} className="h-8 px-3 font-oswald text-xs uppercase" style={{ backgroundColor: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.1)" }}>
                      Отмена
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => { setNickValue(player?.nickname ?? ""); setNickEditing(true); setNickError(""); }} className="flex items-center gap-2">
                  <span className="font-oswald text-xl font-bold text-white">{player?.nickname ?? "—"}</span>
                  <Icon name="Pencil" size={13} style={{ color: "rgba(255,255,255,0.2)" }} />
                </button>
              )}
              {!nickEditing && (
                <span className="font-rubik text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>{totalGames} матчей</span>
              )}
            </div>
          </div>

          {/* Победы / Поражения / Матчи — без убивающего винрейта */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Победы", value: player?.wins ?? 0, color: "#00e676" },
              { label: "Поражения", value: player?.losses ?? 0, color: "#c0392b" },
              { label: "Матчей", value: totalGames, color: "#f5f5f5" },
            ].map(({ label, value, color }) => (
              <div key={label} className="border p-3 flex flex-col gap-0.5" style={{ borderColor: "rgba(255,255,255,0.07)", backgroundColor: "rgba(255,255,255,0.02)" }}>
                <span className="font-rubik text-[9px] uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.25)" }}>{label}</span>
                <span className="font-oswald text-2xl font-bold" style={{ color }}>{value}</span>
              </div>
            ))}
          </div>

          {/* Рост — вместо винрейта */}
          <div className="border p-4 flex items-center justify-between" style={{ borderColor: "rgba(255,255,255,0.07)", backgroundColor: "rgba(255,255,255,0.02)" }}>
            <div className="flex flex-col gap-0.5">
              <span className="font-rubik text-[10px] uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.25)" }}>Форма</span>
              <span className="font-oswald text-base font-bold" style={{ color: winrate >= 50 ? "#00e676" : winrate >= 30 ? "#f39c12" : "rgba(255,255,255,0.4)" }}>
                {winrate >= 60 ? "🔥 Машина" : winrate >= 50 ? "✊ В ударе" : winrate >= 30 ? "📈 Набирает обороты" : "💪 Разогревается"}
              </span>
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <span className="font-rubik text-[10px] uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.25)" }}>Лучший стрик</span>
              <span className="font-oswald text-2xl font-bold" style={{ color: "#f39c12" }}>{player?.max_streak || "—"}</span>
            </div>
          </div>

          {/* Реакция */}
          <div className="border p-4 flex flex-col gap-3" style={{ borderColor: "rgba(255,255,255,0.07)", backgroundColor: "rgba(255,255,255,0.02)" }}>
            <span className="font-rubik text-[10px] uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.25)" }}>Реакция</span>
            <div className="flex gap-6">
              <div className="flex flex-col gap-0.5">
                <span className="font-oswald text-2xl font-bold" style={{ color: "#00e676" }}>{player?.best_reaction ? `${player.best_reaction}мс` : "—"}</span>
                <span className="font-rubik text-[10px]" style={{ color: "rgba(255,255,255,0.2)" }}>Лучшая реакция</span>
              </div>
              <div className="w-px" style={{ backgroundColor: "rgba(255,255,255,0.07)" }} />
              <div className="flex flex-col gap-0.5">
                <span className="font-oswald text-2xl font-bold" style={{ color: "rgba(255,255,255,0.6)" }}>{profileData?.avg_reaction ? `${profileData.avg_reaction}мс` : "—"}</span>
                <span className="font-rubik text-[10px]" style={{ color: "rgba(255,255,255,0.2)" }}>Средняя реакция</span>
              </div>
            </div>
          </div>

          {/* CTA: улучшить реакцию */}
          <button
            onClick={() => { setScreen("home"); startMatch(); }}
            className="w-full h-12 font-oswald text-base font-bold tracking-[0.2em] uppercase transition-all active:scale-95 flex items-center justify-center gap-2"
            style={{ backgroundColor: "rgba(192,57,43,0.15)", color: "#c0392b", border: "1px solid rgba(192,57,43,0.3)" }}
          >
            <Icon name="Zap" size={16} />
            УЛУЧШИТЬ РЕАКЦИЮ
          </button>
        </div>
      </div>
    );
  }

  // ── DUEL WAIT (ввод кода) ──
  if (screen === "duel-wait") {
    return (
      <div className="flex flex-col h-dvh w-full px-6 py-10 overflow-hidden" style={{ backgroundColor: "#0f0f0f" }}>
        <div className="flex items-center gap-4 pb-6">
          <button onClick={() => setScreen("home")} className="active:opacity-60 transition-opacity">
            <Icon name="ArrowLeft" size={20} style={{ color: "rgba(255,255,255,0.5)" }} />
          </button>
          <h2 className="font-oswald text-2xl font-bold uppercase tracking-wider text-white">Дуэль</h2>
        </div>

        {/* Главный слоган — провокация */}
        <div className="flex flex-col items-center gap-2 pb-6">
          <span className="font-oswald text-2xl font-bold uppercase text-center" style={{ color: "#c0392b" }}>
            КТО СЛОМАЕТСЯ ПЕРВЫМ?
          </span>
          <span className="font-rubik text-xs text-center" style={{ color: "rgba(255,255,255,0.25)" }}>
            Проверь, кто выдержит давление
          </span>
        </div>

        <div className="flex flex-col gap-6 flex-1 justify-center">
          {/* Создать комнату */}
          <div className="border p-5 flex flex-col gap-4" style={{ borderColor: "rgba(192,57,43,0.35)", backgroundColor: "rgba(192,57,43,0.05)" }}>
            <div className="flex flex-col gap-1">
              <span className="font-oswald text-lg font-bold uppercase text-white">Бросить вызов</span>
              <span className="font-rubik text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>Скинь другу ссылку. Пусть докажет, что он не медленный</span>
            </div>
            <button
              onClick={createDuelRoom}
              className="w-full h-12 font-oswald text-base font-bold tracking-[0.15em] uppercase transition-all active:scale-95 flex items-center justify-center gap-2"
              style={{ backgroundColor: "#c0392b", color: "#f5f5f5" }}
            >
              <Icon name="Swords" size={16} />
              ВЫЗВАТЬ ДРУГА
            </button>
          </div>

          {/* Войти по коду */}
          <div className="border p-5 flex flex-col gap-4" style={{ borderColor: "rgba(255,255,255,0.08)", backgroundColor: "rgba(255,255,255,0.02)" }}>
            <div className="flex flex-col gap-1">
              <span className="font-oswald text-lg font-bold uppercase text-white">Принять вызов</span>
              <span className="font-rubik text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>Введи код из ссылки друга</span>
            </div>
            <input
              type="text"
              value={duelJoinCode}
              onChange={e => setDuelJoinCode(e.target.value.toUpperCase())}
              placeholder="XXXXXX"
              maxLength={6}
              className="w-full h-12 px-4 font-oswald text-xl text-center tracking-[0.4em] outline-none"
              style={{ backgroundColor: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "#f5f5f5" }}
            />
            {duelJoinError && (
              <span className="font-rubik text-sm text-center" style={{ color: "#c0392b" }}>{duelJoinError}</span>
            )}
            <button
              onClick={() => joinDuelRoom(duelJoinCode)}
              disabled={duelJoinCode.length < 4}
              className="w-full h-12 font-oswald text-base font-bold tracking-[0.15em] uppercase transition-all active:scale-95"
              style={{ backgroundColor: duelJoinCode.length >= 4 ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.04)", color: duelJoinCode.length >= 4 ? "#f5f5f5" : "rgba(255,255,255,0.25)", border: "1px solid rgba(255,255,255,0.1)" }}
            >
              ВОЙТИ
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── DUEL LOBBY (комната создана / ожидание) ──
  if (screen === "duel-lobby" && duelRoom) {
    const isReady = duelRoom.status === "ready";
    const isFinished = duelRoom.status === "finished";

    return (
      <div className="flex flex-col items-center justify-between h-dvh w-full px-6 py-12 overflow-hidden" style={{ backgroundColor: "#0f0f0f" }}>
        <button onClick={() => { stopDuelPoll(); setScreen("home"); }} className="self-start active:opacity-60">
          <Icon name="ArrowLeft" size={20} style={{ color: "rgba(255,255,255,0.5)" }} />
        </button>

        <div className="flex flex-col items-center gap-6 w-full">
          {/* Код комнаты */}
          <div className="flex flex-col items-center gap-2">
            <span className="font-rubik text-[10px] uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.3)" }}>Код дуэли</span>
            <span className="font-oswald text-5xl font-bold tracking-[0.3em]" style={{ color: "#c0392b" }}>{duelRoom.id}</span>
          </div>

          {/* Статус */}
          {!isReady && !isFinished && (
            <div className="flex flex-col items-center gap-4">
              <div className="flex gap-1.5">
                {[0, 1, 2].map(i => (
                  <div key={i} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#c0392b", animation: `pulse 1.2s ease-in-out ${i * 0.25}s infinite` }} />
                ))}
              </div>
              <span className="font-rubik text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>Ждём соперника…</span>
              <span className="font-rubik text-xs text-center" style={{ color: "rgba(255,255,255,0.15)" }}>
                Может он уже боится?
              </span>
            </div>
          )}

          {isReady && (
            <div className="flex flex-col items-center gap-3">
              <div className="border px-6 py-3 flex items-center gap-2" style={{ borderColor: "#00e676", backgroundColor: "rgba(0,230,118,0.06)" }}>
                <span className="text-base">✅</span>
                <span className="font-oswald text-base font-bold uppercase" style={{ color: "#00e676" }}>Соперник на месте</span>
              </div>
              <span className="font-rubik text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
                Сейчас узнаем кто из вас быстрее на самом деле
              </span>
            </div>
          )}

          {/* Шаринг */}
          <div className="w-full flex flex-col gap-3">
            <button
              onClick={shareDuel}
              className="w-full h-12 font-oswald text-sm tracking-[0.15em] uppercase transition-all active:scale-95 flex items-center justify-center gap-2"
              style={{ backgroundColor: "rgba(255,255,255,0.07)", color: "#f5f5f5", border: "1px solid rgba(255,255,255,0.12)" }}
            >
              <Icon name="Share2" size={14} />
              {duelCopied ? "СКОПИРОВАНО!" : "ПОДЕЛИТЬСЯ ССЫЛКОЙ"}
            </button>
          </div>
        </div>

        {/* Кнопка начать — только когда оба готовы */}
        {isReady && (
          <button
            onClick={() => { stopDuelPoll(); startMatch(); }}
            className="w-full h-14 font-oswald text-xl font-bold tracking-[0.2em] uppercase transition-all active:scale-95"
            style={{ backgroundColor: "#c0392b", color: "#f5f5f5" }}
          >
            НАЧАТЬ ДУЭЛЬ
          </button>
        )}
        {!isReady && <div />}
      </div>
    );
  }

  // ── CHALLENGES ──
  if (screen === "challenges") {
    const total = challenges.length;
    const done = challenges.filter(c => c.completed).length;
    return (
      <div className="flex flex-col h-dvh w-full overflow-hidden" style={{ backgroundColor: "#0f0f0f" }}>
        <div className="flex items-center gap-4 px-6 pt-10 pb-4">
          <button onClick={() => setScreen("home")} className="active:opacity-60 transition-opacity">
            <Icon name="ArrowLeft" size={20} style={{ color: "rgba(255,255,255,0.5)" }} />
          </button>
          <div className="flex-1">
            <h2 className="font-oswald text-2xl font-bold uppercase tracking-wider text-white">Задания</h2>
            <span className="font-rubik text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>
              Новые задания завтра
            </span>
          </div>
          {done === total && total > 0 && (
            <span className="font-oswald text-sm font-bold" style={{ color: "#00e676" }}>ВСЁ!</span>
          )}
        </div>

        {/* Награда за завершение */}
        {challengeCoins > 0 && (
          <div className="mx-6 mb-3 border px-4 py-2.5 flex items-center gap-2 animate-result-in" style={{ borderColor: "#f39c12", backgroundColor: "rgba(243,156,18,0.07)" }}>
            <span className="text-lg">🎁</span>
            <span className="font-oswald text-base font-bold uppercase" style={{ color: "#f39c12" }}>+{challengeCoins}🪙 получено!</span>
          </div>
        )}

        <div className="flex-1 px-6 pb-8 flex flex-col gap-3 overflow-y-auto">
          {challenges.length === 0 ? (
            <div className="flex flex-col items-center pt-16 gap-3">
              <Icon name="CalendarCheck" size={32} style={{ color: "rgba(255,255,255,0.1)" }} />
              <span className="font-rubik text-sm text-center" style={{ color: "rgba(255,255,255,0.25)" }}>Загружаем задания…</span>
            </div>
          ) : (
            <>
              {challenges.map(c => (
                <div key={c.id} className="border p-4 flex flex-col gap-3" style={{
                  borderColor: c.completed ? "rgba(0,230,118,0.35)" : "rgba(255,255,255,0.07)",
                  backgroundColor: c.completed ? "rgba(0,230,118,0.05)" : "rgba(255,255,255,0.02)",
                }}>
                  <div className="flex items-start gap-3">
                    <div className="flex flex-col gap-0.5 flex-1">
                      <span className="font-oswald text-base font-bold uppercase" style={{ color: c.completed ? "#00e676" : "#f5f5f5" }}>
                        {c.title}
                      </span>
                      <span className="font-rubik text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>{c.description}</span>
                    </div>
                    {/* Кнопка ЗАБРАТЬ или сумма */}
                    {c.completed && claimedIds.has(c.id) ? (
                      <div className="shrink-0 flex items-center gap-1.5 px-3 h-8 border" style={{ borderColor: "rgba(0,230,118,0.4)", backgroundColor: "rgba(0,230,118,0.08)" }}>
                        <span className="font-oswald text-xs font-bold uppercase" style={{ color: "#00e676" }}>✓ забрано</span>
                      </div>
                    ) : c.completed ? (
                      <button
                        onClick={() => {
                          setClaimingChallengeId(c.id);
                          if (navigator.vibrate) navigator.vibrate([30, 20, 50]);
                          setTimeout(() => {
                            setClaimedIds(prev => new Set([...prev, c.id]));
                            setClaimingChallengeId(null);
                            setChallengeCoins(c.reward_coins);
                            setTimeout(() => setChallengeCoins(0), 3000);
                          }, 600);
                        }}
                        className="shrink-0 px-4 h-9 font-oswald text-xs font-bold uppercase tracking-wider transition-all active:scale-95 animate-claim-pulse"
                        style={{ backgroundColor: "#f39c12", color: "#0f0f0f" }}
                      >
                        {claimingChallengeId === c.id ? (
                          <span className="animate-coin-collect inline-block">+{c.reward_coins}🪙</span>
                        ) : (
                          <>ЗАБРАТЬ +{c.reward_coins}🪙</>
                        )}
                      </button>
                    ) : (
                      <span className="font-oswald text-sm font-bold shrink-0" style={{ color: "rgba(255,255,255,0.25)" }}>+{c.reward_coins}🪙</span>
                    )}
                  </div>
                  {/* Прогресс */}
                  {!c.completed && (
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between">
                        <span className="font-rubik text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>{c.progress} / {c.target}</span>
                        <span className="font-rubik text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>{Math.round((c.progress / c.target) * 100)}%</span>
                      </div>
                      <div className="relative w-full h-1 rounded-full overflow-hidden" style={{ backgroundColor: "rgba(255,255,255,0.06)" }}>
                        <div
                          className="absolute left-0 top-0 h-full rounded-full transition-all duration-500"
                          style={{ width: `${Math.min(100, (c.progress / c.target) * 100)}%`, backgroundColor: "#c0392b" }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Таймер обновления */}
              <div className="flex items-center justify-center gap-2 py-2">
                <Icon name="Clock" size={12} style={{ color: "rgba(255,255,255,0.2)" }} />
                <span className="font-rubik text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>
                  Новые задания через {challengeTimer}
                </span>
              </div>
            </>
          )}
        </div>

        <div className="px-6 pb-8">
          <button
            onClick={() => { setScreen("home"); startMatch(); }}
            className="w-full h-14 font-oswald text-lg font-bold tracking-[0.2em] uppercase transition-all active:scale-95"
            style={{ backgroundColor: "#c0392b", color: "#f5f5f5" }}
          >
            ИГРАТЬ
          </button>
        </div>
      </div>
    );
  }

  // ── SHOP ──
  if (screen === "shop") {
    const tabItems = shopItems.filter(i => i.tab === shopTab);
    return (
      <div className="flex flex-col h-dvh w-full overflow-hidden" style={{ backgroundColor: "#0f0f0f" }}>
        {/* Header */}
        <div className="flex items-center gap-4 px-6 pt-10 pb-3">
          <button onClick={() => setScreen("home")} className="active:opacity-60">
            <Icon name="ArrowLeft" size={20} style={{ color: "rgba(255,255,255,0.5)" }} />
          </button>
          <h2 className="font-oswald text-2xl font-bold uppercase tracking-wider text-white flex-1">Магазин</h2>
          <div className="flex items-center gap-1.5">
            <span className="font-oswald text-xl font-bold" style={{ color: "#f39c12" }}>🪙{coins}</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex px-6 gap-2 pb-3">
          {(["coins", "help", "look", "status"] as const).map(t => {
            const labels: Record<string, string> = { coins: "Монеты", help: "Помощь", look: "Облик", status: "Статус" };
            return (
              <button
                key={t}
                onClick={() => setShopTab(t)}
                className="flex-1 h-8 font-oswald text-xs font-bold uppercase tracking-wider transition-all"
                style={{
                  backgroundColor: shopTab === t ? "#c0392b" : "rgba(255,255,255,0.05)",
                  color: shopTab === t ? "#f5f5f5" : "rgba(255,255,255,0.35)",
                  border: shopTab === t ? "none" : "1px solid rgba(255,255,255,0.08)",
                }}
              >
                {labels[t]}
              </button>
            );
          })}
        </div>

        {/* Toast */}
        {shopToast && (
          <div className="mx-6 mb-2 px-4 py-2 animate-result-in" style={{ backgroundColor: "rgba(0,230,118,0.12)", border: "1px solid rgba(0,230,118,0.3)" }}>
            <span className="font-oswald text-sm font-bold uppercase" style={{ color: "#00e676" }}>{shopToast}</span>
          </div>
        )}

        {/* Items */}
        <div className="flex-1 overflow-y-auto px-6 pb-8">
          {shopTab === "coins" ? (
            <div className="flex flex-col gap-3">
              {/* Пакет выживания */}
              <div className="border p-4 flex flex-col gap-3" style={{ borderColor: "rgba(243,156,18,0.4)", backgroundColor: "rgba(243,156,18,0.06)" }}>
                <div className="flex items-center gap-2">
                  <span className="text-2xl">🔥</span>
                  <span className="font-oswald text-lg font-bold uppercase" style={{ color: "#f39c12" }}>ПАКЕТ ВЫЖИВАНИЯ</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="font-rubik text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>300 монет</span>
                  <span className="font-rubik text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>3 попытки</span>
                  <span className="font-rubik text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>2 защиты серии</span>
                </div>
                <button
                  className="w-full h-11 font-oswald text-base font-bold tracking-[0.15em] uppercase transition-all active:scale-95"
                  style={{ backgroundColor: "#f39c12", color: "#0f0f0f" }}
                  onClick={() => { trackEvent("shop_pack_click"); }}
                >
                  49 ₽
                </button>
              </div>

              {/* Монеты */}
              {[
                { amount: 100, price: 29 },
                { amount: 300, price: 49 },
                { amount: 700, price: 99 },
                { amount: 1500, price: 149 },
              ].map(pack => (
                <div key={pack.amount} className="border p-4 flex items-center justify-between" style={{ borderColor: "rgba(255,255,255,0.07)", backgroundColor: "rgba(255,255,255,0.02)" }}>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🪙</span>
                    <span className="font-oswald text-lg font-bold" style={{ color: "#f39c12" }}>{pack.amount} монет</span>
                  </div>
                  <button
                    className="px-4 h-9 font-oswald text-sm font-bold uppercase tracking-wider transition-all active:scale-95"
                    style={{ backgroundColor: "#c0392b", color: "#f5f5f5" }}
                    onClick={() => { trackEvent("shop_coins_click", { amount: pack.amount, price: pack.price }); }}
                  >
                    {pack.price} ₽
                  </button>
                </div>
              ))}
            </div>
          ) : shopLoading ? (
            <div className="flex justify-center pt-10">
              <span className="font-rubik text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>Загрузка…</span>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {tabItems.map(item => {
                const owned = shopInventory[item.id];
                const isOwned = !!owned;
                const qty = owned?.quantity ?? 0;
                const isEquipped = owned?.equipped ?? false;
                const isPermanent = item.item_type === "permanent";
                const isConsumable = item.item_type === "consumable" || item.item_type === "activator";
                const boost = shopBoosts[item.effect_key] ?? 0;
                const canAfford = item.price_coins !== null && coins >= item.price_coins;

                return (
                  <div key={item.id} className="border p-4 flex gap-3" style={{
                    borderColor: isOwned ? "rgba(0,230,118,0.2)" : "rgba(255,255,255,0.07)",
                    backgroundColor: isOwned ? "rgba(0,230,118,0.03)" : "rgba(255,255,255,0.02)",
                  }}>
                    <span className="text-3xl leading-none pt-0.5">{item.icon}</span>
                    <div className="flex-1 flex flex-col gap-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-oswald text-base font-bold uppercase" style={{ color: "#f5f5f5" }}>{item.title}</span>
                          {item.badge && (
                            <span className="font-rubik text-[9px] px-1.5 py-0.5 uppercase tracking-wider" style={{
                              backgroundColor: item.badge === "best" ? "rgba(243,156,18,0.2)" : "rgba(192,57,43,0.2)",
                              color: item.badge === "best" ? "#f39c12" : "#c0392b",
                              border: `1px solid ${item.badge === "best" ? "rgba(243,156,18,0.3)" : "rgba(192,57,43,0.3)"}`,
                            }}>{item.badge === "best" ? "Лучшее" : "Популярно"}</span>
                          )}
                        </div>
                        {isConsumable && (isOwned || boost > 0) && (
                          <span className="font-oswald text-sm font-bold shrink-0" style={{ color: "#f39c12" }}>
                            ×{item.item_type === "activator" ? boost : qty}
                          </span>
                        )}
                      </div>
                      <span className="font-rubik text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>{item.description}</span>
                      <div className="flex items-center gap-2 mt-1">
                        {/* Цена */}
                        {item.price_coins && (
                          <span className="font-oswald text-sm font-bold" style={{ color: canAfford ? "#f39c12" : "rgba(255,255,255,0.25)" }}>
                            🪙{item.price_coins}
                          </span>
                        )}
                        <div className="flex-1" />
                        {/* Кнопка действия */}
                        {isPermanent && isOwned ? (
                          <button
                            onClick={() => equipItem(item.id)}
                            className="px-3 h-7 font-oswald text-xs font-bold uppercase tracking-wider transition-all active:scale-95"
                            style={{
                              backgroundColor: isEquipped ? "rgba(0,230,118,0.15)" : "rgba(255,255,255,0.08)",
                              color: isEquipped ? "#00e676" : "rgba(255,255,255,0.6)",
                              border: `1px solid ${isEquipped ? "rgba(0,230,118,0.3)" : "rgba(255,255,255,0.1)"}`,
                            }}
                          >
                            {isEquipped ? "Надето" : "Надеть"}
                          </button>
                        ) : (
                          <button
                            onClick={() => buyItem(item.id)}
                            disabled={!canAfford}
                            className="px-3 h-7 font-oswald text-xs font-bold uppercase tracking-wider transition-all active:scale-95"
                            style={{
                              backgroundColor: canAfford ? "#c0392b" : "rgba(255,255,255,0.04)",
                              color: canAfford ? "#f5f5f5" : "rgba(255,255,255,0.2)",
                            }}
                          >
                            {!canAfford ? "Мало монет" : isConsumable && isOwned ? "Ещё" : "Купить"}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── LEAGUE-UP OVERLAY (глобальный, поверх всего) ──
  return (
    <>
      {leagueUpVisible && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center pointer-events-none"
          style={{ backgroundColor: "rgba(0,0,0,0.85)" }}
        >
          <div
            className="flex flex-col items-center gap-5 animate-result-in"
            style={{ filter: `drop-shadow(0 0 40px ${leagueUpColor})` }}
          >
            <span className="text-7xl">{leagueUpIcon}</span>
            <div className="flex flex-col items-center gap-2">
              <span className="font-rubik text-sm uppercase tracking-[0.4em]" style={{ color: "rgba(255,255,255,0.5)" }}>
                Новая лига
              </span>
              <span
                className="font-oswald font-bold uppercase"
                style={{
                  fontSize: "clamp(3rem, 15vw, 5rem)",
                  color: leagueUpColor,
                  textShadow: `0 0 30px ${leagueUpColor}, 0 0 60px ${leagueUpColor}`,
                  letterSpacing: "-0.02em",
                }}
              >
                {leagueUpName}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Контекстный оффер */}
      {contextOffer && (() => {
        const item = shopItems.find(i => i.id === contextOffer.itemId);
        const hasInInventory = shopInventory["retry_1"]?.quantity > 0 || shopInventory["retry_3"]?.quantity > 0;
        const price = item?.price_coins ?? 10;
        const canAffordOffer = coins >= price;
        return (
          <div className="fixed inset-0 z-40 flex items-end justify-center pb-8 px-6" style={{ backgroundColor: "rgba(0,0,0,0.6)" }}>
            <div className="w-full max-w-sm border p-5 flex flex-col gap-4 animate-result-in" style={{ backgroundColor: "#161616", borderColor: "rgba(192,57,43,0.4)" }}>
              <div className="flex items-center gap-3">
                <span className="text-2xl">🔄</span>
                <span className="font-rubik text-sm flex-1" style={{ color: "rgba(255,255,255,0.7)" }}>{contextOffer.message}</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => hasInInventory ? consumeItem("retry") : buyItem(contextOffer.itemId)}
                  disabled={!hasInInventory && !canAffordOffer}
                  className="flex-1 h-11 font-oswald text-sm font-bold tracking-[0.15em] uppercase transition-all active:scale-95"
                  style={{ backgroundColor: (!hasInInventory && !canAffordOffer) ? "rgba(255,255,255,0.05)" : "#c0392b", color: "#f5f5f5" }}
                >
                  {hasInInventory ? "Использовать" : canAffordOffer ? `Купить · ${price}🪙` : "Мало монет"}
                </button>
                <button
                  onClick={() => setContextOffer(null)}
                  className="h-11 px-4 font-oswald text-sm uppercase transition-all active:scale-95"
                  style={{ backgroundColor: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.1)" }}
                >
                  Нет
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Мягкий промпт: задай ник */}
      {savePrompt && (
        <div className="fixed inset-0 z-40 flex items-end justify-center pb-8 px-6" style={{ backgroundColor: "rgba(0,0,0,0.7)" }}>
          <div className="w-full max-w-sm border p-6 flex flex-col gap-5 animate-result-in" style={{ backgroundColor: "#161616", borderColor: "rgba(243,156,18,0.4)" }}>
            <div className="flex flex-col gap-1.5">
              <span className="font-oswald text-xl font-bold uppercase text-white">СОХРАНИ ПРОГРЕСС</span>
              <span className="font-rubik text-sm" style={{ color: "rgba(255,255,255,0.45)" }}>
                Не потеряй свой результат. Задай ник, чтобы тебя знали в лидерборде.
              </span>
            </div>
            <input
              autoFocus
              value={nickValue}
              onChange={e => setNickValue(e.target.value)}
              maxLength={20}
              placeholder={player?.nickname ?? "Твой ник"}
              className="w-full h-12 px-4 font-oswald text-xl text-center tracking-wide outline-none"
              style={{ backgroundColor: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", color: "#f5f5f5" }}
              onKeyDown={e => { if (e.key === "Enter") saveNickname(); }}
            />
            {nickError && <span className="font-rubik text-xs text-center" style={{ color: "#c0392b" }}>{nickError}</span>}
            <div className="flex gap-2">
              <button onClick={saveNickname} disabled={nickSaving} className="flex-1 h-12 font-oswald text-base font-bold tracking-[0.15em] uppercase transition-all active:scale-95" style={{ backgroundColor: "#f39c12", color: "#0f0f0f" }}>
                {nickSaving ? "…" : "Сохранить"}
              </button>
              <button onClick={() => setSavePrompt(false)} className="h-12 px-4 font-oswald text-sm uppercase" style={{ backgroundColor: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.3)", border: "1px solid rgba(255,255,255,0.08)" }}>
                Позже
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Глобальный тост */}
      {shopToast && screen !== "shop" && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 animate-result-in" style={{ backgroundColor: "rgba(0,230,118,0.15)", border: "1px solid rgba(0,230,118,0.35)", backdropFilter: "blur(8px)" }}>
          <span className="font-oswald text-sm font-bold uppercase tracking-wider" style={{ color: "#00e676" }}>{shopToast}</span>
        </div>
      )}

      {/* Streak Milestone Celebration */}
      {streakMilestone && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none" style={{ backgroundColor: "rgba(0,0,0,0.7)" }}>
          <div className="flex flex-col items-center gap-4 animate-streak-milestone">
            <span className="text-6xl">{streakMilestone >= 10 ? "🔥" : streakMilestone >= 5 ? "🪙" : "🎯"}</span>
            <div className="flex flex-col items-center gap-2">
              <span className="font-oswald text-5xl font-bold" style={{ color: "#f39c12", textShadow: "0 0 40px rgba(243,156,18,0.6)" }}>
                {streakMilestone}
              </span>
              <span className="font-oswald text-xl font-bold uppercase tracking-wider" style={{ color: "#f5f5f5" }}>
                {streakMilestone >= 10 ? "НЕПОБЕДИМ!" : streakMilestone >= 5 ? "X2 НАГРАДЫ!" : "СЕРИЯ!"}
              </span>
              <span className="font-rubik text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>
                {streakMilestone >= 10 ? "Тебя не остановить" : streakMilestone >= 5 ? "Все монеты удваиваются" : "Продолжай давить"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Onboarding — первый запуск */}
      {showOnboarding && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-between px-6 py-12" style={{ backgroundColor: "#0f0f0f" }}>
          {onboardStep === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center gap-8 animate-result-in">
              <div className="flex flex-col items-center gap-4">
                <div className="relative">
                  <div className="absolute inset-0 rounded-full blur-3xl" style={{ backgroundColor: "#c0392b", opacity: 0.15 }} />
                  <span className="relative text-7xl block">🪙</span>
                </div>
                <h1 className="font-oswald font-bold uppercase text-center leading-tight" style={{ fontSize: "clamp(2.5rem, 12vw, 4rem)", color: "#f5f5f5" }}>
                  НЕ СЛОМАЙСЯ
                </h1>
                <p className="font-rubik text-base text-center" style={{ color: "rgba(255,255,255,0.5)", maxWidth: "280px" }}>
                  PvP-дуэль на реакцию. Один сигнал. Кто быстрее нажал — тот победил.
                </p>
              </div>
              <button
                onClick={() => setOnboardStep(1)}
                className="w-full max-w-xs h-14 font-oswald text-lg font-bold tracking-[0.2em] uppercase transition-all active:scale-95 animate-onboard-glow"
                style={{ backgroundColor: "#c0392b", color: "#f5f5f5" }}
              >
                ПОНЯЛ
              </button>
            </div>
          )}
          {onboardStep === 1 && (
            <div className="flex-1 flex flex-col items-center justify-center gap-8 animate-result-in">
              <div className="flex flex-col items-center gap-6">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ backgroundColor: "rgba(192,57,43,0.15)", border: "2px solid rgba(192,57,43,0.4)" }}>
                    <span className="font-oswald text-3xl font-bold" style={{ color: "#c0392b" }}>ЖДИ</span>
                  </div>
                  <span className="font-rubik text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>Экран красный — не трогай</span>
                </div>
                <div className="text-3xl">↓</div>
                <div className="flex flex-col items-center gap-3">
                  <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ backgroundColor: "rgba(0,230,118,0.15)", border: "2px solid rgba(0,230,118,0.4)" }}>
                    <span className="font-oswald text-3xl font-bold" style={{ color: "#00e676" }}>ЖМИ</span>
                  </div>
                  <span className="font-rubik text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>Экран зелёный — жми мгновенно</span>
                </div>
              </div>
              <div className="flex flex-col items-center gap-3 w-full max-w-xs">
                <div className="border px-4 py-2 w-full text-center" style={{ borderColor: "rgba(192,57,43,0.3)", backgroundColor: "rgba(192,57,43,0.05)" }}>
                  <span className="font-rubik text-xs" style={{ color: "#c0392b" }}>⚠️ Нажмёшь раньше = фальстарт = проигрыш</span>
                </div>
                <button
                  onClick={() => { trackEvent("onboarding_complete"); setShowOnboarding(false); startMatch(); }}
                  className="w-full h-14 font-oswald text-lg font-bold tracking-[0.2em] uppercase transition-all active:scale-95 animate-onboard-glow"
                  style={{ backgroundColor: "#c0392b", color: "#f5f5f5" }}
                >
                  П��ЕХАЛИ
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}