Task: collect official documentation for ERP integrations into documentation/reference, and make sure that folder is ignored by git. Docs and notes only. Do not write any integration code, do not sign up for anything, do not use or print any API keys or secrets.

Step 1 (before saving anything): add documentation/reference/ to .gitignore, then prove it with `git check-ignore -v documentation/reference/test.txt`. Some of the docs have unknown licences and must not be committed. documentation/reference/eta-sdk already exists; check it is covered by the same rule. If you are blocked from editing .gitignore, print the exact lines for me to add and wait.

Step 2: for each integration below, create documentation/reference/<name>/ and save the official docs as markdown or text. Cover: authentication, the endpoints we would need, webhooks, rate limits, pricing or free tier, sandbox or test mode, and any account or business verification needed. Add a README.md in each folder with the source URLs, the date saved, and a 5-line summary of what the integration would do for our ERP. Use only official sources. If a page is blocked or needs a login, say so and move on. Do not copy whole websites; copy the pages that matter.

Order, easiest first:

1. Email sending: Resend, Postmark
2. Exchange rates: Central Bank of Egypt published rates, plus one public rates API
3. Slack and Microsoft Teams incoming webhooks
4. Telegram Bot API
5. SMS: Twilio, plus a provider that works well in Egypt (check which exist; note sender-name registration rules)
6. Google Sheets and Drive API with OAuth
7. OpenAI API (chat, embeddings)
8. Speech: OpenAI Whisper, ElevenLabs
9. WhatsApp Cloud API (Meta): business verification, templates, webhooks, 24-hour window
10. Payment gateways: Paymob, Fawry, Kashier, PayTabs, Tap
11. Couriers: Bosta, Aramex, Mylerz
12. E-commerce: Shopify, WooCommerce, Salla, Zid
13. Voice calls: Twilio Voice or SIP
14. Egypt Tax Authority e-invoicing (reuse documentation/reference/eta-sdk, add what is missing)
15. Saudi ZATCA and UAE e-invoicing
16. Bank feeds and open banking in Egypt and the Gulf

Step 3: write documentation/reference/INDEX.md with one row per integration: name, what it would do for us, difficulty (easy, medium, hard, hardest), what we need from outside (account, verification, budget, approval), and the folder. Then tell me which ones you could not fetch and why.

Rules: no time or effort estimates. No secrets in any file. Keep each summary short and plain.

Claude Code can’t see my earlier prompt, so this one is self-contained. It also asks for an integrations plan, since your repo rules need an approved plan before a module is built. Send it after the screens work finishes, or as a separate session.

Task: find and save the official documentation for the integrations we plan to add, then draft the integrations plan. Docs and a plan only. Do not write integration code, sign up for anything, or use or print any API key or secret. Do not commit. Do not touch the treasury work in progress.

Step 1: add documentation/reference/ to .gitignore and prove it with `git check-ignore -v documentation/reference/test.txt`. Some docs have unknown licences and must never be committed. documentation/reference/eta-sdk already exists; confirm it is covered. If you are blocked from editing .gitignore, print the exact lines for me to add and wait.

Step 2: for each integration below, create documentation/reference/<name>/ and save the official docs as markdown or text: authentication, the endpoints we would use, webhooks, rate limits, pricing or free tier, sandbox or test mode, and any account or business verification needed. Add a README.md in each folder with the source URLs, the date saved, and a 5-line summary of what it would do for our ERP. Use only official sources. If a page is blocked or needs a login, say so and move on. Copy the pages that matter, not whole websites.

Easiest first:

1. Email sending: Resend, Postmark
2. Exchange rates: Central Bank of Egypt published rates, plus one public rates API
3. Slack and Microsoft Teams incoming webhooks
4. Telegram Bot API
5. SMS: Twilio, plus a provider that works well in Egypt (note sender-name registration rules)
6. Google Sheets and Drive API with OAuth
7. OpenAI API (chat, embeddings)
8. Speech: OpenAI Whisper, ElevenLabs
9. WhatsApp Cloud API (Meta): business verification, templates, webhooks, 24-hour window
10. Payment gateways: Paymob, Fawry, Kashier, PayTabs, Tap
11. Couriers: Bosta, Aramex, Mylerz
12. E-commerce: Shopify, WooCommerce, Salla, Zid
13. Voice calls: Twilio Voice or SIP
14. Egypt Tax Authority e-invoicing (reuse documentation/reference/eta-sdk and add what is missing)
15. Saudi ZATCA and UAE e-invoicing
16. Bank feeds and open banking in Egypt and the Gulf

Step 3: write documentation/reference/INDEX.md: one row per integration with name, what it does for us, difficulty (easy, medium, hard, hardest), what we need from outside (account, verification, budget, approval), and the folder.

Step 4: draft documentation/plans/INTEGRATIONS_PLAN.md following the repo's plan template, with status "Draft, awaiting Ben's approval". Include:

- the integrations in order, grouped into waves, with the reason for each wave;
- for each one: the ERP feature it supports, how it fits our rules (channels never approve by themselves, secrets only as Worker secrets, every action audited, per-company credentials), and what could go wrong;
- an "adapter" design so providers can be swapped, like the one planned for AI and for ETA (a simulated mode and a real mode);
- a list of decisions Ben must make and accounts he must open;
- open questions.
  Do not add it to checklist.md as approved.

Finish with a short report: which docs you could not fetch and why, and anything in the docs that contradicts what we assumed.

Rules: no time or effort estimates. No secrets in any file. Plain language, short summaries.

When it reports back, send me the INDEX and the plan’s decisions list.
