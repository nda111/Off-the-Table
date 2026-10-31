# Privacy Policy

Off the Table for ChatGPT ("the extension") is an unofficial, free browser extension for deleting ChatGPT conversations and Codex tasks in bulk. This policy explains what the extension accesses and what it does with it.

Last updated: October 31, 2026

## Summary

The extension does not collect, store, sell or share any personal data. It has no servers, analytics or tracking. Everything it does happens in your browser, on chatgpt.com.

## What the extension accesses

- **Your ChatGPT session.** To delete the conversations you select, the extension asks chatgpt.com for your current login session (`/api/auth/session`), the same way the ChatGPT website does. The access token it receives is kept only in memory for the delete requests and is sent only to chatgpt.com. It is never saved or sent anywhere else.
- **The conversation list in the sidebar.** The extension reads the conversation and Codex task links shown in the ChatGPT sidebar so you can select them. Their titles and contents are not read, saved or transmitted.
- **ChatGPT's page settings.** The extension reads the page's theme color, light/dark mode, language and tooltip style so its interface matches ChatGPT. This information stays in your browser.

## What the extension stores

The extension saves two small items in the chatgpt.com site storage on your computer:

- `cbd:tip-style`: the colors of ChatGPT's tooltips, so its own tooltips look the same.
- `cbd:intro-seen`: a flag noting that you have seen the one-time intro, so it isn't shown again.

Neither contains personal information. Clearing the site data for chatgpt.com removes them.

## Network requests

The extension sends requests only to chatgpt.com, and only to:

- read your login session (`/api/auth/session`), and
- delete the conversations or Codex tasks you selected.

It makes no other network requests and does not load remote code.

## Permissions

- **Access to chatgpt.com:** Used to add the selection interface to the ChatGPT sidebar and to send delete requests for the items you choose.
- **scripting:** Used to add the extension to ChatGPT tabs that were already open before the extension was installed or updated.
- **contextMenus:** Used to add a "Help" item to the menu you get by right-clicking the toolbar icon.

## Children

The extension is not directed at children and does not knowingly process any data from them.

## Changes

If this policy changes, the updated version will be published in this repository with a new date.

## Contact

Questions or concerns: open an issue at <https://github.com/nda111/Off-the-Table/issues>.
