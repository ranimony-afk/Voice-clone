# Contributing to VoiceForge

Thank you for your interest in contributing to VoiceForge!

## Code of Conduct

All contributors are expected to uphold respectful, inclusive, and professional behavior.

## Development Workflow

1. Fork the repository and create a feature branch (`git checkout -b feat/my-feature`).
2. Adhere to TypeScript strict type safety without `any`.
3. Follow the modular server structure (`server/{config,data,db,engine,routes}`).
4. Verify changes pass type check and lint:
   ```bash
   npm run lint
   npm run build
   ```
5. Follow Conventional Commits:
   - `feat:` for new capabilities
   - `fix:` for bug fixes
   - `docs:` for documentation updates
   - `security:` for vulnerability patches
