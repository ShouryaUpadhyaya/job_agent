import React from "react";
import { Card } from "./ui";

const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-800 text-[12px] font-mono">{children}</code>
);

export default function HowToPanel({ executor }: { executor: "local" | "agent" | undefined }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-sm text-slate-700">
      <Card title="1. One-time setup (on your computer)">
        <ol className="list-decimal pl-5 space-y-2">
          <li>Install Google Chrome (the runner drives your real Chrome, not a bundled browser).</li>
          <li>
            Install Playwright for the runner: <Code>npm run wellfound:install</Code>
          </li>
          <li>
            Save your Wellfound login: <Code>npm run wellfound:login</Code> — log in in the Chrome window that opens, then close it. The session lives in
            <Code>wellfound_autoApply/.wellfound-chrome-profile/</Code> (git-ignored).
          </li>
          <li>
            Start the runner agent and leave it running in a terminal of your desktop session:
            <ul className="list-disc pl-5 mt-1 space-y-1">
              <li>
                Server in Docker (<Code>docker compose up</Code>): add <Code>WELLFOUND_AGENT_TOKEN=&lt;random string&gt;</Code> to the root <Code>.env</Code>, restart the
                server, then <Code>npm run wellfound:agent:docker</Code>.
              </li>
              <li>
                Server on the host (<Code>npm run dev:server</Code>): no agent needed — the server starts the runner itself. (<Code>npm run wellfound:agent</Code> also works.)
              </li>
            </ul>
            <span className="block mt-1 text-xs text-slate-500">This server currently runs jobs {executor === "agent" ? "through the host agent" : "directly on this machine"}.</span>
          </li>
          <li>Fill in Profile &amp; Rules and save. Everything the bot types comes from there.</li>
        </ol>
      </Card>

      <Card title="2. Dry run first">
        <ol className="list-decimal pl-5 space-y-2">
          <li>Open the Run tab. Every preflight item should be green; each red item says how to fix it.</li>
          <li>Pick Dry run, batch 1, tick “Show the Chrome window”, and start.</li>
          <li>Watch the log: it opens a matching internship, fills the cover letter and questions, and logs “DRY_RUN — would click”. Nothing is sent and nothing is recorded.</li>
          <li>Check the filled answers in the Chrome window. Adjust Profile &amp; Rules if something reads wrong.</li>
        </ol>
        <p className="text-xs text-slate-500">
          CLI equivalent: <Code>npm run wellfound:dry-run</Code> (3 jobs), or <Code>node scripts/wellfound/runner.js wellfound --dry-run --max=1 --visible</Code>.
        </p>
      </Card>

      <Card title="3. What a live run does">
        <ul className="list-disc pl-5 space-y-2">
          <li>Only intern / fresher / entry-level engineering titles are picked; senior, lead, QA, design, mobile-native and similar titles are skipped. Jobs older than 14 days and jobs you already applied to are skipped.</li>
          <li>It types a tailored cover letter (Gemini when configured, otherwise a template built from your highlights), answers questions from your profile, and presses Apply.</li>
          <li>It paces itself like a person (1–5 minutes between applications, longer breaks) and stops at the batch size or the daily cap (counted per IST day from applications.csv).</li>
          <li>Each submission is appended to <Code>applications.csv</Code> and synced to the Applications pipeline as Applied when the run ends.</li>
          <li>Live runs need you to type APPLY. Automated applying may break Wellfound&apos;s terms and can get an account rate-limited — keep batches small.</li>
        </ul>
      </Card>

      <Card title="4. Reading diagnostics">
        <ul className="list-disc pl-5 space-y-2">
          <li>History &amp; Diagnostics lists every run with its status, counts and full log (logs are kept after the run ends).</li>
          <li>A screenshot, the page HTML and a JSON context are saved when the session is logged out, a bot check appears, the apply panel or submit button is missing, a job errors, or the run crashes.</li>
          <li>“Record a Playwright trace” adds <Code>trace.zip</Code>: open it with <Code>npx playwright show-trace trace.zip</Code>.</li>
          <li>Files live in <Code>logs/wellfound/</Code> and <Code>diagnostics/wellfound/</Code> (git-ignored; they contain your account pages).</li>
        </ul>
      </Card>

      <Card title="Troubleshooting">
        <ul className="list-disc pl-5 space-y-2">
          <li><strong>Host agent not reachable</strong>: start <Code>npm run wellfound:agent:docker</Code>; check the token matches in <Code>.env</Code> and that the server container was restarted after adding it.</li>
          <li><strong>Display not available</strong>: start the agent from a terminal inside your desktop session (DISPLAY must be set), not over SSH or from a system service.</li>
          <li><strong>Logged out / bot check</strong> (exit code 3): run <Code>npm run wellfound:login</Code>, log in or solve the check by hand, close the window, retry later.</li>
          <li><strong>Chrome profile in use</strong>: close the Wellfound Chrome window (login window or a previous run) first.</li>
          <li><strong>0 jobs found</strong>: the feed has no new matching titles; try later. The log prints sample titles it saw.</li>
          <li><strong>Permission denied writing logs/</strong>: if Docker created <Code>logs/</Code> or <Code>diagnostics/</Code> as root, run <Code>sudo chown -R $USER logs diagnostics</Code>.</li>
        </ul>
      </Card>
    </div>
  );
}
