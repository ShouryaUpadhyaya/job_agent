import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import NetworkingCrm from "./NetworkingCrm";

const mockContacts = [
  {
    id: "contact-1",
    name: "Priya Sharma",
    company: "Cloudflare",
    role: "Senior Systems Engineer",
    profileUrl: "https://linkedin.com/in/priyasharma",
    headline: "Staff Systems Engineer at Cloudflare | VIT Alum",
    vitAlumni: true,
    outreachAngle: "Shared VIT Vellore alumni network",
    relevanceScore: 98,
    status: "RESEARCHED",
    messages: [],
  },
  {
    id: "contact-2",
    name: "Alex Rivera",
    company: "Linear",
    role: "University Talent Recruiter",
    profileUrl: "https://linkedin.com/in/alexrivera",
    headline: "Campus Recruiter at Linear",
    vitAlumni: false,
    outreachAngle: "Direct campus recruiter inquiry",
    relevanceScore: 88,
    status: "ACCEPTED",
    messages: [],
  },
];

describe("NetworkingCrm Component", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders contacts list and metrics correctly", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockContacts),
      })
    ) as unknown as typeof fetch;

    render(<NetworkingCrm />);

    await waitFor(() => {
      expect(screen.getByText("Priya Sharma")).toBeDefined();
      expect(screen.getByText("Alex Rivera")).toBeDefined();
    });

    expect(screen.getByText("VIT Vellore Alumni")).toBeDefined();
    expect(screen.getByText("98% Fit")).toBeDefined();
  });

  it("generates and displays connection note under 300 characters", async () => {
    global.fetch = vi.fn((url: string) => {
      if (url.includes("/api/networking/contacts/contact-1/generate-note")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              note: {
                content: "Hi Priya, I'm Shourya, CS student at VIT '28 passionate about backend systems. Would love to connect!",
                charCount: 104,
                isWithinLimit: true,
              },
              message: { id: "msg-1", status: "DRAFT" },
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockContacts),
      });
    }) as unknown as typeof fetch;

    render(<NetworkingCrm />);

    await waitFor(() => {
      expect(screen.getByText("Priya Sharma")).toBeDefined();
    });

    const noteBtn = screen.getByText("📝 Note (<300 chars)");
    fireEvent.click(noteBtn);

    await waitFor(() => {
      expect(screen.getByText("LinkedIn Connection Note (<300 chars)")).toBeDefined();
      expect(screen.getByText("✓ Within LinkedIn 300-char limit")).toBeDefined();
      expect(screen.getByText("Copy Note")).toBeDefined();
    });
  });

  it("handles discovery modal open and submission", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockContacts),
      })
    ) as unknown as typeof fetch;

    render(<NetworkingCrm />);

    await waitFor(() => {
      expect(screen.getByText("Auto-Discover Target Leads")).toBeDefined();
    });

    fireEvent.click(screen.getByText("Auto-Discover Target Leads"));
    expect(screen.getByText("Auto-Discover Networking Leads")).toBeDefined();
    expect(screen.getByPlaceholderText("e.g. Cloudflare, Linear, Spotify, Google")).toBeDefined();
  });
});
