# FamilyHub Setup Guide

## 1. Supabase (database + auth)

1. Go to https://supabase.com and create a free account
2. Create a new project (name: "familyhub", pick a region close to you)
3. Once created, go to **Settings > API** and copy:
   - `Project URL` → paste into `.env.local` as `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → paste as `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role secret` key → paste as `SUPABASE_SERVICE_ROLE_KEY`
4. Go to **SQL Editor** and paste the contents of `supabase/schema.sql`, then click **Run**
5. Go to **Authentication > Providers > Google** and enable it (you'll need the Google credentials from step 2 below)

## 2. Google Cloud (Gmail API + OAuth)

1. Go to https://console.cloud.google.com
2. Create a new project (name: "FamilyHub")
3. Enable the **Gmail API**: search "Gmail API" in the API library and enable it
4. Go to **APIs & Services > Credentials > Create Credentials > OAuth 2.0 Client ID**
   - Application type: Web application
   - Authorized redirect URIs: add `https://YOUR-SUPABASE-PROJECT.supabase.co/auth/v1/callback`
   - Copy the **Client ID** and **Client Secret**
5. Paste into `.env.local`:
   - Client ID → `GOOGLE_CLIENT_ID`
   - Client Secret → `GOOGLE_CLIENT_SECRET`
6. Also paste the Client ID and Secret into Supabase: **Authentication > Providers > Google**
7. Go to **OAuth consent screen**:
   - User type: External
   - Add the Gmail readonly scope: `https://www.googleapis.com/auth/gmail.readonly`
   - Add yourself as a test user (your wife's email address)

## 3. Anthropic (Claude API)

1. Go to https://console.anthropic.com
2. Create an API key
3. Paste into `.env.local` as `ANTHROPIC_API_KEY`

## 4. Resend (email sending)

1. Go to https://resend.com and create a free account
2. Create an API key
3. Paste into `.env.local` as `RESEND_API_KEY`
4. (For testing, Resend's free tier lets you send to your own verified email address)

## 5. Cron Secret

Generate a random string for cron job authentication:
```bash
openssl rand -hex 32
```
Paste into `.env.local` as `CRON_SECRET`

## 6. Run locally

```bash
cd familyhub
npm install
npm run dev
```

Open http://localhost:3000 and sign in with Google.

## 7. Set up cron jobs (for production)

If deploying to Vercel, add a `vercel.json`:
```json
{
  "crons": [
    { "path": "/api/ingest", "schedule": "*/15 * * * *" },
    { "path": "/api/digest", "schedule": "30 7 * * *" }
  ]
}
```

For local testing, you can trigger manually:
```bash
curl -X POST http://localhost:3000/api/ingest -H "Authorization: Bearer YOUR_CRON_SECRET"
curl -X POST http://localhost:3000/api/digest -H "Authorization: Bearer YOUR_CRON_SECRET"
```
