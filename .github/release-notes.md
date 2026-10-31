Select text on any web page and get an answer from Claude, using your own Anthropic API key.

{{CHANGES}}
## Install in Microsoft Edge

1. Under **Assets** below, download **answerkey-edge-{{VERSION}}.zip**. (Not "Source code": that's the code, not the extension.)
2. Extract it to a folder you'll keep, for example `Documents\AnswerKey`: right-click the zip, choose **Extract All…**, and pick the folder. Edge runs the extension from this folder, so don't delete or move it.
3. Open `edge://extensions` and turn on **Developer mode**.
4. Click **Load unpacked** and select the extracted folder (the one that contains `manifest.json`).
5. AnswerKey's settings page opens. Paste your Anthropic API key and click **Save key**. You can create a key in the [Claude Console](https://platform.claude.com/settings/keys).
6. Reload any tabs that were already open. Then select text on a page and click **Ask Claude**, right-click it and choose **Ask Claude**, or press **Alt+Shift+K**.

It also works in Google Chrome and other Chromium browsers: open `chrome://extensions` in step 3.

## Updating from an earlier version

Extract the new zip into the same folder, replacing the old files, then click the reload button on the AnswerKey card in `edge://extensions`. Your API key and settings are kept. (Loading it from a different folder installs a separate copy, and you'd have to enter your key again.)

## Good to know

- Edge may warn you about extensions in developer mode when it starts. That's expected for extensions installed this way; keep developer mode on to keep using AnswerKey.
- Questions are billed to your Anthropic account at API prices.
- Your API key is stored only in your browser and is sent only to `api.anthropic.com`. See [Privacy and security]({{REPO_URL}}#privacy-and-security) in the README.
- To verify the download, compare its SHA-256 hash with `SHA256SUMS.txt`.
