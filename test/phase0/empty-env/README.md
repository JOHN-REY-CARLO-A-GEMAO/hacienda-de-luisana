# Intentionally empty Vite test environment

No dotenv file belongs here. All repository Vitest configs use this env directory and require the OS-isolated Phase 0 launcher. SDK doubles are explicit tests, not environment credentials. Emulator SDKs are configured in test contexts under `demo-hacienda` with loopback endpoints only.
