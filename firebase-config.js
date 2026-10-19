// Paste the config object from Firebase console → Project settings → Your apps → Web app.
// These values are safe to publish: access is protected by your login + firestore.rules.
export const firebaseConfig = {
  apiKey: "AIzaSyCWgJYpNt3t8vb6Cr9lMrY7wjNlmZ78f90",
  authDomain: "household-ledger-ce5d9.firebaseapp.com",
  projectId: "household-ledger-ce5d9",
  storageBucket: "household-ledger-ce5d9.firebasestorage.app",
  messagingSenderId: "1001178322680",
  appId: "1:1001178322680:web:5ed50808a2f478f735cd0d"
};

// Login emails: each person signs in with initials + password.
// "BV" signs in as bv@ledger.house, and so on. Create these three users in
// Firebase console → Authentication → Users → Add user.
export const EMAIL_DOMAIN = "ledger.house";
