# public/porcupine/ — Wake Word Model Files

## Place your .ppn file here

1. Go to https://console.picovoice.ai
2. Open your "hey_budy" keyword
3. Click **Download**
4. Select platform: **Browser (WebAssembly)**  ← MUST be this, not macOS
5. Save the file here as: `hey-buddy.ppn`

Final path should be: `public/porcupine/hey-buddy.ppn`

## Why a different .ppn?

Your current file `hey-buddy_en_mac_v4_0_0.ppn` is compiled for macOS native.
Browsers use a WebAssembly runtime — a different binary target.
Both files are trained on the same wake word, just compiled differently.

## Note

This directory (but NOT the .ppn files) is committed to git.
The .ppn files are in .gitignore for size reasons — re-download if needed.
