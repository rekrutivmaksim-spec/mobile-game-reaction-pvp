import confetti from "canvas-confetti";

export function fireStreakConfetti(streak: number) {
  if (streak >= 15) {
    fireEpicConfetti();
  } else if (streak >= 10) {
    fireBigConfetti();
  } else if (streak >= 5) {
    fireSmallConfetti();
  }
}

function fireSmallConfetti() {
  confetti({
    particleCount: 80,
    spread: 70,
    origin: { y: 0.6 },
    colors: ["#f39c12", "#e67e22", "#fff"],
  });
}

function fireBigConfetti() {
  const duration = 1500;
  const end = Date.now() + duration;
  (function frame() {
    confetti({
      particleCount: 4,
      angle: 60,
      spread: 55,
      origin: { x: 0, y: 0.7 },
      colors: ["#00e676", "#f39c12", "#fff"],
    });
    confetti({
      particleCount: 4,
      angle: 120,
      spread: 55,
      origin: { x: 1, y: 0.7 },
      colors: ["#00e676", "#f39c12", "#fff"],
    });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}

function fireEpicConfetti() {
  const duration = 3000;
  const end = Date.now() + duration;
  const colors = ["#00e676", "#f39c12", "#c0392b", "#3b82f6", "#fff"];
  (function frame() {
    confetti({
      particleCount: 6,
      angle: 60,
      spread: 70,
      origin: { x: 0, y: 0.6 },
      colors,
    });
    confetti({
      particleCount: 6,
      angle: 120,
      spread: 70,
      origin: { x: 1, y: 0.6 },
      colors,
    });
    confetti({
      particleCount: 3,
      angle: 90,
      spread: 100,
      origin: { x: 0.5, y: 0.3 },
      colors,
      gravity: 0.8,
    });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}

export function fireWinConfetti() {
  confetti({
    particleCount: 50,
    spread: 60,
    origin: { y: 0.6 },
    colors: ["#00e676", "#fff"],
    disableForReducedMotion: true,
  });
}

export function fireAchievementConfetti() {
  confetti({
    particleCount: 60,
    spread: 80,
    origin: { y: 0.5 },
    colors: ["#f39c12", "#fff", "#00e676"],
    disableForReducedMotion: true,
  });
}
