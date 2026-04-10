"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface SchoolKnowledge {
  id: string;
  school_name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  staff: { name: string; role: string }[];
  term_dates: { term_name: string; start_date: string; end_date: string }[];
  policies: Record<string, string>;
  payment_systems: { name: string; url?: string; notes?: string }[];
  notes: { date?: string; source_subject?: string; note: string }[];
  updated_at: string;
}

interface ClubKnowledge {
  id: string;
  club_name: string;
  school_name: string | null;
  day_of_week: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  provider: string | null;
  is_external: boolean;
  year_groups: string | null;
  cost_per_session: number | null;
  cost_per_term: number | null;
  booking_method: string | null;
  booking_url: string | null;
  cancellation_policy: string | null;
  weather_policy: string | null;
  updated_at: string;
}

interface ChildKnowledge {
  child_id: string;
  class_name: string | null;
  teacher_name: string | null;
  teaching_assistant: string | null;
  enrolled_clubs: { club_name: string; day?: string; status?: string }[];
  dietary_notes: string | null;
  medical_notes: string | null;
  updated_at: string;
}

interface FamilyKnowledge {
  parents: { name: string; role?: string; email?: string }[];
  pickup_arrangements: { child_name: string; details: string }[];
  payment_accounts: { system: string; notes?: string }[];
  key_dates: { date: string; description: string }[];
  updated_at: string;
}

interface OntologyUpdate {
  id: string;
  source_subject: string;
  entities_updated: { entity_type: string; entity_name: string; fields_updated: string[] }[];
  created_at: string;
}

interface ChildName { id: string; name: string; }

export default function KnowledgeView() {
  const [schools, setSchools] = useState<SchoolKnowledge[]>([]);
  const [clubs, setClubs] = useState<ClubKnowledge[]>([]);
  const [childKnowledge, setChildKnowledge] = useState<(ChildKnowledge & { name: string })[]>([]);
  const [family, setFamily] = useState<FamilyKnowledge | null>(null);
  const [updates, setUpdates] = useState<OntologyUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"schools" | "clubs" | "children" | "family" | "log">("schools");

  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: household } = await supabase.from("households").select("id").eq("owner_user_id", user.id).single();
      if (!household) return;

      const [schoolsRes, clubsRes, childrenRes, familyRes, updatesRes] = await Promise.all([
        supabase.from("school_knowledge").select("*").eq("household_id", household.id),
        supabase.from("club_knowledge").select("*").eq("household_id", household.id).order("club_name"),
        supabase.from("children").select("id, name").eq("household_id", household.id),
        supabase.from("family_knowledge").select("*").eq("household_id", household.id).single(),
        supabase.from("ontology_updates").select("*").eq("household_id", household.id).order("created_at", { ascending: false }).limit(20),
      ]);

      setSchools(schoolsRes.data ?? []);
      setClubs(clubsRes.data ?? []);
      setFamily(familyRes.data);
      setUpdates(updatesRes.data ?? []);

      // Load child knowledge with names
      const childNames: ChildName[] = childrenRes.data ?? [];
      const ckList: (ChildKnowledge & { name: string })[] = [];
      for (const child of childNames) {
        const { data: ck } = await supabase.from("child_knowledge").select("*").eq("child_id", child.id).single();
        if (ck) ckList.push({ ...ck, name: child.name });
      }
      setChildKnowledge(ckList);
      setLoading(false);
    }
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-400">Loading...</p></div>;
  }

  const tabs = [
    { key: "schools" as const, label: "Schools", count: schools.length },
    { key: "clubs" as const, label: "Clubs", count: clubs.length },
    { key: "children" as const, label: "Children", count: childKnowledge.length },
    { key: "family" as const, label: "Family", count: family ? 1 : 0 },
    { key: "log" as const, label: "Update Log", count: updates.length },
  ];

  const isEmpty = schools.length === 0 && clubs.length === 0 && childKnowledge.length === 0 && !family;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Knowledge Base</h1>
            <p className="text-sm text-gray-400">Built automatically from your school emails</p>
          </div>
          <div className="flex gap-2">
            <a href="/dashboard" className="text-sm text-blue-600 hover:text-blue-700">Dashboard</a>
            <span className="text-gray-300">|</span>
            <a href="/calendar" className="text-sm text-blue-600 hover:text-blue-700">Calendar</a>
            <span className="text-gray-300">|</span>
            <a href="/clubs" className="text-sm text-blue-600 hover:text-blue-700">Clubs</a>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.label} {tab.count > 0 && <span className="text-xs text-gray-400 ml-1">({tab.count})</span>}
            </button>
          ))}
        </div>

        {isEmpty && activeTab !== "log" && (
          <div className="bg-white rounded-xl p-12 border border-gray-200 text-center">
            <p className="text-gray-400 text-lg mb-2">No knowledge yet</p>
            <p className="text-sm text-gray-300">The knowledge base builds automatically as emails are processed. Run the email ingestion to start learning about your schools, clubs, and family.</p>
          </div>
        )}

        {/* Schools Tab */}
        {activeTab === "schools" && schools.map((school) => (
          <div key={school.id} className="bg-white rounded-xl p-6 border border-gray-200 mb-4">
            <h3 className="text-lg font-bold text-gray-900 mb-4">{school.school_name}</h3>

            {(school.address || school.phone || school.email || school.website) && (
              <div className="mb-4">
                <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Contact</h4>
                {school.address && <p className="text-sm text-gray-600">{school.address}</p>}
                {school.phone && <p className="text-sm text-gray-600">{school.phone}</p>}
                {school.email && <p className="text-sm text-gray-600">{school.email}</p>}
                {school.website && <a href={school.website} className="text-sm text-blue-600">{school.website}</a>}
              </div>
            )}

            {school.staff?.length > 0 && (
              <div className="mb-4">
                <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Staff</h4>
                <div className="flex flex-wrap gap-2">
                  {school.staff.map((s, i) => (
                    <span key={i} className="inline-block bg-blue-50 text-blue-800 text-xs px-2 py-1 rounded-full">{s.name} ({s.role})</span>
                  ))}
                </div>
              </div>
            )}

            {school.term_dates?.length > 0 && (
              <div className="mb-4">
                <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Term Dates</h4>
                {school.term_dates.map((t, i) => (
                  <p key={i} className="text-sm text-gray-600">{t.term_name}: {t.start_date} to {t.end_date}</p>
                ))}
              </div>
            )}

            {school.payment_systems?.length > 0 && (
              <div className="mb-4">
                <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Payment Systems</h4>
                {school.payment_systems.map((p, i) => (
                  <p key={i} className="text-sm text-gray-600">{p.name} {p.url && <a href={p.url} className="text-blue-600 ml-1">→</a>}</p>
                ))}
              </div>
            )}

            {Object.keys(school.policies || {}).length > 0 && (
              <div className="mb-4">
                <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Policies</h4>
                {Object.entries(school.policies).map(([key, value]) => (
                  <div key={key} className="mb-1">
                    <span className="text-xs font-medium text-gray-500">{key}:</span>
                    <span className="text-sm text-gray-600 ml-2">{value}</span>
                  </div>
                ))}
              </div>
            )}

            <p className="text-[10px] text-gray-300 mt-4">Last updated: {new Date(school.updated_at).toLocaleDateString("en-GB")}</p>
          </div>
        ))}

        {/* Clubs Tab */}
        {activeTab === "clubs" && clubs.map((club) => (
          <div key={club.id} className="bg-white rounded-xl p-4 border border-gray-200 mb-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-gray-900">{club.club_name}</p>
                <p className="text-sm text-gray-500">
                  {club.day_of_week && `${club.day_of_week} `}
                  {club.start_time && `${club.start_time}-${club.end_time} `}
                  {club.location && `· ${club.location} `}
                  {club.year_groups && `· ${club.year_groups}`}
                </p>
                {club.provider && <p className="text-xs text-gray-400">By {club.provider}{club.is_external ? " (external)" : ""}</p>}
                {club.cost_per_session && <p className="text-xs text-gray-400">£{club.cost_per_session}/session{club.cost_per_term ? ` · £${club.cost_per_term}/term` : ""}</p>}
                {club.booking_method && <p className="text-xs text-gray-400">Book via {club.booking_method}</p>}
                {club.cancellation_policy && <p className="text-xs text-gray-400 mt-1 italic">{club.cancellation_policy}</p>}
              </div>
              {club.booking_url && <a href={club.booking_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:text-blue-700">Sign up →</a>}
            </div>
          </div>
        ))}

        {/* Children Tab */}
        {activeTab === "children" && childKnowledge.map((ck) => (
          <div key={ck.child_id} className="bg-white rounded-xl p-6 border border-gray-200 mb-4">
            <h3 className="text-lg font-bold text-gray-900 mb-3">{ck.name}</h3>
            {ck.class_name && <p className="text-sm text-gray-600">Class: {ck.class_name}</p>}
            {ck.teacher_name && <p className="text-sm text-gray-600">Teacher: {ck.teacher_name}</p>}
            {ck.teaching_assistant && <p className="text-sm text-gray-600">TA: {ck.teaching_assistant}</p>}
            {ck.dietary_notes && <p className="text-sm text-gray-600 mt-2">Diet: {ck.dietary_notes}</p>}
            {ck.medical_notes && <p className="text-sm text-gray-600">Medical: {ck.medical_notes}</p>}
            {ck.enrolled_clubs?.length > 0 && (
              <div className="mt-3">
                <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Enrolled Clubs</h4>
                <div className="flex flex-wrap gap-2">
                  {ck.enrolled_clubs.map((c, i) => (
                    <span key={i} className="inline-block bg-amber-50 text-amber-800 text-xs px-2 py-1 rounded-full">{c.club_name}{c.day ? ` · ${c.day}` : ""}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Family Tab */}
        {activeTab === "family" && family && (
          <div className="bg-white rounded-xl p-6 border border-gray-200">
            {family.parents?.length > 0 && (
              <div className="mb-4">
                <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Parents</h4>
                {family.parents.map((p, i) => (
                  <p key={i} className="text-sm text-gray-600">{p.name}{p.role ? ` (${p.role})` : ""}{p.email ? ` · ${p.email}` : ""}</p>
                ))}
              </div>
            )}
            {family.payment_accounts?.length > 0 && (
              <div className="mb-4">
                <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Payment Accounts</h4>
                {family.payment_accounts.map((a, i) => (
                  <p key={i} className="text-sm text-gray-600">{a.system}{a.notes ? ` — ${a.notes}` : ""}</p>
                ))}
              </div>
            )}
            {family.key_dates?.length > 0 && (
              <div className="mb-4">
                <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Key Dates</h4>
                {family.key_dates.map((d, i) => (
                  <p key={i} className="text-sm text-gray-600">{d.date}: {d.description}</p>
                ))}
              </div>
            )}
          </div>
        )}
        {activeTab === "family" && !family && (
          <div className="bg-white rounded-xl p-8 border border-gray-200 text-center">
            <p className="text-gray-400">No family knowledge yet. It builds as emails are processed.</p>
          </div>
        )}

        {/* Update Log Tab */}
        {activeTab === "log" && (
          <div>
            {updates.length === 0 ? (
              <div className="bg-white rounded-xl p-8 border border-gray-200 text-center">
                <p className="text-gray-400">No ontology updates yet.</p>
              </div>
            ) : (
              updates.map((u) => (
                <div key={u.id} className="bg-white rounded-xl p-4 border border-gray-200 mb-2">
                  <p className="text-sm font-medium text-gray-900">{u.source_subject}</p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {u.entities_updated.map((e, i) => (
                      <span key={i} className="inline-block bg-green-50 text-green-700 text-xs px-2 py-1 rounded-full">
                        {e.entity_type}: {e.entity_name} ({e.fields_updated.join(", ")})
                      </span>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-300 mt-2">{new Date(u.created_at).toLocaleString("en-GB")}</p>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
