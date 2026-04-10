"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface ChildForm {
  name: string;
  school_name: string;
  year_group: string;
  activities: { activity_name: string; day_of_week: string; time_slot: string }[];
}

interface SenderForm {
  email_address: string;
  label: string;
  category: "school" | "club" | "pta" | "afterschool" | "other";
}

export default function OnboardingForm() {
  const [step, setStep] = useState(1);
  const [children, setChildren] = useState<ChildForm[]>([
    { name: "", school_name: "", year_group: "", activities: [] },
  ]);
  const [senders, setSenders] = useState<SenderForm[]>([
    { email_address: "", label: "", category: "school" },
  ]);
  const [saving, setSaving] = useState(false);

  const supabase = createClient();

  const addChild = () => {
    setChildren([
      ...children,
      { name: "", school_name: "", year_group: "", activities: [] },
    ]);
  };

  const updateChild = (index: number, field: keyof ChildForm, value: string) => {
    const updated = [...children];
    if (field === "activities") return;
    updated[index] = { ...updated[index], [field]: value };
    setChildren(updated);
  };

  const addActivity = (childIndex: number) => {
    const updated = [...children];
    updated[childIndex].activities.push({
      activity_name: "",
      day_of_week: "",
      time_slot: "",
    });
    setChildren(updated);
  };

  const updateActivity = (
    childIndex: number,
    actIndex: number,
    field: string,
    value: string
  ) => {
    const updated = [...children];
    updated[childIndex].activities[actIndex] = {
      ...updated[childIndex].activities[actIndex],
      [field]: value,
    };
    setChildren(updated);
  };

  const addSender = () => {
    setSenders([
      ...senders,
      { email_address: "", label: "", category: "school" },
    ]);
  };

  const updateSender = (index: number, field: keyof SenderForm, value: string) => {
    const updated = [...senders];
    updated[index] = { ...updated[index], [field]: value };
    setSenders(updated);
  };

  const saveAndContinue = async () => {
    setSaving(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      // Get household
      const { data: household } = await supabase
        .from("households")
        .select("id")
        .eq("owner_user_id", user.id)
        .single();

      if (!household) return;

      if (step === 1) {
        // Save children and their activities
        for (const child of children) {
          if (!child.name || !child.school_name) continue;

          const { data: savedChild } = await supabase
            .from("children")
            .insert({
              household_id: household.id,
              name: child.name,
              school_name: child.school_name,
              year_group: child.year_group || null,
            })
            .select("id")
            .single();

          if (savedChild) {
            for (const activity of child.activities) {
              if (!activity.activity_name) continue;
              await supabase.from("child_activities").insert({
                child_id: savedChild.id,
                activity_name: activity.activity_name,
                day_of_week: activity.day_of_week || null,
                time_slot: activity.time_slot || null,
              });
            }
          }
        }
        setStep(2);
      } else if (step === 2) {
        // Save known senders
        for (const sender of senders) {
          if (!sender.email_address || !sender.label) continue;
          await supabase.from("known_senders").insert({
            household_id: household.id,
            email_address: sender.email_address,
            label: sender.label,
            category: sender.category,
          });
        }
        setStep(3);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-lg mx-auto">
        {/* Progress */}
        <div className="flex items-center gap-2 mb-8">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`h-2 flex-1 rounded-full ${
                s <= step ? "bg-blue-600" : "bg-gray-200"
              }`}
            />
          ))}
        </div>

        {step === 1 && (
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              Tell us about your children
            </h1>
            <p className="text-gray-500 mb-8">
              This helps us identify which emails are about your kids and match
              events to the right child.
            </p>

            {children.map((child, ci) => (
              <div
                key={ci}
                className="bg-white rounded-xl p-6 mb-4 border border-gray-200"
              >
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Child&apos;s name
                    </label>
                    <input
                      type="text"
                      value={child.name}
                      onChange={(e) => updateChild(ci, "name", e.target.value)}
                      placeholder="e.g. Oliver"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      School name
                    </label>
                    <input
                      type="text"
                      value={child.school_name}
                      onChange={(e) =>
                        updateChild(ci, "school_name", e.target.value)
                      }
                      placeholder="e.g. St Mary's Primary"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Year group (optional)
                    </label>
                    <input
                      type="text"
                      value={child.year_group}
                      onChange={(e) =>
                        updateChild(ci, "year_group", e.target.value)
                      }
                      placeholder="e.g. Year 3"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>

                  {/* Activities */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Clubs &amp; Activities
                    </label>
                    {child.activities.map((act, ai) => (
                      <div key={ai} className="flex gap-2 mb-2">
                        <input
                          type="text"
                          value={act.activity_name}
                          onChange={(e) =>
                            updateActivity(ci, ai, "activity_name", e.target.value)
                          }
                          placeholder="Activity name"
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                        <select
                          value={act.day_of_week}
                          onChange={(e) =>
                            updateActivity(ci, ai, "day_of_week", e.target.value)
                          }
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        >
                          <option value="">Day</option>
                          {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(
                            (d) => (
                              <option key={d} value={d}>
                                {d}
                              </option>
                            )
                          )}
                        </select>
                        <input
                          type="text"
                          value={act.time_slot}
                          onChange={(e) =>
                            updateActivity(ci, ai, "time_slot", e.target.value)
                          }
                          placeholder="Time"
                          className="w-28 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                      </div>
                    ))}
                    <button
                      onClick={() => addActivity(ci)}
                      className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                    >
                      + Add activity
                    </button>
                  </div>
                </div>
              </div>
            ))}

            <button
              onClick={addChild}
              className="w-full py-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 hover:border-gray-400 hover:text-gray-600 mb-6"
            >
              + Add another child
            </button>

            <button
              onClick={saveAndContinue}
              disabled={saving}
              className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Continue"}
            </button>
          </div>
        )}

        {step === 2 && (
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              Known email senders
            </h1>
            <p className="text-gray-500 mb-8">
              Add email addresses you know are from school, clubs, or PTA. This
              helps us instantly recognise important emails without needing AI.
            </p>

            {senders.map((sender, si) => (
              <div
                key={si}
                className="bg-white rounded-xl p-6 mb-4 border border-gray-200"
              >
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Email address
                    </label>
                    <input
                      type="email"
                      value={sender.email_address}
                      onChange={(e) =>
                        updateSender(si, "email_address", e.target.value)
                      }
                      placeholder="e.g. office@stmarys.sch.uk"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Label
                    </label>
                    <input
                      type="text"
                      value={sender.label}
                      onChange={(e) =>
                        updateSender(si, "label", e.target.value)
                      }
                      placeholder="e.g. St Mary's School Office"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Category
                    </label>
                    <select
                      value={sender.category}
                      onChange={(e) =>
                        updateSender(si, "category", e.target.value)
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="school">School</option>
                      <option value="club">Club / Activity</option>
                      <option value="pta">PTA</option>
                      <option value="afterschool">After-school care</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>
              </div>
            ))}

            <button
              onClick={addSender}
              className="w-full py-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 hover:border-gray-400 hover:text-gray-600 mb-6"
            >
              + Add another sender
            </button>

            <div className="flex gap-3">
              <button
                onClick={() => setStep(1)}
                className="flex-1 py-3 border border-gray-300 text-gray-700 rounded-xl font-semibold hover:bg-gray-50"
              >
                Back
              </button>
              <button
                onClick={saveAndContinue}
                disabled={saving}
                className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Continue"}
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="text-center py-12">
            <div className="text-5xl mb-4">&#10003;</div>
            <h1 className="text-2xl font-bold text-gray-900 mb-4">
              You&apos;re all set!
            </h1>
            <p className="text-gray-500 mb-2">
              FamilyHub is now scanning your Gmail for school communications.
            </p>
            <p className="text-gray-500 mb-8">
              You&apos;ll receive your first morning digest email tomorrow at 7:30am.
            </p>
            <div className="bg-blue-50 rounded-xl p-6 text-left mb-8">
              <p className="text-sm font-semibold text-blue-900 mb-2">
                What happens next:
              </p>
              <ul className="text-sm text-blue-800 space-y-2">
                <li>
                  We&apos;re scanning the last 30 days of your email right now
                </li>
                <li>School-related emails are extracted and organised</li>
                <li>
                  Tomorrow morning, you&apos;ll get a digest with everything you
                  need to know
                </li>
                <li>
                  Items with deadlines will be flagged as urgent
                </li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
