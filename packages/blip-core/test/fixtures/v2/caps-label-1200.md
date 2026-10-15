---
name: Loyalty Cards
horizon: today
priority: 1
category: Client
status: active
created: 2026-05-14
---

# Tasks
- [ ] TURN ON THE SCANNER - code is deployed and switched off (build 20261011-0639). Remaining: Robin stores the 6 settings (SCANNER_REGION + SCANNER_MODE + CARD_PREFIX + CARD_LENGTH + RECEIPT_FOOTER + STAFF_PIN_LENGTH) in the shop tablet; the names and the allowed values are listed in docs/scanner-setup.md section 4, and the tablet has to be on the shop wifi while they are entered or it will not save them. After that, run scripts/scanner-check.sh once as a dry run and read the output: it prints one line per setting and the word READY at the end if all six are present and valid. If it prints READY, run it again with --apply, which writes the settings to the scanner itself and restarts it. Then scan one of the three test cards from the envelope taped inside the till drawer and confirm that a stamp appears on the customer screen within two seconds. If no stamp appears, check the scanner light first (green means it read the card, amber means it read something it did not recognise) and only then look at the log on the tablet. Finally switch the feature on for the Saturday shift only, watch it for the whole shift, and write down every card that failed to scan together with the time, so the pattern (if there is one) can be found on Monday.
- [ ] EMAIL: ask the printer for a quote on 500 more cards
- [ ] NEEDS £40 - buy the second scanner stand
- [ ] ORDER THE NEW TILL ROLLS TODAY
- [ ] Count the cards left in the drawer

# Session log

## 2026-10-11 — Robin + Claude
- Deployed card scanning switched off
