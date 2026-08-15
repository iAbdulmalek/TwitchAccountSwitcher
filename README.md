# Twitch Account Switcher (Local)

![alt Extension popup](https://github.com/iAbdulmalek/TwitchAccountSwitcher/blob/main/example.png)

A minimal Chrome extension that switches between your own Twitch accounts in one click. It works by saving and restoring your `twitch.tv` session cookies. Functionally identical to logging out and logging back in by hand, just faster.

**Everything stays on your machine.** The extension makes zero network requests, contains zero analytics, and stores sessions only in `chrome.storage.local` inside your browser profile.

## Install

1. Clone the repo
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select repo folder.
5. Pin the icon from the puzzle-piece menu so it's always visible.

## Use

1. Log in to Twitch normally.
2. Click the extension icon → **Save current session**.
3. Log out on Twitch (or use the extension's **Log out on this browser** button), log in to your next account, and save that one too.
4. From then on, click any saved account → **Switch**. Open Twitch tabs reload automatically as the new account.

**Before every switch, the extension silently re-saves the account you're leaving, so its session stays fresh.**

## Why this won't get you banned

Twitch allows users to have multiple accounts. What gets accounts suspended is *what you do with them* — ban evasion, view-botting, follow-botting, spam, account selling/sharing. This extension does none of that, and is deliberately built to behave exactly like manual logging out/in:

- **No automation.** It never clicks, follows, chats, watches, or calls any Twitch API. It only swaps cookies when *you* click Switch.
- **No network activity.** Zero requests to Twitch or anywhere else. Your tokens are never transmitted.
- **Stable device identity.** Device-level cookies (`unique_id`, `unique_id_durable`) are shared across accounts and never swapped — the same as when you log out and back in manually. Your browser doesn't look like a new device on every switch, which is the kind of churn anti-abuse systems flag.
- **Minimal permissions.** Only `cookies` + `storage`, scoped to `*.twitch.tv`. It cannot read any other site.

One honest caveat: no tool can make rule-breaking safe. If one of your accounts is suspended, using another to return to the same channels is ban evasion regardless of how you switch — don't do that.

## Security notes

- Saved sessions are Twitch auth tokens. They are stored **unencrypted** in your Chrome profile (`chrome.storage.local`). The same protection level as the live cookies themselves. Don't use this on a shared or untrusted computer.
- Deleting a saved account in the popup only deletes the local snapshot; the Twitch account is untouched.
- To revoke a saved session entirely, log in to that account and disconnect other sessions in Twitch **Settings → Security and Privacy**, or just change the password.

## Troubleshooting

- **Switched but Twitch shows me logged out**  that saved session expired or was invalidated (password change, "log out everywhere", long inactivity). Log in normally and hit **Save current session** to refresh the snapshot.
- **Popup says "Not signed in" but I am**  make sure you're on `www.twitch.tv` in a normal (non-incognito) window; the extension reads the default cookie store.
- **Buttons disabled** — Save/Log out require an active Twitch login to act on.

## Files

- `manifest.json`  Manifest V3, popup-only (no background worker, minimal attack surface)
- `popup.html` / `popup.css` / `popup.js`  all logic lives in the popup
- `icons/`  generated toolbar icons

License: MIT. Do whatever you like with it.
