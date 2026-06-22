export type UserRole = 'admin' | 'internal' | 'agency' | 'external_agency' | 'media' | 'sponsor' | 'supplier';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  agencyName?: string;
}

export interface UserItem {
  uid: string;
  displayName: string;
  role: UserRole;
  email?: string; // email is optional
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface CommentItem {
  id: string;
  user: string;
  role: string;
  text: string;
  time: string;
  internalOnly?: boolean;
  internal_only?: boolean;
  createdAt?: string;
  userUid?: string;
  editedAt?: string;
}

export interface TaskData {
  id: string;
  title: string;
  brand: string;
  platforms: string[];
  contentType: string;
  campaignId: string;
  priority: string;
  status: string;
  statusId?: string;
  statusPhase?: string;
  isTerminal?: boolean;
  assignedTo: string;
  submittedBy: string;
  briefDate?: string;
  draftDueDate?: string;
  sharedDate?: string;       // date draft was shared for review (factual, not a deadline)
  /** @deprecated use sharedDate — kept for Firestore backward compat during migration */
  reviewDeadline?: string;
  scheduledDate?: string;
  scheduledTime?: string;
  publishedDate?: string;
  assetLink?: string;
  caption?: string;
  notes?: string;
  approvedBy?: string;
  overdue?: boolean;
  checklist?: ChecklistItem[];
  comments?: CommentItem[];
  progress?: number;
  createdAt?: string;      // ISO — used for newest-first ordering in Tasks & Queue

  // Meeting fields
  type?: 'task' | 'meeting';
  visibility?: 'internal' | 'agency' | 'external';
  startDate?: string;       // ISO datetime
  endDate?: string;         // ISO datetime
  location?: string;
  agenda?: string;
  invitedGuests?: string[]; // array of user UIDs
  calendarEventId?: string;
}

export interface CampaignData {
  id: string;
  name: string;
  brand: string;
  type: string;
  startDate: string;
  endDate: string;
  status: string;
  objective: string;
  platforms: string;
  postsPlanned: number;
  budget: number;
  notes: string;
  assetLink?: string;        // legacy single link (first of assetLinks)
  assetLinks?: string[];     // multiple post / asset links
  checklist?: ChecklistItem[]; // to-dos; completion drives campaign progress
  budgetPlanned?: number;
  budgetSpent?: number;
}

export interface FileAsset {
  id: string;
  name: string;
  type: string;
  url: string;
  size: string;
  uploadedBy: string;
  uploadedAt: string;
  campaignId?: string;
}

/* ------------------------- Media & Asset Library (DAM) ------------------------- */

export type MediaFileType =
  | 'image' | 'video' | 'document' | 'gdoc' | 'gsheet' | 'gslide'
  | 'pdf' | 'archive' | 'folder' | 'other';

export type AssetStatus = 'Draft' | 'Review' | 'Changes Requested' | 'Approved' | 'Archived';

/**
 * Metadata-only index of a Google Drive asset. Drive remains the source of
 * truth for the bytes; this record only supports search, linking and workflow.
 */
export interface MediaAsset {
  id: string;
  driveFileId: string;
  driveFolderId: string;
  name: string;
  mimeType: string;
  fileType: MediaFileType;
  sizeBytes: number;
  size: string;
  campaignId?: string | null;
  campaignIds?: string[];
  tags: string[];
  category?: string | null;
  version: string;
  versionNumber?: number;
  versionGroupId: string;
  status: AssetStatus;
  uploadedBy: string;
  uploadedByUid?: string | null;
  uploadedAt: string;
  driveModifiedTime?: string | null;
  webViewLink?: string | null;
  iconLink?: string | null;
  notes?: string;
  syncedAt?: string;
  isPublic?: boolean;
  publicViewUrl?: string | null;
  webContentLink?: string | null;
}

export interface DriveRevision {
  id: string;
  modifiedTime?: string;
  size: string;
  keepForever: boolean;
  modifiedBy: string;
}

export interface ActivityEntry {
  id: string;
  type: 'created' | 'comment' | 'status' | 'version' | 'linked' | 'imported';
  user: string;
  role?: string;
  text?: string;
  time: string;
}

export interface MediaMetrics {
  totalAssets: number;
  totalFiles: number;
  recentUploads7d: number;
  pendingApprovals: number;
  approved: number;
  storageBytes: number;
  byType: Record<string, number>;
  byCampaign: Record<string, number>;
  recentUploads: { id: string; name: string; fileType: string; uploadedBy: string; uploadedAt: string; status: string }[];
}

export interface DriveFolderRef {
  root: string;
  url: string;
  subfolders: Record<string, string>;
}

export interface WorkspaceConfig {
  rootFolderId: string;
  rootFolderName: string;
  rootFolderUrl: string;
  topLevelFolders: string[];
  campaignTemplate: string[];
  topLevelFolderIds: Record<string, string>;
  configured: boolean;
}

/* ----------------------------- Brands (first-class) ----------------------------- */

export interface Brand {
  id: string;
  name: string;            // matches legacy `brand` strings on tasks/campaigns
  code: string;            // short slug, e.g. "SCK"
  principal?: string;      // international principal / supplier
  countryOfOrigin?: string;
  color: string;           // hex accent for calendar chips & dashboard
  active: boolean;
  createdAt: string;       // ISO
}

/* ------------------------- Events & Sponsorships ------------------------- */

export type EventType = 'tradeshow' | 'exhibition' | 'sponsorship' | 'activation';
export type EventStatus = 'Scoping' | 'Confirmed' | 'Preparing' | 'Live' | 'Wrapped' | 'Reported';

export interface EventData {
  id: string;
  name: string;
  type: EventType;
  venue: string;
  city: string;
  brands: string[];        // brand names (multi-brand sponsorships)
  startDate: string;       // YYYY-MM-DD
  endDate: string;         // YYYY-MM-DD
  status: EventStatus;
  sponsorshipCost: number;
  expectedFootfall?: number;
  leadsCaptured?: number;
  salesAttributed?: number;
  ownerUid?: string;
  notes?: string;
}

export type PackingStatus = 'requested' | 'packed' | 'shipped' | 'on-site' | 'returned' | 'damaged';

export interface PackingItem {
  id: string;
  assetName: string;
  mediaAssetId?: string | null;
  qty: number;
  status: PackingStatus;
  updatedByUid?: string | null;
  updatedAt?: string;      // ISO
}

export type LogisticsKind = 'shipment' | 'booth' | 'staffing' | 'permit';
export type LogisticsStatus = 'pending' | 'in-progress' | 'done';

export interface LogisticsLeg {
  id: string;
  kind: LogisticsKind;
  description: string;
  dueDate: string;         // YYYY-MM-DD
  status: LogisticsStatus;
  cost: number;
}

/* ------------------------- Outlets & Distributions ------------------------- */

export type OutletTier = 'A' | 'B' | 'C';

export interface Outlet {
  id: string;
  name: string;
  code: string;
  region: string;
  address?: string;
  tier: OutletTier;
  brands?: string[];       // brands assigned to this outlet
  contactName?: string;
  contactPhone?: string;
  active: boolean;
}

export type DistributionType =
  | 'window-sticker' | 'shelf-strip' | 'wobbler' | 'shelf' | 'standee'
  | 'poster' | 'fridge' | 'display-stand' | 'billboard' | 'other';
export type DistributionStatus = 'allocated' | 'dispatched' | 'installed' | 'verified' | 'removed';

export interface Distribution {
  id: string;
  outletId: string;
  outletName: string;      // denormalized for list rendering
  brand: string;           // brand name
  assetName: string;
  mediaAssetId?: string | null;
  type: DistributionType;
  qty: number;
  status: DistributionStatus;
  activityDate?: string;         // YYYY-MM-DD — when the activity was done
  installedAt?: string | null;   // ISO
  verifiedByUid?: string | null;
  photoAssetId?: string | null;
  updatedAt?: string;            // ISO
}

/* ------------------------------ Budget Ledger ------------------------------ */

export type BudgetCategory =
  | 'media' | 'production' | 'sponsorship' | 'logistics' | 'print'
  | 'marketing-agency' | 'billboards' | 'tasting-events' | 'other';

export interface BudgetEntry {
  id: string;
  brand: string;           // brand name
  campaignId?: string | null;
  eventId?: string | null;
  category: BudgetCategory;
  description: string;
  notes?: string;          // optional detail / internal note
  amount: number;
  currency: 'MVR' | 'USD';
  spentAt: string;         // YYYY-MM-DD
  enteredByUid?: string;
  enteredBy?: string;
  createdAt?: string;      // ISO
}

/* ------------------------------ Brand Reports ------------------------------ */

export interface BrandMonthlyReport {
  brand: string;
  period: string;          // 'YYYY-MM'
  spend: { total: number; byCategory: Record<string, number> };
  campaigns: { active: number; completed: number; budgetPlanned: number; budgetSpent: number };
  content: { published: number; overdue: number; byPlatform: Record<string, number> };
  events: Array<{
    name: string; status: string; totalCost: number;
    leads: number; salesAttributed: number; roi: number | null;
  }>;
  retail: { outletsCovered: number; installed: number; verified: number };
  /** Present on combined all-brands reports. */
  brandBreakdown?: Array<{ brand: string; spend: number; published: number; activeCampaigns: number }>;
}

export interface ReportDoc {
  id: string;
  brand: string;
  period: string;
  status: 'generating' | 'ready' | 'failed';
  generatedAt?: string;    // ISO
  error?: string;
  payload?: BrandMonthlyReport;
}

/* --------------------------- News Sentinel (brand monitoring) --------------------------- */

/** A news feed/page the scanner polls. Admin-managed from the News page settings tab. */
export interface NewsSource {
  id: string;
  name: string;            // display, e.g. "Avas"
  url: string;             // 'rss': feed URL. 'html': a listing/section page URL to scrape.
  type: 'rss' | 'html' | 'json';  // RSS/Atom feed · scrape listing page · JSON API
  /** 'html' only: regex (string) matching article href paths, e.g. "/\\d{4,}$". */
  linkPattern?: string;
  // 'json' only — config-driven extraction from an article-list API:
  jsonItemsPath?: string;  // dot path to the array (e.g. "data")
  jsonTitleField?: string;
  jsonExcerptField?: string;
  jsonLinkField?: string;
  jsonDateField?: string;
  linkBase?: string;       // prepended to relative links
  useProxy?: boolean;      // route fetch through PROXY_URL (Cloudflare-blocked sites)
  enabled: boolean;
  createdAt: string;       // ISO
  createdBy?: string;      // uid
}

/** A watch-term tied (optionally) to a brand NAME string — aligns with BrandScopeContext. */
export interface NewsKeyword {
  id: string;
  keyword: string;         // case-insensitive, word-boundary match
  brand: string | null;    // brand NAME string (not id), or null for un-mapped terms
  enabled: boolean;
  createdAt: string;       // ISO
}

export type NewsMentionStatus = 'new' | 'added' | 'dismissed';
export type NewsSentiment = 'positive' | 'neutral' | 'negative';

/** A detected article. Created exclusively by the backend scan worker (Admin SDK). */
export interface NewsMention {
  id: string;                    // = sha1(url), so re-detection is idempotent
  title: string;
  url: string;
  urlHash: string;
  source: string;                // NewsSource.name
  excerpt: string;
  matchedKeywords: string[];
  brands: string[];              // resolved brand NAME strings
  sentiment?: NewsSentiment;     // heuristic, best-effort
  detectedAt: string;            // ISO timestamp
  date: string;                  // 'YYYY-MM-DD'
  status: NewsMentionStatus;
  plannerTaskId?: string;        // set when promoted into the tasks collection
  plannerPriority?: string;      // mirror of the created task's priority for the card badge
  createdAt: string;             // ISO — orderBy('createdAt','desc')
}
