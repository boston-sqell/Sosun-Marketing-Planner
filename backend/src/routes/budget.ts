import { Router, Response } from 'express';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { db } from '../services/firestore';
import { validate } from '../middleware/validate';
import { CreateBudgetEntrySchema } from '../schemas';

const router = Router();

router.use(requireAuth);

/**
 * GET /api/budget
 */
router.get('/', async (req: AuthedRequest, res: Response, next) => {
  try {
    const role = req.role || 'agency';
    // Only internal/admin can view global budget list
    if (role !== 'admin' && role !== 'internal') {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    
    const limit = 50;
    const { cursor, campaignId } = req.query;

    let queryRef = db.collection('budgetEntries').orderBy('spentAt', 'desc').orderBy('__name__', 'desc');
    
    if (campaignId) {
      // If filtering by campaignId, we might need a composite index. 
      // Assuming frontend handles it or we have an index.
      queryRef = db.collection('budgetEntries')
        .where('campaignId', '==', String(campaignId))
        .orderBy('spentAt', 'desc')
        .orderBy('__name__', 'desc');
    }

    if (cursor) {
      const cursorDoc = await db.collection('budgetEntries').doc(String(cursor)).get();
      if (cursorDoc.exists) {
        queryRef = queryRef.startAfter(cursorDoc);
      }
    }

    const snap = await queryRef.limit(limit).get();
    const entriesList: any[] = [];
    let nextCursor: string | null = null;

    for (const doc of snap.docs) {
      nextCursor = doc.id;
      entriesList.push({ ...doc.data(), id: doc.id });
    }

    if (snap.docs.length < limit) {
      nextCursor = null;
    }

    return res.json({ success: true, entries: entriesList, nextCursor });
  } catch (err: any) {
    next(err);
  }
});

/**
 * POST /api/budget
 * Uses a Firestore Transaction to safely increment the linked campaign's budgetSpent.
 */
router.post('/', validate(CreateBudgetEntrySchema), async (req: AuthedRequest, res: Response, next) => {
  try {
    const role = req.role || 'agency';
    if (role !== 'admin' && role !== 'internal') {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const payload = req.body;
    const entryId = payload.id || db.collection('budgetEntries').doc().id;
    delete payload.id;

    const entryRef = db.collection('budgetEntries').doc(entryId);
    let campaignRef: FirebaseFirestore.DocumentReference | null = null;
    
    if (payload.campaignId) {
      campaignRef = db.collection('campaigns').doc(payload.campaignId);
    }

    await db.runTransaction(async (transaction) => {
      // If linked to a campaign, verify campaign exists
      if (campaignRef) {
        const campSnap = await transaction.get(campaignRef);
        if (!campSnap.exists) {
          throw new Error('Linked campaign does not exist');
        }
        
        const currentSpent = campSnap.data()?.budgetSpent || 0;
        transaction.update(campaignRef, {
          budgetSpent: currentSpent + payload.amount
        });
      }

      transaction.set(entryRef, {
        ...payload,
        createdAt: new Date().toISOString(),
        createdBy: req.uid,
      });
    });

    return res.json({ success: true, id: entryId });
  } catch (err: any) {
    // Return 400 for transaction validation errors
    if (err.message === 'Linked campaign does not exist') {
      return res.status(400).json({ success: false, error: err.message });
    }
    next(err);
  }
});

/**
 * PUT /api/budget/:id
 * Uses a Transaction to adjust campaign budgetSpent if amount or campaign link changes.
 */
const UpdateBudgetSchema = CreateBudgetEntrySchema.partial().strict();

router.put('/:id', validate(UpdateBudgetSchema), async (req: AuthedRequest, res: Response, next) => {
  try {
    const { id } = req.params;
    const role = req.role || 'agency';
    if (role !== 'admin' && role !== 'internal') {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const payload = req.body;
    delete payload.id;
    const entryRef = db.collection('budgetEntries').doc(id);

    await db.runTransaction(async (transaction) => {
      const entrySnap = await transaction.get(entryRef);
      if (!entrySnap.exists) {
        throw new Error('Budget entry not found');
      }

      const oldData = entrySnap.data()!;
      const oldAmount = oldData.amount || 0;
      const newAmount = payload.amount !== undefined ? payload.amount : oldAmount;
      
      const oldCid = oldData.campaignId;
      const newCid = payload.campaignId !== undefined ? payload.campaignId : oldCid;

      // Handle campaign budgetSpent adjustments
      if (oldCid === newCid && oldCid) {
        // Same campaign, maybe different amount
        if (oldAmount !== newAmount) {
          const campRef = db.collection('campaigns').doc(oldCid);
          const campSnap = await transaction.get(campRef);
          if (campSnap.exists) {
            const currentSpent = campSnap.data()?.budgetSpent || 0;
            transaction.update(campRef, { budgetSpent: currentSpent - oldAmount + newAmount });
          }
        }
      } else {
        // Campaign changed
        if (oldCid) {
          const oldCampRef = db.collection('campaigns').doc(oldCid);
          const oldCampSnap = await transaction.get(oldCampRef);
          if (oldCampSnap.exists) {
            const currentSpent = oldCampSnap.data()?.budgetSpent || 0;
            transaction.update(oldCampRef, { budgetSpent: currentSpent - oldAmount });
          }
        }
        if (newCid) {
          const newCampRef = db.collection('campaigns').doc(newCid);
          const newCampSnap = await transaction.get(newCampRef);
          if (newCampSnap.exists) {
            const currentSpent = newCampSnap.data()?.budgetSpent || 0;
            transaction.update(newCampRef, { budgetSpent: currentSpent + newAmount });
          }
        }
      }

      transaction.set(entryRef, {
        ...payload,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    });

    return res.json({ success: true });
  } catch (err: any) {
    if (err.message === 'Budget entry not found') {
      return res.status(404).json({ success: false, error: err.message });
    }
    next(err);
  }
});

/**
 * DELETE /api/budget/:id
 */
router.delete('/:id', async (req: AuthedRequest, res: Response, next) => {
  try {
    const { id } = req.params;
    const role = req.role || 'agency';
    if (role !== 'admin' && role !== 'internal') {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const entryRef = db.collection('budgetEntries').doc(id);

    await db.runTransaction(async (transaction) => {
      const entrySnap = await transaction.get(entryRef);
      if (!entrySnap.exists) {
        throw new Error('Budget entry not found');
      }

      const data = entrySnap.data()!;
      if (data.campaignId) {
        const campRef = db.collection('campaigns').doc(data.campaignId);
        const campSnap = await transaction.get(campRef);
        if (campSnap.exists) {
          const currentSpent = campSnap.data()?.budgetSpent || 0;
          transaction.update(campRef, { budgetSpent: currentSpent - (data.amount || 0) });
        }
      }

      transaction.delete(entryRef);
    });

    return res.json({ success: true });
  } catch (err: any) {
    if (err.message === 'Budget entry not found') {
      return res.status(404).json({ success: false, error: err.message });
    }
    next(err);
  }
});

export default router;
