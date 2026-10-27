/**
 * Shemmaa — "Where did the money go?" discovery form.
 *
 * HOW TO USE (2 minutes):
 * 1. Go to https://script.google.com → New project.
 * 2. Delete the sample code, paste this whole file, click Save.
 * 3. Select the function `buildShemmaaForm` and click Run. Approve permissions.
 * 4. Open View → Logs (or Execution log): it prints the form link to share
 *    and the edit link. Responses land in a Google Sheet automatically.
 *
 * Change CURRENCY to localize for other countries (e.g. 'KES', 'NGN', 'USD').
 */

const CURRENCY = 'RWF';
const AMOUNT_BANDS = {
  RWF: ['Under 100k', '100k – 1M', '1M – 10M', 'Over 10M'],
  PRICE: ['0 — it should be free', '5,000', '10,000 – 20,000', '20,000 – 50,000', 'More than 50,000'],
};

function buildShemmaaForm() {
  const form = FormApp.create('Where did the money go? 💸 (4-minute survey)');
  form
    .setDescription(
      'Every month, business owners work hard and still wonder: "Where did the money go?"\n\n' +
      'We are building Shemmaa, a tool that helps owners see every franc and catch theft early. ' +
      'Help us build it right: 4 minutes, 12 quick taps.\n\n' +
      '🔒 Anonymous unless you choose to leave your number. We never ask you to name anyone.'
    )
    .setProgressBar(true)
    .setShowLinkToRespondAgain(false)
    .setConfirmationMessage(
      'Murakoze! 🙏 Thank you. If you left your number, we will WhatsApp you about the free 1-month pilot.'
    );

  // ---------- Section 1: You (30 seconds) ----------
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
    .setChoiceValues(['Cash', 'Mobile money (MoMo / Airtel / M-Pesa)', 'Bank transfers or cheques', 'Cards / POS'])
    .setRequired(true);

  form.addScaleItem()
    .setTitle('4. Honest moment 😅 At the end of the month, how well do you know where every franc went?')
    .setBounds(1, 5)
    .setLabels('No idea', 'To the last franc')
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
      'Mobile money sent to a personal number', 'Fake workers or fake suppliers paid',
      'Stock / goods taken', 'Not sure exactly'])
    .showOtherOption(true);

  form.addMultipleChoiceItem()
    .setTitle('7. How long did it go on before anyone noticed?')
    .setChoiceValues(['Days', 'Weeks', 'Months', 'Years', 'Never fully discovered']);

  form.addMultipleChoiceItem()
    .setTitle('8. Roughly how much was lost? (' + CURRENCY + ')')
    .setChoiceValues(AMOUNT_BANDS.RWF.map(function (b) { return b + ' ' + CURRENCY; }).concat(['Prefer not to say']));

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
    .setChoiceValues(['A notebook', 'Excel / Google Sheets', 'Accounting software (QuickBooks, Sage…)',
      'An accountant checks it', 'I trust my people', 'Nothing really'])
    .showOtherOption(true)
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('10. 🪄 Magic wand: if ONE app could do ONE thing for your money, what should it be?')
    .setChoiceValues(['Alert me the moment something looks suspicious',
      'Check that every receipt is real', 'Show cash + MoMo + bank on one screen',
      'Send me a 2-minute weekly money report', 'Stop staff from spending without my approval'])
    .showOtherOption(true)
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('11. If it truly stopped money from disappearing, what would you pay per month? (' + CURRENCY + ')')
    .setChoiceValues(AMOUNT_BANDS.PRICE.map(function (p) { return p.indexOf('free') > -1 ? p : p + ' ' + CURRENCY; }))
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('12. Want to be one of the first 10 organizations to try Shemmaa FREE for 1 month?')
    .setChoiceValues(['Yes, count me in! 🚀', 'Maybe, tell me more', 'Not now'])
    .setRequired(true);

  form.addTextItem()
    .setTitle('Your name + WhatsApp number (optional, only if you want the free pilot or a 15-min chat)');

  // Responses → Google Sheet
  const sheet = SpreadsheetApp.create('Shemmaa discovery responses');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, sheet.getId());

  Logger.log('SHARE this link: ' + form.getPublishedUrl());
  Logger.log('EDIT the form:  ' + form.getEditUrl());
  Logger.log('RESPONSES sheet: ' + sheet.getUrl());
}
