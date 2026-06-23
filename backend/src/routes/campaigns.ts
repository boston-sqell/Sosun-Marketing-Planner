import { Router, Response } from 'express';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { db } from '../services/firestore';
import { checkPermission } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { CreateCampaignSchema } from '../schemas';
import { z } from 'zod';

const router = Router();

// Apply auth middleware to all campaign routes
router.use(requireAuth);

/**
 * GET /api/campaigns
 * Returns list of campaigns, filtered by user's permission scope, and stripped of financial data if agency.
 */
router.get('/', async (req: AuthedRequest, res: Response, next) => {
  try {
    const role = req.role || 'agency';
    const userUid = req.uid!;

    const limit = 20;
    const { cursor } = req.query;

    let queryRef = db.collection('campaigns').orderBy('startDate', 'desc').orderBy('__name__', 'desc');
    
    if (cursor) {
      const cursorDoc = await db.collection('campaigns').doc(String(cursor)).get();
      if (cursorDoc.exists) {
        queryRef = queryRef.startAfter(cursorDoc);
      }
    }

    const campaignsSnap = await queryRef.limit(limit).get();
    const campaignsList: any[] = [];
    let nextCursor: string | null = null;

    for (const doc of campaignsSnap.docs) {
      nextCursor = doc.id; // The last evaluated doc ID becomes the next cursor
      const data = doc.data();
      const campaign: any = { ...data, id: doc.id };

      // Evaluate permission to view this campaign
      const hasPerm = await checkPermission(role, 'campaign', 'view', {
        userUid,
        resourceData: campaign,
      });

      if (hasPerm) {
        // Enforce financial data stripping server-side at serialization
        if (role === 'agency' || role === 'external_agency') {
          delete campaign.budget;
          delete campaign.budgetPlanned;
          delete campaign.budgetSpent;
          delete campaign.financial_summary;
          delete campaign.performance_metrics;
        }
        campaignsList.push(campaign);
      }
    }

    // If we fetched fewer docs than the limit, we've hit the end of the collection
    if (campaignsSnap.docs.length < limit) {
      nextCursor = null;
    }

    return res.json({ success: true, campaigns: campaignsList, nextCursor });
  } catch (err: any) {
    next(err);
  }
});

/**
 * GET /api/campaigns/:id
 * Returns a single campaign document, stripped of financials if agency.
 */
router.get('/:id', async (req: AuthedRequest, res: Response, next) => {
  try {
    const { id } = req.params;
    const role = req.role || 'agency';
    const userUid = req.uid!;

    const doc = await db.collection('campaigns').doc(id).get();
    if (!doc.exists) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    const campaign: any = { ...doc.data(), id: doc.id };

    const hasPerm = await checkPermission(role, 'campaign', 'view', {
      userUid,
      resourceData: campaign,
    });

    if (!hasPerm) {
      return res.status(403).json({ success: false, error: 'Forbidden: insufficient permissions' });
    }

    // Strip financials
    if (role === 'agency' || role === 'external_agency') {
      delete campaign.budget;
      delete campaign.budgetPlanned;
      delete campaign.budgetSpent;
      delete campaign.financial_summary;
      delete campaign.performance_metrics;
    }

    return res.json({ success: true, campaign });
  } catch (err: any) {
    next(err);
  }
});

/**
 * POST /api/campaigns
 */
router.post('/', validate(CreateCampaignSchema), async (req: AuthedRequest, res: Response, next) => {
  try {
    const role = req.role || 'agency';
    const userUid = req.uid!;

    const hasPerm = await checkPermission(role, 'campaign', 'create', { userUid });
    if (!hasPerm) {
      return res.status(403).json({ success: false, error: 'Forbidden: cannot create campaigns' });
    }

    const payload = req.body; // already whitelisted by Zod
    const campaignId = payload.id || db.collection('campaigns').doc().id;
    delete payload.id;

    await db.collection('campaigns').doc(campaignId).set({
      ...payload,
      createdAt: new Date().toISOString(),
      createdBy: userUid,
    });

    return res.json({ success: true, id: campaignId });
  } catch (err: any) {
    next(err);
  }
});

/**
 * PUT /api/campaigns/:id
 */
// Create a partial schema for updates so we reject unknown fields but don't require all fields
const UpdateCampaignSchema = CreateCampaignSchema.partial().strict();

router.put('/:id', validate(UpdateCampaignSchema), async (req: AuthedRequest, res: Response, next) => {
  try {
    const { id } = req.params;
    const role = req.role || 'agency';
    const userUid = req.uid!;

    const docRef = db.collection('campaigns').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    const campaign = { ...docSnap.data(), id: docSnap.id };

    const hasPerm = await checkPermission(role, 'campaign', 'edit', {
      userUid,
      resourceData: campaign,
    });

    if (!hasPerm) {
      return res.status(403).json({ success: false, error: 'Forbidden: cannot edit this campaign' });
    }

    const payload = req.body;
    delete payload.id;

    await docRef.set({
      ...payload,
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    return res.json({ success: true });
  } catch (err: any) {
    next(err);
  }
});

/**
 * DELETE /api/campaigns/:id
 */
router.delete('/:id', async (req: AuthedRequest, res: Response, next) => {
  try {
    const { id } = req.params;
    const role = req.role || 'agency';
    const userUid = req.uid!;

    const docRef = db.collection('campaigns').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    const campaign = { ...docSnap.data(), id: docSnap.id };

    const hasPerm = await checkPermission(role, 'campaign', 'delete', {
      userUid,
      resourceData: campaign,
    });

    if (!hasPerm) {
      return res.status(403).json({ success: false, error: 'Forbidden: cannot delete this campaign' });
    }

    await docRef.delete();

    return res.json({ success: true });
  } catch (err: any) {
    next(err);
  }
});

export default router;
