"use client";

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM panel — browser-provided telemetry gauges (battery, storage, network,
// device, fps/uptime). While the telemetry engine (task 3) hasn't fed the
// store yet, shimmer placeholders are shown ("AWAITING TELEMETRY BUS").
// ─────────────────────────────────────────────────────────────────────────────

import type { ComponentType } from "react";
import {
  Activity,
  BatteryMedium,
  Cpu,
  HardDrive,
  Wifi,
  Zap,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useJarvisStore } from "@/lib/jarvis/store";
import { formatBytes, formatDuration } from "@/lib/jarvis/client/ui-helpers";
import { PanelShell, EmptyHint } from "@/components/jarvis/panel-shell";
import { cn } from "@/lib/utils";

function GaugeCell({
  icon: Icon,
  label,
  value,
  sub,
  accent,
  children,
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  label: string;
  value: string;
  sub?: string;
  accent?: "amber";
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-cyan-400/12 bg-cyan-400/[0.03] p-3">
      <div className="flex items-center gap-2">
        <Icon
          className={cn("size-4", accent === "amber" ? "text-amber-300" : "text-cyan-300/80")}
          aria-hidden={true}
        />
        <span className="micro-label">{label}</span>
      </div>
      <p className="mt-2 font-mono text-lg tabular-nums leading-none text-cyan-100">
        {value}
      </p>
      {sub && <p className="mt-1 font-mono text-[10px] text-muted-foreground">{sub}</p>}
      {children}
    </div>
  );
}

function ShimmerCell() {
  return (
    <div className="hud-shimmer h-[86px] rounded-md border border-cyan-400/10" />
  );
}

export function SystemPanel() {
  const telemetry = useJarvisStore((s) => s.telemetry);
  const battery = telemetry.battery;
  const storage = telemetry.storage;
  const network = telemetry.network;
  const device = telemetry.device;
  const fps = telemetry.fps;
  const uptime = telemetry.uptimeMs;

  const isEmpty =
    !battery && !storage && !network && !device && fps == null;

  return (
    <PanelShell title="System telemetry">
      {isEmpty ? (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <ShimmerCell key={i} />
            ))}
          </div>
          <EmptyHint>
            AWAITING TELEMETRY BUS — the telemetry engine (task 3) will feed
            live readings here.
          </EmptyHint>
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <GaugeCell
              icon={BatteryMedium}
              label="Battery"
              accent={battery && battery.level < 0.2 ? "amber" : undefined}
              value={
                battery ? `${Math.round(battery.level * 100)}%` : "N/A"
              }
              sub={
                battery
                  ? battery.charging
                    ? Number.isFinite(battery.chargingTime) && battery.chargingTime
                      ? `charging · full in ${formatDuration(battery.chargingTime)}`
                      : "charging"
                    : Number.isFinite(battery.dischargingTime) && battery.dischargingTime
                      ? `discharging · ~${formatDuration(battery.dischargingTime)} left`
                      : "discharging"
                  : "API unavailable"
              }
            >
              {battery?.charging && (
                <Zap className="mt-1 size-3 fill-amber-300 text-amber-300" aria-hidden={true} />
              )}
            </GaugeCell>

            <GaugeCell
              icon={HardDrive}
              label="Storage"
              value={storage ? formatBytes(storage.usage) : "N/A"}
              sub={storage ? `of ${formatBytes(storage.quota)} quota` : "API unavailable"}
            >
              {storage && storage.quota > 0 && (
                <Progress
                  value={(storage.usage / storage.quota) * 100}
                  aria-label="Storage used"
                  className="mt-2 h-1 bg-cyan-400/10"
                />
              )}
            </GaugeCell>

            <GaugeCell
              icon={Wifi}
              label="Network"
              value={
                network ? (network.online ? "ONLINE" : "OFFLINE") : "N/A"
              }
              sub={
                network
                  ? [
                      network.effectiveType ?? "—",
                      network.downlink != null ? `${network.downlink} Mb/s` : "—",
                      network.rtt != null ? `${network.rtt} ms rtt` : "—",
                    ].join(" · ")
                  : "API unavailable"
              }
            />

            <GaugeCell
              icon={Cpu}
              label="Device"
              value={`${device?.cores ?? "—"} cores`}
              sub={[
                device?.memoryGB != null ? `${device.memoryGB} GB RAM` : null,
                device?.platform ?? null,
              ]
                .filter(Boolean)
                .join(" · ") || "API unavailable"}
            />

            <GaugeCell
              icon={Activity}
              label="FPS"
              value={fps != null ? String(Math.round(fps)) : "—"}
              sub={`uptime ${formatDuration(uptime != null ? uptime / 1000 : null)}`}
            />

            <GaugeCell
              icon={Wifi}
              label="Save data"
              value={network?.saveData ? "ON" : "OFF"}
              sub={device?.language ?? undefined}
            />
          </div>
          <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
            Telemetry is browser-provided (Battery / Storage / Network /
            deviceMemory / hardwareConcurrency APIs) and is attached to every
            chat request as client context.
          </p>
        </>
      )}
    </PanelShell>
  );
}
