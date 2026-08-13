# apps/mobile

Flutter game application — **not scaffolded yet**.

Per TODO.md Phase 31: the Flutter project is only created after the backend/content model is stable. This directory intentionally contains a placeholder until then.

Planned stack (Phase 31):

- Flutter + Dart
- State: Riverpod
- Local DB: Drift / SQLite
- Push: Firebase Cloud Messaging
- Errors: Sentry
- Analytics: PostHog

The mobile app must NEVER hard-code game content. Content is downloaded via the manifest/content-pack system and stored locally.
