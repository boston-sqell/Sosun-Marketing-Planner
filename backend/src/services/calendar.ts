import { google } from 'googleapis';

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';

let authClient: any = null;

export function getCalendarAuth(): any {
  if (authClient) return authClient;

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (email && privateKey) {
    privateKey = privateKey.replace(/\\n/g, '\n');
    authClient = new google.auth.JWT(
      email,
      undefined,
      privateKey,
      [CALENDAR_SCOPE]
    );
    console.log('Google Calendar service initialized with service account.');
    return authClient;
  }

  // Fallback to Application Default Credentials (for Cloud Run production environment)
  console.log('Google Calendar service falling back to Application Default Credentials.');
  authClient = new google.auth.GoogleAuth({
    scopes: [CALENDAR_SCOPE]
  });
  return authClient;
}

const calendar = google.calendar('v3');
const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';

export async function createCalendarEvent(meeting: any, guestEmails: string[]): Promise<string | null> {
  try {
    const auth = getCalendarAuth();
    const event = {
      summary: meeting.title,
      location: meeting.location || '',
      description: meeting.agenda || '', // Strictly omit internal meeting.notes
      start: {
        dateTime: meeting.startDate,
        timeZone: 'UTC',
      },
      end: {
        dateTime: meeting.endDate,
        timeZone: 'UTC',
      },
      attendees: guestEmails.map(email => ({ email })),
    };

    const response = await calendar.events.insert({
      auth,
      calendarId,
      requestBody: event,
      sendUpdates: 'all',
    });

    console.log('Google Calendar event created:', response.data.id);
    return response.data.id || null;
  } catch (error: any) {
    console.error('Error creating Google Calendar event:', error.message);
    throw error;
  }
}

export async function updateCalendarEvent(eventId: string, meeting: any, guestEmails: string[]): Promise<void> {
  try {
    const auth = getCalendarAuth();
    const event = {
      summary: meeting.title,
      location: meeting.location || '',
      description: meeting.agenda || '', // Strictly omit internal meeting.notes
      start: {
        dateTime: meeting.startDate,
        timeZone: 'UTC',
      },
      end: {
        dateTime: meeting.endDate,
        timeZone: 'UTC',
      },
      attendees: guestEmails.map(email => ({ email })),
    };

    await calendar.events.patch({
      auth,
      calendarId,
      eventId,
      requestBody: event,
      sendUpdates: 'all',
    });

    console.log('Google Calendar event updated:', eventId);
  } catch (error: any) {
    console.error('Error updating Google Calendar event:', error.message);
    throw error;
  }
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  try {
    const auth = getCalendarAuth();
    await calendar.events.delete({
      auth,
      calendarId,
      eventId,
      sendUpdates: 'all',
    });
    console.log('Google Calendar event deleted:', eventId);
  } catch (error: any) {
    console.error('Error deleting Google Calendar event:', error.message);
    throw error;
  }
}
