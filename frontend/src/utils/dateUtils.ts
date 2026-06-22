/**
 * Converts a DD/MM/YYYY date string to YYYY-MM-DD format (suitable for native date inputs).
 */
export const toISODate = (dateStr?: string): string => {
  if (!dateStr) return '';
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    const year = parts[2];
    return `${year}-${month}-${day}`;
  }
  return dateStr;
};

/**
 * Converts a YYYY-MM-DD date string to DD/MM/YYYY format (suitable for user display).
 */
export const toDisplayDate = (dateStr?: string): string => {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const year = parts[0];
    const month = parts[1].padStart(2, '0');
    const day = parts[2].padStart(2, '0');
    return `${day}/${month}/${year}`;
  }
  return dateStr;
};

/**
 * Parses a date string (either DD/MM/YYYY or YYYY-MM-DD) into a JavaScript Date object.
 */
export const parseDate = (dateStr?: string): Date | null => {
  if (!dateStr) return null;
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    return new Date(+parts[2], +parts[1] - 1, +parts[0]);
  }
  // Bare YYYY-MM-DD must be parsed as a LOCAL calendar day. `new Date('2026-06-22')`
  // is interpreted as UTC midnight, which renders as the previous day in any
  // timezone behind UTC — shifting calendar items by a day. Build it locally to
  // match the DD/MM/YYYY branch above.
  const iso = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    return new Date(+iso[1], +iso[2] - 1, +iso[3]);
  }
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
};

/**
 * Formats an ISO timestamp or Date string into a human-readable relative time representation.
 */
export const formatTimeAgo = (isoString?: string): string => {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    
    if (seconds < 0) return 'Just now';
    if (seconds < 60) return `${seconds}s ago`;
    
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    
    const days = Math.floor(hours / 24);
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return String(isoString);
  }
};
