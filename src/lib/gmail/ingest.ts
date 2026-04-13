import { createGmailClient, fetchEmails, fetchMessageContent } from "./client";
import { classifyEmail } from "../ai/classify";
import { extractFromEmail } from "../ai/extract";
import { extractTextFromAttachments } from "../ai/attachments";
import { findDocumentLinks, downloadAndExtract } from "../ai/links";
import { updateOntology } from "../ai/ontology";
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

  // Build sender filter from known senders
  const senderEmails = ctx.knownSenders.map((s) => s.email_address);

  // Fetch a batch of email IDs (filtered by known senders if available)
  const { messages, nextPageToken } = await fetchEmails(gmail, {
    afterDate: opts.afterDate,
    pageToken: opts.pageToken,
    maxResults: BATCH_SIZE,
    senderFilter: senderEmails.length > 0 ? senderEmails : undefined,
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

    // Process attachments (PDFs, images) to extract additional text
    let fullBody = message.body;
    if (message.attachments.length > 0) {
      try {
        const attachmentText = await extractTextFromAttachments(message.attachments);
        if (attachmentText) {
          fullBody = message.body + "\n" + attachmentText;
        }
      } catch (err) {
        console.error(`Attachment extraction failed for ${msg.id}:`, err);
      }
    }

    // Follow document download links (ParentMail, school portals, etc.)
    // Search both text body and HTML body for links (HTML has href attributes)
    const docLinks = findDocumentLinks(message.body + "\n" + (message.htmlBody || ""));
    if (docLinks.length > 0) {
      for (const link of docLinks.slice(0, 3)) { // Max 3 links per email
        try {
          const downloaded = await downloadAndExtract(link);
          if (downloaded && downloaded.text) {
            fullBody += "\n--- LINKED DOCUMENT: " + downloaded.filename + " ---\n" + downloaded.text.slice(0, 5000);
          }
        } catch (err) {
          console.error(`Link download failed for ${link}:`, err);
        }
      }
    }

    // Stage 2: Extract
    const extractions = await extractFromEmail(
      message.subject,
      message.from,
      fullBody,
      ctx.children,
      ctx.activities,
      today
    );

    if (extractions.length === 0) {
      // Email classified as school-related but nothing extractable
      // Store as an info item so it's not lost
      const { error } = await ctx.supabase.from("extracted_items").insert({
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
      });
      if (error) {
        // Ignore duplicate fingerprint errors
        if (!error.message?.includes("duplicate") && !error.code?.includes("23505")) {
          console.error("Failed to store info item:", JSON.stringify(error));
        }
      }
      itemsExtracted++;
      continue;
    }

    // Store extracted items (insert, skip duplicates)
    for (const item of extractions) {
      const { error } = await ctx.supabase.from("extracted_items").insert({
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
      });
      if (error) {
        if (!error.message?.includes("duplicate") && !error.code?.includes("23505")) {
          console.error("Failed to store extracted item:", JSON.stringify(error));
        }
      } else {
        itemsExtracted++;
      }
    }

    // Stage 3: Update ontology with accumulated knowledge from this email
    try {
      const schoolNames = [...new Set(ctx.children.map((c) => c.school_name))];
      const childNames = ctx.children.map((c) => c.name);
      const ontologyResult = await updateOntology(
        { householdId: ctx.householdId, childNames, schoolNames, supabase: ctx.supabase },
        { subject: message.subject, from: message.from, body: fullBody, messageId: msg.id }
      );
      if (ontologyResult.entitiesUpdated.length > 0) {
        console.log(`Ontology: updated ${ontologyResult.entitiesUpdated.length} entities from "${message.subject}"`);
      }
    } catch (err) {
      // Ontology updates are non-blocking — don't fail the ingestion
      console.error(`Ontology update failed for ${msg.id}:`, err);
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
