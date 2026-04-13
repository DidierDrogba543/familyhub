"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface Suggestion {
  type: "LINK" | "MISSING" | "MERGE" | "DISMISS" | "ENRICH" | "VERIFY";
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  action: string;
  entity_type: string;
  entity_name: string;
}

const typeConfig: Record<string, { icon: string; color: string; bg: string }> = {
  LINK: { icon: "🔗", color: "text-purple-700", bg: "bg-purple-50 border-purple-200" },
  MISSING: { icon: "⚠️", color: "text-amber-700", bg: "bg-amber-50 border-amber-200" },
  MERGE: { icon: "🔀", color: "text-blue-700", bg: "bg-blue-50 border-blue-200" },
  DISMISS: { icon: "🗑️", color: "text-gray-700", bg: "bg-gray-50 border-gray-200" },
  ENRICH: { icon: "✨", color: "text-green-700", bg: "bg-green-50 border-green-200" },
  VERIFY: { icon: "❓", color: "text-red-700", bg: "bg-red-50 border-red-200" },
};

const priorityBadge: Record<string, string> = {
  high: "bg-red-100 text-red-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-gray-100 text-gray-500",
};

export default function AdminView() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [householdId, setHouseholdId] = useState("");
  const [approved, setApproved] = useState<Set<number>>(new Set());
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [lastRun, setLastRun] = useState<string | null>(null);

  const supabase = createClient();

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = "/"; return; }
      const { data: household } = await supabase.from("households").select("id").eq("owner_user_id", user.id).single();
      if (household) setHouseholdId(household.id);
    }
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const runAnalysis = async () => {
    if (!householdId) return;
    setLoading(true);
    setSuggestions([]);
    setApproved(new Set());
    setDismissed(new Set());

    try {
      const res = await fetch("/api/admin/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ householdId }),
      });
      const data = await res.json();
      setSuggestions(data.suggestions || []);
      setLastRun(new Date().toLocaleTimeString("en-GB"));
    } catch (err) {
      console.error("Analysis failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const approveSuggestion = (index: number) => {
    setApproved((prev) => new Set([...prev, index]));
    // In a full implementation, this would apply the suggested change to the database
  };

  const dismissSuggestion = (index: number) => {
    setDismissed((prev) => new Set([...prev, index]));
  };

  const activeSuggestions = suggestions.filter((_, i) => !approved.has(i) && !dismissed.has(i));
  const highCount = activeSuggestions.filter((s) => s.priority === "high").length;
  const medCount = activeSuggestions.filter((s) => s.priority === "medium").length;
  const lowCount = activeSuggestions.filter((s) => s.priority === "low").length;

  // Group by type
  const grouped: Record<string, { suggestion: Suggestion; index: number }[]> = {};
  suggestions.forEach((s, i) => {
    if (approved.has(i) || dismissed.has(i)) return;
    if (!grouped[s.type]) grouped[s.type] = [];
    grouped[s.type].push({ suggestion: s, index: i });
  });

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Admin</h1>
            <p className="text-sm text-gray-400">AI-powered suggestions to improve your knowledge base</p>
          </div>
          <div className="flex gap-2 text-sm">
            <a href="/dashboard" className="text-blue-600 hover:text-blue-700">Dashboard</a>
            <span className="text-gray-300">|</span>
            <a href="/knowledge" className="text-blue-600 hover:text-blue-700">Knowledge</a>
          </div>
        </div>

        {/* Run Analysis Button */}
        <div className="bg-white rounded-xl p-6 border border-gray-200 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-gray-900">Knowledge Analysis</p>
              <p className="text-sm text-gray-400 mt-1">
                AI reviews your entire knowledge base and suggests improvements, linkages, and fixes.
                {lastRun && ` Last run: ${lastRun}`}
              </p>
            </div>
            <button
              onClick={runAnalysis}
              disabled={loading || !householdId}
              className="px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="animate-spin">⏳</span> Analyzing...
                </span>
              ) : (
                "Run Analysis"
              )}
            </button>
          </div>
        </div>

        {/* Stats */}
        {suggestions.length > 0 && (
          <div className="grid grid-cols-4 gap-3 mb-6">
            <div className="bg-white rounded-xl p-4 border border-gray-200 text-center">
              <p className="text-2xl font-bold text-gray-900">{activeSuggestions.length}</p>
              <p className="text-xs text-gray-400">Pending</p>
            </div>
            <div className="bg-white rounded-xl p-4 border border-gray-200 text-center">
              <p className="text-2xl font-bold text-red-600">{highCount}</p>
              <p className="text-xs text-gray-400">High Priority</p>
            </div>
            <div className="bg-white rounded-xl p-4 border border-gray-200 text-center">
              <p className="text-2xl font-bold text-green-600">{approved.size}</p>
              <p className="text-xs text-gray-400">Approved</p>
            </div>
            <div className="bg-white rounded-xl p-4 border border-gray-200 text-center">
              <p className="text-2xl font-bold text-gray-400">{dismissed.size}</p>
              <p className="text-xs text-gray-400">Dismissed</p>
            </div>
          </div>
        )}

        {/* Suggestions grouped by type */}
        {Object.entries(grouped).map(([type, items]) => (
          <div key={type} className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">{typeConfig[type]?.icon || "📋"}</span>
              <h2 className={`text-sm font-semibold uppercase tracking-wide ${typeConfig[type]?.color || "text-gray-500"}`}>
                {type} ({items.length})
              </h2>
            </div>

            <div className="space-y-3">
              {items.map(({ suggestion: s, index }) => (
                <div
                  key={index}
                  className={`rounded-xl p-5 border ${typeConfig[s.type]?.bg || "bg-white border-gray-200"}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-semibold text-gray-900">{s.title}</p>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${priorityBadge[s.priority] || priorityBadge.low}`}>
                          {s.priority}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 leading-relaxed">{s.description}</p>
                      <div className="mt-3 bg-white/60 rounded-lg p-3 border border-gray-200/50">
                        <p className="text-xs text-gray-400 mb-1">Suggested action:</p>
                        <p className="text-sm text-gray-700">{s.action}</p>
                      </div>
                      <div className="flex gap-2 mt-2">
                        <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded">{s.entity_type}</span>
                        <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded">{s.entity_name}</span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                      <button
                        onClick={() => approveSuggestion(index)}
                        className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => dismissSuggestion(index)}
                        className="px-4 py-2 border border-gray-300 text-gray-500 rounded-lg text-sm hover:bg-gray-50"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Approved items */}
        {approved.size > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-green-600 uppercase tracking-wide mb-3">Approved ({approved.size})</h2>
            <div className="space-y-2">
              {[...approved].map((i) => (
                <div key={i} className="bg-green-50 rounded-xl p-4 border border-green-200 opacity-75">
                  <div className="flex items-center gap-2">
                    <span className="text-green-600">✓</span>
                    <p className="text-sm font-medium text-green-800">{suggestions[i]?.title}</p>
                    <span className="text-xs text-green-500 ml-auto">Applied</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && suggestions.length === 0 && (
          <div className="bg-white rounded-xl p-12 border border-gray-200 text-center">
            <p className="text-4xl mb-4">🧠</p>
            <p className="text-gray-400 text-lg mb-2">Ready to analyze</p>
            <p className="text-sm text-gray-300">Click "Run Analysis" to have AI review your knowledge base and suggest improvements.</p>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="bg-white rounded-xl p-12 border border-gray-200 text-center">
            <p className="text-4xl mb-4 animate-pulse">🧠</p>
            <p className="text-gray-400 text-lg mb-2">Analyzing your knowledge base...</p>
            <p className="text-sm text-gray-300">Looking at schools, clubs, children, family data, and extracted items to find gaps and connections.</p>
          </div>
        )}
      </div>
    </div>
  );
}
