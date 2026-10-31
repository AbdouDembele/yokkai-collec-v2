export type RankObservation = {
  delta: number | null;
  since: string | null;
  observations: { day: string; position: number }[];
};
export type RankHistory = Record<string, RankObservation>;

export function personalRankGoal(
  kind: "collection" | "likes",
  userId: string,
  mine: { position: number | null; value?: number; score?: number },
  entries: { userId: string; pseudo: string; value?: number; score?: number }[]
):
  | { type: "leader" | "firstLike" | "start" | "progress" }
  | { type: "target"; count: number; pseudo: string } {
  if (mine.position === 1) return { type: "leader" };
  const current = kind === "likes" ? (mine.value ?? 0) : (mine.score ?? 0);
  const candidates = entries
    .filter(
      e =>
        e.userId !== userId &&
        (kind === "likes" ? (e.value ?? 0) : (e.score ?? 0)) > current
    )
    .sort(
      (a, b) =>
        (kind === "likes" ? (a.value ?? 0) : (a.score ?? 0)) -
        (kind === "likes" ? (b.value ?? 0) : (b.score ?? 0))
    );
  if (candidates[0])
    return {
      type: "target",
      count:
        (kind === "likes"
          ? (candidates[0].value ?? 0)
          : (candidates[0].score ?? 0)) -
        current +
        1,
      pseudo: candidates[0].pseudo
    };
  return {
    type: current > 0 ? "progress" : kind === "likes" ? "firstLike" : "start"
  };
}
