"use client";

import React, { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import SystemOverview from "./SystemOverview";
import ProfileForm from "./profile/ProfileForm";
import ResumesManager from "./profile/ResumesManager";
import type { CandidateProfile } from "./profile/types";

export type { CandidateProfile } from "./profile/types";

export default function ProfileManager({ onProfileUpdated }: { onProfileUpdated?: () => void }) {
  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Bumped after saves: reloads the profile (remounting the form with fresh values) and the overview.
  const [version, setVersion] = useState(0);
  const [loadCount, setLoadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api<CandidateProfile>("/api/profiles")
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
        setLoadCount((n) => n + 1);
        setError(null);
      })
      .catch((err) => !cancelled && setError(errorMessage(err) || "Failed to load candidate profile"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [version]);

  const changed = (msg?: string) => {
    if (msg) setMessage(msg);
    setVersion((v) => v + 1);
    onProfileUpdated?.();
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900">Profile & Resumes</h2>
        <p className="text-sm text-slate-500 mt-1">
          Your details drive matching (graduation year, locations, skills), cover letters and application forms.
        </p>
      </div>

      <SystemOverview refreshKey={version} />

      {error && (
        <div role="alert" className="p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm">
          {error}
        </div>
      )}
      {message && (
        <div role="status" className="p-4 rounded-xl text-sm font-semibold border bg-emerald-50 text-emerald-800 border-emerald-200">
          {message}
        </div>
      )}

      {loading && !profile ? (
        <div className="flex justify-center items-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      ) : profile ? (
        <ProfileForm key={`${profile.id}-${loadCount}`} profile={profile} onSaved={changed} />
      ) : null}

      <ResumesManager onChanged={() => changed()} />
    </div>
  );
}
