import { useEffect, useState } from "react";
import Icon from "@/components/ui/icon";
import { fireAchievementConfetti } from "@/lib/confetti";

interface Achievement {
  id: string;
  title: string;
  icon: string;
  reward: number;
  unlocked: boolean;
  claimed: boolean;
}

interface AchievementsModalProps {
  apiUrl: string;
  playerId: string;
  onPlayerUpdate: (player: unknown) => void;
  onClose: () => void;
}

export default function AchievementsModal({ apiUrl, playerId, onPlayerUpdate, onClose }: AchievementsModalProps) {
  const [items, setItems] = useState<Achievement[]>([]);
  const [unlockedCount, setUnlockedCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [claiming, setClaiming] = useState<string | null>(null);

  const load = () => {
    fetch(`${apiUrl}/?action=achievements&player_id=${playerId}`)
      .then(r => r.json())
      .then(d => {
        setItems(d.achievements || []);
        setUnlockedCount(d.unlocked_count || 0);
        setTotal(d.total || 0);
      })
      .catch(() => {});
  };

  useEffect(load, [apiUrl, playerId]);

  const claim = async (id: string) => {
    if (claiming) return;
    setClaiming(id);
    try {
      const r = await fetch(`${apiUrl}/?action=claim-achievement`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Player-Id": playerId },
        body: JSON.stringify({ achievement_id: id }),
      });
      const d = await r.json();
      if (d.player) {
        onPlayerUpdate(d.player);
        fireAchievementConfetti();
        load();
      }
    } finally {
      setClaiming(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ backgroundColor: "#0f0f0f" }}>
      <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
        <button onClick={onClose} className="active:opacity-60">
          <Icon name="ArrowLeft" size={22} style={{ color: "#f5f5f5" }} />
        </button>
        <span className="font-oswald font-bold uppercase tracking-wider" style={{ fontSize: "clamp(1.1rem, 4vw, 1.4rem)", color: "#f5f5f5" }}>
          Достижения
        </span>
        <span className="font-oswald text-sm font-bold" style={{ color: "#f39c12" }}>
          {unlockedCount}/{total}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-2">
          {items.map(it => {
            const canClaim = it.unlocked && !it.claimed;
            return (
              <div
                key={it.id}
                className="w-full border px-4 py-3 flex items-center gap-3"
                style={{
                  borderColor: it.unlocked ? (canClaim ? "#f39c12" : "rgba(0,230,118,0.3)") : "rgba(255,255,255,0.07)",
                  backgroundColor: canClaim ? "rgba(243,156,18,0.08)" : it.unlocked ? "rgba(0,230,118,0.04)" : "rgba(255,255,255,0.02)",
                  boxShadow: canClaim ? "0 0 12px rgba(243,156,18,0.25)" : "none",
                  opacity: it.unlocked ? 1 : 0.5,
                }}
              >
                <div
                  className="w-10 h-10 flex items-center justify-center rounded-full"
                  style={{
                    backgroundColor: it.unlocked ? (canClaim ? "rgba(243,156,18,0.2)" : "rgba(0,230,118,0.15)") : "rgba(255,255,255,0.05)",
                  }}
                >
                  <Icon
                    name={it.icon}
                    size={20}
                    fallback="Trophy"
                    style={{ color: it.unlocked ? (canClaim ? "#f39c12" : "#00e676") : "rgba(255,255,255,0.3)" }}
                  />
                </div>
                <div className="flex-1 flex flex-col gap-0">
                  <span className="font-oswald text-sm font-bold uppercase" style={{ color: "#f5f5f5" }}>
                    {it.title}
                  </span>
                  <span className="font-rubik" style={{ fontSize: "clamp(9px, 2.5vw, 11px)", color: "rgba(255,255,255,0.4)" }}>
                    {it.unlocked ? (it.claimed ? "Награда получена" : `Доступно: +${it.reward} 🪙`) : `Награда: +${it.reward} 🪙`}
                  </span>
                </div>
                {canClaim && (
                  <button
                    onClick={() => claim(it.id)}
                    disabled={claiming === it.id}
                    className="px-3 py-1.5 font-oswald text-xs font-bold uppercase tracking-wider active:scale-95 transition-all"
                    style={{
                      backgroundColor: "#f39c12",
                      color: "#0f0f0f",
                      opacity: claiming === it.id ? 0.5 : 1,
                    }}
                  >
                    Забрать
                  </button>
                )}
                {it.claimed && <Icon name="Check" size={18} style={{ color: "#00e676" }} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
