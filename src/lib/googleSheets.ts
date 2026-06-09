import { supabase } from './supabase';

export interface ExportQuestionRow {
  slNo: number;
  section: string;
  questionText: string;
  correctAnswer: any;
  selectedAnswer: any;
  marking: number;
  result: 'Correct' | 'Incorrect' | 'Skipped';
  timeSpent?: string;
}

export interface ExportHistoryRow {
  slNo: number;
  examTitle: string;
  submittedAt: string;
  attempted: number;
  correct: number;
  incorrect: number;
  skipped: number;
  score: number;
}

let cachedAccessToken: string | null = null;

export function getCachedToken() {
  return cachedAccessToken;
}

export function clearCachedToken() {
  cachedAccessToken = null;
}

// Google Authentication using Supabase OAuth
export async function authenticateGoogle(): Promise<string> {
  if (cachedAccessToken) {
    return cachedAccessToken;
  }

  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        scopes: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send',
        skipBrowserRedirect: false,
      }
    });

    if (error) {
      throw error;
    }

    // For OAuth, we need to get the provider token from the session
    const { data: { session } } = await supabase.auth.getSession();
    const providerToken = session?.provider_token;

    if (!providerToken) {
      throw new Error('Google authorization failed to return an access security token.');
    }

    cachedAccessToken = providerToken;
    return cachedAccessToken;
  } catch (error: any) {
    console.error('Google authorization sequence failed:', error);
    throw error;
  }
}

// Create dynamic spreadsheet
export async function createSpreadsheet(title: string, token: string): Promise<{ id: string; url: string }> {
  try {
    const response = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: {
          title: title,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Spreadsheet generation rejected: ${response.statusText} (${errText})`);
    }

    const data = await response.json();
    return {
      id: data.spreadsheetId,
      url: data.spreadsheetUrl,
    };
  } catch (error) {
    console.error('Spreadsheet instantiation protocol fault:', error);
    throw error;
  }
}

// Populate sheet values
export async function populateSpreadsheet(
  spreadsheetId: string,
  range: string,
  values: any[][],
  token: string
): Promise<void> {
  try {
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values,
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Data write block update failed: ${response.statusText} (${errText})`);
    }
  } catch (error) {
    console.error('Spreadsheet population protocol fault:', error);
    throw error;
  }
}
