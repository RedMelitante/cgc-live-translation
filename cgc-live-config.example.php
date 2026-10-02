<?php
// Settings for cgcmultimedia.com/live/api/translate.php. This file goes in the
// hosting account's HOME folder (/home/mmkuo2cihvxr/cgc-live-config.php),
// never inside public_html, so no web address can reach it.
//
// Type these in by hand, in cPanel → File Manager → Edit:
//   google_api_key         Google Cloud → APIs & Services → Credentials → the
//                          API key, restricted to the Cloud Translation API
//   firebase_database_url  the databaseURL from the Firebase web config
//   firebase_project_id    the projectId from the Firebase web config
//
// A key with a ' in it, or ending in \, breaks this file. Google's keys are
// letters, digits, - and _, so a pasted key is fine.
return [
  'google_api_key' => 'PASTE-THE-GOOGLE-API-KEY-HERE',
  'firebase_database_url' => 'https://PASTE-PROJECT-default-rtdb.asia-southeast1.firebasedatabase.app',
  'firebase_project_id' => 'paste-project-id',
  // Characters a month before the proxy stops sending lines to Google.
  // Google's free tier is 500,000; this leaves a margin under it.
  'month_limit' => 490000,
];
