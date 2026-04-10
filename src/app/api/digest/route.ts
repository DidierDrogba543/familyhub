import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendDigestEmail } from "@/lib/digest/send";

/**
 * POST /api/digest
 * Called by cron at each household's digest_time. Sends the morning digest email.
 * Protected by CRON_SECRET header.
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  // Get all households (V1: send to all at once, future: respect digest_time per household)
  const { data: households } = await supabase
    .from("households")
    .select("id, owner_user_id, digest_time");

  if (!households) {
    return NextResponse.json({ error: "No households" }, { status: 500 });
  }

  const results = [];

  for (const household of households) {
    try {
      // Get user email
      const { data: userData } = await supabase.auth.admin.getUserById(
        household.owner_user_id
      );
      const userEmail = userData?.user?.email;
      const userName =
        userData?.user?.user_metadata?.full_name ??
        userData?.user?.user_metadata?.name ??
        "";

      if (!userEmail) {
        results.push({ household_id: household.id, error: "No email" });
        continue;
      }

      // Get items from last 24 hours, not dismissed
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: items } = await supabase
        .from("extracted_items")
        .select("*")
        .eq("household_id", household.id)
        .eq("dismissed", false)
        .gte("created_at", since)
        .order("urgency", { ascending: true }) // high first
        .order("created_at", { ascending: false });

      // Also get upcoming items (date or deadline within next 7 days)
      const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const now = new Date().toISOString();
      const { data: upcomingItems } = await supabase
        .from("extracted_items")
        .select("*")
        .eq("household_id", household.id)
        .eq("dismissed", false)
        .or(`date.gte.${now},deadline.gte.${now}`)
        .or(`date.lte.${nextWeek},deadline.lte.${nextWeek}`)
        .order("date", { ascending: true });

      // Merge and deduplicate
      const allItems = [...(items ?? []), ...(upcomingItems ?? [])];
      const seen = new Set<string>();
      const uniqueItems = allItems.filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });

      const today = new Date().toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });

      const sent = await sendDigestEmail({
        recipientEmail: userEmail,
        recipientName: userName,
        items: uniqueItems,
        date: today,
      });

      results.push({
        household_id: household.id,
        items_count: uniqueItems.length,
        sent,
      });
    } catch (err) {
      console.error(`Digest error for household ${household.id}:`, err);
      results.push({ household_id: household.id, error: String(err) });
    }
  }

  return NextResponse.json({ results });
}
