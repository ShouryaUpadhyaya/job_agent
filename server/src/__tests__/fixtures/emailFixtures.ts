/**
 * Synthetic emails modelled on the shapes real ATS / job sites send. Companies and people are
 * made up or used only as names in subject lines; no real message content.
 */
export interface EmailFixture {
  name: string;
  sender: string;
  senderName?: string;
  subject: string;
  body: string;
  expect: {
    classification: string;
    company?: string;
    role?: string;
    person?: string;
    deadline?: RegExp;
    importance?: string;
  };
}

export const EMAIL_FIXTURES: EmailFixture[] = [
  {
    name: 'Greenhouse confirmation',
    sender: '"Razorpay" <no-reply@us.greenhouse-mail.io>',
    subject: 'Thank you for applying to Razorpay',
    body: `Hi Shourya,

Thank you for your interest in Razorpay! We have received your application for the SDE Intern - Backend position and our team will review it shortly.

If your experience matches our needs, a member of our recruiting team will reach out about next steps.

Best,
The Razorpay Talent Acquisition Team`,
    expect: { classification: 'APPLICATION_CONFIRMATION', company: 'Razorpay', importance: 'NORMAL' },
  },
  {
    name: 'Lever confirmation (company only in sender name)',
    sender: 'Postman Hiring Team <no-reply@hire.lever.co>',
    subject: 'Thanks for Applying',
    body: `Hi Shourya,

Thanks for applying for the Software Engineer Intern role. We've received your application and will be in touch if there's a fit.

Postman Hiring Team`,
    expect: { classification: 'APPLICATION_CONFIRMATION', company: 'Postman', role: 'Software Engineer Intern' },
  },
  {
    name: 'Workday confirmation',
    sender: 'atlassian@myworkday.com',
    senderName: 'Workday',
    subject: 'Your application for Graduate Software Engineer at Atlassian',
    body: `Dear Shourya,

Thank you for your application for Graduate Software Engineer (Job ID: 160322) at Atlassian. We have received your application and will review it carefully.

Atlassian Talent Team`,
    expect: { classification: 'APPLICATION_CONFIRMATION', company: 'Atlassian', role: 'Graduate Software Engineer' },
  },
  {
    name: 'Ashby pipe subject',
    sender: 'no-reply@ashbyhq.com',
    senderName: 'Zepto',
    subject: 'Zepto | Application received',
    body: 'Hi Shourya, thanks for applying to Zepto. We have received your application for Backend Engineer Intern and will get back to you.',
    expect: { classification: 'APPLICATION_CONFIRMATION', company: 'Zepto' },
  },
  {
    name: 'LinkedIn Easy Apply confirmation',
    sender: 'LinkedIn <jobs-noreply@linkedin.com>',
    subject: 'Shourya, your application was sent to Groww',
    body: `Your application was sent to Groww

Software Development Engineer Intern
Groww · Bengaluru, Karnataka, India
Applied on October 14, 2026`,
    expect: { classification: 'APPLICATION_CONFIRMATION', company: 'Groww' },
  },
  {
    name: 'Naukri application sent',
    sender: 'Naukri <info@naukri.com>',
    subject: 'Your application for Java Developer at Infosys has been sent',
    body: 'Dear Shourya, your application for the position of Java Developer at Infosys has been successfully submitted.',
    expect: { classification: 'APPLICATION_CONFIRMATION', company: 'Infosys' },
  },
  {
    name: 'Internshala application',
    sender: 'Internshala <student@internshala.com>',
    subject: 'Application submitted: Web Development internship at CodeNest',
    body: 'Congratulations on taking the first step! You have successfully applied for the Web Development internship at CodeNest.',
    expect: { classification: 'APPLICATION_CONFIRMATION', company: 'CodeNest' },
  },
  {
    name: 'HackerRank assessment invite with deadline',
    sender: 'HackerRank <support@hackerrankforwork.com>',
    subject: 'Invitation: Swiggy SDE Intern Online Assessment',
    body: `Hi Shourya,

Swiggy has invited you to take the SDE Intern Online Assessment on HackerRank.
Duration: 90 minutes
Please complete the test by Oct 20, 2026 11:59 PM IST.`,
    expect: { classification: 'ASSESSMENT', company: 'Swiggy', deadline: /Oct 20/, importance: 'HIGH' },
  },
  {
    name: 'Interview invitation from recruiter with 48h deadline',
    sender: '"Ananya Rao" <ananya.rao@cred.club>',
    subject: 'Interview invitation - Backend Engineer Intern at CRED',
    body: `Hi Shourya,

Thanks for your time so far. We'd like to invite you to a technical interview with our platform team.
Please share your availability within 48 hours using the link below.
https://calendly.com/cred-hiring/tech-round

Regards,
Ananya Rao
Talent Acquisition, CRED`,
    expect: { classification: 'INTERVIEW_INVITATION', company: 'CRED', deadline: /within 48 hours/i, importance: 'HIGH' },
  },
  {
    name: 'Greenhouse rejection',
    sender: 'Stripe <no-reply@us.greenhouse-mail.io>',
    subject: 'Update on your application to Stripe',
    body: `Hi Shourya,

Thank you for your interest in the Software Engineering Intern role at Stripe and for taking the time to interview with us.
Unfortunately, we have decided to move forward with other candidates whose experience more closely matches our needs.`,
    expect: { classification: 'REJECTION', company: 'Stripe' },
  },
  {
    name: 'Offer',
    sender: '"Meera Iyer" <meera@sarvam.ai>',
    subject: 'Offer letter: Software Engineering Intern',
    body: `Hi Shourya,

Congratulations! We are delighted to extend you an offer for the Software Engineering Intern position at Sarvam AI.
Please find your offer letter attached and accept the offer by October 25.`,
    expect: { classification: 'OFFER', company: 'Sarvam AI', deadline: /October 25/ },
  },
  {
    name: 'Recruiter cold email',
    sender: '"Rohan Mehta" <rohan.mehta@juspay.in>',
    subject: 'Backend internship opportunity at Juspay',
    body: `Hi Shourya,

I came across your profile on GitHub and was impressed by your work on distributed systems. We're hiring backend interns for our payments platform and I think you might be a great fit.
Would you be open to a quick chat this week?

Rohan Mehta
Technical Recruiter, Juspay`,
    expect: { classification: 'RECRUITER_OUTREACH', company: 'Juspay', importance: 'HIGH' },
  },
  {
    name: 'LinkedIn connection accepted with headline',
    sender: 'LinkedIn <invitations@linkedin.com>',
    subject: 'Priya Sharma accepted your invitation',
    body: `Priya Sharma
SDE-2 at Razorpay | VIT Vellore '21
Priya Sharma has accepted your invitation. Let's start a conversation.`,
    expect: { classification: 'LINKEDIN_CONNECTION_ACCEPTED', person: 'Priya Sharma', company: 'Razorpay' },
  },
  {
    name: 'LinkedIn job alert mentioning interview and offer',
    sender: 'LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>',
    subject: '“software engineer intern”: 12 new jobs in India',
    body: `Your job alert for software engineer intern
Razorpay - SDE Intern - Bengaluru
Interview tips: prepare for next steps. Job offer in hand? Compare offers on LinkedIn.`,
    expect: { classification: 'JOB_ALERT', importance: 'LOW' },
  },
  {
    name: 'Naukri recommended jobs',
    sender: 'Naukri <jobalert@naukri.com>',
    subject: 'Jobs matching your profile: 25 new openings',
    body: 'Recommended jobs for you. Interview call guaranteed? Apply now.',
    expect: { classification: 'JOB_ALERT' },
  },
  {
    name: 'Internshala internship digest',
    sender: 'Internshala <alerts@internshala.com>',
    subject: 'Internships for you: Backend Development, React',
    body: 'New internships matching your preferences. Stipend up to 30,000. Apply before the next steps close.',
    expect: { classification: 'JOB_ALERT' },
  },
  {
    name: 'Referral response',
    sender: '"Karthik N" <karthik.n@gmail.com>',
    subject: 'Re: Referral for SDE Intern at Flipkart',
    body: 'Hey Shourya, I have referred you for the SDE Intern role. You should get an email from the Flipkart portal soon. All the best!',
    expect: { classification: 'REFERRAL_RESPONSE', importance: 'HIGH' },
  },
  {
    name: 'Newsletter',
    sender: 'Medium Daily Digest <noreply@medium.com>',
    subject: 'The best stories on Rust this week',
    body: 'Top reads from writers you follow.',
    expect: { classification: 'UNRELATED' },
  },
];
