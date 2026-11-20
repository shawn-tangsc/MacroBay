[English](./download-and-install.md) | [中文](./download-and-install.zh-CN.md)

# Download and install

This page covers one thing: after you download an installer from the releases page, how to install it and how to open it. No Node.js, no command line.

To run from source or build your own package, see [Installation](./installation.md).

## Pick the right file

Every file is on the [releases page](https://github.com/shawn-tangsc/MacroBay/releases).

- **macOS, Apple silicon** (M1/M2/M3/M4): `MacroBay-arm64.dmg`
- **macOS, Intel**: `MacroBay-x64.dmg`
- **Windows x64**: `MacroBay-x64-setup.exe`
- **Linux**: no installer. Packaging for Linux is not configured yet.

Not sure which chip your Mac has: open the  menu in the top-left corner → About This Mac, and read the **Chip** line.

## macOS: drag it into Applications, then right-click to open

1. Double-click the `.dmg` and drag MacroBay into *Applications*.
2. In *Applications*, **right-click (or Control-click) MacroBay → Open**, then click **Open** in the dialog.

**A plain double-click is blocked by the system**, with a message such as *Apple cannot verify the developer*. The file is not broken; the reason is under "Why you see this prompt" below.

If the menu has no **Open** item (newer macOS versions removed it), open **System Settings → Privacy & Security**, find MacroBay near the bottom of the page, and click **Open Anyway**.

If neither works and the app is reported as damaged, run this once in a terminal:

```bash
xattr -dr com.apple.quarantine /Applications/MacroBay.app
```

Then open it again.

## Windows: the installer goes through SmartScreen

1. Run `MacroBay-x64-setup.exe`.
2. When *Windows protected your PC* appears, click **More info → Run anyway**.

Start it from the Start menu after the install finishes.

## Check that it installed correctly

Three steps, each one you can see for yourself:

1. **The version inside the app.** Open **Settings → About**; the block near the top shows **Current version**, and it must equal the version you downloaded from the releases page. If it says "Unknown", the check did not read a version — do not treat that as a good install.
2. **No failure page on first launch.** A healthy launch goes straight to the main window. If you get the "this page did not load" failure page, quit the app completely (`Command+Q` on macOS) and open it again; if it repeats, open an issue with the log file.
3. **The data directory exists.** macOS: `~/Library/Application Support/MacroBay/`; Windows: `%APPDATA%\MacroBay\`. It contains `platform/agents.sqlite` and `logs/app.log` — the log file only exists once the app has really run.

One optional extra step: configure a model API key, send one conversation and get one reply; that is the check that the bundled agent runtime works too.

## An old copy, or the wrong chip

- **Which macOS build you have**: select MacroBay in *Applications*, press `Command+I`, and read the *Kind* line — "Application (Apple silicon)" or "Application (Intel)". An Intel build on Apple silicon asks for Rosetta; it works but is slower, so prefer the matching download.
- **The version does not match**: quit the app completely, then make sure you launched the copy in *Applications*, not the one still inside the mounted `.dmg`.
- **Installing a new version replaces the old one**, no uninstall needed; app data lives in the data directory and is not touched by installing over it.

## Every update repeats both steps

There is no auto-update: a new version means going back to the releases page, downloading it and installing again. Installing replaces the files, so the macOS quarantine flag and the Windows SmartScreen decision are new every time — **this is not a first-install-only step**.

## About the Intel build

`MacroBay-x64.dmg` is built and published, but **not yet verified on Intel hardware**. If it fails on an Intel machine, please open an issue and say which step you got stuck at and what the error was.

## Why you see this prompt: unsigned and not notarized

Neither platform's installer is **code-signed, and neither is notarized by Apple**. That is the current release state, which is why the system asks you to allow it by hand the first time it sees it. Both prompts come from the release state, not from a requirement of the app itself.

Because nothing is signed, download only from the [releases page](https://github.com/shawn-tangsc/MacroBay/releases).

## After it opens

The first launch asks for a model provider API key — the app ships no keys and no data. Steps are in [First run](./first-run.md) and [Model service](./model-service.md).

Data stays on your own machine, and there is no account to create.
