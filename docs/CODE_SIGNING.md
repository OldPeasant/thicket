# Code signing

Thicket's Windows releases are signed through the [SignPath Foundation](https://signpath.org)
open source programme. The first part of this page is the code signing policy the programme
requires; the second part is the one-time setup a maintainer does in SignPath and GitHub; the
third explains how the release workflow signs.

macOS and Linux builds are not covered here: they stay unsigned (macOS: ad-hoc signed, see
[the install guide](user/install.md)).

## Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by
[SignPath Foundation](https://signpath.org).

### What is signed

Only release builds of Thicket made from this repository
([OldPeasant/thicket](https://github.com/OldPeasant/thicket)) by its GitHub Actions release
workflow ([`.github/workflows/release.yml`](../.github/workflows/release.yml)), from a `v*` tag:

- `Thicket.exe`, the application, in the portable zip and inside the installer;
- `thicket-<version>-win-x64.exe`, the NSIS installer.

Nothing built on a developer's machine, in a fork or from a pull request is signed. Third-party
files that ship with the app (the Electron runtime's DLLs and other binaries) are not signed with
the Thicket certificate.

### Team roles

| Role | Who | What they do |
| --- | --- | --- |
| Committers and reviewers | Members of the [OldPeasant/thicket](https://github.com/OldPeasant/thicket) repository with write access | Change the source; every change reaches `main` through a reviewed commit or pull request |
| Approvers | The repository owner, [OldPeasant](https://github.com/OldPeasant) | Create release tags and approve each signing request in SignPath |

Every signing request needs a manual approval by an approver in SignPath. Before approving, the
approver checks that the request comes from the release workflow run of the expected tag
(SignPath shows the repository, workflow, run and commit). All team members use multi-factor
authentication for GitHub and SignPath.

### Privacy policy

This program will not transfer any information to other networked systems unless specifically
requested by the user or the person installing or operating it.

Thicket sends no telemetry. It only connects to the database servers, SSH hosts, proxies and
identity providers the user configures. Any future feature that contacts another system (for
example a check for new releases) will be listed here before it ships.

## One-time setup (maintainer)

These steps are done once, by a person with admin rights on the GitHub repository. Until they are
done, the release workflow builds Windows unsigned and says so in the run summary ("Windows
signing skipped").

1. **Apply to the programme.** Fill in the application on
   [signpath.org/apply](https://signpath.org/apply) for `OldPeasant/thicket`. The project has to
   meet the [programme conditions](https://signpath.org/terms) (OSI licence, no malware or
   potentially unwanted software, actively maintained, released, documented, and this policy
   published on the project's website: link this page from the README). Wait for the approval;
   SignPath creates an organization for the project.
2. **Connect GitHub.** In SignPath, open the organization → *Trusted Build Systems* and add
   (or confirm) the predefined *GitHub.com* trusted build system, then link it to the project
   below. This lets SignPath verify that each signing request comes from a GitHub Actions run of
   this repository (origin verification).
3. **Create the project.** *Projects* → *Add*: name `Thicket`, slug **`thicket`**, repository URL
   `https://github.com/OldPeasant/thicket`. The workflow uses this slug.
4. **Create the two artifact configurations** in the project. GitHub artifacts always arrive as a
   zip file, so both start with `<zip-file>`.
   - Slug **`win-app`**: the unpacked app folder (`win-unpacked`, uploaded with
     `Thicket.exe` at the top of the zip). Only Thicket's own executable is signed:

     ```xml
     <?xml version="1.0" encoding="utf-8"?>
     <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
       <zip-file>
         <pe-file path="Thicket.exe">
           <authenticode-sign />
         </pe-file>
       </zip-file>
     </artifact-configuration>
     ```

   - Slug **`win-installer`**: the NSIS installer, the only file in the zip:

     ```xml
     <?xml version="1.0" encoding="utf-8"?>
     <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
       <zip-file>
         <pe-file path="thicket-*-win-x64.exe" max-matches="1">
           <authenticode-sign />
         </pe-file>
       </zip-file>
     </artifact-configuration>
     ```

5. **Create the signing policy.** In the project: *Signing Policies* → *Add*: slug
   **`release-signing`**, the SignPath Foundation's release certificate, *Trusted build system*
   GitHub.com (origin verification on), approvers: the approvers from the policy above, at least
   one approval required. Optionally restrict it to the `release` workflow and `refs/tags/v*`.
6. **Create the API token.** *Users* → add a CI user (for example `github-actions`), give it the
   *Submitter* role on the `release-signing` policy and create an API token for it.
7. **Add the secret and the variable to GitHub.** Repository → *Settings* → *Secrets and
   variables* → *Actions*:
   - secret **`SIGNPATH_API_TOKEN`**: the API token from step 6;
   - variable **`SIGNPATH_ORGANIZATION_ID`**: the organization id (SignPath → *Organization* →
     *Settings*, a GUID).
8. **Test it.** Push a test tag (for example `v0.0.0-signtest`). The `build (win-x64)` job submits
   two signing requests (app, then installer); approve both in SignPath. Then download the draft
   release's installer and zip and check on Windows: *Properties* → *Digital Signatures*, or
   `Get-AuthenticodeSignature .\thicket-<version>-win-x64.exe` and the same for `Thicket.exe`
   from the zip; both should show a valid signature by "SignPath Foundation". Delete the test
   release and tag afterwards.

The task `signpath-setup` on the task board tracks these steps.

## How the release workflow signs

In the `build (win-x64)` job of [`release.yml`](../.github/workflows/release.yml):

1. `Check Windows signing setup` runs
   [`apps/desktop/scripts/signpath-enabled.mjs`](../apps/desktop/scripts/signpath-enabled.mjs): it
   signs only when both `SIGNPATH_API_TOKEN` and `SIGNPATH_ORGANIZATION_ID` are set; otherwise it
   logs a notice and the job builds installer and zip unsigned, exactly as before.
2. With signing, electron-builder first builds only the app folder (`--dir`,
   `release/win-unpacked`, Electron fuses already applied).
3. The folder is uploaded as a workflow artifact and sent to SignPath (`win-app`); the signed
   folder comes back as `release/win-signed`.
4. electron-builder builds the NSIS installer and the portable zip from the signed folder
   (`--prepackaged`), without repacking the app, so both contain the signed `Thicket.exe`.
5. The installer is uploaded and signed (`win-installer`) and replaces the unsigned one under the
   same name.
6. The release job computes `SHA256SUMS.txt` from the uploaded, signed files.

File names do not change: `thicket-<version>-win-x64.exe` and `thicket-<version>-win-x64.zip`,
signed or not. Each signing request waits up to an hour for its approval, so the Windows job may
take up to 150 minutes.

Known limitation: the uninstaller that NSIS generates inside the installer is not signed
(electron-builder generates it while building the installer, and SignPath only sees the finished
installer). It runs only when uninstalling, but AppLocker publisher rules would not allow it.
Signing it needs electron-builder's custom `sign` hook calling SignPath per file: a possible
follow-up.
