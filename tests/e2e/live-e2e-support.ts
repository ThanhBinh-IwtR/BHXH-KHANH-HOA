/** Statuses that mean a live provider sample cannot provide valid measurements. */
export function isProviderBlockedStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 429 || status === 504;
}
