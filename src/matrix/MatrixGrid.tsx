import { useMemo, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { NodeWithStatus } from "@/services/api";
import { useAppConfig } from "@/hooks/useAppConfig";
import { NodeCard } from "@/matrix/components/node/NodeCard";
import { useHomepagePingOverview } from "@/matrix/hooks/usePingOverview";
import { useMatrixNodeSync } from "@/matrix/hooks/useNode";
import { useThemeSettings } from "@/matrix/hooks/useThemeSettings";
import { TodayTrafficStatsProvider } from "@/matrix/hooks/useTodayTrafficStats";
import { isMatrixStoreEmpty, syncMatrixNodes } from "@/matrix/services/nodeStore";
import { queryClient } from "@/matrix/services/queryClient";
import { canViewCosts } from "@/matrix/utils/themeSettings";
import "./styles/card.css";

function MatrixCards({ uuids, allUuids }: { uuids: string[]; allUuids: string[] }) {
  // Starts / stops the shared latency poller for the cards on screen.
  useHomepagePingOverview("large");
  const settings = useThemeSettings();
  const { isLoggedIn } = useAppConfig();
  const showCosts = canViewCosts(settings, isLoggedIn);
  const showTodayTraffic = settings.isReady && settings.showTodayTrafficPopover;

  const grid = (
    <div className="matrix-grid">
      {uuids.map((uuid) => (
        <div key={uuid} data-node-uuid={uuid}>
          <NodeCard uuid={uuid} showTodayTraffic={showTodayTraffic} showCosts={showCosts} />
        </div>
      ))}
    </div>
  );

  return showTodayTraffic ? (
    <TodayTrafficStatsProvider uuids={allUuids}>{grid}</TodayTrafficStatsProvider>
  ) : (
    grid
  );
}

/**
 * Matrix view: large cards for the given (already filtered and sorted) UUIDs.
 * `nodes` is the full node list; it feeds the matrix store the cards read from.
 */
export default function MatrixGrid({ nodes, uuids }: { nodes: NodeWithStatus[]; uuids: string[] }) {
  // Fill the store before the first card renders; later updates go through the layout effect.
  useState(() => {
    if (isMatrixStoreEmpty()) syncMatrixNodes(nodes);
  });
  useMatrixNodeSync(nodes);

  const uuidKey = nodes.map((node) => node.uuid).join(",");
  const allUuids = useMemo(() => (uuidKey ? uuidKey.split(",") : []), [uuidKey]);

  // The matrix cards are memoised and translate through tsText(); re-mount them when the UI
  // language changes so every label follows.
  const { i18n } = useTranslation();
  return (
    <QueryClientProvider client={queryClient}>
      <MatrixCards key={i18n.resolvedLanguage ?? i18n.language} uuids={uuids} allUuids={allUuids} />
    </QueryClientProvider>
  );
}
