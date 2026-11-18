/**
 * Help menu contact addresses: the ONE place to change them.
 *
 * PLACEHOLDERS: narrivell.com is not owned by Summer Grove Software yet.
 * Before any public release, either own the domain and set up these
 * mailboxes/aliases, or change the addresses. Otherwise people's messages
 * could reach whoever owns the domain. (Launch blocker in the plan.)
 */
export const CONTACT = {
  featureRequest: 'featurerequest@narrivell.com',
  feedback: 'feedback@narrivell.com',
  support: 'support@narrivell.com',
} as const;

export type ContactKind = keyof typeof CONTACT;

const SUBJECTS: Record<ContactKind, string> = {
  featureRequest: 'Feature request',
  feedback: 'Problem report',
  support: 'Support request',
};

const PROMPTS: Record<ContactKind, string> = {
  featureRequest: 'What would you like Narrivell to do, and what are you trying to achieve as a writer?',
  feedback: 'What happened, and what did you expect to happen? (Please don’t paste your manuscript.)',
  support: 'How can we help?',
};

/**
 * Builds a mailto: link that opens the user's own mail app with a
 * pre-filled message. The app version and OS are included so problems can
 * be reproduced; the user sees and can edit everything before sending.
 * Nothing is ever sent automatically.
 */
export function contactLink(kind: ContactKind, appVersion: string, platform: string): string {
  const subject = `Narrivell ${SUBJECTS[kind]} (v${appVersion})`;
  const body = [
    PROMPTS[kind],
    '',
    '',
    '',
    '---',
    `Narrivell version: ${appVersion}`,
    `System: ${platform}`,
  ].join('\r\n');
  return `mailto:${CONTACT[kind]}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
