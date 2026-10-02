// Settings for cgcmultimedia.com/live. The only file to edit when setting up
// (README.md, "Setting it up").
export default {
  // Firebase → Project settings → Your apps → the web app's config object,
  // pasted here as it is. These values are not secret: anyone can see them in
  // the page. What protects the feed is database.rules.json.
  //
  // While this is null, every page runs in demo mode: this browser only.
  firebase: null,

  // Where the QR code sends phones.
  phoneUrl: 'https://cgcmultimedia.com/live',

  // The translation proxy, relative to the console page. The Google API key
  // lives on the server beside it, never here.
  translateUrl: '../api/translate.php',
};
