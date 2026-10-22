# Razorpay sample invoice

**What this is.** `SAMPLE_INVOICE.html` is a one-page, print-friendly sample invoice or receipt for Razorpay's website review (OT-06). Razorpay's live-key website review asks for the business website pages (About, Contact, Pricing, Terms, Privacy, Refunds and Cancellation) and an **uploaded sample invoice in PNG, JPG or PDF** (VERIFIED_FACTS VF-D1; D-021). Razorpay has no official "Shipping" page requirement, but the site keeps a Delivery Policy anyway.

**Everything on it is fake.** Business name, address, customer, amounts, numbers and contact details are obviously marked SAMPLE or `example.invalid`. It shows **no real entity details, no price, and no tax rate**. Whether the right document is a plain payment receipt or a tax invoice, which numbering series to use and whether a tax line appears are the **CA's decisions** (D-021, VF-D16); the sample only has a placeholder line saying so. Nothing here is tax or legal advice.

## Making a PDF on your phone (no tools needed)

1. Send the file to your phone (WhatsApp to yourself, email or Google Drive) and open it in **Chrome**.
2. Optional: tap a yellow highlighted field and type your own details. **Do this only after** the CA has chosen the document type and OT-19 (legal name, address, phone, email) and the entity decision (OT-05) are final. The yellow highlight and the instruction box at the top do not print.
3. Tap the three dots, then **Share** (or **Print**), then **Print**, then choose **Save as PDF**, paper size **A4**, and save.
4. The result is one A4 page. Check it before uploading.

On a PC: open the file in Chrome or Edge, press Ctrl+P, destination **Save as PDF**, paper **A4**, margins **None**, tick **Background graphics**.

## Before you upload it to Razorpay

- Decide with the CA what the document should be called (receipt or invoice) and replace the "(SAMPLE: document type ...)" text.
- Replace the SAMPLE business name and address with your own **only when they match the entity you gave Razorpay for KYC** (PAN, bank-account name and invoices must match, VF-D2). If you are not ready, do not upload the sample with your details half filled in; ask Razorpay what they will accept.
- Never put real customer details, real payment IDs or real amounts of a real customer on it: it is a sample.
- Keep the printed copy of what you uploaded.

## Notes for the lead

- The page has no scripts and no external files, so it can be opened offline. The only interactivity is `contenteditable` on the highlighted fields.
- It is not part of the website build (`docs/` is not published). If the strict placeholder gate ever scans `docs/`, note that this file carries no `TODO(owner)` text: it uses SAMPLE markers instead.
- When D-021's `orders` and `payments` tables arrive in M3 and the CA has decided the document type, replace this sample with a generated one from real field names, with fake values.
