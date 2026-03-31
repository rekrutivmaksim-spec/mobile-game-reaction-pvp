export interface League {
  id: string;
  name: string;
  minRating: number;
  maxRating: number;
  color: string;
  glowColor: string;
  textColor: string;
  icon: string;
  animated: boolean;
}

export const LEAGUES: League[] = [
  { id: "bronze",  name: "Бронза",  minRating: 0,    maxRating: 999,  color: "#cd7f32", glowColor: "rgba(205,127,50,0.4)",  textColor: "#cd7f32", icon: "🥉", animated: false },
  { id: "silver",  name: "Серебро", minRating: 1000, maxRating: 1399, color: "#c0c0c0", glowColor: "rgba(192,192,192,0.4)", textColor: "#c0c0c0", icon: "🥈", animated: false },
  { id: "gold",    name: "Золото",  minRating: 1400, maxRating: 1799, color: "#f39c12", glowColor: "rgba(243,156,18,0.5)",  textColor: "#f39c12", icon: "🥇", animated: false },
  { id: "plat",    name: "Платина", minRating: 1800, maxRating: 2199, color: "#00bcd4", glowColor: "rgba(0,188,212,0.5)",   textColor: "#00bcd4", icon: "💎", animated: false },
  { id: "legend",  name: "Легенда", minRating: 2200, maxRating: Infinity, color: "#c0392b", glowColor: "rgba(192,57,43,0.6)", textColor: "#ff6b6b", icon: "🔥", animated: true },
];

export function getLeague(rating: number): League {
  return LEAGUES.slice().reverse().find(l => rating >= l.minRating) ?? LEAGUES[0];
}

export function getNextLeague(rating: number): League | null {
  const curr = getLeague(rating);
  const idx = LEAGUES.findIndex(l => l.id === curr.id);
  return idx < LEAGUES.length - 1 ? LEAGUES[idx + 1] : null;
}

export function getProgressToNext(rating: number): { pct: number; pointsLeft: number; next: League | null } {
  const curr = getLeague(rating);
  const next = getNextLeague(rating);
  if (!next) return { pct: 100, pointsLeft: 0, next: null };
  const span = next.minRating - curr.minRating;
  const done = rating - curr.minRating;
  const pct = Math.min(100, Math.round((done / span) * 100));
  const pointsLeft = next.minRating - rating;
  return { pct, pointsLeft, next };
}

export function getPressureMessage(rating: number, ratingDelta: number, isWin: boolean): string | null {
  const curr = getLeague(rating);
  const next = getNextLeague(rating);
  const pointsToNext = next ? next.minRating - rating : null;
  const pointsToDrop = rating - curr.minRating;

  if (isWin && pointsToNext !== null && pointsToNext <= 50) {
    const wins = Math.ceil(pointsToNext / 25);
    return wins === 1 ? "Ещё 1 победа до " + next!.name + "!" : `Ещё ${wins} победы до ${next!.name}!`;
  }
  if (!isWin && pointsToDrop <= 30 && curr.id !== "bronze") {
    return `Осторожно — можешь вылететь из ${curr.name}!`;
  }
  return null;
}
