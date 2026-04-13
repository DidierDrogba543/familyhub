import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const { suggestionId } = await request.json();
  if (!suggestionId) {
    return NextResponse.json({ error: "Missing suggestionId" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("admin_suggestions")
    .update({ status: "dismissed" })
    .eq("id", suggestionId);

  if (error) {
    return NextResponse.json({ error: error.message, success: false });
  }

  return NextResponse.json({ success: true });
}
