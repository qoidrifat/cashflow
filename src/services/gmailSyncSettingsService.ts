import { apiGet, apiPut } from '../config/api';

export interface GmailSyncSettings {
  id: string;
  userId: string;
  autoSyncEnabled: boolean;
  syncIntervalMinutes: number;
  historyStartDate: string | null;
  lastHistorySyncAt: string | null;
  historySyncCompleted: boolean;
  lastSyncedAt: string | null;
  nextSyncAt: string | null;
  lastStatus: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastResultSummary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GmailSyncSettingsInput {
  autoSyncEnabled?: boolean;
  syncIntervalMinutes?: number;
  lastSyncedAt?: string;
  nextSyncAt?: string;
  lastStatus?: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  lastResultSummary?: string;
}

export async function getGmailSyncSettings(userId: string): Promise<GmailSyncSettings | null> {
  try {
    const res = await apiGet<any>('/api/gmail/settings');
    const now = new Date().toISOString();
    return {
      id: `settings-${userId}`,
      userId,
      autoSyncEnabled: !!res.autoSyncEnabled,
      syncIntervalMinutes: res.syncIntervalMinutes || 60,
      historyStartDate: null,
      lastHistorySyncAt: null,
      historySyncCompleted: true,
      lastSyncedAt: res.lastSyncAt || null,
      nextSyncAt: null,
      lastStatus: 'idle',
      lastErrorCode: null,
      lastErrorMessage: null,
      lastResultSummary: null,
      createdAt: now,
      updatedAt: now,
    };
  } catch {
    return null;
  }
}

export async function upsertGmailSyncSettings(
  userId: string,
  input: GmailSyncSettingsInput,
): Promise<GmailSyncSettings | null> {
  try {
    await apiPut('/api/gmail/settings', input);
    return getGmailSyncSettings(userId);
  } catch {
    return null;
  }
}

export async function toggleAutoSync(
  userId: string,
  enabled: boolean,
  intervalMinutes?: number,
): Promise<GmailSyncSettings | null> {
  return upsertGmailSyncSettings(userId, {
    autoSyncEnabled: enabled,
    syncIntervalMinutes: intervalMinutes || 60,
  });
}

export async function updateLastSyncResult(
  userId: string,
  result: {
    status: string;
    errorCode?: string;
    errorMessage?: string;
    summary?: string;
  },
  intervalMinutes?: number,
): Promise<GmailSyncSettings | null> {
  const now = new Date().toISOString();
  return upsertGmailSyncSettings(userId, {
    lastSyncedAt: now,
    lastStatus: result.status,
    lastErrorCode: result.errorCode,
    lastErrorMessage: result.errorMessage,
    lastResultSummary: result.summary,
    syncIntervalMinutes: intervalMinutes || 60,
  });
}

export function calculateNextSyncAt(
  lastSyncedAt: string | null,
  intervalMinutes: number,
): string {
  if (!lastSyncedAt) {
    return new Date(Date.now() + intervalMinutes * 60 * 1000).toISOString();
  }
  return new Date(new Date(lastSyncedAt).getTime() + intervalMinutes * 60 * 1000).toISOString();
}

export function shouldRunAutoSync(settings: GmailSyncSettings | null): boolean {
  if (!settings || !settings.autoSyncEnabled || !settings.nextSyncAt) return false;
  return new Date() >= new Date(settings.nextSyncAt);
}
