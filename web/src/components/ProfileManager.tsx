"use client";

import React, { useState, useEffect } from "react";

export type CandidateProfile = {
  id: string;
  name: string;
  email?: string;
  targetRole?: string;
  targetGradYear?: number;
  skills: string[];
  education?: any;
  experience?: any;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export default function ProfileManager({ onProfileUpdated }: { onProfileUpdated?: () => void }) {
  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Edit fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [targetRole, setTargetRole] = useState("");
  const [targetGradYear, setTargetGradYear] = useState<number>(2028);
  const [newSkill, setNewSkill] = useState("");
  const [skills, setSkills] = useState<string[]>([]);

  // Resume upload
  const [uploading, setUploading] = useState(false);
  const [resumeText, setResumeText] = useState("");
  const [showPasteText, setShowPasteText] = useState(false);

  const fetchProfile = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${API_BASE_URL}/api/profiles`);
      if (!res.ok) throw new Error("Failed to load profile");
      const data = await res.json();
      setProfile(data);
      setName(data.name || "");
      setEmail(data.email || "");
      setTargetRole(data.targetRole || "Software Engineer Intern");
      setTargetGradYear(data.targetGradYear || 2028);
      setSkills(data.skills || []);
    } catch (err: any) {
      setError(err.message || "Failed to load candidate profile");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setStatusMessage(null);
      const res = await fetch(`${API_BASE_URL}/api/profiles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: profile?.id,
          name,
          email,
          targetRole,
          targetGradYear: Number(targetGradYear),
          skills,
          education: profile?.education,
          experience: profile?.experience,
        }),
      });

      if (res.ok) {
        setStatusMessage("✓ Candidate profile successfully saved!");
        await fetchProfile();
        if (onProfileUpdated) onProfileUpdated();
      } else {
        setStatusMessage("✗ Failed to save profile");
      }
    } catch (err: any) {
      setStatusMessage(`✗ Error: ${err.message}`);
    }
  };

  const handleAddSkill = () => {
    const trimmed = newSkill.trim();
    if (trimmed && !skills.includes(trimmed)) {
      setSkills([...skills, trimmed]);
      setNewSkill("");
    }
  };

  const handleRemoveSkill = (skillToRemove: string) => {
    setSkills(skills.filter((s) => s !== skillToRemove));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("resume", file);

    try {
      setUploading(true);
      setStatusMessage(null);
      const res = await fetch(`${API_BASE_URL}/api/profiles/upload-resume`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        setStatusMessage(
          `✓ Resume parsed! Extracted ${data.parsedSummary?.skillsFound || 0} skills, rescored ${data.rescoredCount || 0} jobs.`
        );
        await fetchProfile();
        if (onProfileUpdated) onProfileUpdated();
      } else {
        setStatusMessage(`✗ Resume parsing failed: ${data.error || "Unknown error"}`);
      }
    } catch (err: any) {
      setStatusMessage(`✗ Upload error: ${err.message}`);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleTextUpload = async () => {
    if (!resumeText.trim()) return;

    try {
      setUploading(true);
      setStatusMessage(null);
      const res = await fetch(`${API_BASE_URL}/api/profiles/upload-resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: resumeText }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatusMessage(
          `✓ Resume text parsed! Extracted ${data.parsedSummary?.skillsFound || 0} skills, rescored ${data.rescoredCount || 0} jobs.`
        );
        setShowPasteText(false);
        setResumeText("");
        await fetchProfile();
        if (onProfileUpdated) onProfileUpdated();
      } else {
        setStatusMessage(`✗ Parsing failed: ${data.error || "Unknown error"}`);
      }
    } catch (err: any) {
      setStatusMessage(`✗ Error: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Candidate Profile & Resume Intelligence</h2>
          <p className="text-sm text-slate-500 mt-1">
            Single source of truth for deterministic matching, graduation year eligibility, and tailored materials.
          </p>
        </div>
      </div>

      {statusMessage && (
        <div
          className={`p-4 rounded-xl text-sm font-semibold border ${
            statusMessage.startsWith("✓")
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : "bg-rose-50 text-rose-800 border-rose-200"
          }`}
        >
          {statusMessage}
        </div>
      )}

      {error && <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Resume Ingestion */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <h3 className="font-bold text-slate-900 text-base">📄 Resume Ingestion & Parser</h3>
          <p className="text-xs text-slate-500">
            Upload your PDF resume or paste raw text to automatically extract verified skills, education, and re-score listings.
          </p>

          <div className="p-6 border-2 border-dashed border-slate-200 hover:border-indigo-400 rounded-xl text-center bg-slate-50/50 transition-colors">
            <input
              type="file"
              accept=".pdf"
              id="resume-file"
              onChange={handleFileUpload}
              className="hidden"
              disabled={uploading}
            />
            <label htmlFor="resume-file" className="cursor-pointer block">
              <div className="text-3xl mb-2">📥</div>
              <span className="text-xs font-bold text-indigo-600 block">
                {uploading ? "Extracting & Rescoring..." : "Upload Resume (PDF)"}
              </span>
              <span className="text-[11px] text-slate-400 mt-1 block">Up to 10MB</span>
            </label>
          </div>

          <button
            type="button"
            onClick={() => setShowPasteText(!showPasteText)}
            className="w-full py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors"
          >
            {showPasteText ? "Hide Text Input" : "Paste Raw Resume Text Instead"}
          </button>

          {showPasteText && (
            <div className="space-y-3 pt-2">
              <textarea
                value={resumeText}
                onChange={(e) => setResumeText(e.target.value)}
                placeholder="Paste full text of your resume here..."
                className="w-full h-36 p-3 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 resize-none font-mono"
              />
              <button
                type="button"
                onClick={handleTextUpload}
                disabled={uploading || !resumeText.trim()}
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md disabled:opacity-50"
              >
                {uploading ? "Parsing..." : "Parse Text & Rescore Jobs"}
              </button>
            </div>
          )}

          {profile?.education && (
            <div className="pt-4 border-t border-slate-100 space-y-1">
              <h4 className="text-xs font-bold text-slate-700">Verified Academic Record</h4>
              <p className="text-xs text-slate-600 font-medium">
                {(profile.education as any).degree || "Degree"}
              </p>
              <p className="text-xs text-slate-500">
                {(profile.education as any).institution || "Institution"} • Class of {(profile.education as any).graduationYear || targetGradYear}
              </p>
            </div>
          )}
        </div>

        {/* Right: Candidate Profile Details & Skills */}
        <form
          onSubmit={handleSaveProfile}
          className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Candidate Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full text-sm p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 font-medium text-slate-800"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Contact Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full text-sm p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 font-medium text-slate-800"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Target Role Category</label>
              <input
                type="text"
                value={targetRole}
                onChange={(e) => setTargetRole(e.target.value)}
                className="w-full text-sm p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 font-medium text-slate-800"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Target Graduation Year</label>
              <input
                type="number"
                value={targetGradYear}
                onChange={(e) => setTargetGradYear(Number(e.target.value))}
                min={2024}
                max={2032}
                className="w-full text-sm p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 font-medium text-slate-800"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-2">
              Verified Technical Skills ({skills.length})
            </label>
            <div className="flex flex-wrap gap-2 mb-3">
              {skills.map((skill) => (
                <span
                  key={skill}
                  className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-50 text-indigo-700 text-xs font-bold rounded-lg border border-indigo-100"
                >
                  {skill}
                  <button
                    type="button"
                    onClick={() => handleRemoveSkill(skill)}
                    className="text-indigo-400 hover:text-indigo-700 text-sm font-black"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Add skill (e.g. Docker, Rust, Redis)..."
                value={newSkill}
                onChange={(e) => setNewSkill(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddSkill();
                  }
                }}
                className="flex-1 text-sm p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 font-medium text-slate-800"
              />
              <button
                type="button"
                onClick={handleAddSkill}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-sm"
              >
                + Add
              </button>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-sm shadow-md shadow-indigo-600/20"
            >
              Save Profile Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
