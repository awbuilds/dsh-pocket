/**
 * Styles owned by the mobile half. They are scoped under
 * `html[data-pocket-mobile]` so a desktop window is untouched, and they use
 * the theme's own alias variables with neutral fallbacks.
 */
export const styles = String.raw`
html[data-pocket-mobile] {
  --dsh-frame-top-clearance: env(safe-area-inset-top, 0px);
  --dsh-frame-overlay-top: calc(env(safe-area-inset-top, 0px) + 16px);
  overscroll-behavior: none;
}
html[data-pocket-mobile] body {
  overscroll-behavior: none;
  -webkit-text-size-adjust: 100%;
}

/* ── Frame: remove the 56px rail; the sidebar becomes an off-canvas drawer ── */
html[data-pocket-mobile] [data-pocket-frame] {
  grid-template-columns: 0 minmax(0, 1fr) 0 !important;
}
/* The fixed drawer leaves the grid flow; keep the remaining tracks in place. */
html[data-pocket-mobile] [data-pocket-frame] > [data-pocket-main] {
  grid-column: 2 !important;
  grid-row: 1 !important;
}
html[data-pocket-mobile] [data-pocket-frame] > [data-pocket-right] {
  grid-column: 3 !important;
  grid-row: 1 !important;
}
html[data-pocket-mobile] [data-pocket-frame] > :first-child,
html[data-pocket-mobile] [data-pocket-sidebar] {
  position: fixed !important;
  top: 0;
  bottom: 0;
  left: 0;
  width: min(86vw, 320px) !important;
  z-index: 70;
  transform: translateX(-104%);
  transition: transform 220ms cubic-bezier(.2, .8, .2, 1);
  box-shadow: 8px 0 36px rgb(0 0 0 / .28);
  border-right: .5px solid var(--dsw-alias-border-l3, #e3e6ea);
  background: var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-base, #fff));
  padding-top: env(safe-area-inset-top, 0px);
  overflow: hidden;
}
html[data-pocket-mobile][data-pocket-drawer="open"] [data-pocket-frame] > :first-child,
html[data-pocket-mobile][data-pocket-drawer="open"] [data-pocket-sidebar] {
  transform: translateX(0);
}
html[data-pocket-mobile] [data-pocket-frame] [role="separator"] {
  display: none !important;
}
/* The mobile grid has no right column; its toggle would open an invisible panel. */
html[data-pocket-mobile] [data-sidebar-right-expand],
html[data-pocket-mobile] [data-sidebar-right-collapse] {
  display: none !important;
}
html[data-pocket-mobile] [data-pocket-frame] {
  height: 100dvh;
}
html[data-pocket-mobile] [data-pocket-frame] pre,
html[data-pocket-mobile] [data-pocket-frame] table {
  max-width: 100%;
  overflow-x: auto;
}
/* iOS zoom guard: inputs below 16px make Safari zoom the whole page. */
html[data-pocket-mobile] [data-pocket-frame] textarea,
html[data-pocket-mobile] [data-pocket-frame] input:not([type="checkbox"]):not([type="radio"]),
html[data-pocket-mobile] [data-pocket-frame] select {
  font-size: 16px !important;
}
@media (pointer: coarse) {
  html[data-pocket-mobile] [data-pocket-frame] button,
  html[data-pocket-mobile] [data-pocket-frame] [role="button"] {
    min-height: 36px;
  }
}

/* ── Settings: stack the nav above the content on phone widths ── */
@media (max-width: 640px) {
  html[data-pocket-mobile] [data-shortcut-modal="settings"] {
    width: 100vw !important;
    max-width: none !important;
    height: 100vh !important;
    height: 100dvh !important;
    max-height: 100vh !important;
    max-height: 100dvh !important;
    border-radius: 0 !important;
    flex-direction: column !important;
  }
  html[data-pocket-mobile] [data-shortcut-modal="settings"] > nav {
    width: 100% !important;
    flex: none !important;
    gap: 10px !important;
    padding: calc(env(safe-area-inset-top, 0px) + 14px) 16px 0 !important;
    border-bottom: 1px solid var(--dsw-alias-border-l3, rgba(255, 255, 255, 0.1)) !important;
  }
  html[data-pocket-mobile] [data-shortcut-modal="settings"] > nav > :first-child {
    padding: 0 4px !important;
  }
  html[data-pocket-mobile] [data-shortcut-modal="settings"] > nav > :last-child {
    display: flex !important;
    flex-direction: row !important;
    flex-wrap: wrap !important;
    gap: 6px !important;
    overflow: visible !important;
    padding-bottom: 10px !important;
  }
  html[data-pocket-mobile] [data-shortcut-modal="settings"] > nav > :last-child > button {
    flex: 0 0 auto !important;
    width: auto !important;
    height: 40px !important;
    padding: 9px 14px !important;
    white-space: nowrap !important;
  }
  html[data-pocket-mobile] [data-shortcut-modal="settings"] > div {
    flex: 1 !important;
    min-height: 0 !important;
    width: 100% !important;
  }
  html[data-pocket-mobile] [data-shortcut-modal="settings"] > div > :first-child {
    height: auto !important;
    padding: 6px 12px 2px 16px !important;
    align-items: center !important;
    justify-content: flex-end !important;
  }
  /* The config file lives on the Mac; the close control is the only action here. */
  html[data-pocket-mobile] [data-shortcut-modal="settings"] > div > :first-child > :first-child {
    display: none !important;
  }
  html[data-pocket-mobile] [data-shortcut-modal="settings"] > div > :last-child {
    padding: 0 16px calc(16px + env(safe-area-inset-bottom, 0px)) !important;
  }
  /* Account card: let the profile copy use the full width and move its link below. */
  html[data-pocket-mobile] [data-shortcut-modal="settings"] div:has(> a[href*="platform.deepseek.com"]) {
    flex-direction: column !important;
    align-items: flex-start !important;
    gap: 8px !important;
  }
  /* Long group headers with a menu (e.g. Built-in plugins preset) wrap instead of clipping. */
  html[data-pocket-mobile] [data-shortcut-modal="settings"] > div > :last-child div:has(button[aria-haspopup="menu"]) {
    flex-wrap: wrap !important;
  }
  html[data-pocket-mobile] [data-shortcut-modal="settings"] > div > :last-child button[aria-haspopup="menu"] {
    max-width: 100% !important;
  }
}

/* ── Review: phone layout for the rightbar fullscreen diff ── */
@media (max-width: 640px) {
  /* The pane-split control is disabled by width here and only adds noise. */
  html[data-pocket-mobile] [data-dockkit-split-button] {
    display: none !important;
  }
  /* Opening a file in a desktop IDE/Finder is not a phone action. */
  html[data-pocket-mobile] div:has(> [data-open-path-open]) {
    display: none !important;
  }
  /* Keep the tab title clear of its close control. */
  html[data-pocket-mobile] [data-dockkit-tab-title] {
    padding-right: 26px !important;
  }
  html[data-pocket-mobile] [data-dockkit-tab-close] {
    width: 28px !important;
    min-width: 28px !important;
  }
  /* Side-by-side diff panes are 180px each on a phone; stack them full width. */
  html[data-pocket-mobile] [data-review-view="split"] > div {
    grid-template-columns: minmax(0, 1fr) !important;
  }
  html[data-pocket-mobile] [data-review-view="split"] > div > div + div {
    border-left: 0 !important;
    border-top: 0.5px solid var(--dsw-alias-border-l3) !important;
  }
}

/* ── Bottom bar (shell.bottom occupant) ── */
.pocket-bar {
  display: flex;
  align-items: stretch;
  gap: 2px;
  padding: 4px 6px calc(4px + env(safe-area-inset-bottom, 0px));
  background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, #fff));
  border-top: .5px solid var(--dsw-alias-border-l3, #e3e6ea);
  color: var(--dsw-alias-label-primary, #11151a);
  -webkit-tap-highlight-color: transparent;
}
.pocket-bar__btn {
  flex: 1;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-height: 48px;
  padding: 4px 6px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .01em;
  cursor: pointer;
}
.pocket-bar__btn:active {
  background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / .06));
}
.pocket-bar__btn svg {
  width: 20px;
  height: 20px;
  flex: none;
}
.pocket-badge {
  position: absolute;
  top: 3px;
  right: calc(50% - 22px);
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border-radius: 9px;
  background: var(--dsw-alias-accent, #2f6bff);
  color: #fff;
  font-size: 10px;
  line-height: 17px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

/* ── Session sheet ── */
.pocket-sheet-mask {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: flex-end;
  background: rgb(0 0 0 / .45);
  animation: pocket-fade-in 140ms ease-out;
}
.pocket-sheet {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: min(82vh, 760px);
  overflow: hidden;
  border-radius: 18px 18px 0 0;
  background: var(--dsw-alias-bg-base, #fff);
  color: var(--dsw-alias-label-primary, #11151a);
  box-shadow: 0 -12px 48px rgb(0 0 0 / .3);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  animation: pocket-slide-up 180ms cubic-bezier(.2, .8, .2, 1);
}
.pocket-sheet__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 16px 10px;
  border-bottom: .5px solid var(--dsw-alias-border-l3, #e3e6ea);
}
.pocket-sheet__title {
  flex: 1;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -.01em;
}
.pocket-sheet__list {
  flex: 1;
  padding: 6px 6px 12px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}
.pocket-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  padding: 13px 12px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.pocket-row:active {
  background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / .06));
}
.pocket-row__title {
  overflow: hidden;
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.pocket-row__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, #5c6673);
}
.pocket-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--dsw-alias-accent, #2f6bff);
}
.pocket-empty {
  padding: 28px 18px;
  text-align: center;
  font-size: 14px;
  color: var(--dsw-alias-label-secondary, #5c6673);
}

/* ── Drawer backdrop ── */
.pocket-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgb(0 0 0 / .42);
  animation: pocket-fade-in 140ms ease-out;
}

/* ── Pairing dialog ── */
.pocket-modal-mask {
  position: fixed;
  inset: 0;
  z-index: 95;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgb(0 0 0 / .45);
  animation: pocket-fade-in 140ms ease-out;
}
.pocket-modal {
  width: min(440px, 100%);
  max-height: min(90vh, 820px);
  overflow-y: auto;
  padding: 20px;
  border: .5px solid var(--dsw-alias-border-l3, #e3e6ea);
  border-radius: 18px;
  background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, #fff));
  color: var(--dsw-alias-label-primary, #11151a);
  box-shadow: 0 24px 80px rgb(0 0 0 / .35);
  animation: pocket-pop-in 160ms cubic-bezier(.2, .8, .2, 1);
}
.pocket-modal__head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}
.pocket-modal__title {
  flex: 1;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -.01em;
}
.pocket-modal__sub {
  margin: 0 0 16px;
  font-size: 13.5px;
  line-height: 1.45;
  color: var(--dsw-alias-label-secondary, #5c6673);
}
.pocket-icon-btn {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.pocket-icon-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / .06));
}
.pocket-qr {
  display: grid;
  place-items: center;
  width: 100%;
  max-width: 260px;
  margin: 0 auto 14px;
  padding: 12px;
  border-radius: 14px;
  background: #fff;
}
.pocket-qr svg {
  display: block;
  width: 100%;
  height: auto;
}
.pocket-code {
  margin: 0 0 4px;
  font: 700 30px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: .26em;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.pocket-countdown {
  margin: 0 0 14px;
  font-size: 12.5px;
  text-align: center;
  color: var(--dsw-alias-label-secondary, #5c6673);
}
.pocket-url {
  display: block;
  margin: 0 0 12px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-base, #f6f7f9);
  font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  word-break: break-all;
  color: var(--dsw-alias-label-secondary, #5c6673);
}
.pocket-select {
  width: 100%;
  margin: 0 0 12px;
  padding: 9px 10px;
  border: .5px solid var(--dsw-alias-border-l3, #e3e6ea);
  border-radius: 9px;
  background: var(--dsw-alias-bg-base, #fff);
  color: inherit;
  font: inherit;
  font-size: 13.5px;
}
.pocket-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.pocket-btn {
  flex: 1 1 auto;
  min-height: 38px;
  padding: 9px 14px;
  border: .5px solid var(--dsw-alias-border-l3, #e3e6ea);
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
}
.pocket-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / .06));
}
.pocket-btn--primary {
  border-color: transparent;
  background: var(--dsw-alias-accent, #2f6bff);
  color: #fff;
}
.pocket-btn--danger {
  color: #c0392b;
}
.pocket-btn:disabled {
  opacity: .55;
  cursor: default;
}
.pocket-devices {
  margin: 16px 0 0;
  border: .5px solid var(--dsw-alias-border-l3, #e3e6ea);
  border-radius: 10px;
  overflow: hidden;
}
.pocket-devices__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 11px;
  background: var(--dsw-alias-bg-base, #f6f7f9);
  color: var(--dsw-alias-label-secondary, #5c6673);
  font-size: 12px;
  font-weight: 600;
}
.pocket-devices__count {
  min-width: 20px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / .06));
  font-size: 11px;
  text-align: center;
}
.pocket-devices__empty {
  padding: 11px;
  color: var(--dsw-alias-label-secondary, #5c6673);
  font-size: 12px;
}
.pocket-devices__list {
  max-height: 190px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}
.pocket-device {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 11px;
  border-top: .5px solid var(--dsw-alias-border-l3, #e3e6ea);
}
.pocket-device__body {
  min-width: 0;
  flex: 1;
}
.pocket-device__label {
  overflow: hidden;
  color: inherit;
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pocket-device__meta {
  margin-top: 2px;
  color: var(--dsw-alias-label-secondary, #5c6673);
  font-size: 11px;
}
.pocket-device__remove {
  flex: none;
  min-height: 30px;
  padding: 5px 9px;
  border: .5px solid var(--dsw-alias-border-l3, #e3e6ea);
  border-radius: 8px;
  background: transparent;
  color: #c0392b;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.pocket-device__remove:hover {
  background: color-mix(in srgb, #c0392b 8%, transparent);
}
.pocket-device__remove:disabled {
  opacity: .55;
  cursor: default;
}
.pocket-note {
  margin: 16px 0 0;
  padding-top: 14px;
  border-top: .5px solid var(--dsw-alias-border-l3, #e3e6ea);
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary, #5c6673);
}
.pocket-notice {
  margin: 0 0 14px;
  padding: 12px 14px;
  border-radius: 10px;
  background: var(--dsw-alias-bg-base, #f6f7f9);
  font-size: 13.5px;
  line-height: 1.5;
}
.pocket-notice--warn {
  background: color-mix(in srgb, #c0392b 10%, transparent);
  color: #c0392b;
}
.pocket-spinner {
  padding: 26px 0;
  text-align: center;
  font-size: 14px;
  color: var(--dsw-alias-label-secondary, #5c6673);
}
.pocket-footer-action {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 34px;
  padding: 6px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #5c6673);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.pocket-footer-action:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / .06));
}
.pocket-footer-action svg {
  width: 16px;
  height: 16px;
  flex: none;
}
@media (prefers-reduced-motion: reduce) {
  .pocket-sheet,
  .pocket-modal,
  .pocket-sheet-mask,
  .pocket-modal-mask,
  .pocket-backdrop {
    animation: none;
  }
  html[data-pocket-mobile] [data-pocket-frame] > :first-child,
  html[data-pocket-mobile] [data-pocket-sidebar] {
    transition: none;
  }
}
@keyframes pocket-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes pocket-slide-up { from { transform: translateY(24px); opacity: .6; } to { transform: none; opacity: 1; } }
@keyframes pocket-pop-in { from { transform: scale(.98); opacity: 0; } to { transform: none; opacity: 1; } }
`
