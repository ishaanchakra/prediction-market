import { initializeApp } from 'firebase/app';
   import { getAuth } from 'firebase/auth';
   import { getFirestore } from 'firebase/firestore';

   const firebaseConfig = {
      apiKey: "AIzaSyAz0Ri0rn4gfB13ufScrxAjip7ZoaNJ_ro",
  authDomain: "prediction-markets-at-cornell.firebaseapp.com",
  projectId: "prediction-markets-at-cornell",
  storageBucket: "prediction-markets-at-cornell.firebasestorage.app",
  messagingSenderId: "269813501387",
  appId: "1:269813501387:web:3d169f84364f55830ffa4e",
  measurementId: "G-R9S2Z99917"
   };

   const app = initializeApp(firebaseConfig);
   export const auth = getAuth(app);
   export const db = getFirestore(app);