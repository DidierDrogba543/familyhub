import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ingestEmailBatch } from "@/lib/gmail/ingest";
import { config } from "dotenv";
import { resolve } from "path";

// Load .env.local explicitly for server-side API routes, overriding empty values
config({ path: resolve(process.cwd(), ".env.local"), override: true });

/**
 * POST /api/ingest
 * Called by cron every 15 minutes. Processes one batch of emails per household.
 * Protected by CRON_SECRET header.
 */
export async function POST(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  // Get all households with Gmail tokens
  const { data: households, error: hErr } = await supabase
    .from("gmail_tokens")
    .select("household_id, access_token, refresh_token, expiry_date");

  if (hErr || !households) {
    return NextResponse.json({ error: "Failed to fetch households", detail: hErr?.message }, { status: 500 });
  }

  // Debug: log what we have (remove after testing)
  console.log("Households found:", households.length);
  console.log("Google Client ID set:", !!process.env.GOOGLE_CLIENT_ID);
  console.log("Google Client Secret set:", !!process.env.GOOGLE_CLIENT_SECRET);
  console.log("ANTHROPIC_API_KEY set:", !!process.env.ANTHROPIC_API_KEY);
  console.log("ANTHROPIC_API_KEY value:", process.env.ANTHROPIC_API_KEY?.slice(0, 15));
  for (const h of households) {
    console.log(`Household ${h.household_id}: token=${h.access_token?.slice(0, 20)}... refresh=${!!h.refresh_token} expiry=${h.expiry_date}`);
  }

  const results = [];

  for (const household of households) {
    try {
      // Load context for this household
      const [childrenRes, activitiesRes, sendersRes, stateRes] = await Promise.all([
        supabase.from("children").select("*").eq("household_id", household.household_id),
        supabase
          .from("child_activities")
          .select("*, children!inner(household_id)")
          .eq("children.household_id", household.household_id),
        supabase.from("known_senders").select("*").eq("household_id", household.household_id),
        supabase.from("processing_state").select("*").eq("household_id", household.household_id).single(),
      ]);

      const children = childrenRes.data ?? [];
      const activities = activitiesRes.data ?? [];
      const knownSenders = sendersRes.data ?? [];
      const state = stateRes.data;

      // Determine what to fetch
      const afterDate = state?.last_poll_at
        ? new Date(state.last_poll_at)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

      const pageToken =
        state && !state.initial_import_complete
          ? state.initial_import_cursor ?? undefined
          : undefined;

      const result = await ingestEmailBatch(
        {
          householdId: household.household_id,
          children,
          activities,
          knownSenders,
          supabase,
        },
        {
          access_token: household.access_token,
          refresh_token: household.refresh_token,
          expiry_date: new Date(household.expiry_date).getTime(),
        },
        { afterDate, pageToken }
      );

      // Update processing state
      const stateUpdate: Record<string, unknown> = {
        household_id: household.household_id,
        last_poll_at: new Date().toISOString(),
        emails_processed: (state?.emails_processed ?? 0) + result.emailsProcessed,
        emails_classified_school:
          (state?.emails_classified_school ?? 0) + result.emailsClassifiedSchool,
      };

      if (result.nextPageToken) {
        stateUpdate.initial_import_cursor = result.nextPageToken;
        stateUpdate.initial_import_complete = false;
      } else {
        stateUpdate.initial_import_complete = true;
        stateUpdate.initial_import_cursor = null;
      }

      await supabase.from("processing_state").upsert(stateUpdate, {
        onConflict: "household_id",
      });

      results.push({
        household_id: household.household_id,
        items_extracted: result.itemsExtracted,
        emails_processed: result.emailsProcessed,
        has_more: !!result.nextPageToken,
      });
    } catch (err) {
      console.error(`Ingest error for household ${household.household_id}:`, err);
      results.push({
        household_id: household.household_id,
        error: String(err),
      });
    }
  }

  return NextResponse.json({ results });
}
