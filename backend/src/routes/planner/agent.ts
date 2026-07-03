import { Router, Response, NextFunction } from 'express';
import { db } from '../../services/firestore';
import { getItem, executeTransition, getWorkflow } from '../../lib/planner/data';
import { availableTransitions } from '../../lib/planner/workflow';
import { WORK_ITEMS_COLLECTION } from '../../lib/planner/constants';
import { firestore } from 'firebase-admin';
import { WorkItem } from '../../lib/planner/types';
import { requireAuth, requireRole, AuthedRequest } from '../../middleware/auth';

const router = Router();

const RUNS_COLLECTION = 'agentRuns';
const SYSTEM_ACTOR = { uid: 'agent:campaign', roles: ['internal'] };

/**
 * Same service-to-service pattern as cron.ts's schedulerOrAdmin: a webhook
 * caller carrying the shared secret, or an authenticated admin/internal user.
 * Unlike the previous version of this file, a secret MISMATCH now actually
 * rejects the request (401) instead of logging a warning and continuing —
 * this endpoint used to be reachable by anyone, with no auth at all, and
 * would spend the Anthropic API key and mutate arbitrary work items on
 * request. CRON_SECRET must be set in production; there is no fallback
 * secret, because a hardcoded fallback is not a secret.
 */
function agentWebhookOrAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  const key = process.env.CRON_SECRET;
  if (key && req.headers['x-agent-secret'] === key) return next();
  requireAuth(req, res, (err?: unknown) => {
    if (err) return next(err);
    requireRole('admin', 'internal')(req, res, next);
  });
}

// Webhook endpoint called by the automation engine: POST /api/planner/agent/run
router.post('/run', agentWebhookOrAdmin, async (req, res, next) => {
  try {
    const { itemId } = req.body;
    if (!itemId) {
      return res.status(400).json({ success: false, error: 'itemId is required' });
    }

    // Write initial queued status
    const runRef = db.collection(RUNS_COLLECTION).doc(itemId);
    await runRef.set({
      itemId,
      status: 'queued',
      updatedAt: new Date().toISOString(),
    });

    // Run in the background
    runAgentJob(itemId).catch(err => {
      console.error(`[planner-agent] Background job failed for ${itemId}:`, err);
    });

    return res.status(202).json({ success: true, message: 'Agent job queued' });
  } catch (err) {
    next(err);
  }
});

async function runAgentJob(itemId: string) {
  const runRef = db.collection(RUNS_COLLECTION).doc(itemId);
  
  try {
    // 1. Update status to running
    await runRef.update({
      status: 'running',
      updatedAt: new Date().toISOString(),
    });

    // 2. Load item
    const item = await getItem(itemId);
    if (!item) {
      throw new Error(`Item ${itemId} not found`);
    }

    // 3. Load parent item if any (for campaign context)
    let parent = null;
    if (item.parentId) {
      parent = await getItem(item.parentId);
    }

    // 4. Load comments from task document array
    const comments = item.comments || [];

    // 5. Construct prompt
    const prompt = `You are the Campaign Agent AI teammate, an expert marketing assistant.
We have a work item that needs your attention.

Item Details:
- Title: ${item.title}
- Description: ${item.description || 'No description.'}
- Type: ${item.typeId}
- Status: ${item.status}
- Priority: ${item.priority || 'normal'}
- Labels: ${(item.labels || []).join(', ') || 'None'}

${parent ? `Parent Campaign/Event:
- Title: ${parent.title}
- Description: ${parent.description || 'No description.'}
` : ''}

Comments on this item so far:
${comments.map((c: any) => `- [${c.user}]: ${c.text}`).join('\n') || 'None'}

Your task: Provide help with this item. Propose a short checklist of subtasks (formatted with "- [ ] task description") or draft a brief summary.
Keep your response concise and structured in plain markdown.`;

    // 6. Call Claude API or fallback
    let aiResponseText = '';
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (apiKey && apiKey !== 'your_anthropic_api_key') {
      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 1024,
            messages: [{ role: 'user', content: prompt }],
          }),
        });

        if (!response.ok) {
          throw new Error(`Claude API returned status ${response.status}`);
        }

        const resData = (await response.json()) as any;
        aiResponseText = resData.content?.[0]?.text || '';
      } catch (err: any) {
        console.warn('[planner-agent] Claude API failed, falling back to mock:', err.message);
        aiResponseText = getMockResponse(item);
      }
    } else {
      console.log('[planner-agent] ANTHROPIC_API_KEY missing, using mock response');
      aiResponseText = getMockResponse(item);
    }

    if (!aiResponseText) {
      throw new Error('No AI response generated');
    }

    // 7. Parse checklist items from the AI response
    // Match lines starting with "- [ ]" or "- [x]"
    const checklistRegex = /-\s*\[\s*\]\s*(.+)/g;
    let match;
    const checklistItems: { id: string; text: string; done: boolean }[] = [];
    while ((match = checklistRegex.exec(aiResponseText)) !== null) {
      checklistItems.push({
        id: 'ch-' + Math.random().toString(36).substring(2, 9),
        text: match[1].trim(),
        done: false,
      });
    }

    // 8. Add a comment to the task doc
    const newComment = {
      id: 'comment-' + Date.now(),
      user: 'Campaign Agent',
      role: 'internal',
      userUid: SYSTEM_ACTOR.uid,
      text: aiResponseText,
      time: new Date().toLocaleTimeString() + ', Today',
      createdAt: new Date().toISOString(),
      internalOnly: false,
    };

    // 9. Update the task in Firestore (comment + checklist if any). Every other
    // mutation path in the planner (updateItemFields, executeTransition) checks
    // `locked` before writing and appends an activity entry in the same
    // transaction — this direct write previously did neither, so a workflow
    // that had fired `lockEditing` could still be silently overwritten by the
    // agent, and the mutation left no audit trail. Both are fixed here.
    const taskRef = db.collection(WORK_ITEMS_COLLECTION).doc(itemId);
    const nowIso = new Date().toISOString();
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(taskRef);
      if (!fresh.exists) throw new Error(`Item ${itemId} disappeared before agent write`);
      if ((fresh.data() as WorkItem).locked) {
        throw new Error(`Item ${itemId} is locked for editing; agent write skipped`);
      }

      const updates: Record<string, any> = {
        comments: firestore.FieldValue.arrayUnion(newComment),
        updatedAt: nowIso,
      };
      if (checklistItems.length > 0) {
        updates.checklist = firestore.FieldValue.arrayUnion(...checklistItems);
      }
      tx.update(taskRef, updates);
      tx.set(taskRef.collection('activity').doc(), {
        ts: nowIso,
        actorUid: SYSTEM_ACTOR.uid,
        kind: 'commentAdded',
        payload: { source: 'agent', checklistItemsAdded: checklistItems.length },
      });
    });

    // 10. Fire transition programmatically (e.g. 'agent_done' or similar)
    try {
      const workflow = await getWorkflow(item.workflowId);
      if (workflow) {
        const trs = availableTransitions(workflow, item, SYSTEM_ACTOR);
        const matchedTr = trs.find(
          (t) => t.id === 'agent_done' || t.to.toLowerCase().includes('done') || t.id.toLowerCase().includes('agent')
        );
        if (matchedTr) {
          await executeTransition(itemId, matchedTr.id, SYSTEM_ACTOR, new Date().toISOString());
        }
      }
    } catch (err) {
      console.warn('[planner-agent] Programmatic transition skipped:', err);
    }

    // 11. Write success run status
    await runRef.update({
      status: 'done',
      updatedAt: new Date().toISOString(),
    });

  } catch (err: any) {
    console.error(`[planner-agent] Agent runner execution failed for ${itemId}:`, err);
    await runRef.update({
      status: 'failed',
      error: err.message || 'Unknown error',
      updatedAt: new Date().toISOString(),
    });
  }
}

function getMockResponse(item: WorkItem): string {
  return `### Campaign Agent Auto-Prioritization & Planning Brief

I have processed the task **"${item.title}"** and aligned it with our marketing objectives.

#### Projections & Analysis
1. **Target Audience Alignment:** Focuses heavily on the Maldives local retail sector.
2. **Channel Distribution:** Leverage high-impact visual content (Instagram & TikTok).
3. **Execution Timeline:** Recommended 7-day lead time for creatives.

#### Proposed Action Checklist
- [ ] Compile creative assets and references
- [ ] Draft copywriting brief for external agency lead
- [ ] Establish budget limits and target channels
- [ ] Review checklist progression with team`;
}

export default router;
