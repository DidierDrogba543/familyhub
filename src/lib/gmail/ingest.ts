import { createGmailClient, fetchEmails, fetchMessageContent } from "./client";
import { classifyEmail } from "../ai/classify";
import { extractFromEmail } from "../ai/extract";
import type {
  Child,
  ChildActivity,
  KnownSender,
  GmailMessage,
} from "../types";
import { SupabaseClient } from "@supabase/supabase-js";

const BATCH_SIZE = 30; // Emails per chunk (fits within Edge Function timeout)

interface IngestContext {
  householdId: string;
  children: Child[];
  activities: ChildActivity[];
  knownSenders: KnownSender[];
  supabase: SupabaseClient;
}

/**
 * Process a batch of emails through the classify → extract pipeline.
 * Designed for chunked execution within Edge Function timeout limits.
 *
 * Returns the number of items extracted and whether there are more emails to process.
 */
export async function ingestEmailBatch(
  ctx: IngestContext,
  gmailCredentials: { access_token: string; refresh_token: string; expiry_date: number },
  opts: {
    afterDate?: Date;
    pageToken?: string;
  }
): Promise<{
  itemsExtracted: number;
  emailsProcessed: number;
  emailsClassifiedSchool: number;
  nextPageToken: string | null;
  updatedCredentials: { access_token: string; expiry_date: number };
}> {
  const { gmail, credentials } = createGmailClient(gmailCredentials);

  // Fetch a batch of email IDs
  const { messages, nextPageToken } = await fetchEmails(gmail, {
    afterDate: opts.afterDate,
    pageToken: opts.pageToken,
    maxResults: BATCH_SIZE,
  });

  let itemsExtracted = 0;
  let emailsProcessed = 0;
  let emailsClassifiedSchool = 0;
  const today = new Date().toISOString().split("T")[0];

  for (const msg of messages) {
    if (!msg.id) continue;

    // Check if already processed (idempotency)
    const { data: existing } = await ctx.supabase
      .from("extracted_items")
      .select("id")
      .eq("gmail_message_id", msg.id)
      .eq("household_id", ctx.householdId)
      .limit(1);

    if (existing && existing.length > 0) {
      emailsProcessed++;
      continue;
    }

    let message: GmailMessage;
    try {
      message = await fetchMessageContent(gmail, msg.id);
    } catch (err) {
      console.error(`Failed to fetch message ${msg.id}:`, err);
      emailsProcessed++;
      continue;
    }

    // Stage 1: Classify
    const classification = await classifyEmail(
      message.subject,
      message.from,
      message.snippet || message.body.slice(0, 500),
      ctx.knownSenders,
      ctx.children
    );

    emailsProcessed++;

    if (!classification.is_school_related) {
      continue;
    }

    emailsClassifiedSchool++;

    // Stage 2: Extract
    const extractions = await extractFromEmail(
      message.subject,
      message.from,
      message.body,
      ctx.children,
      ctx.activities,
      today
    );

    if (extractions.length === 0) {
      // Email classified as school-related but nothing extractable
      // Store as an info item so it's not lost
      const { error } = await ctx.supabase.from("extracted_items").upsert(
        {
          household_id: ctx.householdId,
          type: "info",
          title: message.subject,
          urgency: "low",
          source_channel: "gmail",
          source_subject: message.subject,
          source_sender: message.from,
          confidence: classification.confidence,
          raw_snippet: message.snippet || message.body.slice(0, 200),
          event_fingerprint: `info-${msg.id}`,
          needs_review: classification.confidence < 0.7,
          gmail_message_id: msg.id,
        },
        { onConflict: "household_id,event_fingerprint" }
      );
      if (error) console.error("Failed to store info item:", error);
      itemsExtracted++;
      continue;
    }

    // Store extracted items (with dedup via event_fingerprint)
    for (const item of extractions) {
      const { error } = await ctx.supabase.from("extracted_items").upsert(
        {
          household_id: ctx.householdId,
          type: item.type,
          title: item.title,
          date: item.date,
          deadline: item.deadline,
          child_name: item.child_name,
          urgency: item.urgency,
          action_url: item.action_url,
          source_channel: "gmail",
          source_subject: message.subject,
          source_sender: message.from,
          confidence: item.confidence,
          raw_snippet: item.raw_snippet,
          event_fingerprint: item.event_fingerprint,
          needs_review: item.confidence < 0.7,
          gmail_message_id: msg.id,
        },
        { onConflict: "household_id,event_fingerprint" }
      );
      if (error && !error.message.includes("duplicate")) {
        console.error("Failed to store extracted item:", error);
      } else {
        itemsExtracted++;
      }
    }
  }

  // Update tokens if they were refreshed
  if (credentials.access_token !== gmailCredentials.access_token) {
    await ctx.supabase
      .from("gmail_tokens")
      .update({
        access_token: credentials.access_token,
        expiry_date: new Date(credentials.expiry_date).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("household_id", ctx.householdId);
  }

  return {
    itemsExtracted,
    emailsProcessed,
    emailsClassifiedSchool,
    nextPageToken,
    updatedCredentials: {
      access_token: credentials.access_token,
      expiry_date: credentials.expiry_date,
    },
  };
}
