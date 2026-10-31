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
3. Press the delete button. Deleting five or more asks for confirmation first. Press it again (or Esc) to stop.

FEATURES
• Fast selection: click, drag, Shift+click, Shift+End/Home and Select all
• Works with ChatGPT conversations and Codex tasks
• Deletes a few at a time to stay within rate limits; failed items stay selected so you can retry
• Matches ChatGPT's theme color, light/dark mode and tooltips
• Available in 14 languages and follows ChatGPT's language setting
• Toolbar icon shows whether delete mode is on, off or unavailable
• A short on-page intro on first install; right-click the toolbar icon and choose Help to see it again

PRIVACY
The extension talks only to chatgpt.com, using your existing login, to delete the items you choose. It has no servers, analytics or tracking, and does not collect or share any data.

PLEASE NOTE
• Deleted conversations can't be restored.
• The extension uses ChatGPT's undocumented web API, which may change.
• This is an unofficial third-party extension. It is not affiliated with, endorsed by or sponsored by OpenAI. ChatGPT and Codex are trademarks of OpenAI.

Source code: https://github.com/nda111/Off-the-Table
```

**Description, Korean** (add 한국어 in the listing's language menu; the summary comes from `_locales/ko`):

```
ChatGPT 사이드바를 몇 초 만에 정리하세요. Off the Table은 사이드바에서 바로 대화와 Codex 작업을 골라 한 번에 삭제할 수 있게 해 줍니다. 유료 일괄 삭제 확장 프로그램을 대신할 수 있는 무료 오픈소스 확장입니다.

사용 방법
1. 사이드바의 휴지통 버튼, 툴바 아이콘 또는 Ctrl+D(Mac은 ⌘D)로 삭제 모드를 켭니다.
2. 대화를 클릭해 선택합니다. 선택한 대화는 ChatGPT 테마 색으로 표시됩니다.
3. 삭제 버튼을 누릅니다. 5개 이상 삭제할 때는 먼저 확인을 받습니다. 삭제 중에 버튼을 다시 누르거나 Esc를 누르면 멈춥니다.

기능
• 빠른 선택: 클릭, 드래그, Shift+클릭, Shift+End/Home, 전체 선택
• ChatGPT 대화와 Codex 작업 모두 지원
• 요청 제한에 걸리지 않도록 몇 개씩 나눠 삭제하고, 실패한 항목은 선택된 채로 남아 다시 시도할 수 있음
• ChatGPT의 테마 색, 라이트/다크 모드, 툴팁 모양에 맞춰 표시
• 14개 언어 지원, ChatGPT 언어 설정을 그대로 따름
• 툴바 아이콘으로 삭제 모드가 켜졌는지, 꺼졌는지, 사용할 수 없는지 표시
• 처음 설치하면 화면에서 사용법을 짧게 안내하고, 툴바 아이콘을 우클릭해 도움말을 누르면 다시 볼 수 있음

개인정보
이 확장은 기존 로그인 정보를 사용해 chatgpt.com과만 통신하며, 선택한 항목을 삭제하는 데에만 씁니다. 서버, 분석 도구, 추적 기능이 없고 어떤 데이터도 수집하거나 공유하지 않습니다.

참고
• 삭제한 대화는 되돌릴 수 없습니다.
• ChatGPT의 공개되지 않은 웹 API를 사용하므로 동작이 바뀔 수 있습니다.
• OpenAI와 관계가 없는 비공식 서드파티 확장입니다. OpenAI의 제휴, 보증, 후원을 받지 않았습니다. ChatGPT와 Codex는 OpenAI의 상표입니다.

소스 코드: https://github.com/nda111/Off-the-Table
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

`contextMenus`

```
Adds one item, "Help", to the menu shown when the user right-clicks the extension's toolbar icon. It replays the short on-page introduction on chatgpt.com. No other menus are added.
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
