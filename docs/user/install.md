# Installing Thicket

Thicket is published on the [GitHub releases page](https://github.com/OldPeasant/thicket/releases).
Each release lists the installers for every system and a `SHA256SUMS.txt` file with their
checksums. In the file names below, `<version>` is the release version without the `v`, for example
`1.2.0`.

The macOS builds are **not code-signed yet** (no Apple Developer ID), so macOS warns the first
time you open Thicket. Windows builds are signed from the first signed release on (publisher
"SignPath Foundation", see [code signing](../CODE_SIGNING.md)); older Windows releases are
unsigned, and Windows warns about them. The steps for each system below show how to open it
anyway. Only do this for files downloaded from the official releases page whose checksum matches.

- [Check the download](#check-the-download)
- [Linux](#linux): [AppImage](#appimage-any-distribution), [Debian and Ubuntu](#debian-and-ubuntu-deb),
  [Fedora, RHEL and openSUSE](#fedora-rhel-and-opensuse-rpm), [Keyring](#keyring-for-saved-passwords)
- [macOS](#macos) and the [Gatekeeper warning](#gatekeeper-warning)
- [Windows](#windows) and the [SmartScreen warning](#smartscreen-warning)
- [Where Thicket stores its data](#where-thicket-stores-its-data)
- [Uninstall](#uninstall)

## Check the download

Download `SHA256SUMS.txt` into the same folder as the installer, then run:

| System | Command | Expected |
| --- | --- | --- |
| Linux | `sha256sum --check --ignore-missing SHA256SUMS.txt` | `thicket-…: OK` |
| macOS | `shasum -a 256 --check --ignore-missing SHA256SUMS.txt` | `thicket-…: OK` |
| Windows (PowerShell) | `Get-FileHash .\thicket-<version>-win-x64.exe` | the same hash as in `SHA256SUMS.txt` |

## Linux

Builds are available for x64 and arm64.

| Package | x64 | arm64 |
| --- | --- | --- |
| AppImage | `thicket-<version>-linux-x86_64.AppImage` | `thicket-<version>-linux-arm64.AppImage` |
| Debian/Ubuntu | `thicket-<version>-linux-amd64.deb` | `thicket-<version>-linux-arm64.deb` |
| Fedora/RHEL/openSUSE | `thicket-<version>-linux-x86_64.rpm` | `thicket-<version>-linux-aarch64.rpm` |

### AppImage (any distribution)

The AppImage needs no installation and no root rights.

1. Download `thicket-<version>-linux-x86_64.AppImage` (or the arm64 file) and `SHA256SUMS.txt`.
2. Check it: `sha256sum --check --ignore-missing SHA256SUMS.txt`.
3. Make it executable: `chmod +x thicket-<version>-linux-x86_64.AppImage`. In a file manager you
   can do the same under Properties → Permissions → "Allow executing file as program".
4. Start it: `./thicket-<version>-linux-x86_64.AppImage`, or double-click it. The welcome screen
   offers **New connection** and **Import from Compass**.

If the AppImage doesn't start:

- **"dlopen(): error loading libfuse.so.2"**: AppImages need FUSE 2. Install it
  (`sudo apt install libfuse2t64` on Ubuntu 24.04 and newer, `sudo apt install libfuse2` on older
  Debian/Ubuntu, `sudo dnf install fuse-libs` on Fedora). You can also skip FUSE with
  `./thicket-<version>-linux-x86_64.AppImage --appimage-extract-and-run`.
- **"The SUID sandbox helper binary was found, but is not configured correctly"** (Ubuntu 24.04 and
  newer, which restrict unprivileged user namespaces with AppArmor): use the `.deb` package
  instead, which sets up the sandbox correctly.

To get a menu entry for the AppImage, use a tool such as
[Gear Lever](https://github.com/mijorus/gearlever) or
[AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher), or use the `.deb`/`.rpm`
package.

### Debian and Ubuntu (`.deb`)

```sh
sudo apt install ./thicket-<version>-linux-amd64.deb
```

Thicket then appears in the application menu. You can also start it with `thicket` in a terminal.

### Fedora, RHEL and openSUSE (`.rpm`)

```sh
sudo dnf install ./thicket-<version>-linux-x86_64.rpm      # Fedora, RHEL
sudo zypper install ./thicket-<version>-linux-x86_64.rpm   # openSUSE
```

### Keyring for saved passwords

Thicket keeps passwords, key passphrases and tokens in the system keyring (GNOME Keyring or KWallet
through libsecret). Most desktops have one running. Without a keyring, Electron could only store
secrets with a fixed key, so Thicket shows a warning and by default does not save passwords; it asks
for them each time you connect. To get a keyring, install
`gnome-keyring` (or KWallet on KDE) and sign in to your desktop again.

## macOS

There are two disk images: `thicket-<version>-mac-arm64.dmg` for Apple Silicon (M1 and newer) and
`thicket-<version>-mac-x64.dmg` for Intel Macs. To see which Mac you have, open the Apple menu →
About This Mac → "Chip" (Apple M…) or "Processor" (Intel).

1. Download the `.dmg` and `SHA256SUMS.txt`, and check them:
   `shasum -a 256 --check --ignore-missing SHA256SUMS.txt`.
2. Open the `.dmg` and drag **Thicket** into **Applications**.
3. Start Thicket from Applications. Because the app is not signed with an Apple Developer ID, macOS
   blocks it the first time; see below.

### Gatekeeper warning

The first start shows "“Thicket” cannot be opened because Apple cannot check it for malicious
software" (or "Apple could not verify “Thicket” is free of malware"). Click **Done** (or **OK**),
not **Move to Trash**. Then:

1. Open **System Settings → Privacy & Security**.
2. Scroll down to **Security**. Next to "“Thicket” was blocked to protect your Mac", click
   **Open Anyway**.
3. Confirm with **Open Anyway** and enter your password if asked.

macOS remembers this choice; later starts show no warning. On macOS 14 (Sonoma) and older you can
instead Control-click Thicket in Applications, choose **Open**, and confirm with **Open**.

If you prefer the terminal, remove the quarantine flag that the browser set on the download:

```sh
xattr -dr com.apple.quarantine /Applications/Thicket.app
```

If macOS says the app "is damaged and can't be opened", the download was incomplete or changed:
check the checksum and download it again.

## Windows

Two downloads are available for Windows x64:

- `thicket-<version>-win-x64.exe`: an installer. It asks whether to install for you only (no
  administrator rights needed) or for all users, lets you choose the folder, and adds Start menu
  and desktop shortcuts.
- `thicket-<version>-win-x64.zip`: a portable version. Unpack it anywhere and run `Thicket.exe`.

### SmartScreen warning

Signed releases show the publisher "SignPath Foundation" in the Windows prompts (check it under
*Properties* → *Digital Signatures*). For releases from before signing started, and sometimes for
a newly signed release that has not yet built up download reputation, Microsoft Defender
SmartScreen shows "Windows protected your PC" when you start the installer:

1. Click **More info**.
2. Check that the app is the `thicket-<version>-win-x64.exe` you downloaded, then click
   **Run anyway**.

For the portable `.zip`, first unblock it so that Windows doesn't warn about every file in it:
right-click the `.zip` → **Properties** → check **Unblock** → **OK**, then unpack it. In PowerShell:
`Unblock-File .\thicket-<version>-win-x64.zip`.

If your organization manages SmartScreen or uses Smart App Control, you may not see **Run anyway**.
In that case ask your administrator, or build Thicket from source (see the
[README](../../README.md#build-from-source)).

## Where Thicket stores its data

Connection profiles (`connections.json`, without secrets), encrypted secrets (`secrets.bin`),
settings, saved queries and pipelines, and SSH `known_hosts` are stored in:

| System | Folder |
| --- | --- |
| Linux | `~/.config/Thicket` (or `$XDG_CONFIG_HOME/Thicket`) |
| macOS | `~/Library/Application Support/Thicket` |
| Windows | `%APPDATA%\Thicket` |

`secrets.bin` can only be decrypted by your user account on the same computer. Copying it to another
machine does not carry the passwords over. To move your connections, use **Import and export
connections** → **Export**; it writes the profiles without their secrets.

## Uninstall

- **AppImage**: delete the `.AppImage` file.
- **Debian/Ubuntu**: `sudo apt remove thicket`.
- **Fedora/RHEL**: `sudo dnf remove thicket`; **openSUSE**: `sudo zypper remove thicket`.
- **macOS**: move `/Applications/Thicket.app` to the Trash.
- **Windows**: Settings → Apps → Installed apps → **Thicket** → Uninstall. For the portable
  version, delete its folder.

Uninstalling keeps your connections and settings. To remove them too, delete the data folder listed
above.
