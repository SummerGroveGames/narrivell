# Contributing to Narrivell

Thanks for your interest! Narrivell is in early development. The most useful help right now is:

- **Bug reports** – use the *Bug report* issue template.
- **Feature ideas** – use the *Feature request* template. Tell us what you're trying to do as a writer, not just the button you want.
- **Testing with real-world Word files** – if an import loses or mangles comments, please report it.
- **Security reviews** – see [SECURITY.md](SECURITY.md) and report privately.

## Please don't share your manuscript

This repository is public. Never attach your real book, chapters or comments to an issue or pull request. If a bug needs a sample file, make a small made-up `.docx` that shows the same problem.

## About the licence

Narrivell is **source-available, not open source**: the code is public so you can see how it works and check its security, but it's a commercial product of Summer Grove Software. See [LICENSE](LICENSE).

## Pull requests

Because Narrivell will be sold, Summer Grove Software needs the right to include contributions in the product. **Before your first pull request can be merged, you'll be asked to agree to a short Contributor Licence Agreement (CLA).** Until the CLA is in place, code pull requests can't be accepted, but issues, ideas and security reports are very welcome.

When code contributions open:

1. Open an issue first for anything large, so we can agree on the approach.
2. Fork the repo and create a branch from `main`.
3. Keep each pull request focused on one change.
4. Run the tests (`npm test`) before submitting.
5. Describe *what* changed and *why*.

## The one rule

**Never lose a word.** Any change that touches saving, syncing, import or export must not be able to delete or silently overwrite a writer's text. If you're unsure, ask in the issue first.

## Code of conduct

Be kind and constructive. We follow the spirit of the [Contributor Covenant](https://www.contributor-covenant.org/).
