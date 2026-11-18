# Security policy

Narrivell holds people's unpublished books, so security issues are treated as top priority.

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately through GitHub:
**Security › Report a vulnerability** on this repository.

Include what you found, how to reproduce it, and the version (shown at the bottom of the app). You'll get an acknowledgement within 7 days. Confirmed issues are fixed in a new release as quickly as possible, and you'll be credited unless you'd rather not be.

## Supported versions

Only the latest release receives security fixes. Please keep Narrivell up to date.

## How Narrivell limits risk

- **No server.** Narrivell has no backend and no accounts; your work stays on your devices and in storage you choose.
- **Least privilege.** The app window gets no native permissions unless a feature explicitly needs one, and every permission is reviewed.
- **Strict content security policy** in both the Windows app and the web version: only Narrivell's own code can run.
- **System components stay patchable.** The Windows app uses Microsoft's Evergreen WebView2, which Windows keeps updated; the Linux `.deb`/`.rpm` packages use the distribution's WebKitGTK, which your package manager keeps updated. Narrivell doesn't bundle its own browser engine.
- **Protected install location.** The Windows app installs per machine under *Program Files*, and the Linux packages install system-wide under `/usr`; standard users can't modify either.
- **Dependencies are watched.** Dependabot, npm audit and CodeQL run on this repository; builds fail on known high-severity vulnerabilities in shipped code.
- **Your writing never goes into the repository.** Manuscript files are blocked by `.gitignore`.
