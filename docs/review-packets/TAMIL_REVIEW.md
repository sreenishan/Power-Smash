# Tamil review packet (generated, do not edit by hand)

Regenerate with `node scripts/review-packets.mjs tamil`. A test fails if Tamil text appears in `src/` that is missing here.

## For the reviewer

**Owner:** please forward this page to a native Tamil speaker (a friend, a teacher or a paid reviewer; OT-32). Every Tamil line here is a draft. Nothing new has been machine-translated for the site.

**English.** Power Smash is a Tamil Nadu badminton website. For each row, read the English line and the draft Tamil line. In the last-but-one column write `OK`, or `change to` and the Tamil you prefer. Please also say if a line sounds too formal or too casual for a badminton fan on a phone. The Notes column says what each line is for.

**தமிழ்.** இந்த வரிகளைப் படித்து, சரியா என்று சொல்லுங்கள்; மாற்ற வேண்டுமெனில் உங்கள் தமிழ் வரியை எழுதுங்கள். (Tamil instruction: suggestion, unverified.)

Any wording marked "suggestion, unverified" has not been checked by a Tamil speaker.

## A. Website lines (spec Appendix B)

| id | where it is used | English | current draft Tamil | OK / change to ... | notes |
|---|---|---|---|---|---|
| TB-01 | Home H1 | Tamil Nadu badminton, on record. | தமிழ்நாட்டு பேட்மிண்டனின் இல்லம் | | MISMATCH found by the brand review: the Tamil means "Home of Tamil Nadu badminton", which matches tagline option C ("Where Tamil Nadu badminton lives."), not this English headline. Reviewer: translate the English line, or tell us which tagline this Tamil fits. The owner picks the tagline first (question 12). No replacement suggested. |
| TB-02 | Tagline | Every player. Every match. Every smash. | ஒவ்வொரு வீரர். ஒவ்வொரு போட்டி. ஒவ்வொரு ஸ்மாஷ். | | Three short sentences. Check the rhythm and that each one stands alone. |
| TB-03 | Search placeholder | Search a player or tournament… | வீரர் அல்லது போட்டியைத் தேடுங்கள்… | | Polite command form. Check register: formal vs spoken. |
| TB-04 | Primary CTA | Find your match | உங்கள் போட்டி வீடியோவைக் கண்டுபிடியுங்கள் | | Polite command form. Check register: formal vs spoken. |
| TB-05 | Booking CTA | Book coverage | கவரேஜ் புக் செய்யுங்கள் | | Uses English loan words. Is that natural for your audience, or would you prefer pure Tamil? Register: spoken, polite. |
| TB-06 | Player share text | Watch all my badminton matches on Power Smash 🏸 {url} | என் அனைத்து பேட்மிண்டன் போட்டிகளையும் Power Smash-இல் பாருங்கள் 🏸 {url} | | Sent by a player to friends on WhatsApp, so spoken and warm is fine. Keep {url} and the emoji exactly as they are. |

English lines with no Tamil yet (they show in English only; any Tamil offered for them is a "suggestion, unverified" until a second person checks it):

- Home sub-line: {matches}+ matches. {players}+ players. Find yours, share it — and book Power Smash for your next tournament.
- Organizer hero: Your tournament deserves broadcast-quality coverage.
- Listing CTA: List your tournament — free
- Sponsor hero: Reach Tamil Nadu's badminton community — players, parents, coaches and organizers.
- Player CTA: Get my highlight reel
- Claim prompt: Is this you? Claim your profile.
- Form success: Thanks! Your reference is {ref}. We reply within 24 hours — or chat with us on WhatsApp now.
- Placement label: Sponsored

Also not drafted yet: the Tamil summary of the privacy notice (OT-32). It will be added here when it exists.

## B. Title-reader vocabulary (parser, PO-05)

These words are never shown to visitors. The title reader (`src/lib/parser/vocab.ts`) uses them to notice that a YouTube title may be about under-age players. A title containing one of them is held back for the owner to check (the safe choice), because nobody has confirmed what each word means. The English column is the developer's reading and is **unverified**.

Please say for each word: is it a real word used in Tamil badminton titles, what does it mean, and does it mean a young or under-age player (yes / no / depends)?

| id | where it is used | English (unverified) | current draft Tamil | OK / change to ... | notes |
|---|---|---|---|---|---|
| TV-01 | Parser age words (fail-closed list, vocab.ts) | school | பள்ளி | | Is this an under-age signal? Please also tell us other spellings. |
| TV-02 | Parser age words (fail-closed list, vocab.ts) | junior | ஜூனியர் | | Is this an under-age signal? Please also tell us other spellings. |
| TV-03 | Parser age words (fail-closed list, vocab.ts) | junior (second spelling) | ஜுனியர் | | Is this an under-age signal? Please also tell us other spellings. |
| TV-04 | Parser age words (fail-closed list, vocab.ts) | sub-junior | சப்ஜூனியர் | | Is this an under-age signal? Please also tell us other spellings. |
| TV-05 | Parser age words (fail-closed list, vocab.ts) | boys / children | சிறுவர் | | Is this an under-age signal? Please also tell us other spellings. |
| TV-06 | Parser age words (fail-closed list, vocab.ts) | boys / children (plural) | சிறுவர்கள் | | Is this an under-age signal? Please also tell us other spellings. |
| TV-07 | Parser age words (fail-closed list, vocab.ts) | girls | சிறுமியர் | | Is this an under-age signal? Please also tell us other spellings. |
| TV-08 | Parser age words (fail-closed list, vocab.ts) | girls (plural) | சிறுமிகள் | | Is this an under-age signal? Please also tell us other spellings. |
| TV-09 | Parser age words (fail-closed list, vocab.ts) | student | மாணவர் | | Is this an under-age signal? Please also tell us other spellings. |
| TV-10 | Parser age words (fail-closed list, vocab.ts) | students | மாணவர்கள் | | Is this an under-age signal? Please also tell us other spellings. |
| TV-11 | Parser age words (fail-closed list, vocab.ts) | girl students | மாணவியர் | | Is this an under-age signal? Please also tell us other spellings. |
| TV-12 | Parser age words (fail-closed list, vocab.ts) | youth / younger ones | இளையோர் | | Is this an under-age signal? Please also tell us other spellings. |
| TV-13 | Parser age words (fail-closed list, vocab.ts) | cadet | கேடட் | | Is this an under-age signal? Please also tell us other spellings. |

Still missing, and the reason test PF-041 stays skipped (PO-05): the Tamil words for **versus** (the "vs" between two sides), the rounds (**final**, **semi-final**, **quarter-final**) and the categories as real titles write them. No guess has been written. If you know how a Tamil title writes them, fill the last-but-one column (it counts as "suggestion, unverified" until a second person confirms):

| id | where it would be used | English | current draft Tamil | OK / change to ... | notes |
|---|---|---|---|---|---|
| TW-01 | Parser: splits the two sides | versus | (none yet) | | Reviewer to supply. |
| TW-02 | Parser: round | final | (none yet) | | Reviewer to supply. |
| TW-03 | Parser: round | semi-final | (none yet) | | Reviewer to supply. |
| TW-04 | Parser: round | quarter-final | (none yet) | | Reviewer to supply. |
| TW-05 | Parser: category | singles | (none yet) | | Reviewer to supply. |
| TW-06 | Parser: category | doubles | (none yet) | | Reviewer to supply. |
| TW-07 | Parser: category | mixed doubles | (none yet) | | Reviewer to supply. |
| TW-08 | Parser: category | men / women | (none yet) | | Reviewer to supply. |

## C. Other Tamil text found in the code (`src/`)

None. The site code has no Tamil interface text yet (Tamil shows only after OT-32).

Tamil digits and comments in the code are logic, not visible text, and are not listed.
