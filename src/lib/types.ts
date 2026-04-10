// FamilyHub Core Types

export interface Household {
  id: string;
  created_at: string;
  owner_user_id: string;
  digest_time: string; // HH:MM format, default "07:30"
}

export interface Child {
  id: string;
  household_id: string;
  name: string;
  school_name: string;
  year_group: string | null;
  created_at: string;
}

export interface ChildActivity {
  id: string;
  child_id: string;
  activity_name: string;
  day_of_week: string | null; // "Monday", "Tuesday", etc.
  time_slot: string | null; // "15:30-16:30"
  provider_name: string | null;
  notes: string | null;
  created_at: string;
}

export interface KnownSender {
  id: string;
  household_id: string;
  email_address: string;
  label: string; // "St Mary's School", "Football Club", "PTA"
  category: "school" | "club" | "pta" | "afterschool" | "other";
  created_at: string;
}

export interface ExtractedItem {
  id: string;
  household_id: string;
  type: "event" | "deadline" | "action" | "info";
  title: string;
  date: string | null; // ISO8601
  deadline: string | null; // ISO8601
  child_name: string | null;
  urgency: "high" | "medium" | "low";
  action_url: string | null;
  source_channel: "gmail" | "forwarded";
  source_subject: string;
  source_sender: string;
  confidence: number; // 0-1
  raw_snippet: string;
  event_fingerprint: string; // for dedup
  needs_review: boolean; // confidence < 0.7
  dismissed: boolean;
  corrected: boolean;
  gmail_message_id: string;
  created_at: string;
}

export interface ProcessingState {
  id: string;
  household_id: string;
  gmail_history_id: string | null;
  last_poll_at: string | null;
  initial_import_complete: boolean;
  initial_import_cursor: string | null; // page token for resumable import
  emails_processed: number;
  emails_classified_school: number;
  created_at: string;
}

// AI Pipeline types
export interface ClassificationResult {
  is_school_related: boolean;
  confidence: number;
  reason: string;
}

export interface ExtractionResult {
  type: ExtractedItem["type"];
  title: string;
  date: string | null;
  deadline: string | null;
  child_name: string | null;
  urgency: ExtractedItem["urgency"];
  action_url: string | null;
  confidence: number;
  event_fingerprint: string;
  raw_snippet: string;
}

// Gmail types
export interface GmailAttachment {
  filename: string;
  mimeType: string;
  data: Buffer; // raw attachment bytes
}

export interface GmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  body: string;
  htmlBody: string;
  snippet: string;
  attachments: GmailAttachment[];
}
