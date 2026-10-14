import type { ManifestItem } from "../../supabase/functions/_shared/protocol";
export interface Binding {
  projectUrl: string;
  deviceId: string;
  eventId: string;
  eventName: string;
}
export interface SyncJob {
  sessionId: string;
  binding: Binding;
  manifest?: ManifestItem[];
  state: "pending" | "syncing" | "retry" | "blocked" | "synced";
  attempts: number;
  nextAttempt: number;
  uploaded: number[];
  error?: string;
  updatedAt: string;
}
