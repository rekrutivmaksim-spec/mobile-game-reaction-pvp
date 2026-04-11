/**
 * Модуль рекламы — Yandex Games SDK Rewarded Video + Interstitial
 *
 * Если SDK доступен (игра запущена в Yandex Games) — показывает настоящую рекламу.
 * Если SDK недоступен (свой домен) — fallback с таймером (имитация просмотра).
 */

interface YaGamesSDK {
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

declare global {
  interface Window {
    YaGames?: {
      init: () => Promise<YaGamesSDK>;
    };
    ysdk?: YaGamesSDK;
  }
}

let ysdk: YaGamesSDK | null = null;
let sdkInitAttempted = false;

async function ensureSDK(): Promise<YaGamesSDK | null> {
  if (ysdk) return ysdk;
  if (sdkInitAttempted) return null;
  sdkInitAttempted = true;

  if (window.ysdk) {
    ysdk = window.ysdk;
    return ysdk;
  }
  if (window.YaGames) {
    try {
      ysdk = await window.YaGames.init();
      return ysdk;
    } catch {
      return null;
    }
  }
  return null;
}

export type AdResult = "rewarded" | "closed" | "error";

export async function showRewardedAd(): Promise<AdResult> {
  const sdk = await ensureSDK();

  if (sdk) {
    return new Promise<AdResult>((resolve) => {
      let rewarded = false;
      sdk.adv.showRewardedVideo({
        onOpen: () => {},
        onRewarded: () => { rewarded = true; },
        onClose: () => { resolve(rewarded ? "rewarded" : "closed"); },
        onError: () => { resolve("error"); },
      });
    });
  }

  return new Promise<AdResult>((resolve) => {
    setTimeout(() => resolve("rewarded"), 5000);
  });
}

export async function showInterstitialAd(): Promise<boolean> {
  const sdk = await ensureSDK();

  if (sdk) {
    return new Promise<boolean>((resolve) => {
      sdk.adv.showFullscreenAdv({
        onClose: (wasShown) => { resolve(wasShown); },
        onError: () => { resolve(false); },
      });
    });
  }

  return new Promise<boolean>((resolve) => {
    setTimeout(() => resolve(true), 2000);
  });
}

export function isAdSDKAvailable(): boolean {
  return !!(window.YaGames || window.ysdk);
}

export default showRewardedAd;
