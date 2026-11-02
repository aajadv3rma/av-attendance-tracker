"use client";

import { getApps, initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  type User,
} from "firebase/auth";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseConfigured = Object.values(config).every(Boolean);

const app = firebaseConfigured
  ? getApps()[0] ?? initializeApp(config)
  : null;

export const firebaseAuth = app ? getAuth(app) : null;
export const googleProvider = firebaseAuth ? new GoogleAuthProvider() : null;

export async function provisionFirebaseSession(user: User, category: string, fullName?: string) {
  if (!firebaseAuth) throw new Error("Firebase Authentication is not configured.");
  const token = await user.getIdToken();
  const response = await fetch("/api/auth/firebase", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    credentials: "same-origin",
    body: JSON.stringify({ category, fullName: fullName?.trim() || user.displayName || user.email?.split("@")[0] }),
  });
  const result = await response.json() as { user?: unknown; error?: string };
  if (!response.ok || !result.user) throw new Error(result.error ?? "Unable to create your secure session.");
  return result.user;
}

export async function syncWorkspaceSnapshot(snapshot: unknown) {
  if (!firebaseAuth?.currentUser) return;
  const token = await firebaseAuth.currentUser.getIdToken();
  const response = await fetch("/api/firebase/sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    credentials: "same-origin",
    body: JSON.stringify({ snapshot }),
  });
  if (!response.ok) throw new Error("Workspace sync failed.");
}