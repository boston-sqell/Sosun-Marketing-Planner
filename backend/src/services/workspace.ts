import { db } from './firestore';
import { DEFAULT_TOP_LEVEL_FOLDERS, DEFAULT_CAMPAIGN_TEMPLATE } from './drive';

/**
 * The single workspace configuration document (settings/workspace).
 * Treating the configured root folder as the app's private file system means
 * everything else (top-level folder ids, campaign folder ids) hangs off this.
 */
export interface WorkspaceConfig {
  rootFolderId: string;
  rootFolderName: string;
  rootFolderUrl: string;
  topLevelFolders: string[];
  campaignTemplate: string[];
  topLevelFolderIds: Record<string, string>; // name -> Drive folder id
  configured: boolean;
  drivePageToken?: string; // Drive change-feed cursor for incremental sync
}

const WORKSPACE_DOC = db.collection('settings').doc('workspace');

const EMPTY: WorkspaceConfig = {
  rootFolderId: '',
  rootFolderName: '',
  rootFolderUrl: '',
  topLevelFolders: DEFAULT_TOP_LEVEL_FOLDERS,
  campaignTemplate: DEFAULT_CAMPAIGN_TEMPLATE,
  topLevelFolderIds: {},
  configured: false,
};

export async function getWorkspace(): Promise<WorkspaceConfig> {
  const snap = await WORKSPACE_DOC.get();
  if (!snap.exists) return { ...EMPTY };
  return { ...EMPTY, ...(snap.data() as Partial<WorkspaceConfig>) };
}

export async function saveWorkspace(patch: Partial<WorkspaceConfig>): Promise<WorkspaceConfig> {
  await WORKSPACE_DOC.set(patch, { merge: true });
  return getWorkspace();
}

/** Accepts a raw folder id or a Drive folder URL and returns the bare id. */
export function extractFolderId(input: string): string {
  if (!input) return '';
  const trimmed = input.trim();
  // .../folders/<id>  or  ?id=<id>
  const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) return folderMatch[1];
  const idParam = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParam) return idParam[1];
  return trimmed;
}

/** Accepts a raw file id or any Drive file/doc URL and returns the bare id. */
export function extractFileId(input: string): string {
  if (!input) return '';
  const trimmed = input.trim();
  // .../file/d/<id>, .../document/d/<id>, .../spreadsheets/d/<id>, .../folders/<id>
  const dMatch = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/) || trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (dMatch) return dMatch[1];
  const idParam = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParam) return idParam[1];
  return trimmed;
}
