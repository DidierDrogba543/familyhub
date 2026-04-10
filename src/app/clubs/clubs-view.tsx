"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface Term {
  id: string;
  school_name: string;
  term_name: string;
  start_date: string;
  end_date: string;
}

interface Club {
  id: string;
  term_id: string;
  club_name: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  location: string | null;
  year_groups: string | null;
  provider: string | null;
  is_external: boolean;
  cost_per_session: number | null;
  signup_url: string | null;
  notes: string | null;
}

interface Enrollment {
  id: string;
  child_id: string;
  club_id: string;
  status: string;
  paid: boolean;
}

interface Child {
  id: string;
  name: string;
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

export default function ClubsView() {
  const [terms, setTerms] = useState<Term[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [householdId, setHouseholdId] = useState("");
  const [selectedTermId, setSelectedTermId] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAddTerm, setShowAddTerm] = useState(false);
  const [showAddClub, setShowAddClub] = useState(false);
  const [newTerm, setNewTerm] = useState({ school_name: "", term_name: "", start_date: "", end_date: "" });
  const [newClub, setNewClub] = useState({
    club_name: "", day_of_week: "Monday", start_time: "15:30", end_time: "16:30",
    location: "", year_groups: "", provider: "", is_external: false,
    cost_per_session: "", signup_url: "", notes: "",
  });

  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: household } = await supabase
        .from("households").select("id").eq("owner_user_id", user.id).single();
      if (!household) return;
      setHouseholdId(household.id);

      const [termsRes, childrenRes] = await Promise.all([
        supabase.from("school_terms").select("*").eq("household_id", household.id).order("start_date", { ascending: false }),
        supabase.from("children").select("id, name").eq("household_id", household.id),
      ]);

      setTerms(termsRes.data ?? []);
      setChildren(childrenRes.data ?? []);

      // Auto-fill school name from first child
      if (childrenRes.data?.[0]) {
        // Get school name from children table
        const { data: firstChild } = await supabase
          .from("children").select("school_name").eq("id", childrenRes.data[0].id).single();
        if (firstChild) {
          setNewTerm((prev) => ({ ...prev, school_name: firstChild.school_name }));
        }
      }

      // Select most recent term
      if (termsRes.data?.[0]) {
        setSelectedTermId(termsRes.data[0].id);
        await loadClubsForTerm(termsRes.data[0].id);
      }

      setLoading(false);
    }
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadClubsForTerm = async (termId: string) => {
    const [clubsRes, enrollRes] = await Promise.all([
      supabase.from("club_schedule").select("*").eq("term_id", termId).order("day_of_week").order("start_time"),
      supabase.from("child_enrollments").select("*"),
    ]);
    setClubs(clubsRes.data ?? []);
    setEnrollments(enrollRes.data ?? []);
  };

  const selectTerm = async (termId: string) => {
    setSelectedTermId(termId);
    await loadClubsForTerm(termId);
  };

  const addTerm = async () => {
    if (!newTerm.school_name || !newTerm.term_name || !newTerm.start_date || !newTerm.end_date) return;
    const { data } = await supabase.from("school_terms").insert({
      household_id: householdId, ...newTerm,
    }).select("*").single();
    if (data) {
      setTerms([data, ...terms]);
      setSelectedTermId(data.id);
      setClubs([]);
      setShowAddTerm(false);
      setNewTerm({ ...newTerm, term_name: "", start_date: "", end_date: "" });
    }
  };

  const addClub = async () => {
    if (!newClub.club_name || !selectedTermId) return;
    const { data } = await supabase.from("club_schedule").insert({
      term_id: selectedTermId,
      club_name: newClub.club_name,
      day_of_week: newClub.day_of_week,
      start_time: newClub.start_time,
      end_time: newClub.end_time,
      location: newClub.location || null,
      year_groups: newClub.year_groups || null,
      provider: newClub.provider || null,
      is_external: newClub.is_external,
      cost_per_session: newClub.cost_per_session ? parseFloat(newClub.cost_per_session) : null,
      signup_url: newClub.signup_url || null,
      notes: newClub.notes || null,
    }).select("*").single();
    if (data) {
      setClubs([...clubs, data]);
      setNewClub({ club_name: "", day_of_week: "Monday", start_time: "15:30", end_time: "16:30", location: "", year_groups: "", provider: "", is_external: false, cost_per_session: "", signup_url: "", notes: "" });
      setShowAddClub(false);
    }
  };

  const removeClub = async (id: string) => {
    await supabase.from("club_schedule").delete().eq("id", id);
    setClubs(clubs.filter((c) => c.id !== id));
  };

  const toggleEnrollment = async (childId: string, clubId: string) => {
    const existing = enrollments.find((e) => e.child_id === childId && e.club_id === clubId);
    if (existing) {
      await supabase.from("child_enrollments").delete().eq("id", existing.id);
      setEnrollments(enrollments.filter((e) => e.id !== existing.id));
    } else {
      const { data } = await supabase.from("child_enrollments").insert({
        child_id: childId, club_id: clubId, status: "enrolled",
      }).select("*").single();
      if (data) setEnrollments([...enrollments, data]);
    }
  };

  const isEnrolled = (childId: string, clubId: string) =>
    enrollments.some((e) => e.child_id === childId && e.club_id === clubId);

  const selectedTerm = terms.find((t) => t.id === selectedTermId);

  if (loading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-400">Loading...</p></div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Club Schedule</h1>
            {selectedTerm && (
              <p className="text-sm text-gray-400">{selectedTerm.school_name} · {selectedTerm.term_name}</p>
            )}
          </div>
          <div className="flex gap-2">
            <a href="/dashboard" className="text-sm text-blue-600 hover:text-blue-700">Dashboard</a>
            <span className="text-gray-300">|</span>
            <a href="/calendar" className="text-sm text-blue-600 hover:text-blue-700">Calendar</a>
          </div>
        </div>

        {/* Term selector */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {terms.map((term) => (
            <button
              key={term.id}
              onClick={() => selectTerm(term.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                term.id === selectedTermId
                  ? "bg-blue-600 text-white"
                  : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {term.term_name}
            </button>
          ))}
          <button
            onClick={() => setShowAddTerm(true)}
            className="px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-400 hover:border-gray-400 text-sm"
          >
            + Add term
          </button>
        </div>

        {/* Add Term Form */}
        {showAddTerm && (
          <div className="bg-white rounded-xl p-6 mb-6 border-2 border-blue-200">
            <h3 className="font-semibold text-gray-900 mb-4">Add school term</h3>
            <div className="grid grid-cols-2 gap-3">
              <input type="text" value={newTerm.school_name} onChange={(e) => setNewTerm({ ...newTerm, school_name: e.target.value })} placeholder="School name" className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <input type="text" value={newTerm.term_name} onChange={(e) => setNewTerm({ ...newTerm, term_name: e.target.value })} placeholder="e.g. Summer 2026" className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <div><label className="block text-xs text-gray-500 mb-1">Start</label><input type="date" value={newTerm.start_date} onChange={(e) => setNewTerm({ ...newTerm, start_date: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">End</label><input type="date" value={newTerm.end_date} onChange={(e) => setNewTerm({ ...newTerm, end_date: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={addTerm} className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">Save</button>
              <button onClick={() => setShowAddTerm(false)} className="flex-1 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
            </div>
          </div>
        )}

        {/* Club timetable by day */}
        {selectedTermId && (
          <>
            {DAYS.map((day) => {
              const dayClubs = clubs.filter((c) => c.day_of_week === day);
              if (dayClubs.length === 0) return null;

              return (
                <div key={day} className="mb-6">
                  <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">{day}</h3>
                  <div className="space-y-2">
                    {dayClubs.map((club) => (
                      <div key={club.id} className="bg-white rounded-xl p-4 border border-gray-200">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <p className="font-semibold text-gray-900">{club.club_name}</p>
                              {club.is_external && (
                                <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">External</span>
                              )}
                            </div>
                            <p className="text-sm text-gray-500 mt-0.5">
                              {club.start_time} - {club.end_time}
                              {club.location ? ` · ${club.location}` : ""}
                              {club.year_groups ? ` · ${club.year_groups}` : ""}
                            </p>
                            {club.provider && <p className="text-xs text-gray-400 mt-0.5">By {club.provider}</p>}
                            {club.cost_per_session && <p className="text-xs text-gray-400">£{club.cost_per_session}/session</p>}
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            {children.map((child) => (
                              <button
                                key={child.id}
                                onClick={() => toggleEnrollment(child.id, club.id)}
                                className={`text-xs px-2 py-1 rounded-full ${
                                  isEnrolled(child.id, club.id)
                                    ? "bg-green-100 text-green-700 font-medium"
                                    : "bg-gray-100 text-gray-400 hover:bg-gray-200"
                                }`}
                              >
                                {isEnrolled(child.id, club.id) ? "✓ " : ""}{child.name}
                              </button>
                            ))}
                            <button onClick={() => removeClub(club.id)} className="text-[10px] text-red-400 hover:text-red-600 mt-1">Remove</button>
                          </div>
                        </div>
                        {club.signup_url && (
                          <a href={club.signup_url} target="_blank" rel="noopener noreferrer" className="inline-block mt-2 text-xs text-blue-600 hover:text-blue-700">Sign up →</a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            <button
              onClick={() => setShowAddClub(true)}
              className="w-full py-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-400 hover:border-gray-400 hover:text-gray-500 text-sm mb-6"
            >
              + Add club
            </button>

            {/* Add Club Form */}
            {showAddClub && (
              <div className="bg-white rounded-xl p-6 mb-6 border-2 border-amber-200">
                <h3 className="font-semibold text-gray-900 mb-4">Add club to {selectedTerm?.term_name}</h3>
                <div className="grid grid-cols-2 gap-3">
                  <input type="text" value={newClub.club_name} onChange={(e) => setNewClub({ ...newClub, club_name: e.target.value })} placeholder="Club name" className="col-span-2 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  <select value={newClub.day_of_week} onChange={(e) => setNewClub({ ...newClub, day_of_week: e.target.value })} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
                    {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <input type="text" value={newClub.year_groups} onChange={(e) => setNewClub({ ...newClub, year_groups: e.target.value })} placeholder="Year groups (e.g. R-3, Y4-6)" className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  <input type="time" value={newClub.start_time} onChange={(e) => setNewClub({ ...newClub, start_time: e.target.value })} className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  <input type="time" value={newClub.end_time} onChange={(e) => setNewClub({ ...newClub, end_time: e.target.value })} className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  <input type="text" value={newClub.provider} onChange={(e) => setNewClub({ ...newClub, provider: e.target.value })} placeholder="Provider (optional)" className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  <input type="text" value={newClub.location} onChange={(e) => setNewClub({ ...newClub, location: e.target.value })} placeholder="Location (optional)" className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  <input type="text" value={newClub.cost_per_session} onChange={(e) => setNewClub({ ...newClub, cost_per_session: e.target.value })} placeholder="Cost per session (£)" className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  <input type="url" value={newClub.signup_url} onChange={(e) => setNewClub({ ...newClub, signup_url: e.target.value })} placeholder="Sign-up URL (optional)" className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  <label className="col-span-2 flex items-center gap-2 text-sm text-gray-600">
                    <input type="checkbox" checked={newClub.is_external} onChange={(e) => setNewClub({ ...newClub, is_external: e.target.checked })} />
                    Externally run club (not school-managed)
                  </label>
                </div>
                <div className="flex gap-2 mt-4">
                  <button onClick={addClub} className="flex-1 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600">Save</button>
                  <button onClick={() => setShowAddClub(false)} className="flex-1 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
                </div>
              </div>
            )}
          </>
        )}

        {!selectedTermId && terms.length === 0 && (
          <div className="bg-white rounded-xl p-8 border border-gray-200 text-center">
            <p className="text-gray-400 mb-2">No terms set up yet.</p>
            <p className="text-sm text-gray-300">Add a school term to start building the club schedule.</p>
          </div>
        )}
      </div>
    </div>
  );
}
