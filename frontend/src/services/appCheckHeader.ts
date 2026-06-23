import { getToken } from 'firebase/app-check';
import { appCheck } from '../firebase/config';

/**
 * Returns the `X-Firebase-AppCheck` header for backend API calls.
 *
 * The backend enforces App Check in production (see backend middleware/auth.ts),
 * so every API wrapper must attach this header. Returns `{}` if a token cannot be
 * obtained (e.g. local dev without a debug token) so calls still work outside prod.
 */
export async function appCheckHeader(): Promise<Record<string, string>> {
  try {
    const result = await getToken(appCheck, /* forceRefresh */ false);
    return result?.token ? { 'X-Firebase-AppCheck': result.token } : {};
  } catch {
    return {};
  }
}
