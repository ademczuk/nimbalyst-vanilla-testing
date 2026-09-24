/** Order callbacks capture only their ordering data, never a component render. */
type OrderableSession = { id: string; createdAt: number; updatedAt: number };

export function getLiveSessionOrderTimestamp(
  session: OrderableSession,
  options: {
    sortBy: 'updated' | 'created';
    mode: 'chat' | 'agent';
    turnActivity: Map<string, number>;
  }
): number {
  const { sortBy, mode, turnActivity } = options;
  if (sortBy === 'created') {
    return session.createdAt;
  }
  if (mode === 'agent') {
    const turnBoundaryTimestamp = turnActivity.get(session.id);
    if (turnBoundaryTimestamp !== undefined) {
      return turnBoundaryTimestamp;
    }
  }
  return session.updatedAt || session.createdAt;
}


export function createCommittedRankBuilder(
  sessionRegistry: ReadonlyMap<string, OrderableSession>,
  displayOrderRankMap: ReadonlyMap<string, number>,
) {
  return (nextMap: Map<string, number>): Map<string, number> => {
    const rankedSessions = Array.from(sessionRegistry.values())
      .sort((a, b) => {
        const timestampDiff = compareNumbersDesc(
          nextMap.get(a.id) ?? 0,
          nextMap.get(b.id) ?? 0,
        );
        if (timestampDiff !== 0) return timestampDiff;

        const previousRankA = displayOrderRankMap.get(a.id);
        const previousRankB = displayOrderRankMap.get(b.id);
        if (previousRankA !== undefined && previousRankB !== undefined && previousRankA !== previousRankB) {
          return compareNumbersAsc(previousRankA, previousRankB);
        }

        const createdDiff = compareNumbersDesc(a.createdAt, b.createdAt);
        if (createdDiff !== 0) return createdDiff;

        return a.id.localeCompare(b.id);
      });
    return new Map(rankedSessions.map((session, index) => [session.id, index]));
  };
}

export function createSessionOrder({
  sortBy, mode, workspaceTurnActivity, useThrottledTurnOrdering,
  displayOrderTimestampMap, displayOrderRankMap,
}: {
  sortBy: 'updated' | 'created';
  mode: 'chat' | 'agent';
  workspaceTurnActivity: Map<string, number>;
  useThrottledTurnOrdering: boolean;
  displayOrderTimestampMap: Map<string, number>;
  displayOrderRankMap: Map<string, number>;
}) {
  const getDisplayedOrderTimestamp = (session: OrderableSession) => {
    const liveTimestamp = getLiveSessionOrderTimestamp(session, {
      sortBy,
      mode,
      turnActivity: workspaceTurnActivity,
    });
    if (!useThrottledTurnOrdering) {
      return liveTimestamp;
    }
    return displayOrderTimestampMap.get(session.id) ?? liveTimestamp;
  };
  const getDisplayedOrderRank = (sessionId: string) => {
    return displayOrderRankMap.get(sessionId) ?? Number.MAX_SAFE_INTEGER;
  };
  const compareSessionOrder = (
    a: OrderableSession,
    b: OrderableSession
  ) => {
    const timestampDiff = compareNumbersDesc(
      getDisplayedOrderTimestamp(a),
      getDisplayedOrderTimestamp(b),
    );
    if (timestampDiff !== 0) return timestampDiff;

    const rankDiff = compareNumbersAsc(
      getDisplayedOrderRank(a.id),
      getDisplayedOrderRank(b.id),
    );
    if (rankDiff !== 0) return rankDiff;

    const createdDiff = compareNumbersDesc(a.createdAt, b.createdAt);
    if (createdDiff !== 0) return createdDiff;
    return a.id.localeCompare(b.id);
  };
  return { getDisplayedOrderTimestamp, getDisplayedOrderRank, compareSessionOrder };
}

function compareNumbersDesc(a: number, b: number): number { return b - a; }
function compareNumbersAsc(a: number, b: number): number { return a - b; }
