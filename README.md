# Off the Table for ChatGPT

A Chrome Manifest V3 extension for selecting ChatGPT conversations and deleting them in bulk. Current version: 0.13.3.

## Compatibility and affiliation

- Works in Google Chrome and other Chromium-based browsers (such as Microsoft Edge and Naver Whale).
- This is an unofficial third-party extension. It is not affiliated with, endorsed by or sponsored by OpenAI or ChatGPT. ChatGPT and Codex are trademarks of OpenAI.

## Built with Claude

This extension was developed with the help of [Claude](https://claude.ai), Anthropic's AI assistant.

## Install and update

1. Turn on Developer mode at chrome://extensions.
2. Choose "Load unpacked" and select this folder.
3. Pin the extension icon to the toolbar.
4. After updating the code, press reload on the extension card, then reload the ChatGPT page too.

## Usage

1. The trash button at the top of the ChatGPT sidebar (left of the search button) or the extension icon turns delete mode ON; pressing it again turns it OFF. When OFF, the trash button looks like the other sidebar buttons; when ON, it shows in the theme color. While ON, the search, sidebar toggle, ChatGPT/Codex mode switch and account (profile) buttons are disabled. The detected count starts fresh each time delete mode is turned on and is cleared, along with the selection, when it is turned off. Codex tasks (`/remote/task_…`) can be selected and deleted the same way (delete request: `DELETE /backend-api/wham/tasks/<id>`).
2. When ON, an action bar appears at the top left of the chat area, and selected conversations are shown with a tinted row background. The color is the account's theme (accent) color, read from the page itself, and follows light/dark switches. The action bar uses the same background, text and accent colors. The console log `[cbd] Theme color:` shows which color was picked. Hovering a conversation doesn't show its more/pin buttons. The toolbar icon's cat pose shows the state: a sitting cat is OFF, a swatting cat is ON, and on ChatGPT both are painted in the account's theme color. Tabs other than ChatGPT show a gray sleeping cat. The badge appears only for errors (ERR).
3. The top of the panel shows the number of conversations in the list, such as "10 Chats", and the trash button shows how many are selected. An empty list shows "No chats in the list".
4. There is one select button. With nothing selected it is "Select all"; with one or more selected it immediately becomes "Clear all". Pressing it with a partial selection also clears everything.
5. "Select all" selects every undeleted conversation detected on this page so far, including ones scrolled out of view. Delete them with the trash button (which shows the selected count).
6. Newly loaded conversations are added to the detected count automatically but are not selected. With an existing selection, press "Clear all" and then "Select all" to include the new items.
7. Turning delete mode off clears the selection. While deleting, mode switches and selection changes are blocked. Failed or pending items stay selected.
8. In delete mode, clicking a conversation only toggles its selection instead of opening it. During this time the conversation links' addresses (href) are set aside, so the browser also can't open a new window or tab with Shift/Ctrl/Alt/middle click. The addresses come back when the mode is turned off.
9. Deleted conversations collapse out of the sidebar without a reload. They stay hidden after delete mode is turned off, and are actually gone once ChatGPT reloads the list.

## Shortcuts (delete mode)

Hover or press the `?` button at the top right of the panel to see the list below.

Deleting five or more asks once more inside the panel (Delete or the delete button to proceed, Esc or cancel to go back). Four or fewer are deleted right away.

| Input | Action |
| --- | --- |
| Click | Toggles that conversation's selection as soon as it is pressed |
| Drag | Applies the pressed conversation's new state (selected/cleared) to the whole dragged range. Conversations that leave the range when you drag back return to their previous state. Scrolls automatically at the top and bottom edges of the sidebar |
| Shift+click | Sets everything from the last changed conversation to the clicked one to the same state |
| Ctrl+D (Mac: ⌘D) | Turns delete mode on/off. Works while typing, and replaces the browser's bookmark shortcut on ChatGPT only |
| Shift+End | From the last changed conversation to the end of the list (oldest) |
| Shift+Home | From the last changed conversation to the start of the list |
| Ctrl/Cmd+A | Selects every conversation in the list |
| Esc | Clears the selection if there is one, otherwise leaves delete mode |
| Delete | Deletes the selection (with confirmation) |
| Space / Enter | Toggles the keyboard-focused conversation (Shift+Space for a range) |

- Shortcuts don't work while the cursor is in the input box. Click the sidebar once first.
- When a ChatGPT dialog or menu is open, ChatGPT handles Esc.
- On touch, a tap toggles; there is no drag selection, so it isn't confused with scrolling.
- Drag and Shift+click ranges follow the order currently shown in the sidebar. If the last changed item has scrolled away, they act as a single toggle.

## Languages

The panel, tooltips, confirmation text, result messages and toolbar icon title follow ChatGPT's language setting (`<html lang>`), and a change applies immediately without a reload. Without a value they use the browser language, and an unsupported language shows English. The extension name and store description follow the browser language (`_locales/`).

Supported languages: Korean, English, Japanese, Chinese (Simplified and Traditional), Spanish, Portuguese (Brazil), French, German, Italian, Russian, Indonesian, Vietnamese, Turkish.

All text lives in `i18n.js`. It uses placeholders such as `{n}` and per-language plurals (`Intl.PluralRules`), so word order and forms can differ by language: "대화 10개", "10 Chats", "1 Chat", "5 чатов". To add a language, add an entry to `MESSAGES` and a folder under `_locales/`; `tests/i18n.test.js` checks for missing messages and mismatched placeholders.

## Delete speed and rate limits

- Up to three requests run at once. It is a worker pool: when a slot frees up, the next conversation starts.
- Each worker waits 500 ms between requests. Adjust with DELETE_CONCURRENCY and DELETE_DELAY_MS in content.js.
- On a 429 response, every worker waits together. Retry-After is used first, otherwise exponential backoff.
- Each item is retried at most three times. If limiting continues or a 401/403 occurs, no new requests are started and only the ones in flight are finished.
- This is an unofficial API, so concurrent deletion isn't guaranteed to be safe. The code caps it at 5. Actual limits depend on the server.

## Files

- manifest.json: extension settings and script load order
- background.js: toggling from the icon, connection checks, injection recovery, toolbar icon (per state, in the theme color) and error badge updates
- icons/: the main icon and the toolbar state icons (solid black on transparent, tinted at runtime)
- store/icon_128.png: the icon for the Web Store listing. It follows the store image guideline (96×96 artwork with 16px of transparent padding on each side). The manifest icons fill the whole canvas so they look full-size on the extensions page.
- content.js: sidebar detection, selection UI, authentication and the delete API
- delete-queue.js: concurrent delete queue and rate-limit handling
- i18n.js: per-language messages and plurals
- _locales/: extension name, description and default toolbar title (browser language)
- panel.css: selection colors, delete mode styling, action bar styles
- tests/: tests that don't use the real network. Run `npm install` once, then `npm test` runs them all (uses Node.js and jsdom; the extension itself has no dependencies). If `samples/*.html` (saved ChatGPT pages, not committed) exist, they are checked too.
- package.json: test tooling. Leave package.json, package-lock.json, node_modules/, tests/ and samples/ out of the store zip.

## Troubleshooting

- If nothing responds, reload both the extension and the ChatGPT page. After reloading the extension, the old script left on the page cleans itself up on the next interaction, and pressing the icon injects the new script, which takes over the selection state.
- Real connection errors on ChatGPT show as an ERR badge on the icon and in the tooltip that appears on hover. chrome://extensions, whale://extensions and other sites are unsupported pages and are ignored without exceptions, script injection or an ERR badge.
- If it shows "No chats in the list", open or scroll the sidebar to load the conversation list.
- Conversations for the whole account are not fetched from the API in advance. The detected count is the unique conversations that appeared in the sidebar on this page, and resets on reload.
- /backend-api/* is an unofficial API. Changes to the actual request format will need updates. Try it on test conversations first.

## Whale dual tabs

- Instead of using only the tab ID passed by the extension icon, it checks the active tabs in the same window. If both panes are ChatGPT, the target is corrected using each pane's current focus or its most recent real click, key press or focus.
- Focus history is kept in each page, so it still works after the service worker sleeps and wakes. A reload clears the history, so click the pane you want to use once.
- If there is nothing to tell the two panes apart, or one is another site whose focus history can't be read, it stops instead of acting on the left pane.
- The sidebar trash button applies only to the pane where it is pressed, so it works even if the browser reports the wrong dual-tab target. When the sidebar is closed or there is no sidebar header, as on the settings page, use the extension icon to toggle.
- The real Whale dual-tab environment needs separate checking. After updating, reload the extension and the ChatGPT pages in both dual-tab panes.
