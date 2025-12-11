# 🚀 Production Setup Guide for Supabase & RevenueCat

## 📋 Critical Checklist Before Production Launch

---

## 🔵 SUPABASE - Pre-Production Setup

### 1. **Run Database Migrations** ⚠️ CRITICAL

Run these migrations in your Supabase Dashboard → SQL Editor:

#### ✅ Required Migrations:
1. **`create_user_profiles_table.sql`** - Creates user profiles table (if not already run)
2. **`create_purchases_table.sql`** - Creates purchases table (if not already run)
3. **`add_history_delete_policy.sql`** - Adds RLS policy for history deletion
4. **`fix_update_user_credits_permissions.sql`** - ⚠️ **MUST RUN THIS** - Fixes credit update function permissions

**To run migrations:**
1. Go to Supabase Dashboard → SQL Editor
2. Copy and paste each migration file content
3. Click "Run" 
4. Verify each migration succeeded

### 2. **Edge Function Secrets** 🔐

Add these secrets in **Supabase Dashboard → Edge Functions → Secrets**:

#### Required Secrets:

1. **`OPENAI_API_KEY`** ✅ (Already required)
   - Get from: https://platform.openai.com/api-keys
   - Value: Your OpenAI API key

2. **`SPOTIFY_CLIENT_ID`** ⚠️ **RECOMMENDED** (For real songs only)
   - Get from: https://developer.spotify.com/dashboard
   - Steps:
     1. Create a Spotify app in Spotify Developer Dashboard
     2. Get your Client ID
     3. Add as secret in Supabase

3. **`SPOTIFY_CLIENT_SECRET`** ⚠️ **RECOMMENDED** (For real songs only)
   - Get from: Same Spotify app
   - Click "Show client secret" to reveal
   - Add as secret in Supabase

**Why Spotify?** Without it, OpenAI may return fake/non-existent songs. Spotify API guarantees real songs only.

### 3. **Edge Functions Deployment** 🚀

#### Verify Edge Functions Are Deployed:

1. **`recommend-songs`** - Main analysis function
   - Check: Supabase Dashboard → Edge Functions
   - Verify it's deployed and running
   - Ensure secrets above are configured

2. **`smooth-handler`** - User deletion handler
   - Check: Supabase Dashboard → Edge Functions  
   - Verify it's deployed
   - Uses: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (auto-provided)

### 4. **Row Level Security (RLS) Policies** 🔒

Verify these policies exist and work:

- ✅ `user_profiles` table:
  - Users can SELECT their own profile
  - Users can UPDATE their own profile
  - Service role can manage profiles

- ✅ `history` table:
  - Users can SELECT their own history
  - Users can INSERT their own history
  - Users can DELETE their own history (`add_history_delete_policy.sql`)

- ✅ `purchases` table:
  - Only service role can insert (via Edge Function)
  - Users can SELECT their own purchases

**To verify:** Supabase Dashboard → Authentication → Policies

### 5. **Storage Buckets** 📦

Verify storage bucket for images exists:

- **Bucket name:** (check your code for the bucket name)
- **Public access:** Configured appropriately
- **RLS policies:** Users can upload/read their own images

### 6. **Social Auth Configuration** (Optional but Recommended)

#### Apple Sign-In:
1. **Apple Developer Account:**
   - Enable "Sign In with Apple" capability
   - Configure in App Store Connect

2. **Supabase Dashboard:**
   - Authentication → Providers → Apple
   - Add your Apple Team ID and Key ID
   - Configure redirect URLs

#### Google Sign-In:
1. **Google Cloud Console:**
   - Create OAuth 2.0 credentials
   - Get Client ID and Client Secret

2. **Supabase Dashboard:**
   - Authentication → Providers → Google
   - Add Client ID and Client Secret
   - Configure redirect URLs

3. **Update Code:**
   - Update `GOOGLE_WEB_CLIENT_ID` in `lib/supabase.ts` with production client ID

---

## 🟢 REVENUECAT - Pre-Production Setup

### 1. **Get Production API Key** 🔑

**Current Status:** Using test key `test_pSAnCJsEYdHpPmuLdvffpazrRxl`

**Action Required:**
1. Go to [RevenueCat Dashboard](https://app.revenuecat.com/)
2. Navigate to your project settings
3. Get your **Production API Key** (not the test key)
4. Update in `lib/revenuecat.ts`:
   ```typescript
   const REVENUECAT_API_KEY = 'YOUR_PRODUCTION_API_KEY_HERE';
   ```
5. **Important:** Test key will NOT work in production builds!

### 2. **Create Products in App Stores** 📱

You need to create products in both App Store Connect (iOS) and Google Play Console (Android):

#### **Product IDs (must match exactly):**
- `tunematch_credits_5` - 5 credits
- `tunematch_credits_18` - 18 credits (15 + 3 bonus)
- `tunematch_credits_60` - 60 credits (50 + 10 bonus)
- `tunematch_credits_150` - 150 credits (120 + 30 bonus)

#### **iOS (App Store Connect):**
1. Go to App Store Connect → Your App → In-App Purchases
2. Create consumable products with IDs matching above
3. Set prices and descriptions
4. Submit for review

#### **Android (Google Play Console):**
1. Go to Google Play Console → Your App → Monetization → Products → In-app products
2. Create products with IDs matching above
3. Set prices and activate them
4. Products are available immediately (no review needed)

### 3. **Configure RevenueCat Products** ⚙️

In RevenueCat Dashboard:

1. **Navigate to:** Products → Your App
2. **Add Products:**
   - Click "Add Product"
   - Enter product ID (e.g., `tunematch_credits_5`)
   - Select type: **Consumable**
   - Connect to App Store and Google Play products
   - Repeat for all 4 products

3. **Verify Product IDs Match:**
   - RevenueCat product ID = App Store product ID = Google Play product ID = Code product ID
   - Must be EXACT match!

### 4. **Create and Configure Offering** 🎯

1. **Create Offering:**
   - RevenueCat Dashboard → Offerings
   - Click "Create Offering"
   - Name it: "Default" or "Main Credits"

2. **Add Packages:**
   - Add all 4 credit packages to the offering
   - You can mark one as "Best Value" or "Most Popular"

3. **Mark as Current:**
   - ⚠️ **CRITICAL:** Mark this offering as "Current"
   - The app looks for the "current" offering
   - If not marked as current, purchases won't work!

### 5. **Webhooks (Optional but Recommended)** 🔔

Set up webhooks to grant credits when purchases complete:

1. **In RevenueCat Dashboard:**
   - Go to Project Settings → Webhooks
   - Add webhook URL (your Supabase Edge Function endpoint)

2. **Create Edge Function:**
   - Create a Supabase Edge Function to handle webhook events
   - Grant credits when `PURCHASE_SUCCESS` event is received
   - More reliable than client-side credit granting

**Alternative:** Current implementation grants credits client-side, which works but webhooks are more reliable.

### 6. **Test Purchases** ✅

**Before Production:**
1. Use RevenueCat sandbox/test environment
2. Test purchases on:
   - iOS Simulator (sandbox)
   - Android Emulator (test purchases)
3. Verify credits are granted correctly
4. Test restore purchases
5. Test purchase errors/cancellations

**Production Testing:**
1. Use TestFlight (iOS) or Internal Testing (Android)
2. Test with real (free) test accounts
3. Verify end-to-end flow works

---

## 🔍 Verification Checklist

### Supabase:
- [ ] All migrations run successfully
- [ ] `OPENAI_API_KEY` secret added
- [ ] `SPOTIFY_CLIENT_ID` secret added (recommended)
- [ ] `SPOTIFY_CLIENT_SECRET` secret added (recommended)
- [ ] All Edge Functions deployed and running
- [ ] RLS policies verified
- [ ] Storage bucket configured
- [ ] Social auth configured (if using)

### RevenueCat:
- [ ] Production API key updated in code
- [ ] Products created in App Store Connect (iOS)
- [ ] Products created in Google Play Console (Android)
- [ ] Products configured in RevenueCat dashboard
- [ ] Products match IDs in code exactly
- [ ] Offering created and marked as "Current"
- [ ] All packages added to offering
- [ ] Test purchases working
- [ ] Credits granted correctly after purchase

---

## 🚨 Critical Notes

### RevenueCat API Key:
- **Test key:** Works in development/simulator
- **Production key:** Required for App Store/Play Store builds
- ⚠️ **Production builds will fail with test key!**

### Product IDs:
- Must match EXACTLY across: Code, RevenueCat, App Store, Google Play
- Case-sensitive!
- Use the exact IDs from your code: `tunematch_credits_5`, etc.

### Offering:
- ⚠️ **Must be marked as "Current"** in RevenueCat
- App looks for `offerings.current` - won't work without it!

### Spotify API:
- Not required, but STRONGLY recommended
- Without it, OpenAI may return fake songs
- Users will be frustrated with non-existent Spotify URLs

---

## 📝 Quick Start Commands

### Run Supabase Migration:
```sql
-- Copy content from fix_update_user_credits_permissions.sql
-- Paste in Supabase Dashboard → SQL Editor → Run
```

### Update RevenueCat Key:
1. Open `lib/revenuecat.ts`
2. Find line: `const REVENUECAT_API_KEY = 'test_pSAnCJsEYdHpPmuLdvffpazrRxl';`
3. Replace with production key from RevenueCat dashboard

---

## 🆘 Troubleshooting

### "No offerings found" in RevenueCat:
- ✅ Check offering is marked as "Current"
- ✅ Check products are added to offering
- ✅ Verify API key is correct

### Credits not deducting:
- ✅ Run `fix_update_user_credits_permissions.sql` migration
- ✅ Check RLS policies allow user to update their own profile
- ✅ Check function permissions

### Fake songs returned:
- ✅ Add Spotify API credentials to Edge Function secrets
- ✅ Redeploy Edge Function after adding secrets

### Purchases not working:
- ✅ Verify production API key (not test key)
- ✅ Check product IDs match exactly
- ✅ Verify offering is marked as "Current"
- ✅ Test in sandbox/test environment first

---

**Last Updated:** Based on current codebase
**Priority:** Complete Supabase migrations first, then RevenueCat setup

