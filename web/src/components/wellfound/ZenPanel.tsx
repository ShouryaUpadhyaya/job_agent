"use client";

import React, { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { Card, Notice, NoticeBanner } from "./ui";

/** Paste-in-console bundle for when you'd rather drive your own browser (Zen/Firefox/Chrome). */
export default function ZenPanel() {
  const [live, setLive] = useState(false);
  const [includeKey, setIncludeKey] = useState(false);
  const [max, setMax] = useState(5);
  const [script, setScript] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const generate = async () => {
    setLoading(true);
    setNotice(null);
    try {
      const text = await api<string>("/api/wellfound/script", {
        query: { mode: live ? "live" : "dry", includeKey: includeKey ? "1" : undefined, max },
      });
      setScript(typeof text === "string" ? text : String(text));
    } catch (e) {
      setNotice({ type: "error", text: errorMessage(e) });
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      setNotice({ type: "error", text: `Copy failed: ${errorMessage(e)}` });
    }
  };

  return (
    <Card title="Browser console script">
      <ol className="text-xs text-slate-600 list-decimal pl-5 space-y-1">
        <li>Log in to wellfound.com in your own browser and open wellfound.com/jobs.</li>
        <li>Generate the script, copy it, open DevTools → Console, paste and press Enter.</li>
        <li>Keep the tab focused. A full page reload stops the script; paste again to continue.</li>
      </ol>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
          Live (presses Apply)
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={includeKey} onChange={(e) => setIncludeKey(e.target.checked)} />
          Embed my Gemini key
        </label>
        <label className="text-xs font-semibold text-slate-600">
          Applications per session
          <input type="number" min={1} max={50} value={max} onChange={(e) => setMax(Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 1)))} className="ml-2 w-20 px-2 py-1 text-sm border border-slate-200 rounded-lg" />
        </label>
        <button onClick={generate} disabled={loading} className="px-4 py-2 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50">
          {loading ? "Building…" : "Generate script"}
        </button>
      </div>
      {live && <p className="text-xs text-amber-700">Live scripts submit real applications from whatever browser you paste them into.</p>}
      {includeKey && <p className="text-xs text-amber-700">The key will be readable by the Wellfound page and anyone you share the script with.</p>}
      <NoticeBanner notice={notice} onClose={() => setNotice(null)} />
      {script && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">{script.split("\n")[0].replace(/^\/\/\s*/, "")}</span>
            <button onClick={copy} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 text-white">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <textarea readOnly value={script} aria-label="Generated script" className="w-full h-72 font-mono text-[11px] p-3 bg-slate-950 text-slate-200 rounded-xl" />
        </div>
      )}
    </Card>
  );
}
