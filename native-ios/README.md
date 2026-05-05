# Miwa Native iOS

This is the Apple-first Miwa app. It is a separate SwiftUI codebase, not the existing Capacitor/web wrapper under `client/ios`.

## What is here

- Native SwiftUI app shell with `TabView` navigation.
- Bearer-token auth against the existing Miwa API.
- Keychain-backed token storage.
- Starter native screens for Sign In, Today, Clients, and Settings.
- XcodeGen project spec so the Xcode project can be generated cleanly on macOS.

## Generate the Xcode project

On a Mac with Xcode installed:

```sh
brew install xcodegen
cd native-ios
xcodegen generate
open Miwa.xcodeproj
```

The default API base is:

```text
https://api.miwa.care/api/
```

For local development, set `MIWA_API_BASE_URL` in the Xcode scheme environment to your API host, for example:

```text
http://localhost:3000/api/
```

## App Store direction

The native app should stay focused on phone-first clinician workflows:

- Start the day: schedule, next session, pre-session brief, high-risk alerts.
- Move fast between clients.
- Record or dictate session material using native audio permissions.
- Keep PHI access secure with Keychain, Face ID, and short idle locks.

Keep the web app for broad desktop workflows. The iOS app should feel like something a clinician can use between sessions, in supervision, or immediately after an appointment.
