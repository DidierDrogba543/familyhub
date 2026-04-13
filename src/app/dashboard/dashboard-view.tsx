"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface Child {
  id: string;
  name: string;
  school_name: string;
  year_group: string | null;
  activities: { activity_name: string; day_of_week: string | null; time_slot: string | null }[];
}

interface ExtractedItem {
  id: string;
  type: string;
  title: string;
  date: string | null;
  deadline: string | null;
  child_name: string | null;
  urgency: string;
  action_url: string | null;
  source_subject: string;
  source_sender: string;
  confidence: number;
  raw_snippet: string;
  needs_review: boolean;
  dismissed: boolean;
  created_at: string;
}

interface KnownSender {
  id: string;
  email_address: string;
  label: string;
  category: string;
}

// Helper: is date today, tomorrow, this week, or later?
function dateCategory(dateStr: string | null): "overdue" | "today" | "tomorrow" | "this_week" | "next_week" | "later" | "none" {
  if (!dateStr) return "none";
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const endOfWeek = new Date(today); endOfWeek.setDate(today.getDate() + (7 - today.getDay()));
  const endOfNextWeek = new Date(endOfWeek); endOfNextWeek.setDate(endOfWeek.getDate() + 7);

  if (d < today) return "overdue";
  if (d < tomorrow) return "today";
  if (d < new Date(tomorrow.getTime() + 86400000)) return "tomorrow";
  if (d < endOfWeek) return "this_week";
  if (d < endOfNextWeek) return "next_week";
  return "later";
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function formatRelative(dateStr: string | null): string {
  const cat = dateCategory(dateStr);
  const formatted = formatDate(dateStr);
  if (cat === "overdue") return `Overdue (${formatted})`;
  if (cat === "today") return "Today";
  if (cat === "tomorrow") return "Tomorrow";
  return formatted;
}

export default function DashboardView() {
  const [children, setChildren] = useState<Child[]>([]);
  const [items, setItems] = useState<ExtractedItem[]>([]);
  const [senders, setSenders] = useState<KnownSender[]>([]);
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [householdId, setHouseholdId] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showAddChild, setShowAddChild] = useState(false);
  const [newChild, setNewChild] = useState({ name: "", school_name: "", year_group: "" });
  const [addingActivityFor, setAddingActivityFor] = useState<string | null>(null);
  const [newActivity, setNewActivity] = useState({ activity_name: "", day_of_week: "", time_slot: "" });
  const [showAddSender, setShowAddSender] = useState(false);
  const [newSender, setNewSender] = useState({ email_address: "", label: "", category: "school" as const });

  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = "/"; return; }
      setUserEmail(user.email ?? "");
      setUserName(user.user_metadata?.full_name || user.user_metadata?.name || "");

      const { data: household } = await supabase.from("households").select("id").eq("owner_user_id", user.id).single();
      if (!household) { window.location.href = "/onboarding"; return; }
      setHouseholdId(household.id);

      const [childrenRes, sendersRes, itemsRes] = await Promise.all([
        supabase.from("children").select("id, name, school_name, year_group").eq("household_id", household.id),
        supabase.from("known_senders").select("id, email_address, label, category").eq("household_id", household.id),
        supabase.from("extracted_items").select("*").eq("household_id", household.id).eq("dismissed", false).order("created_at", { ascending: false }).limit(200),
      ]);

      const childrenWithActivities: Child[] = [];
      for (const child of childrenRes.data ?? []) {
        const { data: activities } = await supabase.from("child_activities").select("activity_name, day_of_week, time_slot").eq("child_id", child.id);
        childrenWithActivities.push({ ...child, activities: activities ?? [] });
      }
      setChildren(childrenWithActivities);
      setSenders(sendersRes.data ?? []);
      setItems(itemsRes.data ?? []);
      setLoading(false);
    }
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Actions ---
  const dismissItem = async (id: string) => {
    await supabase.from("extracted_items").update({ dismissed: true }).eq("id", id);
    setItems(items.filter((i) => i.id !== id));
  };

  const addChild = async () => {
    if (!newChild.name || !newChild.school_name) return;
    const { data: savedChild } = await supabase.from("children").insert({ household_id: householdId, name: newChild.name, school_name: newChild.school_name, year_group: newChild.year_group || null }).select("id, name, school_name, year_group").single();
    if (savedChild) {
      setChildren([...children, { ...savedChild, activities: [] }]);
      // Auto-create school knowledge entry if it doesn't exist
      const { data: existingSchool } = await supabase.from("school_knowledge").select("id").eq("household_id", householdId).eq("school_name", newChild.school_name).single();
      if (!existingSchool) {
        await supabase.from("school_knowledge").insert({ household_id: householdId, school_name: newChild.school_name, staff: [], term_dates: [], policies: {}, payment_systems: [], notes: [] });
      }
      // Auto-create child knowledge entry
      await supabase.from("child_knowledge").insert({ child_id: savedChild.id }).catch(() => {});
      setNewChild({ name: "", school_name: "", year_group: "" }); setShowAddChild(false);
    }
  };

  const addActivity = async (childId: string) => {
    if (!newActivity.activity_name) return;
    await supabase.from("child_activities").insert({ child_id: childId, activity_name: newActivity.activity_name, day_of_week: newActivity.day_of_week || null, time_slot: newActivity.time_slot || null });
    setChildren(children.map((c) => c.id !== childId ? c : { ...c, activities: [...c.activities, { ...newActivity, day_of_week: newActivity.day_of_week || null, time_slot: newActivity.time_slot || null }] }));
    setNewActivity({ activity_name: "", day_of_week: "", time_slot: "" }); setAddingActivityFor(null);
  };

  const removeChild = async (childId: string, childName: string) => {
    if (!confirm(`Remove ${childName}?`)) return;
    await supabase.from("child_activities").delete().eq("child_id", childId);
    await supabase.from("children").delete().eq("id", childId);
    setChildren(children.filter((c) => c.id !== childId));
  };

  const removeSender = async (senderId: string) => {
    await supabase.from("known_senders").delete().eq("id", senderId);
    setSenders(senders.filter((s) => s.id !== senderId));
  };

  const addSender = async () => {
    if (!newSender.email_address || !newSender.label || !householdId) return;
    const { data } = await supabase.from("known_senders").insert({ household_id: householdId, ...newSender }).select("*").single();
    if (data) { setSenders([...senders, data]); setNewSender({ email_address: "", label: "", category: "school" }); setShowAddSender(false); }
  };

  if (loading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-400">Loading...</p></div>;
  }

  // --- Triage items into sections ---
  const actionItems = items.filter((i) => i.type === "action" || i.type === "deadline");
  const eventItems = items.filter((i) => i.type === "event");
  const infoItems = items.filter((i) => i.type === "info");

  const urgentItems = items.filter((i) => {
    const dc = dateCategory(i.deadline || i.date);
    return dc === "overdue" || dc === "today" || dc === "tomorrow" || i.urgency === "high";
  });
  const thisWeekItems = items.filter((i) => {
    const dc = dateCategory(i.deadline || i.date);
    return dc === "this_week" && i.urgency !== "high";
  });
  const laterItems = items.filter((i) => {
    const dc = dateCategory(i.deadline || i.date);
    return (dc === "next_week" || dc === "later") && i.urgency !== "high";
  });
  const undatedItems = items.filter((i) => {
    return !i.date && !i.deadline && i.urgency !== "high";
  });

  // Summary stats
  const totalActions = actionItems.length;
  const totalEvents = eventItems.length;
  const urgentCount = urgentItems.length;

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{greeting()}{userName ? `, ${userName.split(" ")[0]}` : ""}</h1>
              <p className="text-sm text-gray-400 mt-1">
                {urgentCount > 0
                  ? `${urgentCount} urgent item${urgentCount > 1 ? "s" : ""} need${urgentCount === 1 ? "s" : ""} your attention`
                  : items.length > 0
                    ? `${items.length} items from school`
                    : "No new items"}
              </p>
            </div>
            <button onClick={() => setShowSettings(!showSettings)} className="text-sm text-gray-400 hover:text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg">
              {showSettings ? "Close" : "Settings"}
            </button>
          </div>

          {/* Nav */}
          <div className="flex gap-2 mt-4">
            <a href="/calendar" className="px-4 py-2 bg-gray-100 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-200">Calendar</a>
            <a href="/clubs" className="px-4 py-2 bg-gray-100 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-200">Clubs</a>
            <a href="/knowledge" className="px-4 py-2 bg-gray-100 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-200">Knowledge</a>
            <a href="/admin" className="px-4 py-2 bg-gray-100 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-200">Admin</a>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">

        {/* Quick Stats */}
        {items.length > 0 && (
          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="bg-white rounded-xl p-4 border border-gray-200 text-center">
              <p className="text-2xl font-bold text-red-600">{urgentCount}</p>
              <p className="text-xs text-gray-400">Urgent</p>
            </div>
            <div className="bg-white rounded-xl p-4 border border-gray-200 text-center">
              <p className="text-2xl font-bold text-amber-600">{totalActions}</p>
              <p className="text-xs text-gray-400">Actions</p>
            </div>
            <div className="bg-white rounded-xl p-4 border border-gray-200 text-center">
              <p className="text-2xl font-bold text-blue-600">{totalEvents}</p>
              <p className="text-xs text-gray-400">Events</p>
            </div>
          </div>
        )}

        {/* Urgent / Needs Attention */}
        {urgentItems.length > 0 && (
          <Section title="Needs Attention" count={urgentItems.length} color="red">
            {urgentItems.map((item) => (
              <ItemCard key={item.id} item={item} onDismiss={dismissItem} />
            ))}
          </Section>
        )}

        {/* This Week */}
        {thisWeekItems.length > 0 && (
          <Section title="This Week" count={thisWeekItems.length} color="amber">
            {thisWeekItems.map((item) => (
              <ItemCard key={item.id} item={item} onDismiss={dismissItem} />
            ))}
          </Section>
        )}

        {/* Coming Up */}
        {laterItems.length > 0 && (
          <Section title="Coming Up" count={laterItems.length} color="blue">
            {laterItems.map((item) => (
              <ItemCard key={item.id} item={item} onDismiss={dismissItem} />
            ))}
          </Section>
        )}

        {/* General Info */}
        {undatedItems.length > 0 && (
          <Section title="General Info" count={undatedItems.length} color="gray">
            {undatedItems.map((item) => (
              <ItemCard key={item.id} item={item} onDismiss={dismissItem} compact />
            ))}
          </Section>
        )}

        {items.length === 0 && (
          <div className="bg-white rounded-xl p-12 border border-gray-200 text-center">
            <p className="text-gray-400 text-lg mb-2">All clear</p>
            <p className="text-sm text-gray-300">No school items right now. Items appear as emails are processed.</p>
          </div>
        )}

        {/* Settings Panel (collapsed) */}
        {showSettings && (
          <div className="mt-8 space-y-8">
            {/* Children */}
            <div>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Your Children</h2>
              {children.map((child) => (
                <div key={child.id} className="bg-white rounded-xl p-4 mb-3 border border-gray-200">
                  <div className="flex items-start justify-between">
                    <p className="font-semibold text-gray-900">{child.name}</p>
                    <button onClick={() => removeChild(child.id, child.name)} className="text-xs text-red-400 hover:text-red-600">Remove</button>
                  </div>
                  <p className="text-sm text-gray-500">{child.school_name}{child.year_group ? ` · ${child.year_group}` : ""}</p>
                  {child.activities.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {child.activities.map((act, i) => (
                        <span key={i} className="inline-block bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded-full">
                          {act.activity_name}{act.day_of_week ? ` · ${act.day_of_week}` : ""}{act.time_slot ? ` ${act.time_slot}` : ""}
                        </span>
                      ))}
                    </div>
                  )}
                  {addingActivityFor === child.id ? (
                    <div className="mt-3 flex gap-2 items-end">
                      <input type="text" value={newActivity.activity_name} onChange={(e) => setNewActivity({ ...newActivity, activity_name: e.target.value })} placeholder="Activity name" className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-xs" />
                      <select value={newActivity.day_of_week} onChange={(e) => setNewActivity({ ...newActivity, day_of_week: e.target.value })} className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs">
                        <option value="">Day</option>
                        {["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                      <input type="text" value={newActivity.time_slot} onChange={(e) => setNewActivity({ ...newActivity, time_slot: e.target.value })} placeholder="Time" className="w-24 px-2 py-1.5 border border-gray-300 rounded-lg text-xs" />
                      <button onClick={() => addActivity(child.id)} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium">Add</button>
                      <button onClick={() => { setAddingActivityFor(null); setNewActivity({ activity_name: "", day_of_week: "", time_slot: "" }); }} className="px-2 py-1.5 text-xs text-gray-400">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => setAddingActivityFor(child.id)} className="mt-2 text-xs text-blue-500 hover:text-blue-600">+ Add activity</button>
                  )}
                </div>
              ))}
              {showAddChild ? (
                <div className="bg-white rounded-xl p-4 mb-3 border-2 border-blue-200 space-y-3">
                  <input type="text" value={newChild.name} onChange={(e) => setNewChild({ ...newChild, name: e.target.value })} placeholder="Child's name" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  <input type="text" value={newChild.school_name} onChange={(e) => setNewChild({ ...newChild, school_name: e.target.value })} placeholder="School name" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  <input type="text" value={newChild.year_group} onChange={(e) => setNewChild({ ...newChild, year_group: e.target.value })} placeholder="Year group (optional)" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  <div className="flex gap-2">
                    <button onClick={addChild} className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">Save</button>
                    <button onClick={() => { setShowAddChild(false); setNewChild({ name: "", school_name: "", year_group: "" }); }} className="flex-1 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm">Cancel</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowAddChild(true)} className="w-full py-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-400 hover:border-gray-400 text-sm">+ Add child</button>
              )}
            </div>

            {/* Known Senders */}
            <div>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Known Senders</h2>
              {senders.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 mb-3">
                  {senders.map((sender) => (
                    <div key={sender.id} className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{sender.label}</p>
                        <p className="text-xs text-gray-400">{sender.email_address} · {sender.category}</p>
                      </div>
                      <button onClick={() => removeSender(sender.id)} className="text-xs text-red-400 hover:text-red-600">Remove</button>
                    </div>
                  ))}
                </div>
              )}
              {showAddSender ? (
                <div className="bg-white rounded-xl p-4 border-2 border-green-200 space-y-3">
                  <input type="email" value={newSender.email_address} onChange={(e) => setNewSender({ ...newSender, email_address: e.target.value })} placeholder="Email address" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  <input type="text" value={newSender.label} onChange={(e) => setNewSender({ ...newSender, label: e.target.value })} placeholder="Label" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  <select value={newSender.category} onChange={(e) => setNewSender({ ...newSender, category: e.target.value as "school" | "club" | "pta" | "afterschool" | "other" })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                    <option value="school">School</option><option value="club">Club</option><option value="pta">PTA</option><option value="afterschool">After-school</option><option value="other">Other</option>
                  </select>
                  <div className="flex gap-2">
                    <button onClick={addSender} className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm font-medium">Save</button>
                    <button onClick={() => { setShowAddSender(false); setNewSender({ email_address: "", label: "", category: "school" }); }} className="flex-1 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm">Cancel</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowAddSender(true)} className="w-full py-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-400 hover:border-gray-400 text-sm">+ Add known sender</button>
              )}
            </div>

            {/* Logout */}
            <button onClick={async () => { await supabase.auth.signOut(); window.location.href = "/"; }} className="w-full py-3 border border-red-200 text-red-500 rounded-xl text-sm hover:bg-red-50">
              Log out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Components ---

function Section({ title, count, color, children }: { title: string; count: number; color: string; children: React.ReactNode }) {
  const borderColors: Record<string, string> = { red: "border-l-red-500", amber: "border-l-amber-500", blue: "border-l-blue-500", gray: "border-l-gray-300" };
  const bgColors: Record<string, string> = { red: "bg-red-50", amber: "bg-amber-50", blue: "bg-blue-50", gray: "bg-gray-50" };
  const textColors: Record<string, string> = { red: "text-red-700", amber: "text-amber-700", blue: "text-blue-700", gray: "text-gray-500" };

  return (
    <div className="mb-6">
      <div className={`flex items-center gap-2 mb-3 px-3 py-2 rounded-lg ${bgColors[color] || bgColors.gray}`}>
        <div className={`w-1 h-4 rounded-full ${borderColors[color]?.replace("border-l-", "bg-") || "bg-gray-300"}`} />
        <h2 className={`text-sm font-semibold ${textColors[color] || textColors.gray}`}>{title}</h2>
        <span className={`text-xs ${textColors[color] || textColors.gray} opacity-60`}>({count})</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function ItemCard({ item, onDismiss, compact }: { item: ExtractedItem; onDismiss: (id: string) => void; compact?: boolean }) {
  const typeIcons: Record<string, string> = { event: "📅", deadline: "⏰", action: "✋", info: "ℹ️" };
  const typeLabels: Record<string, string> = { event: "Event", deadline: "Deadline", action: "Action needed", info: "Info" };

  return (
    <div className="bg-white rounded-xl p-4 border border-gray-200 group">
      <div className="flex items-start gap-3">
        <span className="text-lg mt-0.5">{typeIcons[item.type] || "📋"}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className={`font-semibold text-gray-900 ${compact ? "text-sm" : ""}`}>{item.title}</p>
            <button onClick={() => onDismiss(item.id)} className="text-xs text-gray-300 hover:text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
              Done
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-1">
            <span className="text-xs text-gray-400">{typeLabels[item.type] || item.type}</span>

            {(item.date || item.deadline) && (
              <span className={`text-xs font-medium ${
                dateCategory(item.deadline || item.date) === "overdue" ? "text-red-600" :
                dateCategory(item.deadline || item.date) === "today" ? "text-red-600" :
                dateCategory(item.deadline || item.date) === "tomorrow" ? "text-amber-600" :
                "text-gray-500"
              }`}>
                {formatRelative(item.deadline || item.date)}
              </span>
            )}

            {item.child_name && (
              <span className="inline-block bg-blue-50 text-blue-600 text-xs px-2 py-0.5 rounded-full">{item.child_name}</span>
            )}

            {item.needs_review && (
              <span className="inline-block bg-yellow-100 text-yellow-700 text-xs px-2 py-0.5 rounded-full">Check this</span>
            )}
          </div>

          {!compact && item.raw_snippet && (
            <p className="text-sm text-gray-400 mt-2 leading-relaxed">{item.raw_snippet.slice(0, 150)}</p>
          )}

          {item.action_url && (
            <a href={item.action_url} target="_blank" rel="noopener noreferrer" className="inline-block mt-2 text-sm text-blue-600 hover:text-blue-700 font-medium">
              Take action →
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
