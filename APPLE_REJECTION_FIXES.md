# Apple Rejection Fixes - Action Plan

## 🚨 CRITICAL PRIORITY (Must Fix Before Resubmission)

### 1. **Guideline 2.1 - Submit IAP Products** ⚠️ BLOCKER
**Status:** ✅ PRODUCTS READY - Need to add to app version submission

**Completed:**
- ✅ All 4 products have Review Screenshots
- ✅ All products set to "Ready to Submit"
- ✅ Products: `tunematch_credits_5`, `tunematch_credits_18`, `tunematch_credits_60`, `tunematch_credits_150`

**⚠️ IMPORTANT - When submitting new app version:**
1. Go to your app version in **App Store Connect**
2. Scroll to **"In-App Purchases"** section
3. Click **"+"** button
4. **Add all 4 IAP products to the submission**

**Why this matters:** Even though products are "Ready to Submit", you must explicitly add them to your app version submission. Apple cannot review your app if IAP products aren't included with the binary.

---

### 2. **Guideline 3.1.1 - Alternative Payment Methods** ⚠️ CRITICAL
**Status:** ✅ CODE FIXED - Payment screen now says "In-app purchase only"

**What Apple Saw:** They think credits can be purchased outside IAP

**Code Changes Made:**
- ✅ Updated payment screen text to explicitly say "In-app purchase only"
- ✅ Removed mock purchase functionality (was granting free credits)

**Additional Check Needed:**
- Review your **App Store Connect metadata** (description, screenshots, promotional text)
- Make sure there are NO mentions of:
  - Web payments
  - External payment links
  - Alternative payment methods
  - "Pay on website" or similar

**If you have a website with payment options:**
- Remove any links to payment pages from app metadata
- Make sure website doesn't mention in-app credits

---

## 🔴 HIGH PRIORITY

### 3. **Guideline 5 - China/OpenAI References** 
**Status:** ✅ FIXED - User confirmed China issue resolved

**What Apple Said:** App references OpenAI/ChatGPT in metadata, which isn't allowed in China

**Two Options (Choose One):**

**Option A: Remove China from Availability** (EASIEST)
1. Go to **App Store Connect → My Apps → TuneMatch → App Information → Availability**
2. Click **"Edit"** next to Countries or Regions
3. **Uncheck "China mainland"**
4. Save

**Option B: Remove OpenAI References from Metadata** (If you want to sell in China)
1. Go to **App Store Connect → My Apps → TuneMatch**
2. Check these sections for "OpenAI", "ChatGPT", or "AI" mentions:
   - **App Name**
   - **Subtitle**
   - **Description**
   - **Promotional Text**
   - **Keywords**
   - **Screenshots** (remove any text mentioning OpenAI)
   - **App Preview Videos**
3. Replace with generic terms like:
   - "AI-powered" → "Smart" or "Intelligent"
   - "OpenAI" → Remove entirely
   - "ChatGPT" → Remove entirely
   - "Powered by OpenAI" → Remove entirely

**Recommendation:** Choose Option A (remove China) - it's faster and you can always add it back later.

---

### 4. **Guideline 5.1.1 - Registration Requirement**
**Status:** ✅ CODE FIXED - Users can browse without sign-in

**What We Fixed:**
- ✅ Payment screen accessible without authentication
- ✅ Users can browse packages without signing in
- ✅ Sign-in only required when actually purchasing

**However:** Apple reviewer may have tested old build. Make sure:
- New build (13) is submitted
- Review notes explain: "Users can browse IAP products without registration. Registration is only required at purchase time to save credits to their account for cross-device access."

**Action in App Store Connect:**
1. Go to **App Review Information** section
2. Add this note:
   ```
   IMPORTANT: Users can browse and view all in-app purchase products without 
   requiring registration. Registration is only requested when the user attempts 
   to complete a purchase, and we clearly explain that registration enables 
   cross-device access to purchased credits. This complies with Guideline 5.1.1.
   ```

---

## ✅ COMPLETED CODE FIXES

1. ✅ Removed mock purchase functionality (no free credits without payment)
2. ✅ Made Payment screen accessible to non-authenticated users
3. ✅ Updated payment screen text to say "In-app purchase only"
4. ✅ Added proper sign-in prompt with explanation for why account is needed

---

## 📋 CHECKLIST BEFORE RESUBMISSION

- [x] **IAP Products Submitted:**
  - [x] All 4 products have Review Screenshots
  - [x] All products set to "Ready to Submit"
  - [ ] **Products added to new app version submission** ⚠️ DO THIS WHEN SUBMITTING

- [ ] **App Store Connect Metadata:**
  - [ ] No mentions of alternative payment methods
  - [x] No OpenAI/ChatGPT references (China issue fixed)
  - [ ] Review notes added explaining registration is optional for browsing

- [ ] **New Build:**
  - [x] Build number incremented (currently 16)
  - [ ] New archive created in Xcode
  - [ ] Uploaded to App Store Connect
  - [ ] New build selected for submission
  - [ ] **IAP products added to submission** ⚠️ CRITICAL

- [ ] **Final Check:**
  - [ ] Test that Payment screen works without sign-in
  - [ ] Test that purchase requires sign-in
  - [ ] Verify no mock purchases work

---

## 🚀 NEXT STEPS

1. ✅ **IAP products ready** (all 4 products ready to submit)
2. ✅ **China issue fixed** (OpenAI references resolved)
3. **Add review notes** explaining registration flow (App Review Information)
4. ✅ **Build number incremented** (currently 16)
5. **Build and submit** new version:
   - Create new archive in Xcode
   - Upload to App Store Connect
   - **⚠️ CRITICAL: Add all 4 IAP products to the app version submission**
   - Add review notes
   - Submit for review

---

## 📝 NOTES

- The code fixes are complete
- Most remaining work is in **App Store Connect** (not code)
- IAP submission is the #1 blocker - do this first
- China issue is metadata-only (no code changes needed)

