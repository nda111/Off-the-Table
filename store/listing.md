# Chrome Web Store listing

Text to paste into the Chrome Web Store Developer Dashboard. Not part of the extension package.

## Store listing

**Name** (from the package): Off the Table for ChatGPT

**Summary** (from the package, up to 132 characters): Select ChatGPT chats and delete them in bulk.

**Category:** Productivity

**Language:** English

**Description:**

```
Clean up your ChatGPT sidebar in seconds. Off the Table lets you select conversations and Codex tasks right in the sidebar and delete them all at once. A free, open-source alternative to paid bulk-delete extensions.

HOW IT WORKS
1. Turn on delete mode with the trash button in the sidebar, the toolbar icon, or Ctrl+D (⌘D on Mac).
2. Click conversations to select them. Selected rows are tinted with your ChatGPT theme color.
3. Press the delete button. Deleting five or more asks for confirmation first.

FEATURES
• Fast selection: click, drag, Shift+click, Shift+End/Home and Select all
• Works with ChatGPT conversations and Codex tasks
• Deletes a few at a time to stay within rate limits; failed items stay selected so you can retry
• Matches ChatGPT's theme color, light/dark mode and tooltips
• Available in 14 languages and follows ChatGPT's language setting
• Toolbar icon shows whether delete mode is on, off or unavailable

PRIVACY
The extension talks only to chatgpt.com, using your existing login, to delete the items you choose. It has no servers, analytics or tracking, and does not collect or share any data.

PLEASE NOTE
• Deleted conversations can't be restored.
• The extension uses ChatGPT's undocumented web API, which may change.
• This is an unofficial third-party extension. It is not affiliated with, endorsed by or sponsored by OpenAI. ChatGPT and Codex are trademarks of OpenAI.

Source code: https://github.com/nda111/Off-the-Table
```

**Store icon:** `store/icon_128.png`

**Screenshots:** at least one, 1280×800 or 640×400. Hide account names, emails and private chat titles.

**Homepage URL:** https://github.com/nda111/Off-the-Table

**Support URL:** https://github.com/nda111/Off-the-Table/issues

## Privacy practices

**Single purpose:**

```
Select ChatGPT conversations and Codex tasks in the chatgpt.com sidebar and delete them in bulk.
```

**Permission justifications:**

`scripting`

```
Used to add the extension's content script and styles to chatgpt.com tabs that were already open before the extension was installed or updated, so the user doesn't have to reload the page. It only injects files packaged with the extension, only on chatgpt.com.
```

Host permission `https://chatgpt.com/*`

```
Needed to show the selection interface in the ChatGPT sidebar and to send the delete requests for the conversations the user selects. The extension runs only on chatgpt.com and makes requests only to chatgpt.com.
```

**Remote code:** No, I am not using remote code.

```
All JavaScript is included in the package. The extension does not load or evaluate any external code.
```

**Data usage** (check only this one):

- [x] Authentication information

```
The extension reads the user's ChatGPT access token from chatgpt.com's own session endpoint, keeps it in memory only, and sends it only to chatgpt.com to delete the conversations the user selects. It is never stored or sent anywhere else.
```

Certify all three:

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://github.com/nda111/Off-the-Table/blob/main/PRIVACY.md

## Distribution

**Trader status:** Non-trader (free, personal, non-commercial project)

**Visibility:** Public
