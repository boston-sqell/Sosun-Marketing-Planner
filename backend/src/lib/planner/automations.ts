/**
 * Marketing Planner — automation trigger/condition evaluation (pure).
 *
 * Automations are trigger → conditions → actions, evaluated server-side after a
 * mutation (spec §3.7, §4 step 8). This module decides WHICH automations fire
 * for an event; the action executor (data.ts) runs them, with a depth counter
 * for loop protection. Pure — no Firestore — so the matcher is unit-testable.
 */

import { Automation, AutomationCondition, AutomationEvent, WorkItem } from './types';

export function matchesTrigger(automation: Automation, event: AutomationEvent): boolean {
  const t = automation.trigger;
  if (t.type !== event.type) return false;
  if (t.type === 'statusEntered' && t.statusId !== event.statusId) return false;
  if (t.typeIds && t.typeIds.length > 0 && !t.typeIds.includes(event.typeId)) return false;
  return true;
}

export function passesConditions(conditions: AutomationCondition[] | undefined, item: WorkItem): boolean {
  if (!conditions || conditions.length === 0) return true;
  return conditions.every((c) => {
    switch (c.type) {
      case 'fieldEquals':
        return item.fields?.[c.fieldId] === c.value;
      default:
        return false; // unknown condition fails closed
    }
  });
}

/** The enabled automations whose trigger and conditions match this event/item. */
export function selectAutomations(
  automations: Automation[],
  event: AutomationEvent,
  item: WorkItem,
): Automation[] {
  return automations.filter(
    (a) => a.enabled && matchesTrigger(a, event) && passesConditions(a.conditions, item),
  );
}

/** Loop-protection ceiling: automation-initiated mutations carry a depth
 *  counter; automations stop firing past this (spec §3.7). */
export const MAX_AUTOMATION_DEPTH = 3;
