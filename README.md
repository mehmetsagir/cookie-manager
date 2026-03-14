# Cookie Manager

A Chrome extension to view, search, copy, export, delete and transfer cookies between tabs.

![Cookie Manager Screenshot](https://raw.githubusercontent.com/mehmetsagir/cookie-manager/main/icons/icon128.png)

## Features

- View all cookies for any website with detailed information
- Search and filter cookies by name, value, or domain
- Copy individual cookie values or all cookies as JSON
- Export cookies in multiple formats: JSON, Netscape, Header String, Key-Value Pairs
- Delete individual cookies, selected cookies, or clear all at once
- Transfer cookies between browser tabs
- Dark and light mode support

## Installation

### From Chrome Web Store

*Coming soon*

### Manual Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/mehmetsagir/cookie-manager.git
   ```
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked**
5. Select the cloned `cookie-manager` folder

## Usage

1. Click the Cookie Manager icon in your toolbar
2. View all cookies for the current tab
3. Use the search bar to filter cookies
4. Select cookies and use the toolbar to copy, export, or delete
5. Use the Transfer section to move cookies between tabs

## Export Formats

| Format | Description |
|--------|-------------|
| JSON | Full cookie objects as JSON array |
| Netscape | Netscape/Mozilla cookie file format |
| Header | `Cookie:` HTTP header string |
| Pairs | Simple `name=value` pairs |

## License

[MIT](LICENSE)
