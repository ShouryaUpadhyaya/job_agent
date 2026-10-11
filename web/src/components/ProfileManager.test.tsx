import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import ProfileManager from "./ProfileManager";

const mockProfile = {
  id: "prof-1",
  name: "Shourya Upadhyaya",
  email: "shourya@example.com",
  targetRole: "Software Engineer Intern",
  targetGradYear: 2028,
  skills: ["TypeScript", "React", "Node.js", "Docker"],
  education: {
    institution: "VIT Vellore",
    degree: "B.Tech Computer Science",
    graduationYear: 2028,
  },
};

describe("ProfileManager Component", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders candidate profile fields and skills chips", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => mockProfile,
    });

    render(<ProfileManager />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("Shourya Upadhyaya")).toBeDefined();
      expect(screen.getByDisplayValue("shourya@example.com")).toBeDefined();
    });

    expect(screen.getByText("TypeScript")).toBeDefined();
    expect(screen.getByText("Docker")).toBeDefined();
    expect(screen.getByText(/VIT Vellore/)).toBeDefined();
  });

  it("allows adding a new technical skill", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => mockProfile,
    });

    render(<ProfileManager />);

    await waitFor(() => {
      expect(screen.getByText("TypeScript")).toBeDefined();
    });

    const skillInput = screen.getByPlaceholderText(/Add skill/i);
    fireEvent.change(skillInput, { target: { value: "Kubernetes" } });

    const addBtn = screen.getByRole("button", { name: "+ Add" });
    fireEvent.click(addBtn);

    expect(screen.getByText("Kubernetes")).toBeDefined();
  });

  it("handles profile form submission", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockProfile,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockProfile, name: "Shourya U" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockProfile, name: "Shourya U" }),
      });

    render(<ProfileManager />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("Shourya Upadhyaya")).toBeDefined();
    });

    const saveBtn = screen.getByRole("button", { name: "Save Profile Changes" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText(/successfully saved/i)).toBeDefined();
    });
  });
});
