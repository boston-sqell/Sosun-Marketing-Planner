import { Router, Response } from 'express';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { db } from '../services/firestore';
import { checkPermission } from '../middleware/rbac';

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

    // Fetch all campaigns from Firestore using Admin SDK (bypasses rules)
    const campaignsSnap = await db.collection('campaigns').orderBy('startDate', 'desc').get();
    const campaignsList: any[] = [];

    for (const doc of campaignsSnap.docs) {
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

    return res.json({ success: true, campaigns: campaignsList });
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

export default router;
