## 2025-05-18 - WAI-ARIA Dialog Focus Management & Accessible Naming

**Learning:** Reusable modal and confirmation dialogs built with custom `<div>` overlays require `role="alertdialog"`, explicit `aria-labelledby` and `aria-describedby` associations generated via React `useId()`, internal keyboard focus trapping (`Tab` and `Shift+Tab`), focus restoration on unmount, and distinct `focus-visible:ring-2` styles to satisfy WAI-ARIA modal accessibility requirements without external dependencies.

**Action:** Whenever implementing modal dialog components in this application, generate unique IDs using `useId()`, bind dialog container elements with `aria-labelledby` and `aria-describedby`, trap focus between actionable elements while open, and restore focus to the previously active element upon closure.
