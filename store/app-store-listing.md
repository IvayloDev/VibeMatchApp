# TuneMatch - App Store listing (1.3.0)

Paste each block into the matching field in App Store Connect. Character limits noted.

## App name (30 max)

TuneMatch: Photo to Song

(23 characters. Alternative if you want the category word visible in search:
"TuneMatch - Music for Photos", 28 characters.)

## Subtitle (30 max)

Find the song for your photo

(28 characters.)

## Promotional text (170 max, editable without a review)

Two free matches to start, one every day after. Pick a photo, pick a vibe, get
three songs that fit it - with a line explaining why each one works.

(151 characters.)

## Keywords (100 max, comma separated, no spaces after commas)

photo,song,music,vibe,mood,playlist,spotify,soundtrack,aesthetic,camera roll,picture,match

(89 characters.)

## Description (4000 max)

Pick a photo. Pick a vibe. Get three songs that fit it.

TuneMatch looks at what is actually in the picture - the light, the setting, the
mood - and comes back with three songs, each with a line telling you why it
suits that shot. Play a preview in the app, or open the track in Spotify.

Four vibes: Hype, Chill, Romantic and Moody. The same photo gives you different
songs depending on which one you choose, so a beach at sunset can be a party or
a comedown.

Every match is saved to your Vault. The song you found for one August evening is
still there in December.

Connect Spotify and matches are tuned to what you actually listen to, so you get
songs from artists you like rather than whatever is popular. It is optional and
the app works without it.

WHAT IT COSTS

You get two matches when you start and one free match every day at 9am. If you
want more than that, match packs start at five. TuneMatch Pro gives you ten
matches a day.

NO ACCOUNT NEEDED

You can use TuneMatch, buy matches and keep your Vault without signing up. Make
an account when you want the same Vault on a second phone.

WHAT PEOPLE USE IT FOR

Finding the right song before posting a photo dump. Turning a trip's camera roll
into a playlist. Settling the argument about what to put on when a picture has a
mood nobody can name.

## What's New (4000 max) - for 1.3.0

Your matches now live on our servers instead of only on your phone. Your balance
is the same wherever you sign in, it survives a reinstall, and it stops drifting
when the connection does.

Fixed: a match that failed part way through still cost you one. It doesn't now,
and if anything goes wrong after we've taken it, you get it straight back.

Fixed: retrying the same photo could charge you twice.

Fixed: subscribing to Pro left the upgrade screen showing until you reopened
the app.

Fixed: a purchase that took a moment to confirm sometimes needed the app
reopened before it arrived. It lands on its own now.

Fixed: the Profile screen needed scrolling to reach Terms and Privacy.

Fixed: some matches came back as "we couldn't find the track". When our first
pick isn't on Spotify, you now get a real song from that artist instead.

Fixed: the daily count for Pro members sat at 10 of 10 no matter how many
matches you ran.

New: two matches when you start, and a free one every day at 9am.

## Privacy - do this BEFORE the next submission

The privacy policy published at
https://ivaylodev.github.io/vibematch-privacy-policy/ is wrong. It is dated March
2025, still branded VibeMatch, and it tells reviewers and users that the app
collects only an email address and a provider id, uses no analytics or tracking
identifiers, and never stores photos. The app uploads and keeps photos, sends
their contents to OpenAI, runs PostHog analytics, keeps a device identifier that
survives reinstall, and logs IP addresses. That is a listing that does not match
the binary, which is an App Store review risk on its own and a real problem for
users regardless of review.

Two files here fix it:

- `store/privacy-policy.md` - the replacement policy, accurate as of 2026-09-09.
  Fill in the `[PLACEHOLDER: ...]` entries (legal entity, registered address,
  supervisory authority, retention windows) and publish it at the URL the app
  links to.
- `store/app-store-privacy-label.md` - the App Privacy questionnaire answers
  implied by that policy, row by row. The current label in App Store Connect was
  filled in against the old text and understates collection.

**Order of operations.** The policy has to be live at
https://ivaylodev.github.io/vibematch-privacy-policy/, and the App Privacy
answers updated in App Store Connect, BEFORE the next build is submitted. The app
links to that URL from Profile, so a reviewer reads whatever is at it on the day.
