# Chrome Web Store submission

Prepared for Framehush on 2026-10-20. Review the dashboard's live validation before submission; a successful upload is not approval or publication.

## Package and listing

- Upload a ZIP whose root contains the built `manifest.json`, extension files, locale files, icons, and bundled RNNoise assets.
- Use `listing-en.md`, `listing-zh-TW.md`, and `listing-zh-CN.md` for the corresponding supported locales.
- Pick the closest available category for an audio utility (for example, Tools if the dashboard offers it).
- Homepage: `https://github.com/ycchuang99/framehush`
- Support URL: `https://github.com/ycchuang99/framehush/issues`
- Privacy policy URL: `https://github.com/ycchuang99/framehush/blob/main/docs/privacy-policy.md`
- Verify all URLs are publicly accessible after pushing, with no sign-in required.

The [listing guide](https://developer.chrome.com/docs/webstore/cws-dashboard-listing) describes descriptions, category, language, and localized listings.

## Images

| Asset | File or requirement |
| --- | --- |
| Extension and listing icon | `assets/icon-128.png`, 128 × 128 PNG; the central 96 × 96 artwork has transparent margins. Also bundled in `src/icons/` and declared in `manifest.icons`. |
| Additional extension icons | `assets/icon-16.png`, `assets/icon-32.png`, `assets/icon-48.png`; also bundled in `src/icons/` with matching manifest entries. |
| Small promotional tile | `assets/small-promo-440x280.png`, 440 × 280 RGB PNG. |
| Screenshot | `assets/screenshot-1280x800.png`, 1280 × 800 RGB PNG, showing the final English popup during actual audio processing. |
| Marquee | Optional, 1400 × 560. |

The [image guide](https://developer.chrome.com/docs/webstore/images) explicitly identifies the icon, small promotional image, and at least one screenshot as mandatory. A promotional video is not among that guide's minimum assets; confirm the current dashboard if its fields differ.

The screenshot is captured from `screenshot.html`. Its popup image, `assets/popup-running.png`, is an unmodified capture from the passing browser test, displayed at 1.5× size. The surrounding HTML provides the brand and feature description; it does not replace or reconstruct the extension UI.

## Privacy practices: copy-ready fields

### Single purpose

Reduce background noise in speech from a user-selected Chrome tab by processing its playback audio locally on the user's device.

### activeTab justification

When the user invokes Framehush and enables noise reduction, activeTab grants access to the selected tab for the user-requested capture. The extension uses the tab's numeric ID to request its audio stream. It does not read the page DOM, URL, title, or browsing history.

### tabCapture justification

Framehush needs the selected tab's audio stream to apply local speech noise reduction and play the processed audio back to the user. Capture starts only when the user chooses Enable denoising and stops when the user chooses Stop denoising or the captured tab closes. No video or microphone capture is requested.

### offscreen justification

The offscreen document hosts the AudioContext, AudioWorklet, and bundled RNNoise model. It keeps the user-enabled audio processing running when the popup is closed, because the service worker cannot host these audio processing APIs.

### Remote code

Select **No, I am not using remote code**.

All JavaScript, WebAssembly, and noise-reduction model data are bundled in the submitted extension. The WebAssembly runtime executes locally; no executable code is downloaded.

### User data

Disclose **Website content**, because the extension accesses and processes the selected tab's audio (sounds). Explain the local handling as follows wherever the dashboard permits a description:

> Framehush accesses the selected tab's playback audio only after the user enables noise reduction. Audio is processed in temporary memory buffers on the user's device and played back locally. It is not recorded, uploaded, transcribed, retained, shared, sold, or used for model training. The extension has no analytics, advertising, remote audio service, or developer access to the audio.

The numeric tab ID and temporary status are used only to control the active session. No browsing history, URLs, page text, authentication information, payment information, or location is separately read or stored. Audio can contain conversations or other personal information; the privacy policy discloses that possibility. Match any additional categories required by the live dashboard's definitions to this actual behavior.

Complete the dashboard's Limited Use certifications consistently with the policy: no sale or unrelated transfer, no use unrelated to the single purpose, and no use for creditworthiness or lending.

**Do not declare that the extension handles no user data solely because processing is local.** Google's [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) explicitly requires disclosure of local processing. The [privacy fields guide](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) covers permission justifications, remote code, data categories, certifications, and the privacy-policy URL.

## Reviewer testing notes

No login or subscription is required.

1. Use Chrome 116 or later and open an ordinary web page that plays spoken audio.
2. Start playback and open Framehush from the extension action.
3. Choose Enable denoising. The popup shows that noise reduction is running.
4. Close the popup. Processing continues.
5. Open Framehush again and choose Stop denoising. Tab capture ends.
6. The extension can process audio without an internet connection once the page's audio is available; the model is bundled.

For language testing, Chrome's interface language selects English, Traditional Chinese, or Simplified Chinese, with English used for unsupported languages. There is no account-based language setting.

## Account and publication dependencies

The publisher must be signed into a registered Chrome Web Store developer account. If enrollment, a registration payment, identity/contact verification, or account security setup is required, the account owner must complete it. [Account registration](https://developer.chrome.com/docs/webstore/register) and [publication steps](https://developer.chrome.com/docs/webstore/publish) describe the process.

Save the listing, privacy information, and distribution settings. Submit the completed item for review. Record the item ID and review status; do not describe a pending review as published.
