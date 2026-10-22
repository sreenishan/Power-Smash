// Fictional sample data for the forms tests (never real people, numbers or events).
import { afterAll, beforeAll, vi } from 'vitest';
import { CONSENT } from '../../src/content/consent';
import { alertsSignupForm, coverageForm, generalForm, initialValues, requestForm, sponsorshipForm, submitVideoForm, tournamentSubmissionForm } from '../../src/lib/forms/definitions';
import type { FormDef, Values } from '../../src/lib/forms/types';

/**
 * The fixed "now" of the date tests: 12:00 in India on 2026-10-21. A start date must be from yesterday up to 1,095 days ahead
 * (R-DATE), so the sample dates below (2027) would age out of the window if the tests used the real clock. `pinClock()` freezes
 * `Date` (timers stay real) for the whole file, which also pins the server contract's clock.
 */
export const NOW = new Date('2026-10-21T06:30:00Z');

export function pinClock(at: Date = NOW): void {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at);
  });
  afterAll(() => {
    vi.useRealTimers();
  });
}

export const PACKAGES = [
  { value: 'essential', label: 'Essential' },
  { value: 'pro', label: 'Pro' },
];
export const ADD_ONS = [
  { value: 'extra-court', label: 'Extra court' },
  { value: 'extra-match-day', label: 'Extra match day' },
];
export const SPONSOR_PACKAGES = [{ value: 'rally-partner', label: 'Rally Partner' }];

export const forms: Record<string, FormDef> = {
  coverage: coverageForm({ packages: PACKAGES, addOns: ADD_ONS }),
  sponsorship: sponsorshipForm({ packages: SPONSOR_PACKAGES }),
  general: generalForm(),
  tournament_submission: tournamentSubmissionForm({ publicContactText: CONSENT.tournamentPublicContact.text }),
  video_submission: submitVideoForm(),
  alerts_signup: alertsSignupForm(),
  request: requestForm(),
};

export const FICTIONAL = {
  name: 'Test Person',
  phone: '98765 43210',
  email: 'test.person@example.com',
  organization: 'Sample Club',
  message: 'We would like to know more about your service for our sample event.',
};

/** Every field filled with plausible valid values. */
export const fullValues: Record<string, Values> = {
  coverage: {
    ...initialValues(forms.coverage!),
    eventName: 'Sample Open 2027',
    startDate: '2027-02-10',
    name: FICTIONAL.name,
    phone: FICTIONAL.phone,
    packageKey: 'essential',
    liveStream: 'yes',
    matchDays: '2',
    addOns: ['extra-court'],
    endDate: '2027-02-11',
    venue: 'Sample Indoor Stadium',
    district: 'Sampletown',
    level: 'District',
    courts: '4',
    categories: 'U13 boys singles, Open doubles',
    expectedEntries: '120',
    organizerName: 'Sample District Association',
    filmingPermission: 'unsure',
    organization: FICTIONAL.organization,
    email: FICTIONAL.email,
    contactPreference: 'whatsapp',
    budgetRange: 'Rs 25000',
    notes: 'Please call after 6 pm.',
  },
  sponsorship: {
    ...initialValues(forms.sponsorship!),
    name: FICTIONAL.name,
    phone: FICTIONAL.phone,
    company: 'Sample Sports Pvt',
    startMonth: '2027-03',
    packageKey: 'rally-partner',
    objectives: 'Reach local players.',
    budgetRange: 'Rs 25000 per month',
    companyUrl: 'https://sample-sports.in/',
    email: FICTIONAL.email,
    contactPreference: 'email',
  },
  general: {
    ...initialValues(forms.general!),
    name: FICTIONAL.name,
    phone: FICTIONAL.phone,
    email: FICTIONAL.email,
    message: FICTIONAL.message,
  },
  tournament_submission: {
    ...initialValues(forms.tournament_submission!),
    tournamentName: 'Sample Junior Open',
    startDate: '2027-04-02',
    name: FICTIONAL.name,
    phone: FICTIONAL.phone,
    organization: 'Sample District Association',
    endDate: '2027-04-03',
    venue: 'Sample Indoor Stadium',
    city: 'Sampletown',
    district: 'Sampledistrict',
    categories: 'U13, U15',
    ageGroups: 'U13, U15, Open',
    entryFee: 'Rs 500 per player',
    registrationDetails: 'Register before 20 March.',
    registrationLink: 'https://sample-club.in/register',
    posterUrl: 'https://sample-club.in/poster.jpg',
    listingType: 'featured',
    publicContactConsent: false,
    coverageInterest: true,
    email: FICTIONAL.email,
    contactPreference: 'call',
  },
};

// M3 forms: every field filled, all consent boxes ticked.
fullValues.video_submission = {
  ...initialValues(forms.video_submission!),
  videoUrl: 'https://drive.google.com/file/d/sample-id/view',
  name: FICTIONAL.name,
  role: 'parent_guardian',
  phone: FICTIONAL.phone,
  tournamentName: 'Sample Junior Open',
  matchDate: '2026-09-12',
  category: 'U15 boys singles',
  round: 'Quarter-final',
  players: 'A and B vs C and D',
  notes: 'Filmed from the upper stand.',
  footageSource: 'asked_by_organizer',
  organizerName: 'Sample District Association',
  filmingPermission: 'yes',
  minorsVisible: 'unsure',
  email: FICTIONAL.email,
  contactPreference: 'whatsapp',
  adultConfirmation: true,
  videoRights: true,
  videoLicence: true,
  videoRemoval: true,
};
fullValues.alerts_signup = {
  ...initialValues(forms.alerts_signup!),
  name: FICTIONAL.name,
  email: FICTIONAL.email,
  district: 'Sampledistrict',
  interests: ['tournaments', 'new-videos'],
  alertsConsent: true,
  adultConfirmation: true,
};

// Request form (profile and content-removal requests): the default is a hide request by a parent.
fullValues.request = {
  ...initialValues(forms.request!),
  requestType: 'hide_profile',
  what: 'https://example.org/players/sample-player/',
  relationship: 'parent_guardian',
  name: FICTIONAL.name,
  phone: FICTIONAL.phone,
  details: 'Please hide this profile until we talk.',
};

export const META = {
  idempotencyKey: '11111111-1111-4111-8111-111111111111',
  token: 'test-token.abc_123',
  page: '/book',
  search: '',
  honeypot: '',
};
