# Title spot-check: how to do it (OT-35)

You check Claude's first guesses about real YouTube titles. Each title shows what was guessed (players, category, age, round, tournament, year) and you tap Correct, Wrong or Unsure. About 5 minutes at a time is fine; your place is remembered on that device.

## Make the file (Claude or you, at the PC)

`node scripts/review-packets.mjs spot-check`

This writes one file: `tmp\spot-check\spot-check.html` inside the project folder. It is one page with no internet needed. The tool refuses to write it anywhere else inside the project (so it can never end up in docs, tests or GitHub). Re-run it after the labels change.

## Open it on your phone

Pick one; all keep the file under your control.

1. **USB cable (simplest and most private).** Plug the phone into the PC, choose "File transfer" on the phone, copy `spot-check.html` into the phone's Downloads folder, then open it from the Files app (long-press, "Open with Chrome"). Nothing goes over the internet.
2. **Same Wi-Fi.** Not recommended for now: it needs a small server on the PC and the owner's approval first. Ask Claude if you want it.
3. **OneDrive (or Google Drive) in your own account.** Copy the file into your private folder, open it from the phone's app. This does put the real titles on that company's servers, so use it only if you accept that, never share the link, and delete the file afterwards. If a file viewer shows it as plain text instead of a page, download it and open it in Chrome.

If the page looks like plain code, you opened it in a text viewer: use Chrome.

## Why the titles must stay private

The titles name real players, and some may be under 18. The project rule (D-012, D-017) is that they never leave the private project: not in chat, screenshots, email, social media, or any website. Do not forward the HTML file to anyone.

## Using it

- Tap Correct, Wrong or Unsure for each line. Tap the same button again to clear it. If Wrong, type the right answer in the note box.
- Back and Next move between titles. The titles Claude was unsure about come first.
- Tap Export when you stop. It downloads `spot-check-answers.json` to your phone. The file holds your taps and notes by title number only, with no titles.

## What to send back

For now, just tell Claude when you are done. Do not send the file anywhere yet: Claude will explain how to share the answers file safely first.
