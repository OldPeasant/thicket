# Running Thicket on a locked-down Windows laptop

Use this guide on a company Windows laptop where you have no administrator rights and aren't sure
which programs you may run. Try the approaches in order: each one is a bit more work than the one
before, and each needs less than the one before it to be allowed.

Thicket is a desktop (Electron) app, so every approach starts a program: `Thicket.exe` in 1 and 2,
`node.exe` and `electron.exe` in 3. What differs is where that program comes from and whether your
company's rules let it start. None of the approaches needs administrator rights.

| # | Approach | Needs | Effort |
|---|---|---|---|
| 1 | [Portable zip](#1-portable-zip) | starting an unsigned or signed `.exe` from your user folder | 2 min |
| 2 | [Installer, "only for me"](#2-installer-only-for-me) | the same, plus running an installer | 3 min |
| 3 | [From source with Node.js](#3-from-source-with-nodejs) | Node.js 24 (you use it for Angular already), npm downloads | 15 min |
| 4 | [Browser mode](#4-if-nothing-works-browser-mode) | Node.js only, not built yet | - |

[What the error messages mean](#what-the-error-messages-mean) helps you tell a warning you may click
through from a block only IT can lift.

## 0. Get a build (once, on your own computer)

There's no Thicket release on GitHub yet, so approaches 1 and 2 need one first. On your own
computer, in the repo:

```sh
git pull
git tag v0.1.0-rc.1
git push origin v0.1.0-rc.1
```

The `release` workflow builds all installers (about 15 min, see the repo's **Actions** tab) and
creates a **draft** release. Drafts are only visible to you while logged in to GitHub. To download
on the work laptop without logging in, open the draft under **Releases**, check **Set as a
pre-release** and click **Publish release**.

## 1. Portable zip

1. On the work laptop, open <https://github.com/OldPeasant/thicket/releases> and download
   `thicket-<version>-win-x64.zip` and `SHA256SUMS.txt`.
2. Check the download in PowerShell. The hash must match the zip's line in `SHA256SUMS.txt`:
   ```powershell
   Get-FileHash $HOME\Downloads\thicket-*-win-x64.zip
   ```
3. Unblock the zip so Windows doesn't warn about every file in it. Right-click → **Properties** →
   check **Unblock** → **OK**, or in PowerShell:
   ```powershell
   Unblock-File $HOME\Downloads\thicket-*-win-x64.zip
   ```
4. Unpack it to a folder of your own, e.g. `%LOCALAPPDATA%\Programs\Thicket`, and start
   `Thicket.exe`.
5. If SmartScreen says "Windows protected your PC": click **More info** → **Run anyway**. That's
   allowed: it is a warning, not a block.

If it's blocked (see [the messages](#what-the-error-messages-mean)), try other folders you can
write to: some rules only block `Downloads` or `Temp`. For example `C:\Users\<you>\Thicket` or,
if your laptop has one, `D:\`. If every folder is blocked, go on to 3; approach 2 would hit the
same rule.

## 2. Installer, "only for me"

1. Download `thicket-<version>-win-x64.exe`, check its hash as in step 1.2.
2. Start it. On SmartScreen: **More info** → **Run anyway**.
3. Choose **Only for me**: it installs to `%LOCALAPPDATA%\Programs\Thicket` without
   administrator rights. **Anyone who uses this computer** would ask for an administrator.
4. Start Thicket from the Start menu.

## 3. From source with Node.js

Here the app runs under Node.js and npm, which you already use for Angular. npm downloads
Electron's `electron.exe` into the project folder. If 1 failed because of a rule that allows only
known publishers or only certain folders, this one may hit the same rule, but it often works on
developer laptops, because they allow what Angular builds need.

### 3.1 Node.js 24

Open PowerShell and check the version:

```powershell
node -v
```

Thicket needs **24.15 or newer** (but below 25). If yours is older, use a portable Node without
installing it:

1. On <https://nodejs.org/en/download>, download the **Windows x64 .zip** (not the `.msi`) of the
   latest 24.x.
2. Unpack it to e.g. `%LOCALAPPDATA%\node24`.
3. Use it in this PowerShell window only (your normal Node stays as it is):
   ```powershell
   $env:Path = "$env:LOCALAPPDATA\node24\node-v24.15.0-win-x64;$env:Path"   # adjust to the folder name
   node -v
   ```

### 3.2 Get the source

With git: `git clone https://github.com/OldPeasant/thicket.git`. Without git: on the GitHub page,
**Code** → **Download ZIP**, then unblock and unpack it as in step 1.3.

### 3.3 Install and start

```powershell
cd thicket
npm ci
npm run start
```

`npm ci` takes a few minutes. `npm run start` builds the app and opens the window. Next time,
only `npm run start` is needed.

### 3.4 If `npm ci` fails

| Error mentions | Fix |
|---|---|
| `ETIMEDOUT`, `ECONNREFUSED`, proxy | Set your company proxy (ask colleagues or check your Angular setup's `.npmrc`): `$env:HTTPS_PROXY = "http://proxy.example:8080"`, also `npm config set proxy …` and `npm config set https-proxy …`, then run `npm ci` again. |
| `self-signed certificate in certificate chain`, `UNABLE_TO_GET_ISSUER_CERT` | Your company inspects HTTPS. Export the company root certificate as a Base-64 `.cer`/`.pem` file (ask colleagues; Angular developers usually have it) and run `$env:NODE_EXTRA_CA_CERTS = "C:\path\company-root.pem"` and `npm config set cafile "C:\path\company-root.pem"`. |
| `electron` and `download` or `postinstall` | Electron's binary is downloaded from GitHub. Same proxy/certificate fixes; with a proxy, also `$env:ELECTRON_GET_USE_PROXY = "true"`. |
| `gyp`, `node-gyp`, `Visual Studio`, `MSBuild` | A native module found no prebuilt binary and tried to compile. That needs Visual Studio Build Tools, which you can't install without administrator rights. Send me the log (`npm ci > npm-ci.log 2>&1`). |

If `npm run start` fails because `electron.exe` is blocked, 3 doesn't work on this laptop either.

## 4. If nothing works: browser mode

A mode in which Thicket runs as a local web server under Node.js and you use it in your browser
would need only `node.exe`, which you're allowed to run. It doesn't exist yet. If approaches 1 to
3 all fail, it is the remaining route: tell the maintainer (or the planning agent) to add it.

## What the error messages mean

| You see | Meaning | What to do |
|---|---|---|
| "Windows protected your PC" with **More info** → **Run anyway** | SmartScreen: the app is new or unsigned | Click through. It's a warning. |
| "Windows protected your PC" without a **Run anyway** button | SmartScreen set to block by your company | Try 3, or ask IT. |
| "This app has been blocked by your system administrator" | AppLocker | Try another folder (step 1), then 3, then ask IT. |
| "Your organization used App Control / Device Guard to block this app" | WDAC (App Control for Business) | Try 3, then ask IT. Often only signed apps are allowed. |
| The file disappears or Defender reports a threat | Antivirus quarantine, typical for new unsigned files | Ask IT. Don't disable Defender. |
| Nothing happens at all | Often a silent block | In **Event Viewer** → *Applications and Services Logs* → *Microsoft* → *Windows* → **AppLocker** or **CodeIntegrity**, look for an entry at the time you started it. |

Optionally, PowerShell can often show the AppLocker rules for your user (if it says no policy or
access denied, AppLocker isn't the problem, or you can't see it):

```powershell
Get-AppLockerPolicy -Effective | Select-Object -ExpandProperty RuleCollections
```

## Asking IT

If you have to ask IT to allow Thicket, these facts help:

- Open source desktop client for MongoDB, Apache-2.0 licence, source at
  <https://github.com/OldPeasant/thicket>. Built in public by GitHub Actions from that source;
  each release has SHA-256 checksums.
- From the first signed release on, `Thicket.exe` and the installer are code-signed, publisher
  **SignPath Foundation** (a free signing service for open source projects). A publisher rule for
  it is the cleanest way to allow it.
- Installs per user, needs no administrator rights, sends no telemetry, connects only to the
  database servers you configure (and, once the update notice exists, to GitHub to check for new
  versions). Data lives in `%APPDATA%\Thicket`; saved passwords are
  encrypted for your Windows account (DPAPI).
