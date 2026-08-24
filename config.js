/* ------------------------------------------------------------------
   Codirector Hub — front-end config

   The hub talks to the SAME Apps Script deployment as the standalone eval
   tracker, so this URL is already filled in. Redeploy a new version of
   Code.gs after editing it, and the URL stays the same.
------------------------------------------------------------------ */
window.CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbxQtWIaGaRE6xxSrngjrrPDt-lqA9fd8QVmfHdPJCbDl2nudHN6Ss5MJmyEoNQ_qPpu/exec',

  TERM_LABEL: 'Fall 2026',
  REQUIRE_CODE: true,
  RATING_OPTIONS: ['1', '2', '3', '4', '5']
};
