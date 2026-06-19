import type { CampaignData, TaskData, FileAsset, UserItem } from './types';

// Centralized Mock Campaigns
export const mockCampaigns: CampaignData[] = [
  {
    id: 'C-EID-2026',
    name: 'Eid al-Adha Mega Sale',
    brand: 'Sosun Fihaara',
    type: 'Seasonal',
    startDate: '2026-05-01',
    endDate: '2026-06-20',
    status: 'Active',
    objective: 'Drive sales of kitchen appliances & cookware with up to 50% off',
    platforms: 'Instagram, TikTok, Facebook',
    postsPlanned: 12,
    budget: 4500,
    notes: 'Focus on big-ticket items; festive messaging, lifestyle visuals.'
  },
  {
    id: 'C-SB-2026',
    name: 'Sosun Book Summer Reading Challenge',
    brand: 'Sosun Book',
    type: 'Awareness',
    startDate: '2026-06-01',
    endDate: '2026-08-30',
    status: 'Active',
    objective: 'Encourage reading and grow the Sosun Book community',
    platforms: 'Instagram, Facebook',
    postsPlanned: 8,
    budget: 2000,
    notes: 'Partner with local authors; share weekly book recommendations.'
  },
  {
    id: 'C-COOK-2026',
    name: 'New Recipe Launch - Sosun Cook',
    brand: 'Sosun Cook',
    type: 'Product Launch',
    startDate: '2026-06-10',
    endDate: '2026-07-10',
    status: 'Planning',
    objective: 'Build anticipation around exclusive new recipe bundles',
    platforms: 'TikTok, Instagram',
    postsPlanned: 6,
    budget: 1500,
    notes: 'Collaborate with food bloggers; short recipe reel format.'
  },
  {
    id: 'C-FIT-2026',
    name: 'Fitness & Wellness Month',
    brand: 'Sosun Fihaara',
    type: 'Seasonal',
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    status: 'Draft',
    objective: 'Promote healthy kitchen gadgets and cookware for fitness enthusiasts',
    platforms: 'Instagram, TikTok, Facebook',
    postsPlanned: 10,
    budget: 3000,
    notes: 'Highlight air fryers, blenders, and meal-prep containers.'
  }
];

// Helper to get dynamic date offset for tasks (e.g. 18th of current month)
const getDynamicDate = (day: number): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const dayStr = String(day).padStart(2, '0');
  return `${year}-${month}-${dayStr}`;
};

// Centralized Mock Tasks (Content Planner entries)
export const mockTasks: TaskData[] = [
  {
    id: 'T-104',
    title: 'Eid Promo Reels Creative Assets',
    brand: 'Sosun Fihaara',
    platforms: ['Instagram', 'TikTok'],
    contentType: 'Video',
    campaignId: 'C-EID-2026',
    priority: 'High',
    status: 'Draft Ready',
    assignedTo: 'Agency',
    submittedBy: 'Agency Partner',
    reviewDeadline: '2026-06-12',
    scheduledDate: getDynamicDate(18),
    scheduledTime: '18:00',
    caption: 'Get ready for the biggest Eid sale in town! Up to 50% off on all items! #SosunFihaara #EidSale',
    assetLink: 'https://drive.google.com/drive/folders/mock',
    notes: 'Make sure the background music is local/festive.',
    progress: 60,
    checklist: [
      { id: '1', text: 'Shoot product videos', done: true },
      { id: '2', text: 'Edit reels', done: true },
      { id: '3', text: 'Submit draft for review', done: false }
    ],
    comments: [
      { id: 'c1', user: 'Agency Partner', role: 'agency', text: 'First draft upload to the drive folder. Awaiting feedback.', time: '10:30 AM, Today' }
    ]
  },
  {
    id: 'T-108',
    title: 'TikTok Kitchenware Cooking Demo',
    brand: 'Sosun Cook',
    platforms: ['TikTok'],
    contentType: 'Video',
    campaignId: 'C-COOK-LAUNCH',
    priority: 'Medium',
    status: 'Brief Sent',
    assignedTo: 'Agency',
    submittedBy: 'Aminath Ali',
    reviewDeadline: '2026-06-15',
    scheduledDate: getDynamicDate(15),
    scheduledTime: '11:00',
    notes: 'Feature the non-stick skillet in a cooking demo recipe.',
    progress: 33,
    checklist: [
      { id: '1', text: 'Draft recipe card', done: true },
      { id: '2', text: 'Film cooking session', done: false },
      { id: '3', text: 'Video editing', done: false }
    ],
    comments: []
  },
  {
    id: 'T-110',
    title: 'June Clearance Sale Announcement',
    brand: 'Sosun Fihaara',
    platforms: ['Facebook', 'Instagram'],
    contentType: 'Image',
    campaignId: 'C-EID-2026',
    priority: 'High',
    status: 'Approved',
    assignedTo: 'Internal',
    submittedBy: 'Aminath Ali',
    reviewDeadline: '2026-06-10',
    scheduledDate: getDynamicDate(22),
    scheduledTime: '09:30',
    notes: 'Announce final date extension.',
    progress: 100,
    checklist: [],
    comments: []
  }
];

// Centralized Mock Assets
export const mockAssets: FileAsset[] = [
  {
    id: 'A-101',
    name: 'Eid_Sale_Reel_Draft_v1.mp4',
    type: 'video',
    url: 'https://sample-videos.com/video321/mp4/720/big_buck_bunny_720p_1mb.mp4',
    size: '1.2 MB',
    uploadedBy: 'Agency Partner',
    uploadedAt: '2026-06-08',
    campaignId: 'C-EID-2026'
  },
  {
    id: 'A-102',
    name: 'Banner_Promo_Graphics_Final.png',
    type: 'image',
    url: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?q=80&w=300',
    size: '420 KB',
    uploadedBy: 'Aminath Ali',
    uploadedAt: '2026-06-07',
    campaignId: 'C-EID-2026'
  },
  {
    id: 'A-103',
    name: 'Eid_Festive_Campaign_Brief.pdf',
    type: 'document',
    url: 'https://pdfobject.com/pdf/sample.pdf',
    size: '2.1 MB',
    uploadedBy: 'Aminath Ali',
    uploadedAt: '2026-06-05',
    campaignId: 'C-EID-2026'
  }
];

// Centralized Mock Users
export const mockUsers: UserItem[] = [
  { uid: 'mock-uid-1', displayName: 'Aminath Ali', email: 'aminath.ali@sosunfihaara.com', role: 'admin' },
  { uid: 'mock-uid-2', displayName: 'Ahmed Nazeer', email: 'ahmed@sosunfihaara.com', role: 'internal' },
  { uid: 'mock-uid-3', displayName: 'Agency Partner', email: 'agency@partner.com', role: 'agency' }
];
