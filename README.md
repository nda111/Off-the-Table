<p align="center">
  <img src="icons/icon_128.png" width="128" height="128" alt="Off the Table logo">
</p>

<h1 align="center">Off the Table for ChatGPT</h1>

<p align="center">Select ChatGPT conversations and Codex tasks right in the sidebar, then delete them all at once.<br>
  A free, open-source alternative to paid bulk-delete extensions.</p>

## Compatibility and affiliation

- Works in Google Chrome and other Chromium-based browsers (such as Microsoft Edge and Naver Whale).
- This is an unofficial third-party extension. It is not affiliated with, endorsed by or sponsored by OpenAI or ChatGPT. ChatGPT and Codex are trademarks of OpenAI.
- It was made for personal use and is shared as is, without any warranty.

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
3. Press the trash button in the panel to delete the selection. The button shows how many are selected. While deleting, it turns into a stop button; press it (or Esc) to stop. Chats that weren't deleted yet stay selected.
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
| Esc | Stop deleting; otherwise clear the selection, or leave delete mode if nothing is selected |
| Space / Enter | Select or clear the focused conversation |
| Ctrl+D (Mac: ⌘D) | Turn delete mode on or off |

Shortcuts other than Ctrl+D don't work while you are typing in the message box; click the sidebar first.

## Languages

The extension follows ChatGPT's language setting and switches as soon as you change it. Other languages show English.

| Language | Native name | Code |
| --- | --- | --- |
| English | English | `en` |
| Korean | 한국어 | `ko` |
| Japanese | 日本語 | `ja` |
| Chinese (Simplified) | 简体中文 | `zh-CN` |
| Chinese (Traditional) | 繁體中文 | `zh-TW` |
| Spanish | Español | `es` |
| Portuguese (Brazil) | Português (Brasil) | `pt-BR` |
| French | Français | `fr` |
| German | Deutsch | `de` |
| Italian | Italiano | `it` |
| Russian | Русский | `ru` |
| Indonesian | Bahasa Indonesia | `id` |
| Vietnamese | Tiếng Việt | `vi` |
| Turkish | Türkçe | `tr` |

## Privacy

The extension talks only to chatgpt.com, using your existing login, to delete the conversations you choose. It doesn't collect, store or send your data anywhere else. See the [privacy policy](PRIVACY.md).

## Good to know

- Deletion uses ChatGPT's own web API, which isn't officially documented and may change. Try it on a few test conversations first.
- Conversations are deleted a few at a time to stay within ChatGPT's rate limits, so large selections take a moment. Any that fail stay selected so you can try again.
- If nothing happens, reload the extension and the ChatGPT page.
- In Whale's dual-tab view, use the sidebar trash button in the pane you want, or click that pane once before using the toolbar icon.

## Development

Run `npm install` once, then `npm test`. Leave `package.json`, `package-lock.json`, `node_modules/` and `tests/` out of the store zip, and upload `store/icon_128.png` as the store icon.

## License

```
MIT License

Copyright (c) 2026 Yu Geunhyeok

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
