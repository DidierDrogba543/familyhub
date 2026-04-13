"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

interface SchoolKnowledge {
  id: string;
  school_name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  staff: { name: string; role: string; email?: string }[];
  term_dates: { term_name: string; start_date: string; end_date: string }[];
  policies: Record<string, string>;
  payment_systems: { name: string; url?: string; notes?: string }[];
  notes: { date?: string; note: string }[];
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
  booking_url: string | null;
  contact_email: string | null;
  cancellation_policy: string | null;
  updated_at: string;
}

interface ChildKnowledge {
  id: string;
  child_id: string;
  class_name: string | null;
  teacher_name: string | null;
  teaching_assistant: string | null;
  dietary_notes: string | null;
  medical_notes: string | null;
  enrolled_clubs: { club_name: string; day?: string }[];
  updated_at: string;
}

interface FamilyKnowledge {
  id: string;
  parents: { name: string; role?: string; email?: string; phone?: string }[];
  pickup_arrangements: { child_name: string; details: string }[];
  emergency_contacts: { name: string; phone: string; relationship: string }[];
  payment_accounts: { system: string; notes?: string }[];
  key_dates: { date: string; description: string }[];
  updated_at: string;
}

interface ProviderLogin {
  id: string;
  provider_name: string;
  url: string | null;
  username: string | null;
  email: string | null;
  notes: string | null;
  category: string;
}

interface OntologyUpdate {
  id: string;
  source_subject: string;
  entities_updated: { entity_type: string; entity_name: string; fields_updated: string[] }[];
  created_at: string;
}

interface ChildRef { id: string; name: string; school_name: string; }

export default function KnowledgeView() {
  const [schools, setSchools] = useState<SchoolKnowledge[]>([]);
  const [clubs, setClubs] = useState<ClubKnowledge[]>([]);
  const [childKnowledge, setChildKnowledge] = useState<(ChildKnowledge & { name: string })[]>([]);
  const [childRefs, setChildRefs] = useState<ChildRef[]>([]);
  const [family, setFamily] = useState<FamilyKnowledge | null>(null);
  const [updates, setUpdates] = useState<OntologyUpdate[]>([]);
  const [logins, setLogins] = useState<ProviderLogin[]>([]);
  const [loading, setLoading] = useState(true);
  const [householdId, setHouseholdId] = useState("");
  const [activeTab, setActiveTab] = useState<"schools" | "clubs" | "children" | "family" | "logins" | "log">("schools");
  const [showAddLogin, setShowAddLogin] = useState(false);
  const [newLogin, setNewLogin] = useState({ provider_name: "", url: "", username: "", email: "", notes: "", category: "school" });

  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: household } = await supabase.from("households").select("id").eq("owner_user_id", user.id).single();
      if (!household) return;
      setHouseholdId(household.id);

      const [schoolsRes, clubsRes, childrenRes, familyRes, updatesRes, loginsRes] = await Promise.all([
        supabase.from("school_knowledge").select("id, school_name, address, phone, email, website, staff, term_dates, policies, payment_systems, notes, updated_at").eq("household_id", household.id),
        supabase.from("club_knowledge").select("id, club_name, school_name, day_of_week, start_time, end_time, location, provider, is_external, year_groups, cost_per_session, booking_url, contact_email, cancellation_policy, updated_at").eq("household_id", household.id).order("club_name"),
        supabase.from("children").select("id, name, school_name").eq("household_id", household.id),
        supabase.from("family_info").select("id, household_id, parents, pickup_arrangements, emergency_contacts, payment_accounts, preferences, key_dates, notes, updated_at").eq("household_id", household.id).single(),
        supabase.from("ontology_updates").select("id, source_subject, entities_updated, created_at").eq("household_id", household.id).order("created_at", { ascending: false }).limit(20),
        supabase.from("provider_logins").select("id, provider_name, url, username, email, notes, category").eq("household_id", household.id).order("provider_name"),
      ]);

      setSchools(schoolsRes.data ?? []);
      setClubs(clubsRes.data ?? []);
      setChildRefs(childrenRes.data ?? []);
      setFamily(familyRes.data);
      setUpdates(updatesRes.data ?? []);
      setLogins(loginsRes.data ?? []);

      const ckList: (ChildKnowledge & { name: string })[] = [];
      for (const child of childrenRes.data ?? []) {
        const { data: ck } = await supabase.from("child_knowledge").select("id, child_id, class_name, teacher_name, teaching_assistant, dietary_notes, medical_notes, enrolled_clubs, updated_at").eq("child_id", child.id).single();
        if (ck) ckList.push({ ...ck, name: child.name });
        else ckList.push({ id: "", child_id: child.id, name: child.name, class_name: null, teacher_name: null, teaching_assistant: null, dietary_notes: null, medical_notes: null, enrolled_clubs: [], updated_at: "" });
      }
      setChildKnowledge(ckList);
      setLoading(false);
    }
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Save helpers (all writes go through API to bypass RLS issues) ---
  const saveViaApi = useCallback(async (table: string, match: Record<string, string>, set: Record<string, unknown>) => {
    const res = await fetch("/api/admin/save-knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ table, match, set, householdId }),
    });
    const result = await res.json();
    if (!result.success) console.error("Save error:", result.error);
    return result.success;
  }, [householdId]);

  const saveSchoolField = useCallback(async (schoolId: string, field: string, value: unknown) => {
    await saveViaApi("school_knowledge", { id: schoolId }, { [field]: value });
    setSchools((prev) => prev.map((s) => s.id === schoolId ? { ...s, [field]: value } : s));
  }, [saveViaApi]);

  const saveChildField = useCallback(async (childId: string, field: string, value: unknown) => {
    await saveViaApi("child_knowledge", { child_id: childId }, { [field]: value });
    setChildKnowledge((prev) => prev.map((c) => c.child_id === childId ? { ...c, [field]: value } : c));
  }, [saveViaApi]);

  const saveFamily = useCallback(async (field: string, value: unknown) => {
    await saveViaApi("family_info", {}, { [field]: value });
    setFamily((prev) => {
      const base = prev ?? { id: "new", parents: [], pickup_arrangements: [], emergency_contacts: [], payment_accounts: [], key_dates: [], updated_at: new Date().toISOString() } as FamilyKnowledge;
      return { ...base, [field]: value };
    });
  }, [saveViaApi]);

  const addSchool = async () => {
    const schoolName = childRefs[0]?.school_name || "New School";
    const { data } = await supabase.from("school_knowledge").insert({
      household_id: householdId, school_name: schoolName, staff: [], term_dates: [], policies: {}, payment_systems: [], notes: [],
    }).select("id, school_name").single();
    if (data) setSchools([...schools, { ...data, address: null, phone: null, email: null, website: null, staff: [], term_dates: [], policies: {}, payment_systems: [], notes: [], updated_at: "" } as SchoolKnowledge]);
  };

  if (loading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-400">Loading...</p></div>;

  const tabs = [
    { key: "schools" as const, label: "Schools", count: schools.length },
    { key: "clubs" as const, label: "Clubs", count: clubs.length },
    { key: "children" as const, label: "Children", count: childKnowledge.length },
    { key: "family" as const, label: "Family", count: family ? 1 : 0 },
    { key: "logins" as const, label: "Logins", count: logins.length },
    { key: "log" as const, label: "Log", count: updates.length },
  ];

  const addLogin = async () => {
    if (!newLogin.provider_name) return;
    const res = await fetch("/api/admin/save-knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        table: "provider_logins",
        match: {},
        set: {},
        householdId,
        // Using a custom insert path
      }),
    });
    // Direct insert via supabase for simplicity
    const { data } = await supabase.from("provider_logins").insert({
      household_id: householdId,
      provider_name: newLogin.provider_name,
      url: newLogin.url || null,
      username: newLogin.username || null,
      email: newLogin.email || null,
      notes: newLogin.notes || null,
      category: newLogin.category,
    }).select("id, provider_name, url, username, email, notes, category").single();
    if (data) {
      setLogins([...logins, data]);
      setNewLogin({ provider_name: "", url: "", username: "", email: "", notes: "", category: "school" });
      setShowAddLogin(false);
    }
  };

  const removeLogin = async (id: string) => {
    await supabase.from("provider_logins").delete().eq("id", id);
    setLogins(logins.filter((l) => l.id !== id));
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Knowledge Base</h1>
            <p className="text-sm text-gray-400">Auto-built from emails + manually editable</p>
          </div>
          <div className="flex gap-2 text-sm">
            <a href="/dashboard" className="text-blue-600 hover:text-blue-700">Dashboard</a>
            <span className="text-gray-300">|</span>
            <a href="/calendar" className="text-blue-600 hover:text-blue-700">Calendar</a>
          </div>
        </div>

        <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl">
          {tabs.map((tab) => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${activeTab === tab.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
              {tab.label} {tab.count > 0 && <span className="text-xs text-gray-400 ml-1">({tab.count})</span>}
            </button>
          ))}
        </div>

        {/* === Schools === */}
        {activeTab === "schools" && (
          <div>
            {schools.map((school) => (
              <div key={school.id} className="bg-white rounded-xl p-6 border border-gray-200 mb-4">
                <EditableField label="School Name" value={school.school_name} onSave={(v) => saveSchoolField(school.id, "school_name", v)} large />

                <div className="grid grid-cols-2 gap-x-6 gap-y-1 mt-4">
                  <EditableField label="Address" value={school.address} onSave={(v) => saveSchoolField(school.id, "address", v)} multiline />
                  <EditableField label="Phone" value={school.phone} onSave={(v) => saveSchoolField(school.id, "phone", v)} />
                  <EditableField label="Email" value={school.email} onSave={(v) => saveSchoolField(school.id, "email", v)} />
                  <EditableField label="Website" value={school.website} onSave={(v) => saveSchoolField(school.id, "website", v)} />
                </div>

                {/* Staff */}
                <div className="mt-6">
                  <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Staff</h4>
                  <div className="space-y-2">
                    {(school.staff || []).map((s, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <span className="font-medium text-gray-900">{s.name}</span>
                        <span className="text-gray-400">—</span>
                        <span className="text-gray-500">{s.role}</span>
                        {s.email && <span className="text-gray-400 text-xs">({s.email})</span>}
                        <button onClick={() => {
                          const updated = [...school.staff]; updated.splice(i, 1);
                          saveSchoolField(school.id, "staff", updated);
                        }} className="text-xs text-red-400 hover:text-red-600 ml-auto">Remove</button>
                      </div>
                    ))}
                  </div>
                  <AddStaffForm onAdd={(staff) => saveSchoolField(school.id, "staff", [...(school.staff || []), staff])} />
                </div>

                {/* Payment Systems */}
                <div className="mt-6">
                  <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Payment Systems</h4>
                  {(school.payment_systems || []).map((p, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm mb-1">
                      <span className="font-medium text-gray-900">{p.name}</span>
                      {p.url && <a href={p.url} className="text-blue-600 text-xs" target="_blank" rel="noopener noreferrer">Open</a>}
                      <button onClick={() => {
                        const updated = [...school.payment_systems]; updated.splice(i, 1);
                        saveSchoolField(school.id, "payment_systems", updated);
                      }} className="text-xs text-red-400 hover:text-red-600 ml-auto">Remove</button>
                    </div>
                  ))}
                  <AddPaymentForm onAdd={(ps) => saveSchoolField(school.id, "payment_systems", [...(school.payment_systems || []), ps])} />
                </div>

                {/* Term Dates */}
                <div className="mt-6">
                  <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Term Dates</h4>
                  {(school.term_dates || []).map((t, i) => (
                    <div key={i} className="text-sm text-gray-600 mb-1">
                      <span className="font-medium">{t.term_name}:</span> {t.start_date} to {t.end_date}
                      <button onClick={() => {
                        const updated = [...school.term_dates]; updated.splice(i, 1);
                        saveSchoolField(school.id, "term_dates", updated);
                      }} className="text-xs text-red-400 hover:text-red-600 ml-2">Remove</button>
                    </div>
                  ))}
                  <AddTermForm onAdd={(td) => saveSchoolField(school.id, "term_dates", [...(school.term_dates || []), td])} />
                </div>

                {/* Policies */}
                <div className="mt-6">
                  <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Policies</h4>
                  {Object.entries(school.policies || {}).map(([key, value]) => (
                    <div key={key} className="mb-2">
                      <span className="text-xs font-medium text-gray-500 capitalize">{key}:</span>
                      <p className="text-sm text-gray-600">{value}</p>
                    </div>
                  ))}
                  <AddPolicyForm onAdd={(key, value) => saveSchoolField(school.id, "policies", { ...(school.policies || {}), [key]: value })} />
                </div>
              </div>
            ))}
            <button onClick={addSchool} className="w-full py-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-400 hover:border-gray-400 text-sm">+ Add school</button>
          </div>
        )}

        {/* === Children === */}
        {activeTab === "children" && (
          <div>
            {childKnowledge.map((ck) => (
              <div key={ck.child_id} className="bg-white rounded-xl p-6 border border-gray-200 mb-4">
                <h3 className="text-lg font-bold text-gray-900 mb-4">{ck.name}</h3>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                  <EditableField label="Class" value={ck.class_name} onSave={(v) => saveChildField(ck.child_id, "class_name", v)} />
                  <EditableField label="Teacher" value={ck.teacher_name} onSave={(v) => saveChildField(ck.child_id, "teacher_name", v)} />
                  <EditableField label="Teaching Assistant" value={ck.teaching_assistant} onSave={(v) => saveChildField(ck.child_id, "teaching_assistant", v)} />
                </div>
                <div className="mt-4 grid grid-cols-1 gap-y-1">
                  <EditableField label="Dietary Notes" value={ck.dietary_notes} onSave={(v) => saveChildField(ck.child_id, "dietary_notes", v)} />
                  <EditableField label="Medical Notes" value={ck.medical_notes} onSave={(v) => saveChildField(ck.child_id, "medical_notes", v)} />
                </div>
                {ck.enrolled_clubs?.length > 0 && (
                  <div className="mt-4">
                    <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Enrolled Clubs</h4>
                    <div className="flex flex-wrap gap-2">
                      {ck.enrolled_clubs.map((c, i) => (
                        <span key={i} className="bg-amber-50 text-amber-800 text-xs px-2 py-1 rounded-full">{c.club_name}{c.day ? ` · ${c.day}` : ""}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* === Family === */}
        {activeTab === "family" && (
          <div className="bg-white rounded-xl p-6 border border-gray-200">
            {/* Parents */}
            <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Parents / Guardians</h4>
            {(family?.parents || []).map((p, i) => (
              <div key={i} className="flex items-center gap-2 text-sm mb-1">
                <span className="font-medium text-gray-900">{p.name}</span>
                {p.role && <span className="text-gray-400">({p.role})</span>}
                {p.email && <span className="text-xs text-gray-400">{p.email}</span>}
                {p.phone && <span className="text-xs text-gray-400">{p.phone}</span>}
                <button onClick={() => {
                  const updated = [...(family?.parents || [])]; updated.splice(i, 1);
                  saveFamily("parents", updated);
                }} className="text-xs text-red-400 hover:text-red-600 ml-auto">Remove</button>
              </div>
            ))}
            <AddPersonForm label="parent" onAdd={(p) => saveFamily("parents", [...(family?.parents || []), p])} />

            {/* Emergency Contacts */}
            <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2 mt-6">Emergency Contacts</h4>
            {(family?.emergency_contacts || []).map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-sm mb-1">
                <span className="font-medium text-gray-900">{c.name}</span>
                <span className="text-gray-400">{c.relationship}</span>
                <span className="text-xs text-gray-400">{c.phone}</span>
                <button onClick={() => {
                  const updated = [...(family?.emergency_contacts || [])]; updated.splice(i, 1);
                  saveFamily("emergency_contacts", updated);
                }} className="text-xs text-red-400 hover:text-red-600 ml-auto">Remove</button>
              </div>
            ))}
            <AddEmergencyForm onAdd={(c) => saveFamily("emergency_contacts", [...(family?.emergency_contacts || []), c])} />

            {/* Pickup Arrangements */}
            <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2 mt-6">Pickup Arrangements</h4>
            {(family?.pickup_arrangements || []).map((p, i) => (
              <div key={i} className="text-sm text-gray-600 mb-1">
                <span className="font-medium">{p.child_name}:</span> {p.details}
                <button onClick={() => {
                  const updated = [...(family?.pickup_arrangements || [])]; updated.splice(i, 1);
                  saveFamily("pickup_arrangements", updated);
                }} className="text-xs text-red-400 hover:text-red-600 ml-2">Remove</button>
              </div>
            ))}
            <AddPickupForm childNames={childRefs.map((c) => c.name)} onAdd={(p) => saveFamily("pickup_arrangements", [...(family?.pickup_arrangements || []), p])} />

            {/* Payment Accounts */}
            <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2 mt-6">Payment Accounts</h4>
            {(family?.payment_accounts || []).map((a, i) => (
              <div key={i} className="text-sm text-gray-600 mb-1">
                <span className="font-medium">{a.system}</span>{a.notes ? ` — ${a.notes}` : ""}
                <button onClick={() => {
                  const updated = [...(family?.payment_accounts || [])]; updated.splice(i, 1);
                  saveFamily("payment_accounts", updated);
                }} className="text-xs text-red-400 hover:text-red-600 ml-2">Remove</button>
              </div>
            ))}
          </div>
        )}

        {/* === Clubs === */}
        {activeTab === "clubs" && (
          <div>
            {clubs.map((club) => (
              <div key={club.id} className="bg-white rounded-xl p-4 border border-gray-200 mb-3">
                <p className="font-semibold text-gray-900">{club.club_name}</p>
                <p className="text-sm text-gray-500">
                  {club.day_of_week && `${club.day_of_week} `}{club.start_time && `${club.start_time}-${club.end_time} `}
                  {club.location && `· ${club.location} `}{club.year_groups && `· ${club.year_groups}`}
                </p>
                {club.provider && <p className="text-xs text-gray-400">By {club.provider}{club.is_external ? " (external)" : ""}</p>}
                {club.cost_per_session && <p className="text-xs text-gray-400">£{club.cost_per_session}/session</p>}
                {club.contact_email && <p className="text-xs text-gray-400">{club.contact_email}</p>}
                {club.cancellation_policy && <p className="text-xs text-gray-400 italic mt-1">{club.cancellation_policy}</p>}
                {club.booking_url && <a href={club.booking_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 mt-1 inline-block">Sign up →</a>}
              </div>
            ))}
            {clubs.length === 0 && <p className="text-gray-400 text-center py-8">Clubs are auto-populated from school emails.</p>}
          </div>
        )}

        {/* === Logins === */}
        {activeTab === "logins" && (
          <div>
            {logins.length > 0 && (
              <div className="space-y-3 mb-6">
                {logins.map((login) => (
                  <div key={login.id} className="bg-white rounded-xl p-5 border border-gray-200">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-semibold text-gray-900">{login.provider_name}</p>
                          <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded">{login.category}</span>
                        </div>
                        {login.url && (
                          <a href={login.url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:text-blue-700 block mt-1">
                            {login.url}
                          </a>
                        )}
                        <div className="grid grid-cols-2 gap-x-4 mt-2">
                          {login.username && (
                            <div>
                              <p className="text-[10px] text-gray-400">Username</p>
                              <p className="text-sm text-gray-700">{login.username}</p>
                            </div>
                          )}
                          {login.email && (
                            <div>
                              <p className="text-[10px] text-gray-400">Email</p>
                              <p className="text-sm text-gray-700">{login.email}</p>
                            </div>
                          )}
                        </div>
                        {login.notes && <p className="text-sm text-gray-400 mt-2">{login.notes}</p>}
                      </div>
                      <button onClick={() => removeLogin(login.id)} className="text-xs text-red-400 hover:text-red-600">Remove</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {showAddLogin ? (
              <div className="bg-white rounded-xl p-5 border-2 border-blue-200 space-y-3">
                <h3 className="font-semibold text-gray-900 mb-2">Add provider login</h3>
                <input type="text" value={newLogin.provider_name} onChange={(e) => setNewLogin({ ...newLogin, provider_name: e.target.value })} placeholder="Provider name (e.g. ParentMail, SCOPAY)" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                <input type="url" value={newLogin.url} onChange={(e) => setNewLogin({ ...newLogin, url: e.target.value })} placeholder="Login URL (e.g. https://pmx.parentmail.co.uk)" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                <div className="grid grid-cols-2 gap-3">
                  <input type="text" value={newLogin.username} onChange={(e) => setNewLogin({ ...newLogin, username: e.target.value })} placeholder="Username (optional)" className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  <input type="email" value={newLogin.email} onChange={(e) => setNewLogin({ ...newLogin, email: e.target.value })} placeholder="Email (optional)" className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <select value={newLogin.category} onChange={(e) => setNewLogin({ ...newLogin, category: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option value="school">School</option>
                  <option value="communication">Communication</option>
                  <option value="payment">Payment</option>
                  <option value="club">Club / Activity</option>
                  <option value="other">Other</option>
                </select>
                <textarea value={newLogin.notes} onChange={(e) => setNewLogin({ ...newLogin, notes: e.target.value })} placeholder="Notes (e.g. login with Google account, password in 1Password)" rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                <div className="flex gap-2">
                  <button onClick={addLogin} className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">Save</button>
                  <button onClick={() => { setShowAddLogin(false); setNewLogin({ provider_name: "", url: "", username: "", email: "", notes: "", category: "school" }); }} className="flex-1 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowAddLogin(true)} className="w-full py-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-400 hover:border-gray-400 text-sm">+ Add provider login</button>
            )}

            {logins.length === 0 && !showAddLogin && (
              <p className="text-center text-gray-300 text-sm mt-4">Store login details for school portals, payment systems, and club providers.</p>
            )}
          </div>
        )}

        {/* === Log === */}
        {activeTab === "log" && (
          <div>
            {updates.length === 0 ? (
              <p className="text-gray-400 text-center py-8">No ontology updates yet.</p>
            ) : updates.map((u) => (
              <div key={u.id} className="bg-white rounded-xl p-4 border border-gray-200 mb-2">
                <p className="text-sm font-medium text-gray-900">{u.source_subject}</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {u.entities_updated.map((e, i) => (
                    <span key={i} className="bg-green-50 text-green-700 text-xs px-2 py-1 rounded-full">
                      {e.entity_type}: {e.entity_name} ({e.fields_updated.join(", ")})
                    </span>
                  ))}
                </div>
                <p className="text-[10px] text-gray-300 mt-2">{new Date(u.created_at).toLocaleString("en-GB")}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Editable Field Component ---
function EditableField({ label, value, onSave, large, multiline }: {
  label: string; value: string | null; onSave: (v: string) => void; large?: boolean; multiline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");

  const save = () => { onSave(draft); setEditing(false); };
  const cancel = () => { setDraft(value || ""); setEditing(false); };

  if (editing) {
    return (
      <div className="py-1">
        <label className="block text-xs text-gray-400 mb-1">{label}</label>
        {multiline ? (
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} className="w-full px-2 py-1.5 border border-blue-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" autoFocus />
        ) : (
          <input type="text" value={draft} onChange={(e) => setDraft(e.target.value)} className={`w-full px-2 py-1.5 border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 ${large ? "text-lg font-bold" : "text-sm"}`} autoFocus onKeyDown={(e) => e.key === "Enter" && save()} />
        )}
        <div className="flex gap-1 mt-1">
          <button onClick={save} className="text-xs text-blue-600 font-medium">Save</button>
          <button onClick={cancel} className="text-xs text-gray-400">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="py-1 group cursor-pointer" onClick={() => { setDraft(value || ""); setEditing(true); }}>
      <label className="block text-xs text-gray-400">{label}</label>
      {value ? (
        <p className={`${large ? "text-lg font-bold text-gray-900" : "text-sm text-gray-700"} group-hover:text-blue-600`}>{value}</p>
      ) : (
        <p className="text-sm text-gray-300 italic group-hover:text-blue-400">Click to add</p>
      )}
    </div>
  );
}

// --- Add Forms ---
function AddStaffForm({ onAdd }: { onAdd: (s: { name: string; role: string; email?: string }) => void }) {
  const [show, setShow] = useState(false);
  const [name, setName] = useState(""); const [role, setRole] = useState(""); const [email, setEmail] = useState("");
  if (!show) return <button onClick={() => setShow(true)} className="text-xs text-blue-500 hover:text-blue-600 mt-2">+ Add staff member</button>;
  return (
    <div className="flex gap-2 mt-2 items-end">
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-xs" />
      <input type="text" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role (e.g. Head, Class Teacher)" className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-xs" />
      <input type="text" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (optional)" className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-xs" />
      <button onClick={() => { if (name && role) { onAdd({ name, role, email: email || undefined }); setName(""); setRole(""); setEmail(""); setShow(false); } }} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs">Add</button>
      <button onClick={() => setShow(false)} className="text-xs text-gray-400">Cancel</button>
    </div>
  );
}

function AddPaymentForm({ onAdd }: { onAdd: (p: { name: string; url?: string }) => void }) {
  const [show, setShow] = useState(false);
  const [name, setName] = useState(""); const [url, setUrl] = useState("");
  if (!show) return <button onClick={() => setShow(true)} className="text-xs text-blue-500 hover:text-blue-600 mt-2">+ Add payment system</button>;
  return (
    <div className="flex gap-2 mt-2 items-end">
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. SCOPAY, ParentPay" className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-xs" />
      <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="URL (optional)" className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-xs" />
      <button onClick={() => { if (name) { onAdd({ name, url: url || undefined }); setName(""); setUrl(""); setShow(false); } }} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs">Add</button>
      <button onClick={() => setShow(false)} className="text-xs text-gray-400">Cancel</button>
    </div>
  );
}

function AddTermForm({ onAdd }: { onAdd: (t: { term_name: string; start_date: string; end_date: string }) => void }) {
  const [show, setShow] = useState(false);
  const [termName, setTermName] = useState(""); const [start, setStart] = useState(""); const [end, setEnd] = useState("");
  if (!show) return <button onClick={() => setShow(true)} className="text-xs text-blue-500 hover:text-blue-600 mt-2">+ Add term dates</button>;
  return (
    <div className="flex gap-2 mt-2 items-end">
      <input type="text" value={termName} onChange={(e) => setTermName(e.target.value)} placeholder="e.g. Summer 2026" className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-xs" />
      <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs" />
      <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs" />
      <button onClick={() => { if (termName && start && end) { onAdd({ term_name: termName, start_date: start, end_date: end }); setTermName(""); setStart(""); setEnd(""); setShow(false); } }} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs">Add</button>
      <button onClick={() => setShow(false)} className="text-xs text-gray-400">Cancel</button>
    </div>
  );
}

function AddPolicyForm({ onAdd }: { onAdd: (key: string, value: string) => void }) {
  const [show, setShow] = useState(false);
  const [key, setKey] = useState(""); const [value, setValue] = useState("");
  if (!show) return <button onClick={() => setShow(true)} className="text-xs text-blue-500 hover:text-blue-600 mt-2">+ Add policy</button>;
  return (
    <div className="flex gap-2 mt-2 items-end">
      <input type="text" value={key} onChange={(e) => setKey(e.target.value)} placeholder="e.g. uniform, attendance" className="w-40 px-2 py-1.5 border border-gray-300 rounded-lg text-xs" />
      <input type="text" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Policy details" className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-xs" />
      <button onClick={() => { if (key && value) { onAdd(key, value); setKey(""); setValue(""); setShow(false); } }} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs">Add</button>
      <button onClick={() => setShow(false)} className="text-xs text-gray-400">Cancel</button>
    </div>
  );
}

function AddPersonForm({ label, onAdd }: { label: string; onAdd: (p: { name: string; role?: string; email?: string; phone?: string }) => void }) {
  const [show, setShow] = useState(false);
  const [name, setName] = useState(""); const [role, setRole] = useState(""); const [email, setEmail] = useState(""); const [phone, setPhone] = useState("");
  if (!show) return <button onClick={() => setShow(true)} className="text-xs text-blue-500 hover:text-blue-600 mt-2">+ Add {label}</button>;
  return (
    <div className="flex gap-2 mt-2 items-end flex-wrap">
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="flex-1 min-w-[120px] px-2 py-1.5 border border-gray-300 rounded-lg text-xs" />
      <input type="text" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role (optional)" className="w-32 px-2 py-1.5 border border-gray-300 rounded-lg text-xs" />
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="flex-1 min-w-[120px] px-2 py-1.5 border border-gray-300 rounded-lg text-xs" />
      <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className="w-32 px-2 py-1.5 border border-gray-300 rounded-lg text-xs" />
      <button onClick={() => { if (name) { onAdd({ name, role: role || undefined, email: email || undefined, phone: phone || undefined }); setName(""); setRole(""); setEmail(""); setPhone(""); setShow(false); } }} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs">Add</button>
      <button onClick={() => setShow(false)} className="text-xs text-gray-400">Cancel</button>
    </div>
  );
}

function AddEmergencyForm({ onAdd }: { onAdd: (c: { name: string; phone: string; relationship: string }) => void }) {
  const [show, setShow] = useState(false);
  const [name, setName] = useState(""); const [phone, setPhone] = useState(""); const [rel, setRel] = useState("");
  if (!show) return <button onClick={() => setShow(true)} className="text-xs text-blue-500 hover:text-blue-600 mt-2">+ Add emergency contact</button>;
  return (
    <div className="flex gap-2 mt-2 items-end">
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-xs" />
      <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className="w-32 px-2 py-1.5 border border-gray-300 rounded-lg text-xs" />
      <input type="text" value={rel} onChange={(e) => setRel(e.target.value)} placeholder="Relationship" className="w-32 px-2 py-1.5 border border-gray-300 rounded-lg text-xs" />
      <button onClick={() => { if (name && phone) { onAdd({ name, phone, relationship: rel }); setName(""); setPhone(""); setRel(""); setShow(false); } }} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs">Add</button>
      <button onClick={() => setShow(false)} className="text-xs text-gray-400">Cancel</button>
    </div>
  );
}

function AddPickupForm({ childNames, onAdd }: { childNames: string[]; onAdd: (p: { child_name: string; details: string }) => void }) {
  const [show, setShow] = useState(false);
  const [childName, setChildName] = useState(childNames[0] || ""); const [details, setDetails] = useState("");
  if (!show) return <button onClick={() => setShow(true)} className="text-xs text-blue-500 hover:text-blue-600 mt-2">+ Add pickup arrangement</button>;
  return (
    <div className="flex gap-2 mt-2 items-end">
      <select value={childName} onChange={(e) => setChildName(e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs">
        {childNames.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <input type="text" value={details} onChange={(e) => setDetails(e.target.value)} placeholder="e.g. Mum picks up Mon-Wed, Dad Thu-Fri" className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-xs" />
      <button onClick={() => { if (childName && details) { onAdd({ child_name: childName, details }); setDetails(""); setShow(false); } }} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs">Add</button>
      <button onClick={() => setShow(false)} className="text-xs text-gray-400">Cancel</button>
    </div>
  );
}
