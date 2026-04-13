import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { rebuildAllLinks } from "@/lib/ontology/links";
import { computeProperties } from "@/lib/ontology/computed";

export async function POST(request: Request) {
  const { householdId, action } = await request.json();
  if (!householdId) return NextResponse.json({ error: "Missing householdId" }, { status: 400 });

  const supabase = createServiceClient();

  if (action === "rebuild-links") {
    const result = await rebuildAllLinks(supabase, householdId);
    return NextResponse.json({ success: true, ...result });
  }

  if (action === "compute") {
    const properties = await computeProperties(supabase, householdId);
    return NextResponse.json({ success: true, properties });
  }

  if (action === "full") {
    const [linkResult, properties] = await Promise.all([
      rebuildAllLinks(supabase, householdId),
      computeProperties(supabase, householdId),
    ]);
    return NextResponse.json({ success: true, links: linkResult, properties });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
