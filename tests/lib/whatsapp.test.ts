import { describe, expect, it } from 'vitest';
import { normaliseWhatsAppNumber, waLink, waShareLink } from '../../src/lib/whatsapp';

describe('normaliseWhatsAppNumber (shared with the release check)', () => {
  it('accepts international numbers and drops the 00 prefix', () => {
    expect(normaliseWhatsAppNumber('+91 98765 43210')).toBe('919876543210');
    expect(normaliseWhatsAppNumber('0091 98765 43210')).toBe('919876543210');
    expect(normaliseWhatsAppNumber('+44 20 7946 0958')).toBe('442079460958');
  });
  it('rejects numbers that would give a dead link', () => {
    expect(normaliseWhatsAppNumber('9876543210')).toBeNull(); // Indian mobile without 91
    expect(normaliseWhatsAppNumber('098765 43210')).toBeNull(); // national trunk 0
    expect(normaliseWhatsAppNumber('12345')).toBeNull();
    expect(normaliseWhatsAppNumber('1234567890123456')).toBeNull();
    expect(normaliseWhatsAppNumber('')).toBeNull();
    expect(normaliseWhatsAppNumber(null)).toBeNull();
  });
  it('waLink uses it, so a ten-digit number gives no link at all', () => {
    expect(waLink('9876543210')).toBeNull();
    expect(waLink('09876543210')).toBeNull();
    expect(waLink('0091 98765 43210')).toBe('https://wa.me/919876543210');
  });
});

describe('waShareLink', () => {
  it('builds a number-less share link with encoded text', () => {
    expect(waShareLink('Power Smash https://example.test/a?b=1&c=2')).toBe(
      'https://wa.me/?text=' + encodeURIComponent('Power Smash https://example.test/a?b=1&c=2'),
    );
  });
  it('returns null for blank text so the caller can fall back to a copyable link', () => {
    expect(waShareLink('  \r\n')).toBeNull();
    expect(waShareLink(null)).toBeNull();
    expect(waShareLink(undefined)).toBeNull();
  });
});

describe('waLink', () => {
  it('builds a wa.me link from a digits-only number', () => {
    expect(waLink('919876543210')).toBe('https://wa.me/919876543210');
  });
  it('removes +, spaces and punctuation from the number', () => {
    expect(waLink('+91 98765-43210')).toBe('https://wa.me/919876543210');
  });
  it('URL-encodes the prefilled text, including Tamil, ampersands and newlines', () => {
    const link = waLink('919876543210', 'Hi & hello\nRef PS-2026-ABC123 வணக்கம்');
    expect(link).toBe(
      'https://wa.me/919876543210?text=' + encodeURIComponent('Hi & hello\nRef PS-2026-ABC123 வணக்கம்'),
    );
    expect(link).not.toContain(' ');
    expect(link).not.toContain('\n');
  });
  it('drops carriage returns and trims the text; blank text gives the bare link', () => {
    expect(waLink('919876543210', '  \r\n ')).toBe('https://wa.me/919876543210');
    expect(waLink('919876543210', 'a\r\nb')).toBe('https://wa.me/919876543210?text=' + encodeURIComponent('a\nb'));
  });
  it('returns null for a missing or unusable number so the caller can hide the button', () => {
    expect(waLink(null)).toBeNull();
    expect(waLink(undefined)).toBeNull();
    expect(waLink('')).toBeNull();
    expect(waLink('12345')).toBeNull();
    expect(waLink('1234567890123456')).toBeNull();
  });
  it('cannot be tricked into another host through the number or text', () => {
    // Everything except digits is stripped from the number, so the host and path are always wa.me/<digits>.
    expect(waLink('91987654321@evil.example/x')).toBe('https://wa.me/91987654321');
    expect(waLink('919876543210', 'https://evil.example')).toMatch(/^https:\/\/wa\.me\/919876543210\?text=/);
  });
});
