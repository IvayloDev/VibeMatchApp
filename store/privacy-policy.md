# TuneMatch Privacy Policy

Last updated: 9 September 2026

This policy covers the TuneMatch app for iPhone and Android (bundle identifier
`com.paltech.tunematch`) and the servers behind it.

It replaces the earlier policy published under the name VibeMatch in March 2025.
That version said the app collected only your email address and your sign-in
provider id, that it used no analytics or tracking identifiers, and that your
photos were used only for real-time processing and never stored. None of that is
true of the app as it works today, which is why this document exists. Everything
below describes what the current version actually does.

TuneMatch is operated by [PLACEHOLDER: full legal entity name],
[PLACEHOLDER: registered address].
Questions about this policy or about your data: contact@paltechstudio.com
[PLACEHOLDER: dedicated data protection contact address, if the owner wants one
separate from general support].

## The short version

- You pick a photo. The photo is uploaded to our storage and its contents are
  sent to OpenAI, which describes the scene so we can choose songs for it.
- The photo stays in our storage after that, because your Vault shows it next to
  the songs it produced. It is deleted when you delete that match or your
  account.
- We use product analytics (PostHog, hosted in the EU) to see which screens
  people use and which errors they hit. Analytics events are tied to an opaque
  account id, not to your email address.
- We keep a device identifier in your phone's secure storage. It survives a
  reinstall, and its only job is to stop one device claiming the free starter
  credits over and over.
- There are no ads, no advertising SDKs, no IDFA, no App Tracking Transparency
  prompt, and no tracking of you across other companies' apps or websites. We do
  not sell your data.
- You can delete your account from inside the app. One thing survives that
  deletion, and it is spelled out below.

## What we collect, why, and how long we keep it

### Your account

Signing in with email and password, Google, or Apple gives us your email address
and the account id from that provider. We need it to know whose Vault, credits
and subscription are whose. It is kept while your account exists.

If you use Sign in with Apple, the app asks Apple for your name as part of the
sign-in sheet. We do not store it, and it is not written to any of our tables.

You do not have to sign up at all. On first launch the app creates an anonymous
account for you automatically so that credits, purchases and your Vault have
somewhere to live. That account holds no email address and no name. If you later
sign up, it is upgraded in place and you keep everything in it.

### Photos you choose

When you run a match, the app resizes your photo and uploads it to our storage
on Supabase. The image content is then sent to OpenAI's API (models `gpt-4.1`
and `gpt-4.1-mini`) so it can be described in words, and that description is what
the song choice is made from.

We do not run face recognition, and we do not try to work out who is in a
picture. No biometric identification of any kind happens, by us or on our behalf.

The photo is kept for as long as the match is in your Vault, because the Vault
shows the picture next to the songs it produced. Delete the match and the file
goes with it. Delete your account and every file under your folder is removed.
There is no separate expiry: we do not quietly delete your Vault after a period
of inactivity.

OpenAI states that data sent to its API is not used to train its models and is
retained for up to 30 days for abuse monitoring before deletion.

### Your matches

For each match we store the vibe you picked, the songs we returned, the short
explanation shown with each one, and the time it happened. That is your Vault,
and it is the thing the app is for. Kept while your account exists.

### Device identifier

The app generates a random identifier the first time it runs and stores it in
the iOS Keychain or the Android equivalent. It is sent to our server with match
requests.

It survives deleting and reinstalling the app, and that is deliberate. Without
it, anyone could reinstall to claim the free starter credits again, and the free
tier would be a refill button. It is not an advertising identifier, it is not
shared with anyone, and it cannot be used to recognise you in any other app.

### IP address

Our servers record the IP address a match request and a song search arrive from.
It is used to spot one machine hammering the free tier, which is the only defence
we have against automated abuse when a request has no account behind it.

[PLACEHOLDER: confirm the retention period the owner wants here. As the system is
built today these rows are kept for as long as the account exists, alongside the
match they belong to. State a real number, for example 90 days, only once a purge
actually runs.]

### Usage and diagnostics

We use PostHog, on its EU cloud, for product analytics. It receives which screens
you open, which actions you take (starting a match, hitting a paywall, connecting
Spotify, and similar), and uncaught errors and crashes with their stack traces.

These events are tied to your account id, which is an opaque string. Your email
address is not sent to PostHog. There is no session replay and no screen
recording.

We use this to see where the app is failing people. It is not used for
advertising, and it is not shared with advertising networks.

[PLACEHOLDER: PostHog's own default retention applies. State the project's
configured retention window here once the owner has set it.]

### Spotify, if you connect it

Connecting Spotify is optional and the app works without it. If you connect it:

- We store the access and refresh tokens Spotify issues, so we can keep asking on
  your behalf without sending you back through the login every time.
- We call the Spotify Web API to read your top artists and tracks, and we store a
  derived taste profile (roughly: which artists and genres you actually listen
  to) so matches lean towards music you like.
- We store your Spotify user id to tie the connection to your account.

We do not post anything to your Spotify account and we do not read your playlists
beyond what is needed to build that taste profile. Disconnecting Spotify in the
app removes the stored connection and the profile derived from it. Both are also
removed when you delete your account.

### Purchases

Purchases of match packs and TuneMatch Pro go through Apple's App Store or Google
Play. We never see your card details. Apple and Google tell us that a purchase
happened, and RevenueCat, which we use to manage subscriptions and entitlements,
records it against your account id so your credits and Pro status follow you to a
new phone.

Records of what you bought are kept while your account exists, and for as long
afterwards as tax and accounting rules require.

### Notifications

Reminders about your free daily match are scheduled locally on your own phone.
There is no push token, no notification server, and nothing leaves the device for
this. Turning notifications off in system settings stops them.

## Who processes your data

| Who | What they get | Where |
| --- | --- | --- |
| Supabase | Everything above that we store: account, photos, matches, credits, Spotify tokens and taste profile, server logs | [PLACEHOLDER: confirm the project's region, ref `mebjzwwtuzwcrwugxjvu`] |
| OpenAI | The content of the photo you are matching, and the text prompt around it | United States |
| PostHog | Product analytics and error reports, keyed to your account id | European Union |
| RevenueCat | Purchase and subscription events, keyed to your account id | United States |
| Apple | Sign in with Apple, App Store purchases, and anonymous song searches when we look for a 30 second preview on the iTunes Search API | United States |
| Google | Google sign-in and Google Play purchases | United States |
| Spotify | Only if you connect it: the API calls we make on your behalf | United States and European Union |
| Deezer | Anonymous song title searches when we look for a 30 second preview. No account data is sent | European Union |
| Expo (EAS Update) | Delivers app updates. Receives your IP address and basic device information when the app checks for one | United States |

We do not sell personal data, and we do not share it with anyone for advertising.

Some of these processors are in the United States. Transfers out of the EEA and
the UK rely on the European Commission's Standard Contractual Clauses, or on the
EU-US Data Privacy Framework where the processor is certified under it.

## Legal basis for using your data

For people in the UK and the EEA, under the UK GDPR and the GDPR:

- **Performance of a contract** (Article 6(1)(b)): running your account, analysing
  the photo you asked us to match, storing your Vault, and delivering the credits
  and subscription you paid for.
- **Consent** (Article 6(1)(a)): access to your photo library, connecting Spotify,
  and notifications. You give each of these separately and can withdraw each one
  without affecting the others.
- **Legitimate interests** (Article 6(1)(f)): the device identifier and IP logging
  used to stop abuse of the free tier, product analytics and error reporting used
  to keep the app working, and keeping a record of email addresses that have
  already had free credits. In each case our interest is in the app being
  affordable to run and not being drained by automated abuse, and we have limited
  the data to what that actually needs.
- **Legal obligation** (Article 6(1)(c)): keeping purchase records for tax.

## Your rights

You can ask us to give you a copy of your data, correct it, delete it, restrict
what we do with it, or object to our legitimate interests. You can also ask for
your data in a portable form. Email contact@paltechstudio.com and we will answer
within 30 days.

If you are unhappy with how we handled it you can complain to your national data
protection authority. [PLACEHOLDER: name the lead supervisory authority for the
operating entity, and an EU or UK representative if one is required.]

If you are in California, we do not sell or share your personal information as
those words are defined by the CCPA, and the access and deletion rights above
apply to you too.

### Deleting your account, and the one thing that survives it

Profile, then Delete Profile, deletes your account. When you do:

- Every row we hold about you is deleted: your profile, your matches, your credit
  ledger, your Spotify connection and taste profile.
- Every photo in your storage folder is deleted.
- Your sign-in account is hard deleted. There is no recovery and no grace period.

One thing is deliberately kept: **your email address is written to a list of
addresses that have already received free credits.** Nothing else about you is in
that list. It exists so that deleting and re-creating an account cannot be used
to farm the free starter credits over and over. It is kept indefinitely, because
a list that expired would not do the job.

If you want that address removed as well, email us and say so. Removing it means
a future sign-up with the same address would be treated as new, and would receive
the starter credits again.

## Security

Data is encrypted in transit. Access to our database is controlled per user by
row level security, so one account cannot read another's rows or storage folder.
The `images` bucket is not publicly listable or readable: the app fetches your
own pictures through short-lived signed links. Server keys are held server-side
only and are never shipped in the app.

## Children

TuneMatch is not intended for children under 13, and we do not knowingly collect
data from them. In parts of the EEA the minimum age is 16 unless a parent
consents. If you believe a child has given us data, email
contact@paltechstudio.com and we will delete it.

## Changes

If we change what we collect or who we send it to, we will update this page and
change the date at the top. Material changes will also be mentioned in the app's
release notes so a change is not made silently.

## Contact

[PLACEHOLDER: full legal entity name]
[PLACEHOLDER: registered address]
contact@paltechstudio.com
