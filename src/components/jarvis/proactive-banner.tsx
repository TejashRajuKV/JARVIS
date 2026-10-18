"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Proactive suggestion banner — rendered above the input only when
// autonomy === "proactive" && !dnd && store.suggestion is set.
// "Run" sends the suggestion through the normal chat pipeline.
// ─────────────────────────────────────────────────────────────────────────────

import { AnimatePresence, motion } from "framer-motion";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useJarvisStore } from "@/lib/jarvis/store";
import { sendChatMessage } from "@/lib/jarvis/client/ui-helpers";

export function ProactiveBanner() {
  const suggestion = useJarvisStore((s) => s.suggestion);
  const setSuggestion = useJarvisStore((s) => s.setSuggestion);
  const autonomy = useJarvisStore((s) => s.settings.autonomy);
  const dnd = useJarvisStore((s) => s.settings.dnd);

  const visible = Boolean(suggestion) && autonomy === "proactive" && !dnd;

  const run = () => {
    if (!suggestion) return;
    setSuggestion(null);
    void sendChatMessage(suggestion);
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.25 }}
          className="mb-2"
        >
          <div className="hud-corners relative flex items-center gap-2.5 rounded-md border border-amber-300/30 bg-amber-400/[0.06] py-2 pl-3 pr-2">
            <Sparkles className="size-4 shrink-0 text-amber-300" aria-hidden="true" />
            <p className="min-w-0 flex-1 truncate font-mono text-xs text-amber-100/90">
              {suggestion}
            </p>
            <Button
              type="button"
              size="sm"
              onClick={run}
              className="h-7 rounded border-amber-300/40 bg-amber-400/15 px-2.5 font-mono text-[10px] tracking-[0.15em] text-amber-200 hover:bg-amber-300/25"
            >
              RUN
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Dismiss suggestion"
              onClick={() => setSuggestion(null)}
              className="size-7 text-muted-foreground hover:text-amber-200"
            >
              <X className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
