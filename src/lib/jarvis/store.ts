"use client";

// ─────────────────────────────────────────────────────────────────────────────
// JARVIS Web Console — central client state (zustand).
// Written during scaffolding (Task 1); frontend tasks build against this.
// ─────────────────────────────────────────────────────────────────────────────

import { create } from "zustand";
import {
  type AgentRunDTO,
  type EventLogDTO,
  type MemoryFactDTO,
  type MessageDTO,
  type PanelId,
  type ReminderDTO,
  type SettingsDTO,
  type TelemetrySnapshot,
  type TaskDTO,
  type VoiceState,
  DEFAULT_SETTINGS,
} from "@/lib/jarvis/types";

export interface ChatMessage extends MessageDTO {
  /** optimistic client flag while POST is in flight */
  pending?: boolean;
  /** assistant message typing animation progress (chars revealed) */
  revealed?: number;
}

export interface JarvisState {
  // boot
  booted: boolean;
  bootStage: "reactor" | "systems" | "ready";
  setBootStage: (s: JarvisState["bootStage"]) => void;
  setBooted: (b: boolean) => void;

  // core state
  voiceState: VoiceState;
  setVoiceState: (v: VoiceState) => void;
  busy: boolean; // a request pipeline is running
  setBusy: (b: boolean) => void;

  // session
  sessionId: string;
  messages: ChatMessage[];
  setMessages: (m: ChatMessage[]) => void;
  addMessage: (m: ChatMessage) => void;
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void;
  clearMessages: () => void;

  // ui
  panel: PanelId;
  setPanel: (p: PanelId) => void;
  panelOpenMobile: boolean;
  setPanelOpenMobile: (b: boolean) => void;
  paletteOpen: boolean;
  setPaletteOpen: (b: boolean) => void;
  settingsOpen: boolean;
  setSettingsOpen: (b: boolean) => void;
  gestureTrail: { x: number; y: number }[] | null;
  setGestureTrail: (t: { x: number; y: number }[] | null) => void;
  lastGesture: string | null;
  setLastGesture: (g: string | null) => void;

  // settings (persisted server-side, mirrored here)
  settings: SettingsDTO;
  setSettings: (s: Partial<SettingsDTO>) => void;
  hydrateSettings: (s: SettingsDTO) => void;

  // telemetry (latest snapshot, refreshed by collectors)
  telemetry: TelemetrySnapshot;
  setTelemetry: (t: Partial<TelemetrySnapshot>) => void;

  // data caches
  tasks: TaskDTO[];
  setTasks: (t: TaskDTO[]) => void;
  reminders: ReminderDTO[];
  setReminders: (r: ReminderDTO[]) => void;
  memories: MemoryFactDTO[];
  setMemories: (m: MemoryFactDTO[]) => void;
  logs: EventLogDTO[];
  setLogs: (l: EventLogDTO[]) => void;
  pushLog: (l: EventLogDTO) => void;

  // agent
  activeRunId: string | null;
  setActiveRunId: (id: string | null) => void;
  activeRun: AgentRunDTO | null;
  setActiveRun: (r: AgentRunDTO | null) => void;

  // proactive ("suggestions" from JARVIS — never spammy)
  suggestion: string | null;
  setSuggestion: (s: string | null) => void;
  pendingAlerts: { id: string; title: string; kind: "reminder" | "battery" | "system" }[];
  pushAlert: (a: JarvisState["pendingAlerts"][number]) => void;
  dismissAlert: (id: string) => void;
}

export const useJarvisStore = create<JarvisState>((set) => ({
  booted: false,
  bootStage: "reactor",
  setBootStage: (bootStage) => set({ bootStage }),
  setBooted: (booted) => set({ booted }),

  voiceState: "idle",
  setVoiceState: (voiceState) => set({ voiceState }),
  busy: false,
  setBusy: (busy) => set({ busy }),

  sessionId: "default",
  messages: [],
  setMessages: (messages) => set({ messages }),
  addMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
  updateMessage: (id, patch) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    })),
  clearMessages: () => set({ messages: [] }),

  panel: "system",
  setPanel: (panel) => set({ panel, panelOpenMobile: true }),
  panelOpenMobile: false,
  setPanelOpenMobile: (panelOpenMobile) => set({ panelOpenMobile }),
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  gestureTrail: null,
  setGestureTrail: (gestureTrail) => set({ gestureTrail }),
  lastGesture: null,
  setLastGesture: (lastGesture) => set({ lastGesture }),

  settings: { ...DEFAULT_SETTINGS },
  setSettings: (patch) =>
    set((s) => ({ settings: { ...s.settings, ...patch } })),
  hydrateSettings: (settings) => set({ settings }),

  telemetry: {},
  setTelemetry: (t) =>
    set((s) => ({ telemetry: { ...s.telemetry, ...t } })),

  tasks: [],
  setTasks: (tasks) => set({ tasks }),
  reminders: [],
  setReminders: (reminders) => set({ reminders }),
  memories: [],
  setMemories: (memories) => set({ memories }),
  logs: [],
  setLogs: (logs) => set({ logs }),
  pushLog: (l) => set((s) => ({ logs: [l, ...s.logs].slice(0, 200) })),

  activeRunId: null,
  setActiveRunId: (activeRunId) => set({ activeRunId }),
  activeRun: null,
  setActiveRun: (activeRun) => set({ activeRun }),

  suggestion: null,
  setSuggestion: (suggestion) => set({ suggestion }),
  pendingAlerts: [],
  pushAlert: (a) =>
    set((s) =>
      s.pendingAlerts.some((x) => x.id === a.id)
        ? s
        : { pendingAlerts: [...s.pendingAlerts, a] }
    ),
  dismissAlert: (id) =>
    set((s) => ({
      pendingAlerts: s.pendingAlerts.filter((a) => a.id !== id),
    })),
}));
