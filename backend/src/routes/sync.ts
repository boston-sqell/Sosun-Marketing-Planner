import { Router } from 'express';
import { db } from '../services/firestore';
import { writeAllRows, readSheet, ensureSheet } from '../services/sheets';
import { requireAuth, requireRole } from '../middleware/auth';

const router = Router();
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1P8d6WWEmSNLLkdu8kMzPQuBq_nbboVaHIP7-JUYwNpg';

// Helper to format date objects/strings back to DD/MM/YYYY for Sheets
const formatDateForSheets = (dateStr: any): string => {
  if (!dateStr) return '';
  // If it's already DD/MM/YYYY, keep it
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) return dateStr;
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return String(dateStr);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  } catch {
    return String(dateStr);
  }
};

// Helper to parse date strings from Sheets (DD/MM/YYYY) back to Firestore (YYYY-MM-DD)
const parseDateFromSheets = (dateStr: any): string => {
  if (!dateStr) return '';
  const str = String(dateStr).trim();
  const match = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    const year = match[3];
    return `${year}-${month}-${day}`;
  }
  return str;
};

// POST /api/sync/push - Push all Firestore data into Google Sheets
router.post('/push', requireAuth, requireRole('admin', 'internal'), async (req, res, next) => {
  try {
    console.log('Starting push sync from Firestore to Google Sheets...');
    
    // 1. Sync CAMPAIGNS
    const campaignsSnapshot = await db.collection('campaigns').get();
    const campaignsData: any[] = [];
    campaignsSnapshot.forEach(doc => {
      const data = doc.data();
      campaignsData.push({
        id: doc.id,
        name: data.name || '',
        brand: data.brand || '',
        type: data.type || '',
        startDate: formatDateForSheets(data.startDate),
        endDate: formatDateForSheets(data.endDate),
        status: data.status || '',
        objective: data.objective || '',
        platforms: Array.isArray(data.platforms) ? data.platforms.join(', ') : (data.platforms || ''),
        postsPlanned: data.postsPlanned || 0,
        budget: data.budget || 0,
        notes: data.notes || '',
        assetLinks: Array.isArray(data.assetLinks)
          ? data.assetLinks.join(' | ')
          : (data.assetLink || '')
      });
    });

    const campaignHeaders = [
      'Campaign ID', 'Campaign Name', 'Brand', 'Type', 'Start Date', 
      'End Date', 'Status', 'Objective', 'Platforms', 'Posts Planned', 'Budget', 'Notes', 'Asset Links'
    ];
    const campaignRows = campaignsData.map(c => [
      c.id, c.name, c.brand, c.type, c.startDate, c.endDate, 
      c.status, c.objective, c.platforms, c.postsPlanned, c.budget, c.notes, c.assetLinks
    ]);

    await writeAllRows(SPREADSHEET_ID, 'CAMPAIGNS!A1:M', campaignHeaders, campaignRows);
    console.log(`Campaigns synced: ${campaignsData.length} records.`);

    // 2. Sync POSTS (Tasks / Content Calendar)
    const postsSnapshot = await db.collection('tasks').get();
    const postsData: any[] = [];
    postsSnapshot.forEach(doc => {
      const data = doc.data();
      // Post-absorption, `tasks` also holds planner-native items (campaign,
      // event, creative_task, …); only legacy task/meeting shapes belong in
      // the POSTS sheet.
      if (data.typeId && data.typeId !== 'task' && data.typeId !== 'meeting') return;
      postsData.push({
        id: doc.id,
        title: data.title || '',
        brand: data.brand || '',
        platform: Array.isArray(data.platforms) ? data.platforms.join(', ') : (data.platform || ''),
        contentType: data.contentType || '',
        campaignId: data.campaignId || '',
        priority: data.priority || '',
        status: data.status || '',
        assignedTo: data.assignedTo || '',
        submittedBy: data.submittedBy || '',
        briefDate: formatDateForSheets(data.briefDate),
        draftDueDate: formatDateForSheets(data.draftDueDate),
        reviewDeadline: formatDateForSheets(data.reviewDeadline),
        scheduledDate: formatDateForSheets(data.scheduledDate),
        scheduledTime: data.scheduledTime || '',
        publishedDate: formatDateForSheets(data.publishedDate),
        assetLink: data.assetLink || '',
        caption: data.caption || '',
        hashtags: data.hashtags || '',
        notes: data.notes || '',
        approvedBy: data.approvedBy || '',
        overdue: data.overdue === true || data.overdue === 'TRUE' ? 'TRUE' : 'FALSE'
      });
    });

    const postHeaders = [
      'Post ID', 'Title', 'Brand', 'Platform', 'Content Type', 'Campaign ID',
      'Priority', 'Status', 'Assigned To', 'Submitted By', 'Brief Date', 
      'Draft Due Date', 'Review Deadline', 'Scheduled Date', 'Scheduled Time', 
      'Published Date', 'Asset Link', 'Caption', 'Hashtags', 'Notes', 'Approved By', 'Overdue'
    ];
    const postRows = postsData.map(p => [
      p.id, p.title, p.brand, p.platform, p.contentType, p.campaignId,
      p.priority, p.status, p.assignedTo, p.submittedBy, p.briefDate,
      p.draftDueDate, p.reviewDeadline, p.scheduledDate, p.scheduledTime,
      p.publishedDate, p.assetLink, p.caption, p.hashtags, p.notes, p.approvedBy, p.overdue
    ]);

    await writeAllRows(SPREADSHEET_ID, 'POSTS!A1:V', postHeaders, postRows);
    console.log(`Posts/Tasks synced: ${postsData.length} records.`);

    // 3. Sync BRANDS (backup of the brand portfolio)
    const brandsSnapshot = await db.collection('brands').get();
    const brandHeaders = ['Brand ID', 'Name', 'Code', 'Principal', 'Country', 'Color', 'Active', 'Created At'];
    const brandRows: any[][] = [];
    brandsSnapshot.forEach(doc => {
      const b = doc.data();
      brandRows.push([
        doc.id, b.name || '', b.code || '', b.principal || '',
        b.countryOfOrigin || '', b.color || '',
        b.active === false ? 'FALSE' : 'TRUE', b.createdAt || ''
      ]);
    });
    await ensureSheet(SPREADSHEET_ID, 'BRANDS');
    await writeAllRows(SPREADSHEET_ID, 'BRANDS!A1:H', brandHeaders, brandRows);
    console.log(`Brands synced: ${brandRows.length} records.`);

    res.json({
      success: true,
      message: 'Firestore data pushed to Google Sheets successfully.',
      campaignsSynced: campaignsData.length,
      postsSynced: postsData.length,
      brandsSynced: brandRows.length
    });
  } catch (error: any) {
    next(error);
  }
});

// POST /api/sync/import - Fetch data from Google Sheets and import/update in Firestore
router.post('/import', requireAuth, requireRole('admin', 'internal'), async (req, res, next) => {
  try {
    console.log('Starting import sync from Google Sheets to Firestore...');

    // 1. Import CAMPAIGNS
    const campaignsSheetData = await readSheet(SPREADSHEET_ID, 'CAMPAIGNS!A1:M');
    let campaignsImported = 0;

    if (campaignsSheetData.length > 1) {
      const headers = campaignsSheetData[0].map(h => String(h).trim());
      const rows = campaignsSheetData.slice(1);

      // Chunk writes to bypass Firestore's 500 batch limit
      const CHUNK_SIZE = 500;
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        const batch = db.batch();

        for (const row of chunk) {
          if (!row[0]) continue; // Skip if Campaign ID is missing
          const campaignId = String(row[0]).trim();
          const obj: any = {};
          
          headers.forEach((header, index) => {
            const val = row[index] !== undefined ? row[index] : null;
            // Normalize header names to camelCase for firestore
            const map: { [key: string]: string } = {
              'Campaign ID': 'id',
              'Campaign Name': 'name',
              'Brand': 'brand',
              'Type': 'type',
              'Start Date': 'startDate',
              'End Date': 'endDate',
              'Status': 'status',
              'Objective': 'objective',
              'Platforms': 'platforms',
              'Posts Planned': 'postsPlanned',
              'Budget': 'budget',
              'Notes': 'notes',
              'Asset Links': 'assetLinks'
            };
            const key = map[header];
            if (key) {
              if (key === 'platforms' && val) {
                obj[key] = String(val).split(',').map(p => p.trim()).filter(Boolean);
              } else if (key === 'assetLinks') {
                // Push joins assetLinks with ' | '; split back into an array (round-trip safe).
                obj[key] = val ? String(val).split('|').map(s => s.trim()).filter(Boolean) : [];
              } else if (key === 'postsPlanned' || key === 'budget') {
                obj[key] = Number(val) || 0;
              } else if (key === 'startDate' || key === 'endDate') {
                obj[key] = parseDateFromSheets(val);
              } else {
                obj[key] = val;
              }
            }
          });

          const docRef = db.collection('campaigns').doc(campaignId);
          batch.set(docRef, obj, { merge: true });
          campaignsImported++;
        }
        await batch.commit();
      }
    }

    // 2. Import POSTS (Tasks)
    const postsSheetData = await readSheet(SPREADSHEET_ID, 'POSTS!A1:V');
    let postsImported = 0;

    if (postsSheetData.length > 1) {
      const headers = postsSheetData[0].map(h => String(h).trim());
      const rows = postsSheetData.slice(1);

      // Chunk writes to bypass Firestore's 500 batch limit
      const CHUNK_SIZE = 500;
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        const batch = db.batch();

        for (const row of chunk) {
          if (!row[0]) continue; // Skip if Post ID is missing
          const postId = String(row[0]).trim();
          const obj: any = {};

          headers.forEach((header, index) => {
            const val = row[index] !== undefined ? row[index] : null;
            const map: { [key: string]: string } = {
              'Post ID': 'id',
              'Title': 'title',
              'Brand': 'brand',
              'Platform': 'platforms',
              'Content Type': 'contentType',
              'Campaign ID': 'campaignId',
              'Priority': 'priority',
              'Status': 'status',
              'Assigned To': 'assignedTo',
              'Submitted By': 'submittedBy',
              'Brief Date': 'briefDate',
              'Draft Due Date': 'draftDueDate',
              'Review Deadline': 'reviewDeadline',
              'Scheduled Date': 'scheduledDate',
              'Scheduled Time': 'scheduledTime',
              'Published Date': 'publishedDate',
              'Asset Link': 'assetLink',
              'Caption': 'caption',
              'Hashtags': 'hashtags',
              'Notes': 'notes',
              'Approved By': 'approvedBy',
              'Overdue': 'overdue'
            };
            const key = map[header];
            if (key) {
              if (key === 'platforms' && val) {
                obj[key] = String(val).split(',').map(p => p.trim()).filter(Boolean);
              } else if (key === 'overdue') {
                obj[key] = val === true || val === 'TRUE';
              } else if (['briefDate', 'draftDueDate', 'reviewDeadline', 'scheduledDate', 'publishedDate'].includes(key)) {
                obj[key] = parseDateFromSheets(val);
              } else {
                obj[key] = val;
              }
            }
          });

          const docRef = db.collection('tasks').doc(postId);
          batch.set(docRef, obj, { merge: true });
          postsImported++;
        }
        await batch.commit();
      }
    }

    res.json({
      success: true,
      message: 'Google Sheets data imported to Firestore successfully.',
      campaignsImported,
      postsImported
    });
  } catch (error: any) {
    next(error);
  }
});

export default router;
