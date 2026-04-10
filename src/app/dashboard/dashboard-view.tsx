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
  confidence: number;
  raw_snippet: string;
  needs_review: boolean;
  created_at: string;
}

interface KnownSender {
  id: string;
  email_address: string;
  label: string;
  category: string;
}

export default function DashboardView() {
  const [children, setChildren] = useState<Child[]>([]);
  const [items, setItems] = useState<ExtractedItem[]>([]);
  const [senders, setSenders] = useState<KnownSender[]>([]);
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState("");
  const [householdId, setHouseholdId] = useState("");
  const [showAddChild, setShowAddChild] = useState(false);
  const [newChild, setNewChild] = useState({ name: "", school_name: "", year_group: "" });

  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        window.location.href = "/";
        return;
      }
      setUserEmail(user.email ?? "");

      // Get household
      const { data: household } = await supabase
        .from("households")
        .select("id")
        .eq("owner_user_id", user.id)
        .single();

      if (!household) {
        window.location.href = "/onboarding";
        return;
      }
      setHouseholdId(household.id);

      // Load children with activities
      const { data: childrenData } = await supabase
        .from("children")
        .select("id, name, school_name, year_group")
        .eq("household_id", household.id);

      const childrenWithActivities: Child[] = [];
      for (const child of childrenData ?? []) {
        const { data: activities } = await supabase
          .from("child_activities")
          .select("activity_name, day_of_week, time_slot")
          .eq("child_id", child.id);
        childrenWithActivities.push({ ...child, activities: activities ?? [] });
      }
      setChildren(childrenWithActivities);

      // Load known senders
      const { data: sendersData } = await supabase
        .from("known_senders")
        .select("id, email_address, label, category")
        .eq("household_id", household.id);
      setSenders(sendersData ?? []);

      // Load extracted items (last 7 days, not dismissed)
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: itemsData } = await supabase
        .from("extracted_items")
        .select("*")
        .eq("household_id", household.id)
        .eq("dismissed", false)
        .gte("created_at", weekAgo)
        .order("created_at", { ascending: false });
      setItems(itemsData ?? []);

      setLoading(false);
    }
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const addChild = async () => {
    if (!newChild.name || !newChild.school_name) return;
    const { data: savedChild } = await supabase
      .from("children")
      .insert({
        household_id: householdId,
        name: newChild.name,
        school_name: newChild.school_name,
        year_group: newChild.year_group || null,
      })
      .select("id, name, school_name, year_group")
      .single();
    if (savedChild) {
      setChildren([...children, { ...savedChild, activities: [] }]);
      setNewChild({ name: "", school_name: "", year_group: "" });
      setShowAddChild(false);
    }
  };

  const removeChild = async (childId: string, childName: string) => {
    if (!confirm(`Remove ${childName}? This will also delete their activities.`)) return;
    await supabase.from("child_activities").delete().eq("child_id", childId);
    await supabase.from("children").delete().eq("id", childId);
    setChildren(children.filter((c) => c.id !== childId));
  };

  const removeSender = async (senderId: string) => {
    await supabase.from("known_senders").delete().eq("id", senderId);
    setSenders(senders.filter((s) => s.id !== senderId));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  const urgencyColor: Record<string, string> = {
    high: "border-l-red-500 bg-red-50",
    medium: "border-l-amber-500 bg-amber-50",
    low: "border-l-blue-500 bg-blue-50",
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">FamilyHub</h1>
            <p className="text-sm text-gray-400">{userEmail}</p>
          </div>
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              window.location.href = "/";
            }}
            className="text-sm text-gray-400 hover:text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg"
          >
            Log out
          </button>
        </div>

        {/* Navigation */}
        <div className="flex gap-3 mb-6">
          <a href="/calendar" className="flex-1 py-3 bg-white border border-gray-200 rounded-xl text-center text-sm font-medium text-gray-700 hover:bg-gray-50">
            Weekly Calendar
          </a>
          <a href="/clubs" className="flex-1 py-3 bg-white border border-gray-200 rounded-xl text-center text-sm font-medium text-gray-700 hover:bg-gray-50">
            Club Schedule
          </a>
        </div>

        {/* Children */}
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Your Children
          </h2>
          {children.length === 0 ? (
            <p className="text-gray-400">No children added yet.</p>
          ) : (
            children.map((child) => (
              <div
                key={child.id}
                className="bg-white rounded-xl p-4 mb-3 border border-gray-200"
              >
                <div className="flex items-start justify-between">
                <p className="font-semibold text-gray-900">{child.name}</p>
                <button
                  onClick={() => removeChild(child.id, child.name)}
                  className="text-xs text-red-400 hover:text-red-600"
                >
                  Remove
                </button>
                </div>
                <p className="text-sm text-gray-500">
                  {child.school_name}
                  {child.year_group ? ` · ${child.year_group}` : ""}
                </p>
                {child.activities.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {child.activities.map((act, i) => (
                      <span
                        key={i}
                        className="inline-block bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded-full"
                      >
                        {act.activity_name}
                        {act.day_of_week ? ` · ${act.day_of_week}` : ""}
                        {act.time_slot ? ` ${act.time_slot}` : ""}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}

          {showAddChild ? (
            <div className="bg-white rounded-xl p-4 mb-3 border-2 border-blue-200">
              <div className="space-y-3">
                <input
                  type="text"
                  value={newChild.name}
                  onChange={(e) => setNewChild({ ...newChild, name: e.target.value })}
                  placeholder="Child's name"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <input
                  type="text"
                  value={newChild.school_name}
                  onChange={(e) => setNewChild({ ...newChild, school_name: e.target.value })}
                  placeholder="School name"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <input
                  type="text"
                  value={newChild.year_group}
                  onChange={(e) => setNewChild({ ...newChild, year_group: e.target.value })}
                  placeholder="Year group (optional)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <div className="flex gap-2">
                  <button
                    onClick={addChild}
                    className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => { setShowAddChild(false); setNewChild({ name: "", school_name: "", year_group: "" }); }}
                    className="flex-1 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowAddChild(true)}
              className="w-full py-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-400 hover:border-gray-400 hover:text-gray-500 text-sm"
            >
              + Add child
            </button>
          )}
        </div>

        {/* Known Senders */}
        {senders.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Known Senders
            </h2>
            <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
              {senders.map((sender) => (
                <div key={sender.id} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{sender.label}</p>
                    <p className="text-xs text-gray-400">{sender.email_address} · {sender.category}</p>
                  </div>
                  <button
                    onClick={() => removeSender(sender.id)}
                    className="text-xs text-red-400 hover:text-red-600"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Extracted Items */}
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Extracted Items {items.length > 0 && `(${items.length})`}
          </h2>
          {items.length === 0 ? (
            <div className="bg-white rounded-xl p-8 border border-gray-200 text-center">
              <p className="text-gray-400 mb-2">No items extracted yet.</p>
              <p className="text-sm text-gray-300">
                Items will appear here once the Gmail ingestion runs.
              </p>
            </div>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                className={`bg-white rounded-xl p-4 mb-3 border-l-4 border border-gray-200 ${urgencyColor[item.urgency] ?? ""}`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-gray-900">{item.title}</p>
                    <p className="text-sm text-gray-500 mt-1">
                      {item.date &&
                        new Date(item.date).toLocaleDateString("en-GB", {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        })}
                      {item.child_name && (
                        <span className="ml-2 inline-block bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full">
                          {item.child_name}
                        </span>
                      )}
                      {item.needs_review && (
                        <span className="ml-2 inline-block bg-yellow-100 text-yellow-700 text-xs px-2 py-0.5 rounded-full">
                          Check this
                        </span>
                      )}
                    </p>
                  </div>
                  <span className="text-xs text-gray-300">
                    {Math.round(item.confidence * 100)}%
                  </span>
                </div>
                {item.raw_snippet && (
                  <p className="text-sm text-gray-400 mt-2 italic">
                    {item.raw_snippet.slice(0, 120)}
                  </p>
                )}
                {item.action_url && (
                  <a
                    href={item.action_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-2 text-sm text-blue-600 hover:text-blue-700 font-medium"
                  >
                    Take action →
                  </a>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
