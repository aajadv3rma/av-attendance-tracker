# AV Attendance Tracker

A Next.js attendance workspace for students, employees, and self-employed users.

## Important architecture

This is a server-rendered Next.js application. It is not deployable as a static GitHub Pages site because the application uses Node.js API routes for authentication, sessions, password reset, Google OAuth, attendance validation, overtime calculations, exports, and offline replay.

Use GitHub for source control and connect the repository to Vercel (or another Next.js-capable host). Firebase Auth is supported as an identity option and Firestore is used as a server-controlled mirror. PostgreSQL/Drizzle remains authoritative for server-side data and business rules. Do not remove PostgreSQL until the data API has been deliberately migrated and tested.

## Run locally

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env.local`.
3. Set `DATABASE_URL` to a PostgreSQL database.
4. Install dependencies with `npm install`.
5. Run `npm run dev` and open `http://localhost:3000`.

The current email/password and Google login are implemented by the routes under `src/app/api/auth`. They require PostgreSQL. Email verification and password reset additionally require Resend configuration.

## GitHub and deployment

1. Create an empty GitHub repository.
2. From this project directory, run:

   ```bash
   git init
   git add .
   git commit -m "Initial attendance tracker"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
   git push -u origin main
   ```

3. In Vercel, import the GitHub repository. Keep the framework preset as Next.js and use the default build command.
4. Add the values from `.env.local` in Vercel Project Settings > Environment Variables for Preview and Production.
5. Set `APP_BASE_URL` to the deployed HTTPS URL.
6. Redeploy after saving environment variables.

A GitHub repository alone will not run this application. GitHub Pages is only appropriate after converting the app to a fully client-side/static architecture, which this project is not today.

## Current login setup

The existing login feature supports:

- Email/password registration and login.
- Password reset links through Resend.
- Email verification through Resend.
- Google OAuth through `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

For Google OAuth, register this callback URL in Google Cloud Console:

```text
https://YOUR_DEPLOYED_HOST/api/auth/google/callback
```

Also add `http://localhost:3000/api/auth/google/callback` for local development. The Google OAuth consent screen must include the authorized domain used in production.

## Firebase setup

Firebase browser configuration values are not passwords. Add them as `NEXT_PUBLIC_FIREBASE_*` variables, enable Email/Password and Google under Firebase Console > Authentication > Sign-in method, and add the deployed domain under Authentication > Settings > Authorized domains.

The server-only Admin SDK variables are `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`. Create them from Firebase Console > Project settings > Service accounts and add them only to `.env.local` and Vercel. Never commit the service-account JSON file or private key.

The implemented flow is:

1. Firebase Auth signs the user in with email/password or Google.
2. The browser sends the short-lived Firebase ID token to `/api/auth/firebase`.
3. The server verifies the token, links the verified email to the PostgreSQL user, and creates the existing HTTP-only session.
4. Successful workspace reads are mirrored by the server into a UID-scoped Firestore document.

The browser cannot directly read or write the mirror: `firestore.rules` is deny-by-default and Admin SDK writes happen only on the server.

If Firestore is later intended to become the primary database, complete that migration as a separate project:

1. Replace the PostgreSQL-backed `/api/data` persistence with Firestore transactions or a deliberately designed repository layer. Preserve server-side validation, ownership checks, idempotency, and the overtime calculations.
2. Move from the current single mirrored workspace document to validated, UID-scoped collections. Every document must be protected by tested Firestore rules. Do not leave PostgreSQL and Firestore as competing writable sources of truth.

Recommended Firestore layout:

```text
users/{uid}
users/{uid}/subjects/{subjectId}
users/{uid}/shifts/{shiftId}
users/{uid}/projects/{projectId}
users/{uid}/attendanceRecords/{recordId}
users/{uid}/overtimeAudit/{auditId}
users/{uid}/notifications/{notificationId}
```

A starter rules shape is:

```text
match /users/{uid}/{document=**} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
```

Use more restrictive field validation before production. Firestore rules must be deployed separately with the Firebase CLI; they are not replaced by Next.js route checks.

## Validation

Before deployment, run:

```bash
npm run typecheck
npm run lint
npm run build
```

Do not commit `.env.local`, service-account JSON, Firebase Admin credentials, or database passwords.
