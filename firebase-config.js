// Paste the config object from Firebase console → Project settings → Your apps → Web app.
// These values are safe to publish: access is protected by your login + firestore.rules.
export const firebaseConfig = {
  apiKey: "PASTE_HERE",
  authDomain: "PASTE_HERE.firebaseapp.com",
  projectId: "PASTE_HERE",
  storageBucket: "PASTE_HERE.appspot.com",
  messagingSenderId: "PASTE_HERE",
  appId: "PASTE_HERE"
};

// Login emails: each person signs in with initials + password.
// "BV" signs in as bv@ledger.house, and so on. Create these three users in
// Firebase console → Authentication → Users → Add user.
export const EMAIL_DOMAIN = "ledger.house";
