import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import ApplicationCopilot from './ApplicationCopilot';

afterEach(() => {
  cleanup();
});

describe('ApplicationCopilot', () => {
  it('should allow users to view the drafted cover letter', () => {
    render(<ApplicationCopilot initialCoverLetter="Dear Hiring Manager," />);
    const textarea = screen.getByDisplayValue('Dear Hiring Manager,');
    expect(textarea).toBeTruthy();
  });

  it('should enable the Approve and Submit button only when checkbox is checked', () => {
    render(<ApplicationCopilot />);
    const submitButton = screen.getByText('Approve and Submit') as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);

    const checkbox = screen.getByLabelText('I approve this cover letter and application details');
    fireEvent.click(checkbox);
    expect(submitButton.disabled).toBe(false);
  });

  it('should change button text to Submitted Successfully after clicking', () => {
    render(<ApplicationCopilot />);
    const checkbox = screen.getByLabelText('I approve this cover letter and application details');
    fireEvent.click(checkbox);
    
    const submitButton = screen.getByText('Approve and Submit');
    fireEvent.click(submitButton);

    expect(screen.getByText('Submitted Successfully')).toBeTruthy();
  });
});
