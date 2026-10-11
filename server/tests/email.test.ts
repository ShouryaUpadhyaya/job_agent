import { describe, it, expect } from 'vitest';
import { classifyEmail } from '../src/email/gmail';

describe('Gmail Classifier', () => {
  it('should classify as INTERVIEW', () => {
    expect(classifyEmail("We would like to schedule an interview with you.")).toBe("INTERVIEW");
    expect(classifyEmail("What is your availability for the next step?")).toBe("INTERVIEW");
  });

  it('should classify as REJECTION', () => {
    expect(classifyEmail("Unfortunately we will not be moving forward with your application.")).toBe("REJECTION");
    expect(classifyEmail("We decided to move forward with other candidates.")).toBe("REJECTION");
  });

  it('should classify as UNKNOWN', () => {
    expect(classifyEmail("Thank you for applying. We have received your application.")).toBe("UNKNOWN");
    expect(classifyEmail("Check out our new products!")).toBe("UNKNOWN");
  });
});
