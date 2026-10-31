# Dropbeam

Send files from your Windows PC to your phone over the same local network. Choose files, make a QR code, then scan it with your phone to download.

## Run

Double-click `dist/Dropbeam.exe`. No installation or Node.js required. Keep its console open during transfers; press **Enter** to stop.

Files stay on your network. Transfers use temporary local copies (up to 20 GB per file), and links expire after 30 minutes. Use trusted Wi-Fi: transfers use unencrypted HTTP.

On iPhone, downloads go to the **Files** app. If your phone cannot connect, check the network selector and Windows Firewall.

## Develop

Requires Node.js 22+ (24 for building the Windows executable).

```sh
npm ci
npm start
npm test
npm run build:exe
```

Verify the standalone executable with `node scripts/verify-exe.mjs`.

Built with AI assistance.
