import { useEffect, useState } from "react";
import Icon from "@/components/ui/icon";
import { fireAchievementConfetti } from "@/lib/confetti";

interface DailyBonusProps {
  apiUrl: string;
  playerId: string;
  onClaim: (player: unknown, reward: number) => void;
  onClose: () => void;
}

interface DailyStatus {
  available: boolean;
  day_index: number;
  streak: number;
  rewards: number[];
  next_reward: number;
}

export default function DailyBonus({ apiUrl, playerId, onClaim, onClose }: DailyBonusProps) {
  const [status, setStatus] = useState<DailyStatus | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);

  useEffect(() => {
    fetch(`${apiUrl}/?action=daily-status&player_id=${playerId}`)
      .then(r => r.json())
      .then((d: DailyStatus) => setStatus(d))
      .catch(() => setStatus(null));
  }, [apiUrl, playerId]);

  const handleClaim = async () => {
    if (!status?.available || claiming) return;
    setClaiming(true);
    try {
      const r = await fetch(`${apiUrl}/?action=daily-claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Player-Id": playerId },
      });
      const d = await r.json();
      if (d.player) {
        setClaimed(true);
        fireAchievementConfetti();
        onClaim(d.player, d.reward);
        setTimeout(() => onClose(), 1800);
      }
    } finally {
      setClaiming(false);
    }
  };

  if (!status) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6" style={{ backgroundColor: "rgba(0,0,0,0.85)" }}>
      <div className="w-full max-w-sm flex flex-col items-center gap-4 animate-result-in">
        <div className="flex flex-col items-center gap-1">
          <span className="font-oswald font-bold uppercase tracking-wider" style={{ fontSize: "clamp(1.5rem, 7vw, 2rem)", color: "#f39c12" }}>
            Ежедневный бонус
          </span>
          <span className="font-rubik text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
            {status.streak > 0 ? `Серия входов: ${status.streak} ${status.streak === 1 ? "день" : "дней"}` : "Заходи каждый день"}
          </span>
        </div>

        <div className="grid grid-cols-7 gap-1.5 w-full">
          {status.rewards.map((reward, idx) => {
            const isToday = idx === status.day_index && status.available;
            const isPast = idx < status.day_index || (idx === status.day_index && !status.available);
            return (
              <div
                key={idx}
                className="flex flex-col items-center justify-center gap-1 py-2 border"
                style={{
                  borderColor: isToday ? "#f39c12" : isPast ? "rgba(0,230,118,0.3)" : "rgba(255,255,255,0.1)",
                  backgroundColor: isToday ? "rgba(243,156,18,0.15)" : isPast ? "rgba(0,230,118,0.06)" : "rgba(255,255,255,0.03)",
                  boxShadow: isToday ? "0 0 12px rgba(243,156,18,0.4)" : "none",
                  animation: isToday ? "pulse 2s ease-in-out infinite" : "none",
                }}
              >
                <span className="font-rubik" style={{ fontSize: "clamp(8px, 2.2vw, 10px)", color: "rgba(255,255,255,0.3)" }}>
                  {idx + 1}
                </span>
                <span className="font-oswald font-bold" style={{ fontSize: "clamp(10px, 2.6vw, 12px)", color: isPast ? "#00e676" : isToday ? "#f39c12" : "#f5f5f5" }}>
                  {reward}
                </span>
                <span style={{ fontSize: "10px" }}>{isPast ? "✓" : "🪙"}</span>
              </div>
            );
          })}
        </div>

        {status.available ? (
          <button
            onClick={handleClaim}
            disabled={claiming || claimed}
            className="w-full h-14 font-oswald text-base font-bold tracking-[0.2em] uppercase active:scale-95 transition-all flex items-center justify-center gap-2"
            style={{
              backgroundColor: claimed ? "#00e676" : "#f39c12",
              color: "#0f0f0f",
              boxShadow: claimed ? "0 0 20px rgba(0,230,118,0.5)" : "0 0 20px rgba(243,156,18,0.5)",
              opacity: claiming ? 0.6 : 1,
            }}
          >
            <Icon name={claimed ? "Check" : "Gift"} size={20} />
            {claimed ? `+${status.next_reward} 🪙 ПОЛУЧЕНО` : `ЗАБРАТЬ +${status.next_reward} 🪙`}
          </button>
        ) : (
          <div className="w-full flex flex-col items-center gap-2">
            <span className="font-rubik text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
              Уже получено сегодня
            </span>
            <span className="font-rubik" style={{ fontSize: "clamp(10px, 2.6vw, 12px)", color: "rgba(255,255,255,0.5)" }}>
              Возвращайся завтра за +{status.rewards[(status.day_index + 1) % 7]} 🪙
            </span>
          </div>
        )}

        <button
          onClick={onClose}
          className="font-rubik text-xs underline"
          style={{ color: "rgba(255,255,255,0.4)" }}
        >
          Закрыть
        </button>
      </div>
    </div>
  );
}
