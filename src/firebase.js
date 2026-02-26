// src/firebase.js
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFirestore } from "firebase/firestore"; 
import { getAuth, GoogleAuthProvider } from "firebase/auth"; // Added Auth and Google Provider

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCnXc9it1CndJDe0oHKRiQDxewB52XysTQ",
  authDomain: "hustle-marketplace-eaf0a.firebaseapp.com",
  projectId: "hustle-marketplace-eaf0a",
  storageBucket: "hustle-marketplace-eaf0a.firebasestorage.app",
  messagingSenderId: "661094616326",
  appId: "1:661094616326:web:cb86a84ce4e3cfcb676287",
  measurementId: "G-8EDHZMN3FR"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

// Initialize and export Firestore
export const db = getFirestore(app); 

// Initialize and export Firebase Auth
export const auth = getAuth(app); 

// Initialize and export the Google Provider
export const googleProvider = new GoogleAuthProvider();

export default app;