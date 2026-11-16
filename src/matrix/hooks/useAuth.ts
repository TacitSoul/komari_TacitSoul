import { useMemo } from "react";
import { useAppConfig } from "@/hooks/useAppConfig";

/** Login state for the matrix code, taken from the app config (no second /api/me request). */
export function useAuth() {
  const { isLoggedIn, username, loaded } = useAppConfig();
  return useMemo(
    () => ({
      data: loaded ? { logged_in: isLoggedIn, username } : undefined,
      isError: false,
    }),
    [isLoggedIn, loaded, username],
  );
}
