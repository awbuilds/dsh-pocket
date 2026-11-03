# Mobile device checklist

Run this on a real iPhone (Safari) and a real Android phone (Chrome) before
calling a release done. Automated Playwright coverage cannot reproduce Safari's
keyboard or safe-area behavior.

## Pairing

- [ ] **Link phone** is visible at the sidebar foot; it is hidden on the phone.
- [ ] QR contains `http://<lan-ip>:<port>/pair#<code>` and scans with the system
      camera.
- [ ] The pairing page auto-submits the fragment code and clears the address bar.
- [ ] A wrong code shows an inline message; repeated wrong codes lock out.
- [ ] After pairing, reloading the app needs no code.
- [ ] **Revoke devices** sends the phone back to `/pair` immediately.
- [ ] A second phone can pair independently.

## Layout

- [ ] 390×844 portrait: no 56px rail, no horizontal page scroll.
- [ ] Bottom bar is reachable and sits above the home indicator (safe area).
- [ ] **Sessions** sheet lists recent sessions; tapping one opens it and closes
      the sheet.
- [ ] **New** opens a new session (or the same reusable blank the desktop uses).
- [ ] **More** slides the sidebar in; the backdrop and Escape close it; tapping a
      session or settings row closes it after the navigation.
- [ ] Dark theme matches the app.
- [ ] Landscape 844×390 remains usable; the bar does not cover the composer.
- [ ] Desktop window at >900px is unchanged.

## Composer and keyboard

- [ ] Focusing the composer does not zoom the page (16px inputs).
- [ ] The composer stays visible while the iOS keyboard is open; the page can be
      scrolled to the input.
- [ ] Long messages scroll; send button and attachments remain reachable.
- [ ] Draft text survives opening the session sheet and returning.
- [ ] Image/file upload from the phone works.

## Session behavior

- [ ] Sending a prompt streams tokens and tool cards live.
- [ ] Tool approval appears on both Mac and phone; answering on one settles the
      other.
- [ ] `ask_user_question` renders and can be answered from the phone.
- [ ] Cancel/stop works from the native composer controls.
- [ ] A long turn survives locking the phone and reconnects on unlock.
- [ ] Switching Wi-Fi off/on reconnects the live stream.

## Failure states

- [ ] Mac sleeps or DSH quits: the phone shows a clear connection error, not a
      blank page; reopening after DSH restarts works.
- [ ] Gateway port conflict falls back and the dialog shows the actual port.
- [ ] Desktop window resized narrow shows the bar; widening restores the frame.
- [ ] Unpaired `/api` returns 401; `/pocket/info` is 404 through the gateway.
