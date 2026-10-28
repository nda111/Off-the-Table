# Off the Table for ChatGPT

Select ChatGPT conversations and Codex tasks right in the sidebar, then delete them all at once.

## Compatibility and affiliation

- Works in Google Chrome and other Chromium-based browsers (such as Microsoft Edge and Naver Whale).
- This is an unofficial third-party extension. It is not affiliated with, endorsed by or sponsored by OpenAI or ChatGPT. ChatGPT and Codex are trademarks of OpenAI.

## Built with Claude

This extension was developed with the help of [Claude](https://claude.ai), Anthropic's AI assistant.

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose this folder.
3. Pin the extension to the toolbar.
4. Reload any ChatGPT tabs that were already open.

To update, replace the folder, press reload on the extension card, and reload ChatGPT.

## How to use

1. Turn on delete mode with the trash button at the top of the ChatGPT sidebar, the toolbar icon, or **Ctrl+D** (Mac: **⌘D**).
2. Click conversations to select them. Selected rows are tinted with your ChatGPT theme color.
3. Press the trash button in the panel to delete the selection. The button shows how many are selected.
4. Turn delete mode off the same way you turned it on. The selection is cleared.

- The panel shows how many conversations were found, such as "10 Chats". **Select all** picks every conversation loaded in the sidebar, including ones scrolled out of view. Scroll the sidebar to load older ones.
- Deleting five or more asks for confirmation first. **Deleted conversations can't be restored.**
- While delete mode is on, clicking a conversation selects it instead of opening it, and the search, sidebar toggle, mode switch and account buttons are disabled.
- Codex tasks can be selected and deleted the same way.

### Toolbar icon

The cat on the toolbar shows the state: sitting means delete mode is off, swatting means it is on, and a gray sleeping cat means the tab isn't ChatGPT. A red **ERR** badge means something went wrong; hover the icon to see the message.

## Shortcuts

Hover the `?` button in the panel to see these at any time.

| Input | Action |
| --- | --- |
| Click | Select or clear a conversation |
| Drag | Select or clear every conversation you drag over |
| Shift+click | Select or clear a range from the last conversation you changed |
| Shift+End / Shift+Home | Extend from the last conversation you changed to the end / start of the list |
| Ctrl+A (Mac: ⌘A) | Select all |
| Delete | Delete the selection |
| Esc | Clear the selection, or leave delete mode if nothing is selected |
| Space / Enter | Select or clear the focused conversation |
| Ctrl+D (Mac: ⌘D) | Turn delete mode on or off |

Shortcuts other than Ctrl+D don't work while you are typing in the message box; click the sidebar first.

## Languages

The extension follows ChatGPT's language setting and switches as soon as you change it. Supported: English, Korean, Japanese, Chinese (Simplified and Traditional), Spanish, Portuguese (Brazil), French, German, Italian, Russian, Indonesian, Vietnamese and Turkish. Other languages show English.

## Privacy

The extension talks only to chatgpt.com, using your existing login, to delete the conversations you choose. It doesn't collect, store or send your data anywhere else.

## Good to know

- Deletion uses ChatGPT's own web API, which isn't officially documented and may change. Try it on a few test conversations first.
- Conversations are deleted a few at a time to stay within ChatGPT's rate limits, so large selections take a moment. Any that fail stay selected so you can try again.
- If nothing happens, reload the extension and the ChatGPT page.
- In Whale's dual-tab view, use the sidebar trash button in the pane you want, or click that pane once before using the toolbar icon.

## Development

Run `npm install` once, then `npm test`. Leave `package.json`, `package-lock.json`, `node_modules/`, `tests/` and `samples/` out of the store zip, and upload `store/icon_128.png` as the store icon.
