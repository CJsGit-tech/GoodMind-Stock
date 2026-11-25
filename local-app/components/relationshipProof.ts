/** Relationship assertions do not inherit the verification of an endpoint. */
export function relationshipStatusMatches(edge: Record<string, unknown>, status: string): boolean {
  return !status || edge.verification_status === status;
}

export const relationshipStatusOrder = [
  'officially_disclosed', 'corroborated', 'reported', 'analyst_inferred', 'hypothesis', 'disputed', 'unverified',
] as const;

export function weakestRelationshipStatus(required: readonly unknown[], supporting: readonly unknown[]): string {
  const values = [...required, ...supporting.filter(Boolean)];
  const rank = (value: unknown) => {
    const index = relationshipStatusOrder.findIndex(status => status === value);
    return index < 0 ? relationshipStatusOrder.length - 1 : index;
  };
  return values.length ? relationshipStatusOrder[Math.max(...values.map(rank))] : 'unverified';
}
