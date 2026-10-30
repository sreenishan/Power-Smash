// The notification switches (D-114). Every one is OFF unless it is exactly true / exactly the string 'true'.
//  - NOTIFY_SUBSCRIBE_ENABLED (runtime, Vercel): the three /api/notify/* endpoints for sign-up and confirmation. The unsubscribe endpoint
//    never checks it: an unsubscribe always works. Until src/lib/runtime-env.ts lists the name, getRuntimeEnv() drops it, so it reads
//    as off (the integrator adds it).
//  - EMAIL_ENABLED (runtime, exists): email is sent at all (src/lib/leads/config.ts emailEnabled).
//  - features.emailNotifications (src/content/legal/status.ts, added by the integrator): the sign-up form is shown on pages.
//  - features.siteNotices (same): the notice banner and the WhatsApp Channel block are shown on pages.
// The features are read defensively: a flag that does not exist yet counts as off.
import { features } from '../../content/legal/status';

const allFlags = (): Readonly<Record<string, unknown>> => features as unknown as Readonly<Record<string, unknown>>;

/**
 * Sign-up and confirmation: NOTIFY_SUBSCRIBE_ENABLED exactly 'true' AND the legal flag features.emailNotifications (no address is
 * collected before the privacy wording that describes it is published). Unsubscribe never checks this.
 */
export function notifySubscribeSwitchOn(env: Readonly<Record<string, unknown>>, flags: Readonly<Record<string, unknown>> = allFlags()): boolean {
  return env.NOTIFY_SUBSCRIBE_ENABLED === 'true' && emailNotificationsFlag(flags);
}

export function emailNotificationsFlag(flags: Readonly<Record<string, unknown>> = allFlags()): boolean {
  return flags.emailNotifications === true;
}

export function siteNoticesFlag(flags: Readonly<Record<string, unknown>> = allFlags()): boolean {
  return flags.siteNotices === true;
}

/**
 * /alerts/ swaps its older blocks (the Channel button and the address-only alerts form) for "Stay updated" ONLY when the email
 * updates list is on. siteNotices alone is for the banner: switching it on must never leave /alerts/ with nothing but a hero (the
 * older Channel block already shows the channel link when the owner has set it).
 */
export function alertsPageUsesStayUpdated(flags: Readonly<Record<string, unknown>> = allFlags()): boolean {
  return emailNotificationsFlag(flags);
}
