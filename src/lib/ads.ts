/**
 * Модуль рекламы — Yandex Mobile Ads SDK (YMA)
 *
 * Блоки:
 *   Rewarded:      R-M-19098620-1
 *   Interstitial:  R-M-19098620-2
 *
 * SDK подключается через index.html:
 * <script src="https://yandex.ru/ads/system/context.js" async></script>
 *
 * Если SDK недоступен (локальная разработка) — fallback с таймером.
 */

const REWARDED_BLOCK_ID     = "R-M-19098620-1";
const INTERSTITIAL_BLOCK_ID = "R-M-19098620-2";

interface YMARewardedAd {
  show: () => void;
  addEventListener: (event: string, callback: (data?: unknown) => void) => void;
}

interface YMAInterstitialAd {
  show: () => void;
  addEventListener: (event: string, callback: (data?: unknown) => void) => void;
}

interface YMAAdManager {
  createRewardedAd: (blockId: string) => YMARewardedAd;
  createInterstitialAd: (blockId: string) => YMAInterstitialAd;
}

declare global {
  interface Window {
    yaads?: YMAAdManager;
    // Яндекс Игры SDK (запасной вариант)
    YaGames?: { init: () => Promise<YaGamesSdk> };
    ysdk?: YaGamesSdk;
  }
}

interface YaGamesSdk {
  adv: {
    showRewardedVideo: (callbacks: {
      onOpen?: () => void;
      onRewarded?: () => void;
      onClose?: () => void;
      onError?: (error: Error) => void;
    }) => void;
    showFullscreenAdv: (callbacks: {
      onOpen?: () => void;
      onClose?: (wasShown: boolean) => void;
      onError?: (error: Error) => void;
    }) => void;
  };
}

let ysdk: YaGamesSdk | null = null;
let sdkInitAttempted = false;

async function ensureYaGamesSDK(): Promise<YaGamesSdk | null> {
  if (ysdk) return ysdk;
  if (sdkInitAttempted) return null;
  sdkInitAttempted = true;
  if (window.ysdk) { ysdk = window.ysdk; return ysdk; }
  if (window.YaGames) {
    try { ysdk = await window.YaGames.init(); return ysdk; } catch { return null; }
  }
  return null;
}

export type AdResult = "rewarded" | "closed" | "error";

export async function showRewardedAd(): Promise<AdResult> {
  // 1. Попытка через YMA SDK
  if (window.yaads) {
    return new Promise<AdResult>((resolve) => {
      try {
        const ad = window.yaads!.createRewardedAd(REWARDED_BLOCK_ID);
        let rewarded = false;
        ad.addEventListener("rewarded",   () => { rewarded = true; });
        ad.addEventListener("close",      () => resolve(rewarded ? "rewarded" : "closed"));
        ad.addEventListener("error",      () => resolve("error"));
        ad.addEventListener("dismissed",  () => resolve(rewarded ? "rewarded" : "closed"));
        ad.show();
      } catch {
        resolve("error");
      }
    });
  }

  // 2. Попытка через Яндекс Игры SDK
  const sdk = await ensureYaGamesSDK();
  if (sdk) {
    return new Promise<AdResult>((resolve) => {
      let rewarded = false;
      sdk.adv.showRewardedVideo({
        onRewarded: () => { rewarded = true; },
        onClose:    () => resolve(rewarded ? "rewarded" : "closed"),
        onError:    () => resolve("error"),
      });
    });
  }

  // 3. Fallback для локальной разработки (5 сек имитация)
  return new Promise<AdResult>((resolve) => {
    setTimeout(() => resolve("rewarded"), 5000);
  });
}

export async function showInterstitialAd(): Promise<boolean> {
  // 1. Попытка через YMA SDK
  if (window.yaads) {
    return new Promise<boolean>((resolve) => {
      try {
        const ad = window.yaads!.createInterstitialAd(INTERSTITIAL_BLOCK_ID);
        ad.addEventListener("close",     () => resolve(true));
        ad.addEventListener("error",     () => resolve(false));
        ad.addEventListener("dismissed", () => resolve(true));
        ad.show();
      } catch {
        resolve(false);
      }
    });
  }

  // 2. Попытка через Яндекс Игры SDK
  const sdk = await ensureYaGamesSDK();
  if (sdk) {
    return new Promise<boolean>((resolve) => {
      sdk.adv.showFullscreenAdv({
        onClose: (wasShown) => resolve(wasShown),
        onError: ()         => resolve(false),
      });
    });
  }

  // 3. Fallback для локальной разработки (2 сек имитация)
  return new Promise<boolean>((resolve) => {
    setTimeout(() => resolve(true), 2000);
  });
}

export function isAdSDKAvailable(): boolean {
  return !!(window.yaads || window.YaGames || window.ysdk);
}

export default showRewardedAd;
