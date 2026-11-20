// What the app can say about a round from its rows.

/** A round's groups as read with a count of each player's scores. */
export interface ScoredGroup {
  group_players: { scores?: { count: number }[] }[];
}

/** Has anyone in these groups entered a score? */
export function hasScores(groups: ScoredGroup[] | null | undefined): boolean {
  return (groups ?? []).some((g) =>
    g.group_players.some((gp) => (gp.scores ?? []).some((s) => s.count > 0)),
  );
}

/** "Live" means a round in play: someone has a score in it and it isn't final. */
export function inPlay(round: { status: string; groups?: ScoredGroup[] | null }): boolean {
  return round.status !== 'final' && hasScores(round.groups);
}
