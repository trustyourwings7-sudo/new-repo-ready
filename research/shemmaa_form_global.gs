/**
 * Shemmaa — GLOBAL "Where did the money go?" discovery form (USD, any country).
 * Creates a SEPARATE form from the Rwanda version. Run once only.
 *
 * HOW TO USE (2 minutes):
 * 1. Go to https://script.google.com → New project.
 * 2. Delete the sample code, paste this whole file, click Save.
 * 3. Select the function `buildShemmaaGlobalForm` and click Run. Approve permissions.
 * 4. Open View → Logs (or Execution log): it prints the form link to share
 *    and the edit link. Responses land in a Google Sheet automatically.
 */

const LOSS_BANDS = ['Under $500', '$500 – $5,000', '$5,000 – $50,000', 'Over $50,000', 'Prefer not to say'];
const PRICE_BANDS = ['$0 — it should be free', '$5 – $10', '$10 – $25', '$25 – $50', '$50 – $100', 'More than $100'];

function buildShemmaaGlobalForm() {
  const form = FormApp.create('Where did the money go? 💸 Global survey (4 min)');
  form
    .setDescription(
      'Every month, business owners everywhere work hard and still wonder: "Where did the money go?"\n\n' +
      'We are building Shemmaa, a tool that helps owners see every dollar and catch internal theft early. ' +
      'Help us build it right: 4 minutes, 12 quick taps.\n\n' +
      '🔒 Anonymous unless you choose to leave your number. We never ask you to name anyone.'
    )
    .setProgressBar(true)
    .setShowLinkToRespondAgain(false)
    .setConfirmationMessage(
      'Thank you! 🙏 If you left your number, we will WhatsApp you about the free 1-month pilot.'
    );

  // ---------- Section 1: You (30 seconds) ----------
  form.addMultipleChoiceItem()
    .setTitle('Where is your organization based?')
    .setChoiceValues(['Africa', 'USA', 'Canada', 'Europe / UK', 'Latin America', 'Asia', 'Middle East'])
    .showOtherOption(true)
    .setRequired(true);

  form.addTextItem()
    .setTitle('Which country and city?')
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('1. What kind of organization do you run or manage?')
    .setChoiceValues(['Shop / retail / supermarket', 'Restaurant, bar or hotel', 'School',
      'NGO, church or association', 'Clinic or pharmacy', 'Transport / logistics'])
    .showOtherOption(true)
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('2. How many people work with you?')
    .setChoiceValues(['Just me', '2 – 5', '6 – 20', '21 – 100', 'More than 100'])
    .setRequired(true);

  form.addCheckboxItem()
    .setTitle('3. How does money move in your organization? (tick all)')
    .setChoiceValues(['Cash', 'Mobile money (M-Pesa, MoMo, Airtel, OPay…)', 'Bank transfers or cheques',
      'Company / staff cards', 'Payment apps (PayPal, Venmo, Zelle, Wise, Cash App…)'])
    .setRequired(true);

  form.addScaleItem()
    .setTitle('4. Honest moment 😅 At the end of the month, how well do you know where every dollar went?')
    .setBounds(1, 5)
    .setLabels('No idea', 'To the last cent')
    .setRequired(true);

  // ---------- Section 2: The story (branch) ----------
  const q5 = form.addMultipleChoiceItem()
    .setTitle('5. Have you, or an owner you know personally, ever lost money to someone working inside the business?')
    .setHelpText('Fake receipts, cash taken little by little, MoMo sent to a personal number… it happens more than people admit.')
    .setRequired(true);

  const storyPage = form.addPageBreakItem()
    .setTitle('The story 🕵️')
    .setHelpText('No names needed. Just how it happened.');

  form.addCheckboxItem()
    .setTitle('6. How was it done? (tick all you know)')
    .setChoiceValues(['Fake or inflated receipts', 'Cash taken from the till / petty cash',
      'Money sent to a personal account or number', 'Fake workers or fake suppliers paid',
      'Personal spending on a company card',
      'Stock / goods taken', 'Not sure exactly'])
    .showOtherOption(true);

  form.addMultipleChoiceItem()
    .setTitle('7. How long did it go on before anyone noticed?')
    .setChoiceValues(['Days', 'Weeks', 'Months', 'Years', 'Never fully discovered']);

  form.addMultipleChoiceItem()
    .setTitle('8. Roughly how much was lost? (in US dollars)')
    .setChoiceValues(LOSS_BANDS);

  // ---------- Section 3: Today & wishes ----------
  const todayPage = form.addPageBreakItem()
    .setTitle('Your wish list ✨')
    .setHelpText('Almost done: 4 quick ones.');

  q5.setChoices([
    q5.createChoice('Yes, it happened to me', storyPage),
    q5.createChoice('Yes, to someone I know', storyPage),
    q5.createChoice('Not that I know of 👀', todayPage),
    q5.createChoice('Prefer not to say', todayPage),
  ]);

  form.addCheckboxItem()
    .setTitle('9. What do you use today to keep an eye on money?')
    .setChoiceValues(['A notebook', 'Excel / Google Sheets', 'Accounting software (QuickBooks, Xero, Sage…)',
      'Expense app (Expensify, Ramp, Brex, Pleo…)',
      'An accountant checks it', 'I trust my people', 'Nothing really'])
    .showOtherOption(true)
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('10. 🪄 Magic wand: if ONE app could do ONE thing for your money, what should it be?')
    .setChoiceValues(['Alert me the moment something looks suspicious',
      'Check that every receipt is real', 'Show all my accounts (cash, bank, mobile money, cards) on one screen',
      'Send me a 2-minute weekly money report', 'Stop staff from spending without my approval'])
    .showOtherOption(true)
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('11. If it truly stopped money from disappearing, what would you pay per month? (US dollars)')
    .setChoiceValues(PRICE_BANDS)
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('12. Want to be one of the first 10 organizations to try Shemmaa FREE for 1 month?')
    .setChoiceValues(['Yes, count me in! 🚀', 'Maybe, tell me more', 'Not now'])
    .setRequired(true);

  form.addTextItem()
    .setTitle('Your name + email or WhatsApp (optional, only if you want the free pilot or a 15-min chat)');

  // Responses → Google Sheet
  const sheet = SpreadsheetApp.create('Shemmaa GLOBAL discovery responses');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, sheet.getId());

  Logger.log('SHARE this link: ' + form.getPublishedUrl());
  Logger.log('EDIT the form:  ' + form.getEditUrl());
  Logger.log('RESPONSES sheet: ' + sheet.getUrl());
}
