# App Store Connect privacy questionnaire - TuneMatch

Last updated: 9 September 2026

These are the answers to enter under App Privacy in App Store Connect. They match
`store/privacy-policy.md` and the app as it exists at version 1.3.0. Enter them
before the next submission, because the current label was filled in against the
old VibeMatch policy and understates what the app collects.

## The two global answers

**Do you or your third-party partners use data for tracking?** No, for every data
type.

The app contains no advertising SDK, does not link the IDFA, has no App Tracking
Transparency prompt, and shares nothing with data brokers. Nothing is combined
with data from other companies' apps or websites for advertising or measurement.
So "Used for Tracking" is No on every row, and the "Data Used to Track You"
section of the label comes out empty.

**Is any collected data not linked to the user's identity?** No. Everything below
is linked, including for guests: a guest still has an anonymous account id and
the data hangs off it.

## The answers

| Data type | Collected | Linked to user | Used for tracking | Purpose | Why |
| --- | --- | --- | --- | --- | --- |
| Contact Info > Email Address | Yes | Yes | No | App Functionality | Account sign-in and support. Not sent to analytics. |
| Contact Info > Name | No | - | - | - | Requested from Apple during Sign in with Apple, never stored. See the note below. |
| Identifiers > User ID | Yes | Yes | No | App Functionality, Analytics | The account id. Keys the Vault, credits and subscription, and identifies analytics events. |
| Identifiers > Device ID | Yes | Yes | No | App Functionality | Keychain-persisted device identifier that stops the free starter grant being reclaimed by reinstalling. Not an advertising identifier. |
| Usage Data > Product Interaction | Yes | Yes | No | Analytics, App Functionality | Screens opened, matches started, paywalls seen, Spotify connected. |
| Usage Data > Advertising Data | No | - | - | - | No ads in the app. |
| Diagnostics > Crash Data | Yes | Yes | No | Analytics, App Functionality | PostHog error autocapture sends uncaught errors and stack traces. |
| Diagnostics > Other Diagnostic Data | Yes | Yes | No | Analytics, App Functionality | Caught errors reported deliberately with context, so failures that the app recovered from are still visible. |
| Diagnostics > Performance Data | No | - | - | - | No performance or launch-time metrics are collected. |
| User Content > Photos or Videos | Yes | Yes | No | App Functionality | The photo you match. Uploaded to storage, kept for the Vault, content sent to OpenAI for analysis. |
| User Content > Customer Support | No | - | - | - | Support is plain email outside the app. |
| Purchases > Purchase History | Yes | Yes | No | App Functionality, Analytics | Match packs and Pro, recorded through RevenueCat against the account id. |
| Financial Info > Payment Info | No | - | - | - | Apple and Google handle payment. We never see card details. |
| Other Data > Other Data Types (IP address) | Yes | Yes | No | App Functionality | Recorded per match and per song search to rate limit abuse of the free tier. See the note below. |
| Other Data > Other Data Types (music taste profile) | Yes | Yes | No | App Functionality, Product Personalization | Top artists, tracks and genres read from Spotify, only if the user connects it. Includes the stored Spotify tokens and Spotify user id. |
| Location (any) | No | - | - | - | No location APIs are used. |
| Contacts, Health & Fitness, Sensitive Info, Browsing History, Search History, Audio Data | No | - | - | - | None of these are touched. |

## Notes on the judgement calls

**IP address.** Apple's questionnaire has no IP address data type, and Apple lets
you skip disclosing data collected solely for fraud prevention or security when
it is not used for anything else and not used for tracking. Our IP logging would
arguably qualify. Disclose it anyway, under Other Data, because the addresses are
stored on the match row rather than checked and thrown away, which makes the
exemption a harder argument than it is worth. If a purge job is added that keeps
IP only for a short window and never joins it to anything else, this row can be
dropped, and the policy's retention placeholder should be filled in at the same
time.

**Name.** The Apple sign-in call requests the FULL_NAME scope but the name is
never written anywhere, so it is not collected and the row stays No. Dropping the
scope from the request would make this unambiguous. See the cross-file note in
`store/privacy-policy.md` and the code at `lib/supabase.ts`.

**Guests.** Do not be tempted to answer "not linked to the user" for guest data.
An anonymous Supabase account is still an identity, it persists, and it becomes a
signed-in account later without the data changing hands. Linked is Yes.

## What changes if email is re-added to analytics

Right now the analytics identify call sends only the opaque account id. If the
user's email address is ever sent to PostHog again, as a person property or as
part of an identify call:

- **Contact Info > Email Address** gains **Analytics** as a purpose, alongside App
  Functionality.
- PostHog becomes a recipient of Contact Info, which has to be added to the
  processor table in `store/privacy-policy.md`.
- Used for Tracking stays **No**. Sending your own users' email to your own
  analytics tool is not tracking under Apple's definition, which is about linking
  to third-party data for advertising or measurement.

Nothing else on the label moves. But the label would have to be updated in App
Store Connect before that build ships, not after.
