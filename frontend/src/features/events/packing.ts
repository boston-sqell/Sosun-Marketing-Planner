import type { EventData, LogisticsLeg, PackingStatus } from '../../types';

/** One-directional packing pipeline; `damaged` is the exception lane. */
export const PACKING_FLOW =
  ['requested', 'packed', 'shipped', 'on-site', 'returned'] as const;

export const PACKING_LANES: PackingStatus[] = [...PACKING_FLOW, 'damaged'];

export function nextStatus(s: PackingStatus): PackingStatus | null {
  const i = (PACKING_FLOW as readonly string[]).indexOf(s);
  return i >= 0 && i < PACKING_FLOW.length - 1 ? PACKING_FLOW[i + 1] : null;
}

export const EVENT_STATUS_FLOW =
  ['Scoping', 'Confirmed', 'Preparing', 'Live', 'Wrapped', 'Reported'] as const;

/** Total cost = sponsorship fee + logistics legs + ledger entries tagged to the event. */
export function eventCost(ev: EventData, legs: LogisticsLeg[], ledgerCost: number): number {
  const logisticsCost = legs.reduce((s, l) => s + (l.cost || 0), 0);
  return (ev.sponsorshipCost || 0) + logisticsCost + ledgerCost;
}

/** ROI = (attributed sales − total cost) / total cost. Null when cost is 0. */
export function eventROI(ev: EventData, legs: LogisticsLeg[], ledgerCost: number) {
  const totalCost = eventCost(ev, legs, ledgerCost);
  const sales = ev.salesAttributed || 0;
  return {
    totalCost,
    roi: totalCost > 0 ? (sales - totalCost) / totalCost : null,
  };
}
