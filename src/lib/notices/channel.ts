// The WhatsApp Channel (D-114): ONLY a link to the owner's channel, from the owner's setting (src/content/site.ts
// site.whatsappChannelUrl, OT-09). No phone number, no API, no message is sent by us. A value that is not a WhatsApp Channel address
// (https://whatsapp.com/channel/<id>) shows no button at all, so a chat link that carries a number can never appear by mistake.
// The channel id form (letters and digits, 16 to 40) is from public channel links seen in October 2026; not a vendor-documented
// format (open item for the lead: re-check when the owner gives the real link).
export const WHATSAPP_CHANNEL_PATTERN = /^https:\/\/(www\.)?whatsapp\.com\/channel\/([A-Za-z0-9]{16,40})\/?$/;

/** The normalised channel link (https://whatsapp.com/channel/<id>), or null when the setting is empty or not a channel link. */
export function whatsappChannelLink(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  const m = WHATSAPP_CHANNEL_PATTERN.exec(s);
  return m ? `https://whatsapp.com/channel/${m[2] as string}` : null;
}
