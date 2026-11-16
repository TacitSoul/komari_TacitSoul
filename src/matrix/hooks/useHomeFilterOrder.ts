import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { THEME_SHORT, useAppConfig } from "@/hooks/useAppConfig";
import type { HomeFilterOrderChange, HomeFilterOrderField } from "@/matrix/services/homeFilterOrder";

type SaveState = "idle" | "saving" | "saved" | "error" | "expired";

function isAuthError(error: unknown) {
  const status = (error as { status?: unknown } | null)?.status;
  return (error as Error | null)?.name === "ApiRequestError" && (status === 401 || status === 403);
}

/**
 * Persist a drag-reorder of the group tabs / region chips.
 *
 * Offered only to a logged-in admin while the server actually runs this theme (the settings
 * record belongs to whichever theme is active). The save re-reads the server's current record
 * and merges into it, so other settings are never overwritten. The persistence code (and the
 * schema library it uses) is loaded on first use, keeping it out of the views' chunk.
 */
export function useHomeFilterOrder() {
  const { t } = useTranslation();
  const { isLoggedIn, serverTheme, refresh } = useAppConfig();
  const [state, setState] = useState<SaveState>("idle");
  const [optimistic, setOptimistic] = useState<Partial<Record<HomeFilterOrderField, string[]>>>({});
  const savingRef = useRef(false);
  const authorized = isLoggedIn && serverTheme === THEME_SHORT;

  useEffect(() => {
    if (state !== "error" && state !== "saved") return;
    const timer = window.setTimeout(() => setState("idle"), state === "error" ? 6_000 : 2_000);
    return () => window.clearTimeout(timer);
  }, [state]);

  const reorder = useCallback(
    (change: HomeFilterOrderChange) => {
      if (!authorized || savingRef.current) return;
      savingRef.current = true;
      setState("saving");
      setOptimistic((current) => ({ ...current, [change.field]: [...change.visibleOrder] }));
      void (async () => {
        try {
          const { persistHomeFilterOrder } = await import("@/matrix/services/homeFilterOrder");
          await persistHomeFilterOrder(THEME_SHORT, change);
          await refresh();
          setState("saved");
        } catch (error) {
          const expired = isAuthError(error);
          setState(expired ? "expired" : "error");
          if (expired) void refresh();
        } finally {
          savingRef.current = false;
          setOptimistic((current) => {
            const next = { ...current };
            delete next[change.field];
            return next;
          });
        }
      })();
    },
    [authorized, refresh],
  );

  return {
    canReorder: authorized && state !== "saving" && state !== "expired",
    reorder,
    /** Order to show while a save is in flight, so the row does not snap back. */
    optimistic,
    status: state === "saving" ? t("fleetFilter.saving") : state === "saved" ? t("fleetFilter.saved") : "",
    errorMessage:
      state === "expired"
        ? t("fleetFilter.expired")
        : state === "error"
          ? t("fleetFilter.saveFailed")
          : null,
  };
}
