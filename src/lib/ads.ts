/**
 * Модуль рекламы — Yandex Mobile Ads SDK
 *
 * Приоритет:
 *   1. Нативный Android мост (window.yaads — инжектируется из MainActivity.java)
 *   2. Fallback для локальной разработки (таймер)
 *
 * Блоки РСЯ:
 *   Rewarded:      R-M-19148656-1
 *   Interstitial:  R-M-19148656-2
 *   App Open:      R-M-19148656-3
 */

// Нативный Android мост из MainActivity.java
interface NativeBridge {
  showRewarded: (callbackName: string) => void;
  showInterstitial: (callbackName: string) => void;
}

declare global {
  interface Window {
    yaads?: NativeBridge;
    [key: string]: unknown;
  }
}

export type AdResult = "rewarded" | "closed" | "error";

// Генерируем уникальное имя для callback-функции
function uniqueCallback(): string {
  return "_adCb_" + Math.random().toString(36).slice(2);
}

// Регистрируем временный callback в window, который нативный код вызовет обратно
function registerCallback<T>(resolve: (value: T) => void, map: (result: string) => T): string {
  const name = uniqueCallback();
  (window as Window)[name] = (result: string) => {
    delete (window as Window)[name];
    resolve(map(result));
  };
  return name;
}

export async function showRewardedAd(): Promise<AdResult> {
  // 1. Нативный Android SDK
  if (window.yaads?.showRewarded) {
    return new Promise<AdResult>((resolve) => {
      const cb = registerCallback<AdResult>(resolve, (result) => {
        if (result === "rewarded") return "rewarded";
        if (result === "error") return "error";
        return "closed";
      });
      window.yaads!.showRewarded(cb);
    });
  }

  // 2. Fallback для разработки (5 сек имитация)
  return new Promise<AdResult>((resolve) => {
    setTimeout(() => resolve("rewarded"), 5000);
  });
}

export async function showInterstitialAd(): Promise<boolean> {
  // 1. Нативный Android SDK
  if (window.yaads?.showInterstitial) {
    return new Promise<boolean>((resolve) => {
      const cb = registerCallback<boolean>(resolve, (result) => result === "true");
      window.yaads!.showInterstitial(cb);
    });
  }

  // 2. Fallback для разработки (2 сек имитация)
  return new Promise<boolean>((resolve) => {
    setTimeout(() => resolve(true), 2000);
  });
}

export async function showAppOpenAd(): Promise<boolean> {
  // App Open использует тот же interstitial-поток
  return showInterstitialAd();
}

export function isAdSDKAvailable(): boolean {
  return !!(window.yaads?.showRewarded);
}

export default showRewardedAd;
