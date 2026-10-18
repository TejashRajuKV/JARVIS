"use client";

// ─────────────────────────────────────────────────────────────────────────────
// telemetry.ts — real device telemetry via browser APIs (workstream D):
//   Battery API, StorageManager.estimate(), Network Information API,
//   hardwareConcurrency / deviceMemory / platform, live FPS meter, uptime.
// Feeds store.telemetry → system panel gauges + chat clientContext.
// ─────────────────────────────────────────────────────────────────────────────

import { useJarvisStore } from "@/lib/jarvis/store";
import type { BatteryInfo, NetworkInfo } from "@/lib/jarvis/types";

interface BatteryManagerLike extends EventTarget {
  level: number;
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
}
interface ConnectionLike extends EventTarget {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
}

const startTs = Date.now();

function readBattery(b: BatteryManagerLike): BatteryInfo {
  return {
    level: b.level,
    charging: b.charging,
    chargingTime: isFinite(b.chargingTime) ? b.chargingTime : undefined,
    dischargingTime: isFinite(b.dischargingTime) ? b.dischargingTime : undefined,
  };
}

function readNetwork(c: ConnectionLike | null | undefined): NetworkInfo {
  return {
    online: typeof navigator !== "undefined" ? navigator.onLine : false,
    effectiveType: c?.effectiveType,
    downlink: c?.downlink,
    rtt: c?.rtt,
    saveData: c?.saveData,
  };
}

async function refreshStorage(): Promise<void> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (est) {
      useJarvisStore.getState().setTelemetry({
        storage: { usage: est.usage ?? 0, quota: est.quota ?? 0 },
      });
    }
  } catch {
    /* storage API unavailable */
  }
}

let fpsFrames = 0;
let fpsWindowStart = performance.now();

function startFpsLoop(): void {
  const tick = () => {
    if (!document.hidden) fpsFrames++;
    const now = performance.now();
    if (now - fpsWindowStart >= 2000) {
      const fps = Math.round((fpsFrames * 1000) / (now - fpsWindowStart));
      fpsFrames = 0;
      fpsWindowStart = now;
      useJarvisStore.getState().setTelemetry({ fps });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function initTelemetry(): void {
  if (typeof window === "undefined" || typeof navigator === "undefined") return;
  const store = useJarvisStore.getState();

  // device facts (static)
  store.setTelemetry({
    device: {
      cores: navigator.hardwareConcurrency,
      memoryGB: (navigator as unknown as { deviceMemory?: number }).deviceMemory,
      platform: (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform,
      language: navigator.language,
    },
    uptimeMs: 0,
  });

  // battery
  const nav = navigator as unknown as {
    getBattery?: () => Promise<BatteryManagerLike>;
  };
  if (nav.getBattery) {
    nav
      .getBattery()
      .then((b) => {
        const push = () => useJarvisStore.getState().setTelemetry({ battery: readBattery(b) });
        push();
        b.addEventListener("levelchange", push);
        b.addEventListener("chargingchange", push);
        b.addEventListener("chargingtimechange", push);
        b.addEventListener("dischargingtimechange", push);
      })
      .catch(() => undefined);
  }

  // network
  const conn = (navigator as unknown as { connection?: ConnectionLike }).connection;
  if (conn) {
    const pushNet = () =>
      useJarvisStore.getState().setTelemetry({ network: readNetwork(conn) });
    pushNet();
    conn.addEventListener("change", pushNet);
  }
  window.addEventListener("online", () =>
    useJarvisStore.getState().setTelemetry({
      network: { ...(useJarvisStore.getState().telemetry.network ?? {}), online: true },
    })
  );
  window.addEventListener("offline", () =>
    useJarvisStore.getState().setTelemetry({
      network: { ...(useJarvisStore.getState().telemetry.network ?? {}), online: false },
    })
  );

  // storage (initial + periodic)
  void refreshStorage();
  window.setInterval(() => void refreshStorage(), 30_000);

  // fps
  startFpsLoop();

  // uptime refresh
  window.setInterval(() => {
    useJarvisStore.getState().setTelemetry({ uptimeMs: Date.now() - startTs });
  }, 10_000);
}
