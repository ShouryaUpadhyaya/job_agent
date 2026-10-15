/**
 * Contact status workflow. Every status change goes through `transitionStage`, which keeps
 * requestSentAt / acceptedAt / lastContactAt / nextFollowUpAt consistent.
 *
 * FOLLOW_UP_DUE is mostly derived: a contact whose nextFollowUpAt has passed (and whose
 * conversation isn't closed) is reported as due without rewriting its stored status, so the
 * stored status still says whether it was a request, a message or a referral ask.
 */
import { prisma } from '../db';
import {
  CLOSED_STATUSES,
  CONTACT_STATUSES,
  ContactStatus,
  DAY_MS,
  FOLLOW_UP_DAYS,
  REQUEST_CHECK_DAYS,
  isOneOf,
} from './constants';

export interface NextAction {
  /** Target status, or a message type to draft when `kind` is 'draft'. */
  value: string;
  label: string;
  kind: 'status' | 'draft';
}

const STATUS_ACTIONS: Record<ContactStatus, NextAction[]> = {
  RESEARCHED: [
    { kind: 'draft', value: 'CONNECTION_NOTE', label: 'Draft connection note' },
    { kind: 'status', value: 'READY_TO_CONNECT', label: 'Ready to connect' },
    { kind: 'status', value: 'REQUEST_SENT', label: 'Request sent' },
  ],
  READY_TO_CONNECT: [
    { kind: 'draft', value: 'CONNECTION_NOTE', label: 'Draft connection note' },
    { kind: 'status', value: 'REQUEST_SENT', label: 'Request sent' },
  ],
  REQUEST_SENT: [
    { kind: 'status', value: 'ACCEPTED', label: 'Accepted' },
    { kind: 'status', value: 'NOT_INTERESTED', label: 'Not interested' },
  ],
  ACCEPTED: [
    { kind: 'draft', value: 'REFERRAL_ASK', label: 'Draft referral ask' },
    { kind: 'status', value: 'MESSAGE_SENT', label: 'Message sent' },
    { kind: 'status', value: 'REFERRAL_REQUESTED', label: 'Referral requested' },
  ],
  MESSAGE_DRAFTED: [
    { kind: 'status', value: 'MESSAGE_SENT', label: 'Message sent' },
    { kind: 'status', value: 'REFERRAL_REQUESTED', label: 'Referral requested' },
  ],
  MESSAGE_SENT: [
    { kind: 'status', value: 'REPLIED', label: 'Replied' },
    { kind: 'draft', value: 'REFERRAL_ASK', label: 'Draft referral ask' },
    { kind: 'status', value: 'NOT_INTERESTED', label: 'Not interested' },
  ],
  REPLIED: [
    { kind: 'draft', value: 'REFERRAL_ASK', label: 'Draft referral ask' },
    { kind: 'status', value: 'REFERRAL_REQUESTED', label: 'Referral requested' },
    { kind: 'status', value: 'REFERRED', label: 'Referred' },
    { kind: 'status', value: 'NOT_INTERESTED', label: 'Not interested' },
  ],
  REFERRAL_REQUESTED: [
    { kind: 'status', value: 'REFERRED', label: 'Referred' },
    { kind: 'status', value: 'REPLIED', label: 'Replied' },
    { kind: 'status', value: 'NOT_INTERESTED', label: 'Not interested' },
  ],
  REFERRED: [{ kind: 'draft', value: 'THANK_YOU', label: 'Draft thank-you' }],
  NOT_INTERESTED: [{ kind: 'status', value: 'RESEARCHED', label: 'Reopen' }],
  FOLLOW_UP_DUE: [
    { kind: 'draft', value: 'FOLLOW_UP', label: 'Draft follow-up' },
    { kind: 'status', value: 'REPLIED', label: 'Replied' },
    { kind: 'status', value: 'NOT_INTERESTED', label: 'Not interested' },
  ],
};

export interface WorkflowContact {
  status: string;
  nextFollowUpAt: Date | null;
  messages?: { type: string; status: string }[];
}

export function hasSentFollowUp(contact: WorkflowContact): boolean {
  return (contact.messages || []).some((m) => (m.type === 'FOLLOW_UP' || m.type === 'FOLLOWUP_REMINDER') && m.status === 'SENT');
}

export function isFollowUpDue(contact: WorkflowContact, now = new Date()): boolean {
  if (CLOSED_STATUSES.includes(contact.status as ContactStatus)) return false;
  if (contact.status === 'FOLLOW_UP_DUE') return true;
  return Boolean(contact.nextFollowUpAt && contact.nextFollowUpAt.getTime() <= now.getTime());
}

/** Statuses that turn into FOLLOW_UP_DUE when their reminder passes (you're waiting on them). */
const WAITING_STATUSES = ['REQUEST_SENT', 'MESSAGE_SENT', 'REFERRAL_REQUESTED'];

/**
 * Status shown to the user: the stored one, or FOLLOW_UP_DUE when you're waiting on them and
 * the reminder has passed. (ACCEPTED contacts are "due" too — send the ask — but keep their status.)
 */
export function effectiveStatus(contact: WorkflowContact, now = new Date()): ContactStatus {
  if (WAITING_STATUSES.includes(contact.status) && isFollowUpDue(contact, now)) return 'FOLLOW_UP_DUE';
  return isOneOf(CONTACT_STATUSES, contact.status) ? contact.status : 'RESEARCHED';
}

export function nextActions(contact: WorkflowContact, now = new Date()): NextAction[] {
  const status = effectiveStatus(contact, now);
  let actions = STATUS_ACTIONS[status];
  // Follow up only once: after that the contact counts as "no reply".
  if (hasSentFollowUp(contact)) actions = actions.filter((a) => a.value !== 'FOLLOW_UP');
  // A due connection request can't be "followed up" by message (you aren't connected yet).
  if (status === 'FOLLOW_UP_DUE' && contact.status === 'REQUEST_SENT') {
    actions = [
      { kind: 'status', value: 'ACCEPTED', label: 'Accepted' },
      { kind: 'status', value: 'NOT_INTERESTED', label: 'Not interested' },
    ];
  }
  return actions;
}

/** Date fields to set for a status change. */
export function transitionData(newStage: ContactStatus, now = new Date()): Record<string, unknown> {
  const data: Record<string, unknown> = { status: newStage };
  const inDays = (d: number) => new Date(now.getTime() + d * DAY_MS);
  switch (newStage) {
    case 'REQUEST_SENT':
      data.requestSentAt = now;
      data.lastContactAt = now;
      // Reminder to check whether the request was accepted.
      data.nextFollowUpAt = inDays(REQUEST_CHECK_DAYS);
      break;
    case 'ACCEPTED':
      data.acceptedAt = now;
      // Send the thank-you + referral ask now.
      data.nextFollowUpAt = now;
      break;
    case 'MESSAGE_SENT':
    case 'REFERRAL_REQUESTED':
      data.lastContactAt = now;
      data.nextFollowUpAt = inDays(FOLLOW_UP_DAYS);
      break;
    case 'REPLIED':
    case 'REFERRED':
      data.lastContactAt = now;
      data.nextFollowUpAt = null;
      break;
    case 'NOT_INTERESTED':
      data.nextFollowUpAt = null;
      break;
    case 'FOLLOW_UP_DUE':
      data.nextFollowUpAt = now;
      break;
    default:
      break;
  }
  return data;
}

export class NetworkingCrmService {
  async transitionStage(contactId: string, newStage: string, notes?: string) {
    if (!isOneOf(CONTACT_STATUSES, newStage)) {
      throw Object.assign(new Error(`Unknown status ${newStage}`), { status: 400 });
    }
    const data = transitionData(newStage);
    if (notes) data.notes = notes;
    return prisma.networkingContact.update({
      where: { id: contactId },
      data,
      include: { messages: true, targetJob: true },
    });
  }
}

export const networkingCrmService = new NetworkingCrmService();
