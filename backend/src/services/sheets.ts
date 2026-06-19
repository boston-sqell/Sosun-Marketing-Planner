import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

let authClient: any = null;

export function getGoogleAuth(): any {
  if (authClient) return authClient;

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (email && privateKey) {
    // Replace literal '\n' characters in the key if passed via environment variables
    privateKey = privateKey.replace(/\\n/g, '\n');
    authClient = new google.auth.JWT(
      email,
      undefined,
      privateKey,
      ['https://www.googleapis.com/auth/spreadsheets']
    );
    console.log('Google Sheets service initialized with service account.');
    return authClient;
  }

  // Fallback to Application Default Credentials (for Cloud Run production environment)
  console.log('Google Sheets service falling back to Application Default Credentials.');
  authClient = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  return authClient;
}

const sheets = google.sheets('v4');

export async function readSheet(spreadsheetId: string, range: string) {
  try {
    const auth = getGoogleAuth();
    const response = await sheets.spreadsheets.values.get({
      auth,
      spreadsheetId,
      range,
    });
    return response.data.values || [];
  } catch (error: any) {
    console.error('Error reading sheet:', error.message);
    throw error;
  }
}

export async function appendRow(spreadsheetId: string, range: string, values: any[]) {
  try {
    const auth = getGoogleAuth();
    await sheets.spreadsheets.values.append({
      auth,
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [values],
      },
    });
  } catch (error: any) {
    console.error('Error appending row to sheet:', error.message);
    throw error;
  }
}

export async function updateRow(spreadsheetId: string, range: string, values: any[]) {
  try {
    const auth = getGoogleAuth();
    await sheets.spreadsheets.values.update({
      auth,
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [values],
      },
    });
  } catch (error: any) {
    console.error('Error updating row in sheet:', error.message);
    throw error;
  }
}

export async function clearRange(spreadsheetId: string, range: string) {
  try {
    const auth = getGoogleAuth();
    await sheets.spreadsheets.values.clear({
      auth,
      spreadsheetId,
      range,
    });
  } catch (error: any) {
    console.error('Error clearing range in sheet:', error.message);
    throw error;
  }
}

// Ensures a tab (sheet) with the given name exists, creating it if missing.
// Needed before writing to a range like 'CONFIG!A1' that may not exist yet.
export async function ensureSheet(spreadsheetId: string, sheetName: string) {
  const auth = getGoogleAuth();
  const meta = await sheets.spreadsheets.get({ auth, spreadsheetId, fields: 'sheets.properties.title' });
  const exists = (meta.data.sheets || []).some((s: any) => s.properties?.title === sheetName);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      auth,
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
    });
  }
}

// Bulk update sheets (clears range and writes all values)
export async function writeAllRows(spreadsheetId: string, range: string, headers: string[], rows: any[][]) {
  try {
    const auth = getGoogleAuth();
    
    const [sheetName] = range.split('!');
    const endCol = range.split(':')[1].replace(/\d+/, '');
    const totalNewRows = rows.length + 1; // headers + rows
    const updateRange = `${sheetName}!A1:${endCol}${totalNewRows}`;
    
    // 1. Overwrite existing rows first
    await sheets.spreadsheets.values.update({
      auth,
      spreadsheetId,
      range: updateRange,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [headers, ...rows],
      },
    });

    // 2. Clear any leftover rows below the new range to clean up old data
    const clearRangeStr = `${sheetName}!A${totalNewRows + 1}:${endCol}10000`;
    await clearRange(spreadsheetId, clearRangeStr);
  } catch (error: any) {
    console.error('Error performing bulk write to sheet:', error.message);
    throw error;
  }
}
